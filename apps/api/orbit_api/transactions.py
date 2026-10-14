from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.models import User


async def lock_account(db: AsyncSession, user_id: str) -> None:
    """Serialize quota/credit decisions until commit. SQLite ignores FOR UPDATE, so acquire its writer lock."""
    if db.get_bind().dialect.name == "sqlite":
        await db.execute(update(User).where(User.id == user_id).values(token_version=User.token_version))
    else:
        await db.execute(select(User.id).where(User.id == user_id).with_for_update())
