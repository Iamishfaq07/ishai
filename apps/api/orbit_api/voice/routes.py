"""The mock interviewer's natural voice: the question text in, MP3 audio streamed back (providers/tts.py).

The client asks `GET /v1/voice` what's on offer, then `POST /v1/voice/speak` per question. When it's unavailable (no
key, turned off, the day's characters used up, the provider down), the client reads the question with the device's
own voice instead, so a mock never goes silent. Only the interviewer's text is sent, and it's capped per request.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.guards import require_verified_email
from orbit_api.auth.security import current_user
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.entitlements import is_admin
from orbit_api.models import LiveSessionRow, UsageEvent, User
from orbit_api.providers.tts import TTSError, get_tts_provider
from orbit_api.ratelimit import limit_user
from orbit_api.transactions import lock_account

router = APIRouter(prefix="/v1/voice", tags=["voice"])
speak_limit = Depends(limit_user("voice-speak", rate_per_s=1, burst=20))
METRIC = "tts_chars"
NO_ANSWER = "The natural voice didn't answer. Using your device's voice."
MAX_CHARS = 800  # one interviewer turn; questions are far shorter


class Voice(BaseModel):
    id: str
    label: str
    model: str


# A small choice (D76): two women's and two men's Aura-2 voices that Deepgram describes as natural and suited to
# interviews and conversation. Measured from here they all start within the network's noise of each other (1.3-2.7 s
# to the first byte for a sentence, one connection kept open), so Vesta, Deepgram's "patient, empathetic" interview
# voice, is the default. Every model name was checked against Deepgram's list (a name it doesn't have fails every
# request). An older client's "us" (Thalia) gets the default. Deepgram has no Indian-English Aura-2 voice yet.
VOICES: dict[str, Voice] = {
    "vesta": Voice(id="vesta", label="Vesta · warm and patient", model="aura-2-vesta-en"),
    "aurora": Voice(id="aurora", label="Aurora · bright and lively", model="aura-2-aurora-en"),
    "pluto": Voice(id="pluto", label="Pluto · calm, deeper voice", model="aura-2-pluto-en"),
    "arcas": Voice(id="arcas", label="Arcas · natural and clear", model="aura-2-arcas-en"),
}
DEFAULT_VOICE = "vesta"
# Speaking pace (Settings and the video interview's setup): slower, normal, brisk.
MIN_SPEED, MAX_SPEED = 0.8, 1.25


def _day_start() -> datetime:
    return datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)


async def chars_left(db: AsyncSession, user: User) -> int | None:
    """Characters left today; None = no cap (the admin)."""
    if await is_admin(db, user):
        return None
    used = await db.scalar(select(func.coalesce(func.sum(UsageEvent.quantity), 0.0)).where(
        UsageEvent.user_id == user.id, UsageEvent.metric == METRIC, UsageEvent.created_at >= _day_start()))
    return max(get_settings().tts_daily_chars - int(used or 0), 0)


class VoiceStatus(BaseModel):
    available: bool
    voices: list[Voice]
    default_voice: str
    chars_left: int | None


@router.get("", response_model=VoiceStatus)
async def voice_status(user: Annotated[User, Depends(current_user)],
                       db: Annotated[AsyncSession, Depends(get_db)]) -> VoiceStatus:
    on = get_tts_provider() is not None
    return VoiceStatus(available=on, voices=list(VOICES.values()) if on else [], default_voice=DEFAULT_VOICE,
                       chars_left=await chars_left(db, user) if on else 0)


class SpeakIn(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_CHARS)
    voice: str = Field(DEFAULT_VOICE, max_length=16)
    session_id: str | None = Field(None, max_length=36)
    speed: float = Field(1.0, ge=MIN_SPEED, le=MAX_SPEED)


@router.post("/speak", dependencies=[speak_limit])
async def speak(body: SpeakIn, user: Annotated[User, Depends(require_verified_email)],
                db: Annotated[AsyncSession, Depends(get_db)]) -> StreamingResponse:
    provider = get_tts_provider()
    if provider is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "The natural voice isn't set up on this server.")
    voice = VOICES.get(body.voice) or VOICES[DEFAULT_VOICE]  # an older client's other choice: the one voice
    text = " ".join(body.text.split())
    # Only a session of the caller's own is named on the usage row.
    session = await db.get(LiveSessionRow, body.session_id) if body.session_id else None
    session_id = session.id if session is not None and session.user_id == user.id else None
    # The characters are taken before the provider is asked, under the account lock: two requests at once can't both
    # pass the check with the same characters left. A provider that doesn't answer gives them back.
    await lock_account(db, user.id)
    left = await chars_left(db, user)
    if left is not None and len(text) > left:
        await db.rollback()
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Today's natural-voice allowance is used up. Your device's voice reads the questions now.")
    spent = UsageEvent(user_id=user.id, session_id=session_id, metric=METRIC, quantity=float(len(text)))
    db.add(spent)
    await db.commit()
    speed = round(body.speed, 2)
    chunks = provider.stream(text, voice.model, speed) if speed != 1.0 else provider.stream(text, voice.model)
    try:
        first = await anext(chunks)  # fail here (a JSON error the client can fall back on), not mid-stream
    except TTSError as err:
        if speed == 1.0:
            await _give_back(db, spent)
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, NO_ANSWER) from err
        # A pace the provider won't take for this voice: the normal pace, and the client paces the playback itself.
        speed = 1.0
        chunks = provider.stream(text, voice.model)
        try:
            first = await anext(chunks)
        except (TTSError, StopAsyncIteration, httpx.HTTPError, OSError) as again:
            await _give_back(db, spent)
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, NO_ANSWER) from again
    except (StopAsyncIteration, httpx.HTTPError, OSError) as err:
        await _give_back(db, spent)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, NO_ANSWER) from err

    async def audio() -> AsyncIterator[bytes]:
        yield first
        async for chunk in chunks:
            yield chunk

    # X-Orbit-Speed: the pace the audio was made at (1 when the provider wouldn't take the one asked for).
    return StreamingResponse(audio(), media_type="audio/mpeg",
                             headers={"Cache-Control": "no-store", "X-Orbit-Speed": f"{speed:g}",
                                      "Access-Control-Expose-Headers": "X-Orbit-Speed"})


async def _give_back(db: AsyncSession, spent: UsageEvent) -> None:
    """The provider made no audio: the characters taken for it are given back."""
    await db.execute(delete(UsageEvent).where(UsageEvent.id == spent.id))
    await db.commit()
