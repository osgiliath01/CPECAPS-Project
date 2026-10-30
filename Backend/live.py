"""Live updates: pushes "something changed" to every open browser (Server-Sent Events).

Every change in the app already writes a row to activity_logs. One watcher per server
checks that table every LIVE_CHECK_SECONDS and forwards new rows to the connected
browsers, which then reload what they're showing. Because it watches the database, it
also sees changes made through any other copy of the backend.

Only a small notice is sent (which kind of record changed, the action and who did it),
never the data itself. Normal users don't receive account-related notices.
"""
import asyncio
import json
import time
from typing import Optional, Set

from fastapi import APIRouter, Depends, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from sqlalchemy import func

import database
import models
import security

router = APIRouter(tags=["Live updates"])

LIVE_CHECK_SECONDS = 1.5      # how often the watcher looks for new activity
KEEPALIVE_SECONDS = 15        # comment line so proxies don't close an idle connection
ACCOUNT_CHECK_SECONDS = 60    # re-check that the viewer is still allowed in


class Hub:
    """Watches the Activity Log and fans new rows out to every open connection."""

    def __init__(self) -> None:
        self.queues: Set[asyncio.Queue] = set()
        self.last_id: Optional[int] = None

    def _fetch_new(self) -> list:
        db = database.SessionLocal()
        try:
            if self.last_id is None:
                self.last_id = db.query(func.max(models.ActivityLog.id)).scalar() or 0
                return []
            rows = (
                db.query(models.ActivityLog)
                .filter(models.ActivityLog.id > self.last_id)
                .order_by(models.ActivityLog.id)
                .limit(500)
                .all()
            )
            if rows:
                self.last_id = rows[-1].id
            return [
                {
                    "id": r.id,
                    "entity_type": r.entity_type,
                    "entity_id": r.entity_id,
                    "action": r.action,
                    "actor": r.actor,
                    "requested_by": (r.details or {}).get("requested_by") if isinstance(r.details, dict) else None,
                }
                for r in rows
            ]
        finally:
            db.close()

    async def run(self) -> None:
        while True:
            try:
                events = await run_in_threadpool(self._fetch_new)
                for event in events:
                    for q in list(self.queues):
                        if q.full():
                            # A browser that stopped reading: drop its backlog and tell it
                            # to reload everything instead
                            _drain(q)
                            q.put_nowait({"resync": True})
                        else:
                            q.put_nowait(event)
            except Exception as e:  # database briefly unreachable: try again next round
                print(f"[live] check failed: {e}")
            await asyncio.sleep(LIVE_CHECK_SECONDS)

    def close(self) -> None:
        for q in list(self.queues):
            _drain(q)
            q.put_nowait(None)  # tells each open stream to finish


def _drain(q: asyncio.Queue) -> None:
    while not q.empty():
        q.get_nowait()


hub = Hub()


def _still_allowed(user_id: int) -> bool:
    db = database.SessionLocal()
    try:
        u = db.get(models.User, user_id)
        return bool(u and u.is_active and not u.must_change_password)
    finally:
        db.close()


def _sse(data: dict, event: Optional[str] = None) -> str:
    head = f"event: {event}\n" if event else ""
    return f"{head}data: {json.dumps(data)}\n\n"


@router.get("/live")
async def live_updates(
    request: Request,
    current_user: models.User = Depends(security.get_current_user),
):
    """Server-Sent Events stream for the signed-in user. The browser keeps it open."""
    user_id, username, is_admin = current_user.id, current_user.username, current_user.is_superuser
    queue: asyncio.Queue = asyncio.Queue(maxsize=1000)
    hub.queues.add(queue)

    async def stream():
        try:
            yield "retry: 3000\n\n"
            yield _sse({"last_id": hub.last_id, "username": username}, "hello")
            last_account_check = time.monotonic()
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=KEEPALIVE_SECONDS)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
                    event = False
                if event is None:  # server shutting down
                    break
                if event:
                    if event.get("resync"):
                        yield _sse({}, "resync")
                    elif is_admin or event["entity_type"] != "user":
                        yield _sse(event)
                if time.monotonic() - last_account_check > ACCOUNT_CHECK_SECONDS:
                    last_account_check = time.monotonic()
                    if not await run_in_threadpool(_still_allowed, user_id):
                        yield _sse({}, "bye")
                        break
        finally:
            hub.queues.discard(queue)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )
