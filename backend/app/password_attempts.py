"""Bounded failure backoff, independent of IP and provider account existence."""

import asyncio
import hashlib
import hmac
import threading
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta

from sqlalchemy import case, text
from sqlalchemy.dialects.postgresql import insert

from app.models import LoginThrottle


class PasswordAttemptBusy(Exception):
    """Another request currently holds this identifier's short verification slot."""


class PasswordVerificationUnavailable(Exception):
    pass


class PasswordAttempts:
    def __init__(self, sessions, key):
        self.sessions = sessions
        self.key = key.encode()

    def identifier(self, tenant, email):
        # Normalization groups throttles, never links or resolves identities.
        message = f"lexi:password-failure\0{tenant}\0{email.strip().casefold()}"
        return hmac.new(self.key, message.encode(), hashlib.sha256).hexdigest()

    def acquire(self, identifier):
        # Session advisory locks work across replicas and release on connection
        # loss. Never wait for a lock or persist an account lockout. Each admitted
        # provider operation has a bounded timeout at the caller.
        key = int.from_bytes(bytes.fromhex(identifier)[:8], "big", signed=True)
        session = self.sessions()
        try:
            if session.scalar(text("SELECT pg_try_advisory_lock(:key)"), {"key": key}):
                return session, key
        except BaseException:
            session.invalidate()
            raise
        session.close()
        raise PasswordAttemptBusy()

    @staticmethod
    def release(slot):
        session, key = slot
        try:
            session.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": key})
            session.commit()
        except BaseException:
            session.invalidate()
            raise
        finally:
            session.close()

    @asynccontextmanager
    async def attempt(self, tenant, email):
        loop = asyncio.get_running_loop()
        handoff = threading.Lock()
        state = {"cancelled": False, "slot": None}

        def acquire_owned():
            slot = self.acquire(self.identifier(tenant, email))
            with handoff:
                cancelled = state["cancelled"]
                if not cancelled:
                    state["slot"] = slot
            if cancelled:
                self.release(slot)
            return slot

        def consume_exception(future):
            if not future.cancelled():
                future.exception()

        def release_owned(slot):
            # An executor future has its own ownership; repeated request
            # cancellation cannot cancel the cleanup or leak a pooled lock.
            future = loop.run_in_executor(None, self.release, slot)
            future.add_done_callback(consume_exception)
            return future

        future = loop.run_in_executor(None, acquire_owned)
        future.add_done_callback(consume_exception)
        try:
            slot = await asyncio.shield(future)
        except asyncio.CancelledError:
            with handoff:
                state["cancelled"] = True
                slot = state["slot"]
                state["slot"] = None
            if slot is not None:
                release_owned(slot)
            raise
        with handoff:
            state["slot"] = None
        try:
            yield slot[0]
        finally:
            await asyncio.shield(release_owned(slot))

    def record_failure(self, tenant, email, session=None):
        identifier = self.identifier(tenant, email)
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
        if session is not None:
            attempts = session.execute(statement).scalar_one()
        else:
            with self.sessions.begin() as db:
                attempts = db.execute(statement).scalar_one()
        # No persistent lockout or delay for successful credentials. The short
        # verification lease deliberately covers failure delay across replicas.
        return (0, 0, 0, 0.25, 0.5, 1)[min(attempts, 6) - 1]

    async def failed(self, tenant, email, session=None):
        future = asyncio.get_running_loop().run_in_executor(
            None, self.record_failure, tenant, email, session
        )
        try:
            delay = await asyncio.shield(future)
        except asyncio.CancelledError:
            # Finish this Session operation before the context releases its
            # connection. Repeated cancellation must not overlap SQL and unlock.
            while not future.done():
                try:
                    await asyncio.shield(future)
                except asyncio.CancelledError:
                    pass
            future.result()
            raise
        if delay:
            await asyncio.sleep(delay)
