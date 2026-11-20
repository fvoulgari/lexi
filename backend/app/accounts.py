"""Account settings and explicit shared-library administration."""

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, SecretStr
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.access import current_account, require_admin, require_write
from app.models import Account, Profile, VocabularyEntry


class PasswordChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_password: SecretStr = Field(min_length=1, max_length=128)
    new_password: SecretStr = Field(min_length=15, max_length=128)
    confirmation: SecretStr = Field(min_length=15, max_length=128)


class AccountUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    interface_language: Literal["el", "en", "it"]


class RoleUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["learner", "editor", "admin"] | None = None
    legacy_access: bool | None = None


class Publication(BaseModel):
    model_config = ConfigDict(extra="forbid")
    visibility: Literal["published", "legacy"]


def account_output(account, name=None):
    return {
        "id": str(account.id),
        "profile_id": str(account.profile_id),
        "display_name": name,
        "role": account.role,
        "legacy_access": account.legacy_access,
        "interface_language": account.interface_language,
    }


def account_router(sessions, gate):
    router = APIRouter(prefix="/api", dependencies=[Depends(gate.require)])
    writes = [Depends(gate.check_csrf)]

    @router.get("/account")
    def read_account():
        account = current_account()
        with sessions() as db:
            profile = db.get(Profile, account.profile_id)
            return account_output(account, profile.display_name)

    @router.get("/account/credentials")
    async def read_credentials(request: Request):
        from app.account_credentials import credentials, identity_output

        session = request.state.auth_session
        _, methods = await credentials(session)
        with sessions() as db:
            profile = db.get(Profile, current_account().profile_id)
            return {
                "display_name": profile.display_name,
                **identity_output(session, methods),
            }

    @router.post("/account/password", dependencies=writes)
    async def update_password(body: PasswordChange, request: Request):
        from starlette.concurrency import run_in_threadpool

        from app.account_credentials import change_password, reject

        if not await run_in_threadpool(
            gate.throttle, "password-change:" + str(current_account().id)
        ):
            reject(429, "login_throttled")
        if body.new_password.get_secret_value() != body.confirmation.get_secret_value():
            reject(422, "password_confirmation_mismatch")
        await change_password(
            request.state.auth_session,
            body.current_password.get_secret_value(),
            body.new_password.get_secret_value(),
        )
        return {"changed": True, "reauthentication_required": True}

    @router.patch("/account", dependencies=writes)
    def update_account(body: AccountUpdate):
        with sessions.begin() as db:
            account = db.get(Account, current_account().id)
            account.interface_language = body.interface_language
            return account_output(account)

    @router.get("/admin/accounts")
    def accounts():
        require_admin()
        with sessions() as db:
            rows = db.execute(
                select(Account, Profile.display_name)
                .join(Profile, Profile.id == Account.profile_id)
                .order_by(Account.created_at, Account.id)
                .execution_options(unscoped=True)
            ).all()
            return [account_output(a, name) for a, name in rows]

    @router.patch("/admin/accounts/{account_id}", dependencies=writes)
    def update_roles(account_id: UUID, body: RoleUpdate):
        actor = require_admin()
        with sessions.begin() as db:
            # Serialize role mutations so concurrent demotions cannot remove
            # every administrator. Lock in deterministic order.
            accounts = db.scalars(
                select(Account).order_by(Account.id).with_for_update()
            ).all()
            account = next((a for a in accounts if a.id == account_id), None)
            acting = next((a for a in accounts if a.id == actor.id), None)
            if acting is None or acting.role != "admin":
                raise HTTPException(403, "Administrator permission required.")
            if account is None:
                raise HTTPException(404, "Account not found.")
            if body.role is not None:
                if (
                    account.role == "admin"
                    and body.role != "admin"
                    and sum(a.role == "admin" for a in accounts) == 1
                ):
                    raise HTTPException(
                        409,
                        {
                            "code": "last_admin",
                            "message": "Keep at least one administrator.",
                        },
                    )
                account.role = body.role
            if body.legacy_access is not None:
                account.legacy_access = body.legacy_access
            from app.legacy_models import SecurityEvent

            db.add(
                SecurityEvent(
                    actor_account_id=actor.id,
                    event="account_permissions_changed",
                    resource_id=str(account.id),
                )
            )
            return account_output(account)

    @router.post("/vocabulary/{entry_id}/restore", dependencies=writes)
    def restore(entry_id: UUID):
        with sessions.begin() as db:
            entry = db.scalar(
                select(VocabularyEntry)
                .where(VocabularyEntry.id == entry_id)
                .execution_options(include_archived=True)
                .with_for_update(of=VocabularyEntry)
            )
            require_write(entry)
            entry.archived_at = None
            return {"restored": str(entry.id)}

    @router.patch("/vocabulary/{entry_id}/visibility", dependencies=writes)
    def publish(entry_id: UUID, body: Publication):
        actor = require_admin()
        with sessions.begin() as db:
            entry = db.scalar(
                select(VocabularyEntry)
                .where(VocabularyEntry.id == entry_id)
                .with_for_update(of=VocabularyEntry)
            )
            if entry is None:
                raise HTTPException(404, "Card not found.")
            if entry.owner_account_id is not None:
                raise HTTPException(422, "Only shared cards can be published here.")
            # Shared metadata must remain readable with a published card. A
            # legacy card may continue referencing already published metadata.
            if body.visibility == "published":
                entry.unit.visibility = "published"
                for tag in entry.tags:
                    tag.visibility = "published"
            entry.visibility = body.visibility
            try:
                db.flush()
            except IntegrityError:
                raise HTTPException(
                    409,
                    {
                        "code": "publication_conflict",
                        "message": "Published unit or tag metadata conflicts. "
                        "Review the shared metadata before publishing.",
                    },
                ) from None
            from app.legacy_models import SecurityEvent

            db.add(
                SecurityEvent(
                    actor_account_id=actor.id,
                    event="shared_visibility_changed",
                    resource_id=str(entry.id),
                )
            )
            return {"id": str(entry.id), "visibility": entry.visibility}

    return router
