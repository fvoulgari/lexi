"""Explicit, administrator-authorised legacy association; never GET redemption."""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert

from app.access import current_account, require_admin
from app.legacy_models import (
    ClaimContinuation,
    ClaimLink,
    LegacyRequest,
    ResolutionCase,
    SecurityEvent,
)
from app.models import (
    Account,
    Collection,
    LearningProgress,
    LoginThrottle,
    PracticeSession,
    Profile,
    ReviewEvent,
    Tag,
    Unit,
    VocabularyEntry,
)

COOKIE = "lexi_claim_continuation"


class Capture(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(min_length=20, max_length=256)


class IssueClaim(BaseModel):
    model_config = ConfigDict(extra="forbid")
    acknowledge: Literal[True]


class RecoveryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    profile_name: str = Field(min_length=1, max_length=80)
    note: str | None = Field(default=None, max_length=1000)


class ResolveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["rejected", "resolved"]
    profile_id: UUID | None = None


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def fail(code, status=400):
    raise HTTPException(
        status,
        {
            "code": code,
            "message": "This claim cannot be completed. "
            "Request help from an administrator.",
        },
    )


def count(db, model, *conditions):
    return db.scalar(
        select(func.count())
        .select_from(model)
        .where(*conditions)
        .execution_options(unscoped=True)
    )


def profile_report(db, profile_id, account_id=None):
    report = {
        "profile_id": str(profile_id),
        "reviews": count(db, ReviewEvent, ReviewEvent.profile_id == profile_id),
        "sessions": count(
            db, PracticeSession, PracticeSession.profile_id == profile_id
        ),
        "progress_records": count(
            db, LearningProgress, LearningProgress.profile_id == profile_id
        ),
    }
    if account_id:
        report.update(
            {
                name: count(db, model, model.owner_account_id == account_id)
                for name, model in (
                    ("private_cards", VocabularyEntry),
                    ("private_units", Unit),
                    ("private_tags", Tag),
                    ("collections", Collection),
                )
            }
        )
    return report


def throttle(db, key, limit, seconds):
    now = datetime.now(UTC)
    key = digest("legacy:" + key)
    # Insert then lock also serializes the first concurrent requests.
    db.execute(
        insert(LoginThrottle)
        .values(client_hash=key, window_start=now, attempts=0)
        .on_conflict_do_nothing()
    )
    row = db.get(LoginThrottle, key, with_for_update=True)
    if row.window_start <= now - timedelta(seconds=seconds):
        row.window_start, row.attempts = now, 0
    row.attempts += 1
    exceeded = row.attempts > limit
    return exceeded


def audit(db, actor, event, resource=None):
    db.add(
        SecurityEvent(
            actor_account_id=actor,
            event=event,
            resource_id=str(resource) if resource is not None else None,
        )
    )


def legacy_router(sessions, gate, settings):
    router = APIRouter(prefix="/api")
    auth = [Depends(gate.require)]
    writes = [Depends(gate.require), Depends(gate.check_csrf)]

    def origin(request):
        if request.headers.get("origin") != settings.public_origin.rstrip("/"):
            raise HTTPException(
                403, {"code": "csrf_rejected", "message": "Refresh and try again."}
            )

    def clear_cookie(response):
        response.delete_cookie(
            COOKIE,
            path="/api/legacy-claims",
            secure=settings.cookie_secure,
            httponly=True,
            samesite="lax",
        )

    def continuation(db, request):
        secret = request.cookies.get(COOKIE, "")
        if not secret:
            fail("claim_invalid")
        pending = db.get(ClaimContinuation, digest(secret))
        if pending is None or pending.expires_at <= datetime.now(UTC):
            fail("claim_expired")
        return pending

    def valid_link(db, token_hash, lock=False):
        query = select(ClaimLink).where(ClaimLink.token_hash == token_hash)
        if lock:
            query = query.with_for_update()
        link = db.scalar(query)
        if link is None:
            fail("claim_invalid")
        if link.consumed_at:
            fail("claim_used", 409)
        if link.revoked_at:
            fail("claim_revoked")
        if link.expires_at <= datetime.now(UTC):
            fail("claim_expired")
        return link

    def unclaimed(db, profile_id, lock=False):
        query = (
            select(Profile)
            .where(Profile.id == profile_id, Profile.is_legacy.is_(True))
            .execution_options(unscoped=True)
        )
        if lock:
            query = query.with_for_update()
        profile = db.scalar(query)
        if profile is None:
            fail("claim_invalid")
        if db.scalar(
            select(Account.id).where(Account.profile_id == profile_id)
        ) or db.scalar(
            select(ClaimLink.token_hash)
            .where(
                ClaimLink.profile_id == profile_id, ClaimLink.consumed_at.is_not(None)
            )
            .limit(1)
        ):
            fail("profile_claimed", 409)
        return profile

    def issue(db, profile_id, actor):
        unclaimed(db, profile_id, lock=True)
        now = datetime.now(UTC)
        db.execute(
            update(ClaimLink)
            .where(
                ClaimLink.profile_id == profile_id,
                ClaimLink.consumed_at.is_(None),
                ClaimLink.revoked_at.is_(None),
            )
            .values(revoked_at=now)
        )
        token = secrets.token_urlsafe(48)
        expiry = now + timedelta(hours=getattr(settings, "claim_hours", 48))
        db.add(
            ClaimLink(
                token_hash=digest(token),
                profile_id=profile_id,
                issued_by=actor.id,
                expires_at=expiry,
            )
        )
        audit(db, actor.id, "legacy_claim_generated", profile_id)
        return {
            "claim_url": settings.public_origin.rstrip("/") + "/claim#token=" + token,
            "expires_at": expiry.isoformat(),
        }

    @router.post("/legacy-claims/capture")
    def capture(body: Capture, request: Request, response: Response):
        origin(request)
        peer = request.client.host if request.client else "unknown"
        with sessions.begin() as db:
            limited = throttle(db, "capture:" + peer, 20, 60)
            if not limited:
                db.execute(
                    delete(ClaimContinuation).where(
                        ClaimContinuation.expires_at <= datetime.now(UTC)
                    )
                )
                old = request.cookies.get(COOKIE)
                if old:
                    db.execute(
                        delete(ClaimContinuation).where(
                            ClaimContinuation.secret_hash == digest(old)
                        )
                    )
                secret = secrets.token_urlsafe(32)
                db.add(
                    ClaimContinuation(
                        secret_hash=digest(secret),
                        token_hash=digest(body.token),
                        expires_at=datetime.now(UTC) + timedelta(minutes=20),
                    )
                )
        if limited:
            raise HTTPException(
                429,
                headers={"Retry-After": "60"},
                detail={"code": "request_throttled", "message": "Try again later."},
            )
        response.set_cookie(
            COOKIE,
            secret,
            max_age=1200,
            path="/api/legacy-claims",
            httponly=True,
            secure=settings.cookie_secure,
            samesite="lax",
        )
        return {"captured": True}

    @router.delete("/legacy-claims/capture")
    def cancel(request: Request, response: Response):
        origin(request)
        with sessions.begin() as db:
            db.execute(
                delete(ClaimContinuation).where(
                    ClaimContinuation.secret_hash
                    == digest(request.cookies.get(COOKIE, ""))
                )
            )
        clear_cookie(response)
        return {"cancelled": True}

    @router.get("/legacy-claims/preview", dependencies=auth)
    def preview(request: Request):
        with sessions() as db:
            pending = continuation(db, request)
            link = valid_link(db, pending.token_hash)
            profile = unclaimed(db, link.profile_id)
            report = profile_report(db, profile.id)
            return {
                "status": "ready",
                "profile": {
                    "id": str(profile.id),
                    "display_name": profile.display_name,
                    "review_count": report["reviews"],
                    "session_count": report["sessions"],
                },
            }

    @router.post("/legacy-claims/redeem", dependencies=writes)
    def redeem(request: Request, response: Response):
        actor = current_account()
        conflict = None
        with sessions.begin() as db:
            pending = continuation(db, request)
            # Read target before locking; revalidate link under lock later.
            target_link = valid_link(db, pending.token_hash)
            account = db.scalar(
                select(Account).where(Account.id == actor.id).with_for_update()
            )
            # Lock both profiles in stable order, including the empty profile,
            # to serialize against concurrent practice writes.
            db.scalars(
                select(Profile)
                .where(Profile.id.in_([account.profile_id, target_link.profile_id]))
                .order_by(Profile.id)
                .with_for_update()
                .execution_options(unscoped=True)
            ).all()
            old_profile = db.scalar(
                select(Profile)
                .where(Profile.id == account.profile_id)
                .execution_options(unscoped=True)
            )
            if old_profile is None or old_profile.is_legacy:
                fail("account_already_associated", 409)
            profile = unclaimed(db, target_link.profile_id)
            link = valid_link(db, pending.token_hash, lock=True)
            current = profile_report(db, account.profile_id, account.id)
            legacy = profile_report(db, profile.id)
            if any(value for key, value in current.items() if key != "profile_id"):
                case = db.scalar(
                    select(ResolutionCase).where(
                        ResolutionCase.account_id == account.id,
                        ResolutionCase.legacy_profile_id == profile.id,
                        ResolutionCase.status == "pending",
                    )
                )
                if case is None:
                    db.add(
                        ResolutionCase(
                            account_id=account.id,
                            legacy_profile_id=profile.id,
                            current_profile_id=account.profile_id,
                        )
                    )
                    audit(db, account.id, "legacy_claim_conflict", profile.id)
                conflict = {"current": current, "legacy": legacy}
            else:
                account.profile_id = profile.id
                link.consumed_at = datetime.now(UTC)
                db.delete(pending)
                audit(db, account.id, "legacy_claim_redeemed", profile.id)
                # Keep the genuinely empty former profile rather than cascading
                # deletes; it is not a legacy profile and never publicly listed.
        if conflict is not None:
            return JSONResponse(
                status_code=409,
                content={
                    "error": {
                        "code": "claim_conflict",
                        "message": "Your new progress needs administrator review. "
                        "Both profiles are unchanged.",
                        "report": conflict,
                    }
                },
            )
        clear_cookie(response)
        return {"status": "claimed", "profile_id": str(profile.id)}

    @router.get("/admin/legacy-profiles", dependencies=auth)
    def legacy_profiles():
        require_admin()
        with sessions() as db:
            profiles = db.scalars(
                select(Profile)
                .where(
                    Profile.is_legacy.is_(True),
                    ~select(Account.id)
                    .where(Account.profile_id == Profile.id)
                    .exists(),
                )
                .order_by(Profile.created_at, Profile.id)
                .execution_options(unscoped=True)
            ).all()
            result = []
            for profile in profiles:
                report = profile_report(db, profile.id)
                latest = db.scalar(
                    select(ClaimLink)
                    .where(ClaimLink.profile_id == profile.id)
                    .order_by(ClaimLink.created_at.desc())
                    .limit(1)
                )
                status = (
                    "none"
                    if latest is None
                    else "used"
                    if latest.consumed_at
                    else "revoked"
                    if latest.revoked_at
                    else "expired"
                    if latest.expires_at <= datetime.now(UTC)
                    else "pending"
                )
                result.append(
                    {
                        "id": str(profile.id),
                        "display_name": profile.display_name,
                        "review_count": report["reviews"],
                        "session_count": report["sessions"],
                        "claim_status": status,
                    }
                )
            return result

    @router.get("/admin/claim-links", dependencies=auth)
    def claim_statuses():
        require_admin()
        now = datetime.now(UTC)
        with sessions() as db:
            rows = db.execute(
                select(ClaimLink, Profile.display_name)
                .join(Profile, Profile.id == ClaimLink.profile_id)
                .order_by(ClaimLink.created_at.desc())
                .execution_options(unscoped=True)
            ).all()
            return [
                {
                    "profile_id": str(link.profile_id),
                    "display_name": name,
                    "created_at": link.created_at.isoformat(),
                    "expires_at": link.expires_at.isoformat(),
                    "status": "used"
                    if link.consumed_at
                    else "revoked"
                    if link.revoked_at
                    else "expired"
                    if link.expires_at <= now
                    else "pending",
                }
                for link, name in rows
            ]

    @router.post("/admin/legacy-profiles/{profile_id}/claim-links", dependencies=writes)
    def generate(profile_id: UUID, body: IssueClaim):
        actor = require_admin()
        with sessions.begin() as db:
            return issue(db, profile_id, actor)

    @router.delete(
        "/admin/legacy-profiles/{profile_id}/claim-links", dependencies=writes
    )
    def revoke(profile_id: UUID):
        actor = require_admin()
        with sessions.begin() as db:
            unclaimed(db, profile_id, lock=True)
            db.execute(
                update(ClaimLink)
                .where(
                    ClaimLink.profile_id == profile_id,
                    ClaimLink.consumed_at.is_(None),
                    ClaimLink.revoked_at.is_(None),
                )
                .values(revoked_at=datetime.now(UTC))
            )
            audit(db, actor.id, "legacy_claim_revoked", profile_id)
        return {"revoked": True}

    @router.post("/legacy-requests", dependencies=writes, status_code=202)
    def request_progress(body: RecoveryRequest):
        account = current_account()
        with sessions.begin() as db:
            limited = throttle(db, "request:" + str(account.id), 3, 3600)
            # No existence lookup: matching a name proves nothing.
            if not limited:
                db.execute(
                    insert(LegacyRequest)
                    .values(
                        id=uuid4(),
                        account_id=account.id,
                        profile_name=body.profile_name.strip(),
                        note=body.note,
                        status="pending",
                    )
                    .on_conflict_do_nothing(
                        index_elements=[LegacyRequest.account_id],
                        index_where=LegacyRequest.status == "pending",
                    )
                )
        if limited:
            raise HTTPException(
                429,
                headers={"Retry-After": "3600"},
                detail={"code": "request_throttled", "message": "Try again later."},
            )
        return {"accepted": True}

    @router.get("/admin/legacy-requests", dependencies=auth)
    def requests():
        require_admin()
        with sessions() as db:
            return [
                {
                    "id": str(row.id),
                    "account_id": str(row.account_id),
                    "profile_name": row.profile_name,
                    "note": row.note,
                    "status": row.status,
                    "created_at": row.created_at.isoformat(),
                }
                for row in db.scalars(
                    select(LegacyRequest).order_by(LegacyRequest.created_at.desc())
                )
            ]

    @router.patch("/admin/legacy-requests/{request_id}", dependencies=writes)
    def resolve(request_id: UUID, body: ResolveRequest):
        actor = require_admin()
        with sessions.begin() as db:
            row = db.get(LegacyRequest, request_id, with_for_update=True)
            if row is None:
                raise HTTPException(404, "Request not found.")
            if row.status != "pending":
                raise HTTPException(409, "Request already reviewed.")
            result = {"status": body.status}
            if body.status == "resolved":
                if body.profile_id is None:
                    raise HTTPException(422, "Choose a verified legacy profile.")
                result.update(issue(db, body.profile_id, actor))
            row.status, row.resolved_at, row.resolved_by = (
                body.status,
                datetime.now(UTC),
                actor.id,
            )
            audit(db, actor.id, "legacy_request_" + body.status, row.id)
            return result

    @router.get("/admin/legacy-resolution-cases", dependencies=auth)
    def cases():
        require_admin()
        with sessions() as db:
            return [
                {
                    "id": str(row.id),
                    "status": row.status,
                    "current": profile_report(
                        db, row.current_profile_id, row.account_id
                    ),
                    "legacy": profile_report(db, row.legacy_profile_id),
                }
                for row in db.scalars(
                    select(ResolutionCase).order_by(ResolutionCase.created_at.desc())
                )
            ]

    return router
