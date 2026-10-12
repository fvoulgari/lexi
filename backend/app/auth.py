import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import case, delete
from sqlalchemy.dialects.postgresql import insert

from app.models import GateSession, LoginThrottle

SESSION_COOKIE = "notebook_session"
CSRF_COOKIE = "notebook_csrf"


class LoginInput(BaseModel):
    password: str = Field(min_length=1, max_length=256)


def fail(status, code, message):
    raise HTTPException(status_code=status, detail={"code": code, "message": message})


class SharedGate:
    def __init__(self, settings, sessions):
        self.settings = settings
        self.sessions = sessions
        self.secret = settings.session_secret.get_secret_value().encode()
        self.password_hash = self.hash_password(
            settings.shared_password.get_secret_value()
        )

    def hash_password(self, password):
        return hashlib.scrypt(
            password.encode(), salt=self.secret, n=16384, r=8, p=1, dklen=32
        )

    def signature(self, value):
        return hmac.new(self.secret, value.encode(), hashlib.sha256).hexdigest()

    def csrf_token(self):
        nonce = secrets.token_urlsafe(32)
        return nonce + "." + self.signature(nonce)

    def valid_csrf(self, token):
        nonce, separator, signature = token.partition(".")
        return bool(separator) and hmac.compare_digest(self.signature(nonce), signature)

    def check_csrf(self, request: Request):
        cookie = request.cookies.get(CSRF_COOKIE, "")
        header = request.headers.get("X-CSRF-Token", "")
        origin = request.headers.get("origin")
        if (
            not self.valid_csrf(cookie)
            or not hmac.compare_digest(cookie, header)
            or (origin and origin != self.settings.public_origin.rstrip("/"))
        ):
            fail(403, "csrf_rejected", "Refresh the page and try again.")

    def set_cookie(self, response, name, value, max_age):
        response.set_cookie(
            name,
            value,
            max_age=max_age,
            httponly=True,
            secure=self.settings.cookie_secure,
            samesite="strict",
            path="/",
        )

    def authenticated(self, request: Request):
        token = request.cookies.get(SESSION_COOKIE)
        if not token:
            return False
        with self.sessions() as db:
            session = db.get(GateSession, self.signature("session:" + token))
            return session is not None and session.expires_at > datetime.now(UTC)

    def require(self, request: Request):
        if not self.authenticated(request):
            fail(401, "authentication_required", "Enter the shared password first.")

    def state(self, request: Request, response: Response):
        token = request.cookies.get(CSRF_COOKIE, "")
        if not self.valid_csrf(token):
            token = self.csrf_token()
            self.set_cookie(response, CSRF_COOKIE, token, 3600)
        return {"authenticated": self.authenticated(request), "csrf_token": token}

    def login(self, body: LoginInput, request: Request, response: Response):
        self.check_csrf(request)
        now = datetime.now(UTC)
        client = request.client.host if request.client else "unknown"
        key = self.signature(client)
        cutoff = now - timedelta(minutes=1)
        insert_attempt = insert(LoginThrottle).values(
            client_hash=key, window_start=now, attempts=1
        )
        update = insert_attempt.on_conflict_do_update(
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
            attempts = db.execute(update).scalar_one()
        if attempts > self.settings.login_limit:
            raise HTTPException(
                status_code=429,
                headers={"Retry-After": "60"},
                detail={"code": "login_throttled", "message": "Try again in a minute."},
            )
        if not hmac.compare_digest(
            self.hash_password(body.password), self.password_hash
        ):
            fail(401, "incorrect_password", "The shared password is incorrect.")
        token = secrets.token_urlsafe(32)
        with self.sessions.begin() as db:
            db.execute(delete(GateSession).where(GateSession.expires_at <= now))
            previous = request.cookies.get(SESSION_COOKIE)
            if previous:
                db.execute(
                    delete(GateSession).where(
                        GateSession.token_hash == self.signature("session:" + previous)
                    )
                )
            db.add(
                GateSession(
                    token_hash=self.signature("session:" + token),
                    expires_at=now + timedelta(hours=self.settings.session_hours),
                )
            )
        self.set_cookie(
            response, SESSION_COOKIE, token, self.settings.session_hours * 3600
        )
        return {"authenticated": True}

    def logout(self, request: Request, response: Response):
        self.check_csrf(request)
        token = request.cookies.get(SESSION_COOKIE, "")
        with self.sessions.begin() as db:
            db.execute(
                delete(GateSession).where(
                    GateSession.token_hash == self.signature("session:" + token)
                )
            )
        response.delete_cookie(
            SESSION_COOKIE,
            path="/",
            secure=self.settings.cookie_secure,
            httponly=True,
            samesite="strict",
        )
        return {"authenticated": False}
