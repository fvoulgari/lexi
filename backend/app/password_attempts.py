"""Bounded failure backoff, independent of IP and provider account existence."""

import asyncio
import hashlib
import hmac
from datetime import UTC, datetime, timedelta

from sqlalchemy import case
from sqlalchemy.dialects.postgresql import insert
from starlette.concurrency import run_in_threadpool

from app.models import LoginThrottle


class PasswordAttempts:
    def __init__(self, sessions, key):
        self.sessions = sessions
        self.key = key.encode()

    def record_failure(self, tenant, email):
        # HMAC prevents offline email-dictionary recovery from this table alone.
        # This normalization groups attempts, never links/resolves identities.
        message = f"lexi:password-failure\0{tenant}\0{email.strip().casefold()}"
        identifier = hmac.new(self.key, message.encode(), hashlib.sha256).hexdigest()
        now = datetime.now(UTC)
        cutoff = now - timedelta(minutes=5)
        statement = insert(LoginThrottle).values(
            client_hash=identifier, window_start=now, attempts=1
        )
        statement = statement.on_conflict_do_update(
            index_elements=[LoginThrottle.client_hash],
            set_={
                "window_start": case(
                    (LoginThrottle.window_start <= cutoff, now),
                    else_=LoginThrottle.window_start,
                ),
                "attempts": case(
                    (LoginThrottle.window_start <= cutoff, 1),
                    else_=LoginThrottle.attempts + 1,
                ),
            },
        ).returning(LoginThrottle.attempts)
        with self.sessions.begin() as db:
            attempts = db.execute(statement).scalar_one()
        # No hard lockout, no sleeping while holding a DB connection, and no
        # delay for successful credentials. IP limits remain a separate layer.
        return (0, 0, 0, 0.25, 0.5, 1)[min(attempts, 6) - 1]

    async def failed(self, tenant, email):
        delay = await run_in_threadpool(self.record_failure, tenant, email)
        if delay:
            await asyncio.sleep(delay)
