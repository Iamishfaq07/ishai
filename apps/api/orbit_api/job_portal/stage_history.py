"""Capture ORM tracker writes in their transaction; bulk updates call record explicitly."""
from typing import Any

from sqlalchemy import event, insert, inspect
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Mapper

from orbit_api.models import ApplicationStageEvent, JobApplication


def record(connection: Connection, row: JobApplication, previous: str | None, current: str,
           source: str = "tracker_recorded") -> None:
    connection.execute(insert(ApplicationStageEvent).values(
        user_id=row.user_id, application_id=row.id, from_status=previous, to_status=current, source=source))


@event.listens_for(JobApplication, "after_insert")
def inserted(mapper: Mapper[Any], connection: Connection, row: JobApplication) -> None:
    record(connection, row, None, row.status)


@event.listens_for(JobApplication, "after_update")
def changed(mapper: Mapper[Any], connection: Connection, row: JobApplication) -> None:
    history = inspect(row).attrs.status.history
    if history.has_changes():
        record(connection, row, history.deleted[0] if history.deleted else None, row.status)
