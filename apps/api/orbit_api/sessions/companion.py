"""Phone companion: a read-only second screen for a live session.

The desktop (or web) owner shows a QR code; the phone opens `/companion/<code>` and follows the live question and
answer without capturing anything. Flow:

1. `POST /v1/sessions/{id}/companion` (owner) → a share `code`, valid until the session ends or 4 h pass. The same
   code is returned while it's valid, so the QR stays stable; `DELETE` stops sharing and disconnects phones.
2. `POST /v1/companion/{code}` (no login — the code is the credential; 256-bit random, rate-limited) → a
   single-use, 60 s view ticket, like live tickets.
3. `WS /v1/sessions/{id}/view?ticket=…` → the events the live socket gets (minus interim transcript), replaying the
   recent ones first so a phone joining mid-session catches up. Anything the phone sends is ignored.

Every viewer has its own bounded queue and writer task, so a slow phone never delays the live session; one that
falls too far behind is dropped (it reconnects and replays). In-process state, like tickets and live sockets: fine
for the single API instance (D12).
"""

import asyncio
import contextlib
import json
import secrets
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import current_user
from orbit_api.db import get_db
from orbit_api.models import LiveSessionRow, User
from orbit_api.ratelimit import limit

router = APIRouter(prefix="/v1", tags=["companion"])

SHARE_TTL_S = 4 * 3600
VIEW_TICKET_TTL_S = 60
MAX_VIEWERS = 3
REPLAY_EVENTS = 400
VIEWER_QUEUE = 1_000
# Interim transcript is high-volume and the phone doesn't show it; everything else is mirrored.
SKIP_TYPES = frozenset({"transcript.partial"})
CLOSE_SHARE_ENDED = 4009

redeem_limit = limit("companion-redeem", rate_per_s=0.5, burst=10)


@dataclass
class _Share:
    session_id: str
    user_id: str
    title: str
    expires_at: float


@dataclass
class _Viewer:
    ws: WebSocket
    queue: "asyncio.Queue[str | None]" = field(default_factory=lambda: asyncio.Queue(VIEWER_QUEUE))


_shares: dict[str, _Share] = {}
_view_tickets: dict[str, tuple[str, float]] = {}  # ticket → (session_id, expires_at)
_viewers: dict[str, list[_Viewer]] = {}
_recent: dict[str, deque[str]] = {}


def _prune(now: float) -> None:
    for code in [c for c, s in _shares.items() if s.expires_at < now]:
        del _shares[code]
    for t in [t for t, (_, exp) in _view_tickets.items() if exp < now]:
        del _view_tickets[t]
    shared = {s.session_id for s in _shares.values()}
    for sid in [sid for sid in _recent if sid not in shared and sid not in _viewers]:
        del _recent[sid]  # expired share, nobody watching: drop its replay buffer


def share_code(session_id: str, user_id: str, title: str) -> tuple[str, int]:
    now = time.monotonic()
    _prune(now)
    for code, s in _shares.items():
        if s.session_id == session_id:
            return code, int(s.expires_at - now)
    code = secrets.token_urlsafe(32)
    _shares[code] = _Share(session_id, user_id, title, now + SHARE_TTL_S)
    return code, SHARE_TTL_S


def publish(session_id: str, msg: dict[str, Any]) -> None:
    """Mirror one live-socket event to the session's phones (non-blocking; called from the live send path)."""
    if msg.get("type") in SKIP_TYPES:
        return
    if session_id not in _viewers and not any(s.session_id == session_id for s in _shares.values()):
        return  # nobody is (or can be) watching: keep no buffer
    frame = json.dumps(msg, separators=(",", ":"))
    _recent.setdefault(session_id, deque(maxlen=REPLAY_EVENTS)).append(frame)
    for v in list(_viewers.get(session_id, [])):
        try:
            v.queue.put_nowait(frame)
        except asyncio.QueueFull:  # hopelessly behind: drop it; it will reconnect and replay
            _detach(session_id, v)
    if msg.get("type") == "session.ended":  # the phones get this last event, then are disconnected
        stop_sharing(session_id)


def _detach(session_id: str, v: _Viewer) -> None:
    viewers = _viewers.get(session_id, [])
    if v in viewers:
        viewers.remove(v)
        with contextlib.suppress(asyncio.QueueFull):
            v.queue.put_nowait(None)
    if not viewers:
        _viewers.pop(session_id, None)


def stop_sharing(session_id: str) -> None:
    """Session ended or sharing stopped: revoke codes, forget the replay buffer, disconnect phones."""
    for code in [c for c, s in _shares.items() if s.session_id == session_id]:
        del _shares[code]
    for t in [t for t, (sid, _) in _view_tickets.items() if sid == session_id]:
        del _view_tickets[t]
    _recent.pop(session_id, None)
    for v in list(_viewers.get(session_id, [])):
        _detach(session_id, v)


class ShareOut(BaseModel):
    code: str
    expires_in: int


class RedeemOut(BaseModel):
    session_id: str
    title: str
    ticket: str


async def _owned_session(session_id: str, user: User, db: AsyncSession) -> LiveSessionRow:
    row = await db.get(LiveSessionRow, session_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    return row


@router.post("/sessions/{session_id}/companion", response_model=ShareOut)
async def start_sharing(session_id: str, user: Annotated[User, Depends(current_user)],
                        db: Annotated[AsyncSession, Depends(get_db)]) -> ShareOut:
    row = await _owned_session(session_id, user, db)
    if row.status == "ended":
        raise HTTPException(status.HTTP_409_CONFLICT, "This session has ended.")
    code, expires_in = share_code(row.id, user.id, row.title)
    return ShareOut(code=code, expires_in=expires_in)


@router.delete("/sessions/{session_id}/companion", status_code=204)
async def end_sharing(session_id: str, user: Annotated[User, Depends(current_user)],
                      db: Annotated[AsyncSession, Depends(get_db)]) -> None:
    await _owned_session(session_id, user, db)
    stop_sharing(session_id)


@router.post("/companion/{code}", response_model=RedeemOut, dependencies=[Depends(redeem_limit)])
async def redeem(code: str) -> RedeemOut:
    now = time.monotonic()
    _prune(now)
    share = _shares.get(code)
    if share is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This link has expired. Show a new code on your computer.")
    ticket = secrets.token_urlsafe(32)
    _view_tickets[ticket] = (share.session_id, now + VIEW_TICKET_TTL_S)
    return RedeemOut(session_id=share.session_id, title=share.title, ticket=ticket)


@router.websocket("/sessions/{session_id}/view")
async def view(ws: WebSocket, session_id: str, ticket: str = "") -> None:
    entry = _view_tickets.pop(ticket, None)
    if entry is None or entry[0] != session_id or entry[1] < time.monotonic():
        await ws.close(code=4001, reason="invalid or expired ticket")
        return
    if len(_viewers.get(session_id, [])) >= MAX_VIEWERS:
        await ws.close(code=4029, reason="too many companion screens")
        return
    await ws.accept()
    viewer = _Viewer(ws)
    for frame in list(_recent.get(session_id, [])):  # catch up first, then live
        viewer.queue.put_nowait(frame)
    _viewers.setdefault(session_id, []).append(viewer)

    async def writer() -> None:
        while (frame := await viewer.queue.get()) is not None:
            await ws.send_text(frame)
        with contextlib.suppress(Exception):
            await ws.close(code=CLOSE_SHARE_ENDED, reason="sharing ended")

    writing = asyncio.create_task(writer())
    try:
        while not writing.done():  # read-only: drain (and ignore) anything the phone sends
            receiving = asyncio.create_task(ws.receive())
            done, _ = await asyncio.wait({receiving, writing}, return_when=asyncio.FIRST_COMPLETED)
            if receiving in done:
                if receiving.result()["type"] == "websocket.disconnect":
                    break
            else:
                receiving.cancel()
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        _detach(session_id, viewer)
        writing.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await writing
