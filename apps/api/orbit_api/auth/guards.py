"""Access guards layered on `current_user`.

`require_verified_user` gates everything that spends paid-provider money (Deepgram, DeepSeek) or stores user
uploads: creating sessions, live tickets, screenshots, AI review, document uploads. Unverified users keep access to
their account (/me, verify, resend, logout, privacy, deletion) so they can finish verifying or leave.
"""

from typing import Annotated

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import current_user
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.entitlements import is_admin
from orbit_api.models import User

EMAIL_UNVERIFIED = "email_unverified"


async def require_verified_user(user: Annotated[User, Depends(current_user)],
                                db: Annotated[AsyncSession, Depends(get_db)]) -> User:
    if not get_settings().verification_required or user.email_verified or await is_admin(db, user):
        return user
    raise HTTPException(
        status.HTTP_403_FORBIDDEN,
        detail={"code": EMAIL_UNVERIFIED,
                "message": f"Verify your email to use this. We sent a link to {user.email} — "
                           "you can resend it from the banner."},
    )


VerifiedUser = Annotated[User, Depends(require_verified_user)]
