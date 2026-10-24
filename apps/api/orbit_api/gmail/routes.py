"""User-connected Gmail sending with immutable reviewed attempts and no automatic resend."""
import asyncio
import base64
import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import APIRouter, Depends, Form, HTTPException, Response, UploadFile
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.google import _jwks
from orbit_api.auth.guards import require_verified_email
from orbit_api.auth.security import current_user
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.gmail.delivery import ApplicationEmail, ResumeAttachment, compose, send_once
from orbit_api.job_portal.message_updates import owned
from orbit_api.models import GmailAttempt, GmailConnection, JobApplication, User
from orbit_api.ratelimit import limit_user
from orbit_api.runtime_config import _decrypt_secret, encrypt_secret, secrets_editable
from orbit_api.transactions import lock_account

router = APIRouter(prefix="/v1/gmail", tags=["gmail"],
    dependencies=[Depends(limit_user("gmail", rate_per_s=1, burst=15))])
SCOPE = "https://www.googleapis.com/auth/gmail.send"


def enabled() -> bool:
    s = get_settings()
    return bool(s.google_enabled and s.gmail_redirect_uri and secrets_editable())


def client_secret() -> str:
    secret = get_settings().google_client_secret
    return secret.get_secret_value() if secret else ""


def require_config() -> None:
    if not enabled():
        raise HTTPException(503, "Gmail needs Google OAuth, ORBIT_GMAIL_REDIRECT_URI and encrypted storage configured.")


@router.get("")
async def status(user: Annotated[User, Depends(current_user)],
                 db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    row = await db.get(GmailConnection, user.id)
    return {"configured": enabled(), "connected": bool(row and row.data.get("refresh")),
            "email": row.data.get("email") if row else None}


@router.post("/connect")
async def connect(user: Annotated[User, Depends(require_verified_email)],
                  db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, str]:
    require_config()
    s = get_settings()
    state, verifier, nonce = secrets.token_urlsafe(32), secrets.token_urlsafe(48), secrets.token_urlsafe(32)
    await lock_account(db, user.id)
    row = await db.get(GmailConnection, user.id, populate_existing=True)
    data = dict(row.data) if row else {}
    generation = str(uuid.uuid4())
    data["generation"] = generation
    data["pending"] = {"state": hashlib.sha256(state.encode()).hexdigest(), "verifier": encrypt_secret(verifier),
                       "nonce": nonce, "expires": (datetime.now(UTC) + timedelta(minutes=10)).timestamp()}
    if row:
        row.data = data
    else:
        db.add(GmailConnection(user_id=user.id, data=data))
    await db.commit()
    return {"url": "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode({
        "client_id": s.google_client_id, "redirect_uri": s.gmail_redirect_uri, "response_type": "code",
        "scope": f"openid email {SCOPE}", "access_type": "offline", "prompt": "consent", "state": state,
        "nonce": nonce, "code_challenge_method": "S256",
        "code_challenge": base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")})}


@router.get("/callback")
async def callback(state: str, user: Annotated[User, Depends(current_user)],
                   db: Annotated[AsyncSession, Depends(get_db)], code: str | None = None,
                   error: str | None = None) -> RedirectResponse:
    require_config()
    s = get_settings()
    await lock_account(db, user.id)
    row = await db.scalar(select(GmailConnection).where(GmailConnection.user_id == user.id).with_for_update())
    pending = row.data.get("pending", {}) if row else {}
    if not row or not secrets.compare_digest(pending.get("state", ""), hashlib.sha256(state.encode()).hexdigest()) \
            or pending.get("expires", 0) < datetime.now(UTC).timestamp():
        raise HTTPException(409, "Gmail connection expired. Connect again from Settings.")
    generation = row.data.get("generation")
    data = dict(row.data)
    data.pop("pending", None)
    row.data = data
    await db.commit()  # Consume the state once, including denied or failed exchanges.
    if error or not code:
        return RedirectResponse(s.web_url.rstrip("/") + "/settings?gmail=denied", status_code=303)
    verifier = _decrypt_secret(pending["verifier"])
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post("https://oauth2.googleapis.com/token", data={
                "client_id": s.google_client_id, "client_secret": client_secret(),
                "redirect_uri": s.gmail_redirect_uri, "grant_type": "authorization_code", "code": code,
                "code_verifier": verifier}, timeout=20)
        token = response.json()
        if response.status_code != 200 or SCOPE not in token.get("scope", "").split() or not token.get("refresh_token"):
            raise ValueError("Missing grant")
        key = await asyncio.to_thread(_jwks.get_signing_key_from_jwt, token["id_token"])
        identity = jwt.decode(token["id_token"], key.key, algorithms=["RS256"], audience=s.google_client_id,
                              issuer=["https://accounts.google.com", "accounts.google.com"])
        if identity.get("nonce") != pending["nonce"] or identity.get("email_verified") is not True:
            raise ValueError("Unverified identity")
        data = {"email": identity["email"], "refresh": encrypt_secret(token["refresh_token"]),
                "generation": generation}
    except (httpx.HTTPError, ValueError, KeyError, jwt.PyJWTError) as exc:
        raise HTTPException(502, "Google connection could not be verified. Connect again from Settings.") from exc
    await lock_account(db, user.id)
    latest = await db.get(GmailConnection, user.id, populate_existing=True)
    if latest is None or latest.data.get("generation") != generation:
        raise HTTPException(409, "A newer Gmail connection replaced this flow. Continue from Settings.")
    await db.execute(update(GmailConnection).where(GmailConnection.user_id == user.id).values(data=data))
    await db.commit()
    return RedirectResponse(s.web_url.rstrip("/") + "/settings?gmail=connected", status_code=303)


@router.delete("", status_code=204)
async def disconnect(user: Annotated[User, Depends(current_user)],
                     db: Annotated[AsyncSession, Depends(get_db)]) -> None:
    await lock_account(db, user.id)
    await db.execute(delete(GmailConnection).where(GmailConnection.user_id == user.id))
    await db.commit()


@router.post("/draft/{entry_id}", status_code=201)
async def draft(entry_id: str, payload: Annotated[str, Form()], user: Annotated[User, Depends(require_verified_email)],
                db: Annotated[AsyncSession, Depends(get_db)], file: UploadFile | None = None) -> dict[str, Any]:
    require_config()
    await owned(db, user, entry_id)
    connection = await db.get(GmailConnection, user.id)
    if not connection or not connection.data.get("refresh"):
        raise HTTPException(409, "Connect Gmail first.")
    try:
        message = ApplicationEmail.model_validate_json(payload)
    except ValueError as exc:
        raise HTTPException(422, "Review recipient, subject and body.") from exc
    attachment = None
    if file:
        try:
            raw = await file.read(5_000_001)
            attachment = ResumeAttachment(file.filename or "resume.pdf", raw)
        finally:
            await file.close()
    identity = str(uuid.uuid4())
    try:
        mime = compose(message, connection.data["email"], identity, attachment)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return await save_draft(db, user, entry_id, message, mime, identity,
                            attachment.filename if attachment else None, connection.data["email"])


async def save_draft(db: AsyncSession, user: User, entry_id: str, message: ApplicationEmail, mime: bytes,
                     identity: str, attachment_name: str | None, sender: str,
                     extra: dict[str, Any] | None = None) -> dict[str, Any]:
    await db.scalar(select(User).where(User.id == user.id).with_for_update())
    count = await db.scalar(select(func.count()).select_from(GmailAttempt).where(GmailAttempt.user_id == user.id,
        GmailAttempt.created_at >= datetime.now(UTC) - timedelta(days=1)))
    if (count or 0) >= 20:
        raise HTTPException(429, "Up to 20 Gmail application drafts per rolling day.")
    row = GmailAttempt(id=identity, user_id=user.id, application_id=entry_id, status="ready", data={
        **message.model_dump(), "sender": sender, "mime": base64.b64encode(mime).decode(),
        "sha256": hashlib.sha256(mime).hexdigest(), "attachment": attachment_name,
        **(extra or {})})
    db.add(row)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "This job already has a Gmail attempt. Review its record before continuing.") from None
    return {"id": identity, "status": "ready", **{k: v for k, v in row.data.items() if k != "mime"}}


class Confirmation(BaseModel):
    confirmed: bool = Field(strict=True)


@router.post("/attempts/{attempt_id}/send")
async def send(attempt_id: str, body: Confirmation, user: Annotated[User, Depends(require_verified_email)],
               db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]:
    require_config()
    if not body.confirmed:
        raise HTTPException(422, "Confirm the reviewed email and attachment.")
    row = await db.get(GmailAttempt, attempt_id)
    connection = await db.get(GmailConnection, user.id)
    if not row or row.user_id != user.id:
        raise HTTPException(404, "Email attempt not found")
    if not connection or connection.data.get("email") != row.data.get("sender"):
        raise HTTPException(409, "Reconnect the same Gmail account used for this draft.")
    connection_stamp = (connection.data.get("generation"), connection.data.get("refresh"))
    refresh = _decrypt_secret(connection.data.get("refresh", ""))
    if not refresh:
        raise HTTPException(409, "Reconnect Gmail to restore access.")
    mime = base64.b64decode(row.data["mime"])
    if hashlib.sha256(mime).hexdigest() != row.data["sha256"]:
        raise HTTPException(409, "Draft content is inconsistent. Do not send this record.")
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post("https://oauth2.googleapis.com/token", data={
                "client_id": get_settings().google_client_id,
                "client_secret": client_secret(),
                "refresh_token": refresh, "grant_type": "refresh_token"}, timeout=20)
            token = response.json()
            if response.status_code != 200 or not isinstance(token.get("access_token"), str):
                raise ValueError("Refresh rejected")
        except (httpx.HTTPError, ValueError) as exc:
            raise HTTPException(409, "Gmail access could not be refreshed. Reconnect before sending.") from exc
        await lock_account(db, user.id)
        latest = await db.get(GmailConnection, user.id, populate_existing=True)
        if latest is None or (latest.data.get("generation"), latest.data.get("refresh")) != connection_stamp:
            raise HTTPException(409, "Gmail was disconnected or changed before delivery. Review the connection again.")
        entry = await db.scalar(select(JobApplication).where(JobApplication.id == row.application_id,
            JobApplication.user_id == user.id).with_for_update().execution_options(populate_existing=True))
        if entry is None:
            raise HTTPException(409, "This opportunity was removed before delivery.")
        if entry.status in {"withdrawn", "rejected", "hired"}:
            raise HTTPException(409, "This opportunity is closed. Reopen it explicitly before sending an application.")
        reserved = await db.scalar(update(GmailAttempt).where(GmailAttempt.id == row.id,
            GmailAttempt.user_id == user.id, GmailAttempt.status == "ready").values(status="sending")
            .returning(GmailAttempt.id))
        if not reserved:
            raise HTTPException(409, "This attempt has already been sent or reserved. "
                                "Do not resend uncertain attempts.")
        await db.commit()  # Crash after this point remains reserved; never automatically retry.
        result = await send_once(client, token["access_token"], mime)
    if result.status == "sent":
        from orbit_api.job_portal.routes import _move

        entry = await owned(db, user, row.application_id)
        if entry.status == "saved":
            _move(entry, "applied")
    row.status = result.status
    row.data = {**row.data, "message_id": result.message_id, "reason": result.reason,
                "recorded_at": datetime.now(UTC).isoformat()}
    await db.commit()
    return {"id": row.id, "status": row.status, "message_id": result.message_id, "reason": result.reason}


@router.get("/attempts/{entry_id}")
async def attempts(entry_id: str, user: Annotated[User, Depends(current_user)],
                   db: Annotated[AsyncSession, Depends(get_db)]) -> list[dict[str, Any]]:
    await owned(db, user, entry_id)
    rows = await db.scalars(select(GmailAttempt).where(GmailAttempt.user_id == user.id,
                                                      GmailAttempt.application_id == entry_id))
    return [{"id": r.id, "status": r.status, **{k: v for k, v in r.data.items() if k != "mime"}} for r in rows]


@router.delete("/attempts/{attempt_id}", status_code=204)
async def discard(attempt_id: str, user: Annotated[User, Depends(current_user)],
                   db: Annotated[AsyncSession, Depends(get_db)]) -> None:
    removed = await db.scalar(delete(GmailAttempt).where(GmailAttempt.id == attempt_id,
        GmailAttempt.user_id == user.id, GmailAttempt.status == "ready").returning(GmailAttempt.id))
    if not removed:
        raise HTTPException(409, "Only an unsent draft can be discarded.")
    await db.commit()


@router.get("/attempts/{attempt_id}/attachment")
async def attachment(attempt_id: str, user: Annotated[User, Depends(current_user)],
                      db: Annotated[AsyncSession, Depends(get_db)]) -> Response:
    from email import policy
    from email.parser import BytesParser

    row = await db.get(GmailAttempt, attempt_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(404, "Email attempt not found")
    mime = base64.b64decode(row.data["mime"])
    if hashlib.sha256(mime).hexdigest() != row.data["sha256"]:
        raise HTTPException(409, "Captured email content is inconsistent")
    mail = BytesParser(policy=policy.default).parsebytes(mime)
    part = next(mail.iter_attachments(), None)
    if part is None:
        raise HTTPException(404, "No attachment was captured")
    name = "resume.docx" if part.get_content_subtype().endswith("document") else "resume.pdf"
    return Response(part.get_payload(decode=True), media_type=part.get_content_type(),
                    headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"})
