"""Access guards layered on `current_user`.

`require_verified_user` gates everything that spends paid-provider money (Deepgram, DeepSeek) or stores user
uploads: creating sessions, live tickets, screenshots, AI review, document uploads. Unverified users keep access to
their account (/me, verify, resend, logout, privacy, deletion) so they can finish verifying or leave.

With sign-up approval on (ORBIT_SIGNUP_APPROVAL), the same gate also holds back a new account until the admin
approves it or grants it a plan for a while.

`require_verified_email` is the email half alone, for the resume maker: an account waiting for approval may use it,
since its AI is capped by the free allowance (resumes/allowance.py), exactly as when signed out, and it's where a
newcomer buys Resume Pro (approving the payment approves the account).
"""

from typing import Annotated

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.auth.security import current_user
from orbit_api.config import get_settings
from orbit_api.db import get_db
from orbit_api.entitlements import PENDING, awaiting_approval, is_admin, plan_for
from orbit_api.models import User

EMAIL_UNVERIFIED = "email_unverified"
APPROVAL_PENDING = "approval_pending"


async def require_verified_email(user: Annotated[User, Depends(current_user)],
                                 db: Annotated[AsyncSession, Depends(get_db)]) -> User:
    if get_settings().verification_required and not user.email_verified and not await is_admin(db, user):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail={"code": EMAIL_UNVERIFIED,
                    "message": f"Verify your email to use this. We sent a link to {user.email} — "
                               "you can resend it from the banner."},
        )
    return user


async def require_verified_user(user: Annotated[User, Depends(require_verified_email)],
                                db: Annotated[AsyncSession, Depends(get_db)]) -> User:
    # plan_for also counts the admin and paid plans, which awaiting_approval() alone can't see.
    if awaiting_approval(user) and await plan_for(db, user.id) is PENDING:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail={"code": APPROVAL_PENDING,
                    "message": "Your account is waiting for approval. You'll get an email as soon as it's ready."},
        )
    return user


VerifiedUser = Annotated[User, Depends(require_verified_user)]
