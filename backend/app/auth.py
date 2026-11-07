"""Verified provider sessions and application account provisioning."""

import hashlib
import logging
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, Request, Response
from sqlalchemy import case, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse

from app.access import account_context
from app.auth_provider import configuration_ready, configure_provider
from app.ingress import loopback_peer, tunnel_client_ip
from app.models import Account, LoginThrottle, Profile
from app.password_attempts import PasswordAttemptBusy, PasswordVerificationUnavailable

log = logging.getLogger("lexi.security")


def fail(status, code, message):
    raise HTTPException(status_code=status, detail={"code": code, "message": message})


class AuthGate:
    def __init__(self, settings, sessions, ready=False):
        self.settings = settings
        self.sessions = sessions
        self.ready = ready

    async def _session(self, request, required=True):
        if not self.ready:
            if required:
                fail(503, "authentication_unavailable", "Sign-in is not configured.")
            return None
        from supertokens_python.recipe.session.asyncio import get_session

        # SDK verifies signature, expiry and claims. A Core check on every request
        # is deliberate: revoked access tokens must stop working immediately.
        return await get_session(
            request,
            session_required=required,
            check_database=True,
            anti_csrf_check=request.method not in {"GET", "HEAD", "OPTIONS"},
            **(
                {"override_global_claim_validators": lambda _v, _s, _c: []}
                if not required
                else {}
            ),
        )

    async def _verified(self, session):
        from supertokens_python.recipe.emailverification.asyncio import (
            is_email_verified,
        )

        return await is_email_verified(session.get_recipe_user_id())

    def _account(self, subject):
        with self.sessions.begin() as db:
            account = db.scalar(
                select(Account).where(Account.provider_subject == subject)
            )
            if account is None:
                # Unique subject + transaction protects simultaneous first requests.
                try:
                    with db.begin_nested():
                        profile = Profile(id=uuid.uuid4(), display_name="Learner")
                        db.add(profile)
                        db.flush()
                        account = Account(
                            id=uuid.uuid4(),
                            provider_subject=subject,
                            profile_id=profile.id,
                            role="learner",
                            legacy_access=False,
                        )
                        db.add(account)
                        db.flush()
                    log.info("account_created")
                except IntegrityError:
                    account = db.scalar(
                        select(Account).where(Account.provider_subject == subject)
                    )
                    if account is None:
                        raise
            # Return usable identity after transaction/session closes.
            db.expunge(account)
            return account

    async def require(self, request: Request):
        existing = getattr(request.state, "account", None)
        if existing is not None:
            return existing
        session = await self._session(request)
        if session is None:
            fail(401, "authentication_required", "Sign in first.")
        if not await self._verified(session):
            fail(403, "email_verification_required", "Verify your email first.")
        account = await run_in_threadpool(self._account, session.get_user_id())
        request.state.account = account
        request.state.auth_session = session
        account_context.set(account)
        return account

    async def check_csrf(self, request: Request):
        origin = request.headers.get("origin")
        if (
            request.headers.get("rid") != "session"
            or (origin and origin != self.settings.public_origin.rstrip("/"))
            or request.headers.get("sec-fetch-site") == "cross-site"
        ):
            fail(403, "csrf_rejected", "Refresh the page and try again.")
        await self.require(request)

    async def state(self, request: Request, response: Response):
        response.headers["Cache-Control"] = "no-store"
        session = await self._session(request, required=False)
        result = {
            "authenticated": False,
            "auth_available": self.ready,
            "csrf_token": "supertokens",
        }
        if session is None:
            return result
        if not await self._verified(session):
            result["verification_required"] = True
            return result
        account = await self.require(request)
        with self.sessions() as db:
            profile = db.get(Profile, account.profile_id)
            display_name = profile.display_name if profile else "Learner"
        result.update(
            authenticated=True,
            account={
                "id": str(account.id),
                "role": account.role,
                "legacy_access": account.legacy_access,
                "interface_language": account.interface_language,
                "profile_id": str(account.profile_id),
                "display_name": display_name,
            },
        )
        return result

    async def logout(self, request: Request, response: Response):
        await self.check_csrf(request)
        await request.state.auth_session.revoke_session()
        response.headers["Cache-Control"] = "no-store"
        log.info("logout")
        return {"authenticated": False}

    async def logout_all(self, request: Request, response: Response):
        await self.check_csrf(request)
        from supertokens_python.recipe.session.asyncio import (
            revoke_all_sessions_for_user,
        )

        await revoke_all_sessions_for_user(request.state.auth_session.get_user_id())
        await request.state.auth_session.revoke_session()
        response.headers["Cache-Control"] = "no-store"
        log.info("logout_all")
        return {"authenticated": False}

    def throttle(self, client):
        now = datetime.now(UTC)
        cutoff = now - timedelta(seconds=60)
        key = hashlib.sha256(("auth:" + client).encode()).hexdigest()
        statement = insert(LoginThrottle).values(
            client_hash=key, window_start=now, attempts=1
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
            return db.execute(statement).scalar_one() <= self.settings.login_limit


def initialize_auth(app, settings, sessions):
    gate = AuthGate(settings, sessions, ready=configuration_ready(settings))
    if gate.ready:
        configure_provider(app, settings, sessions)

    # Outer middleware also covers SDK-owned routes. Do not trust forwarded
    # headers here; uvicorn must apply its configured trusted-proxy policy.
    class AuthBoundary:
        def __init__(self, app):
            self.app = app

        async def __call__(self, scope, receive, send):
            if scope["type"] != "http":
                return await self.app(scope, receive, send)
            token = account_context.set(None)
            try:
                path = (
                    scope.get("path", "")
                    .strip()
                    .rstrip("/")
                    .replace("/api/auth/public/", "/api/auth/", 1)
                )
                if settings.auth_ingress_mode == "cloudflare_tunnel":
                    try:
                        if not loopback_peer(scope):
                            raise ValueError("untrusted_ingress")
                        if not (
                            path == "/api/health" and scope["method"] in {"GET", "HEAD"}
                        ):
                            visitor = tunnel_client_ip(scope)
                            scope["client"] = (visitor, 0)
                            scope["scheme"] = "https"
                    except ValueError as error:
                        code = str(error)
                        return await JSONResponse(
                            {"error": {"code": code}},
                            status_code=403 if code == "untrusted_ingress" else 400,
                            headers={"Cache-Control": "no-store"},
                        )(scope, receive, send)
                headers = dict(scope.get("headers", []))
                if path.startswith("/api/auth/"):
                    # Removed launch methods must never reach any recipe, even
                    # when an old client still has a passwordless attempt.
                    if path.startswith(
                        ("/api/auth/signinup/code", "/api/auth/passwordless")
                    ):
                        return await JSONResponse(
                            {"error": {"code": "not_found"}}, status_code=404
                        )(scope, receive, send)
                    origin = headers.get(b"origin", b"").decode()
                    cross_site = headers.get(b"sec-fetch-site") == b"cross-site"
                    if scope["method"] not in {"GET", "HEAD", "OPTIONS"} and (
                        cross_site
                        or (origin and origin != settings.public_origin.rstrip("/"))
                    ):
                        return await JSONResponse(
                            {"error": {"code": "csrf_rejected"}}, status_code=403
                        )(scope, receive, send)
                    if not gate.ready and path != "/api/auth/session":
                        return await JSONResponse(
                            {"error": {"code": "authentication_unavailable"}},
                            status_code=503,
                        )(scope, receive, send)
                    if path in {
                        "/api/auth/signup",
                        "/api/auth/signin",
                        "/api/auth/user/password/reset/token",
                        "/api/auth/user/password/reset",
                        "/api/auth/user/email/verify/token",
                        "/api/auth/user/email/verify",
                        "/api/auth/signinup",
                        "/api/auth/authorisationurl",
                    }:
                        client = scope.get("client")
                        allowed = await run_in_threadpool(
                            gate.throttle, client[0] if client else "unknown"
                        )
                        if not allowed:
                            return await JSONResponse(
                                {"error": {"code": "login_throttled"}},
                                status_code=429,
                                headers={"Retry-After": "60"},
                            )(scope, receive, send)

                async def security_event(message):
                    if message["type"] == "http.response.start":
                        if path.startswith("/api/auth/"):
                            response_headers = [
                                (key, value)
                                for key, value in message.get("headers", [])
                                if key.lower() != b"cache-control"
                            ]
                            message["headers"] = response_headers + [
                                (b"cache-control", b"no-store")
                            ]
                        status = message["status"]
                        if status in {401, 403}:
                            log.info("authentication_rejected")
                        elif (
                            path
                            in {"/api/auth/signinup", "/api/auth/signinup/code/consume"}
                            and status == 200
                            and scope.get("state", {}).get("supertokens")
                        ):
                            log.info("sign_in")
                    await send(message)

                return await self.app(scope, receive, security_event)
            except PasswordAttemptBusy:
                return await JSONResponse(
                    {"error": {"code": "login_throttled"}},
                    status_code=429,
                    headers={"Retry-After": "1", "Cache-Control": "no-store"},
                )(scope, receive, send)
            except PasswordVerificationUnavailable:
                return await JSONResponse(
                    {"error": {"code": "authentication_unavailable"}},
                    status_code=503,
                    headers={"Cache-Control": "no-store"},
                )(scope, receive, send)
            finally:
                account_context.reset(token)

    app.add_middleware(AuthBoundary)
    app.state.auth_gate = gate
    return gate
