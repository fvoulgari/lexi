"""Retired claim endpoints cannot issue, capture, preview or redeem links."""

from test_shareable_collections import H


def test_retired_claim_and_recovery_routes_are_unavailable(client, account_client):
    account_client("retirement-test")
    for method, path in [
        ("post", "/api/legacy-claims/capture"),
        ("get", "/api/legacy-claims/preview"),
        ("post", "/api/legacy-claims/redeem"),
        ("delete", "/api/legacy-claims/capture"),
        ("post", "/api/legacy-requests"),
        ("get", "/api/admin/legacy-profiles"),
        ("get", "/api/admin/claim-links"),
        ("get", "/api/admin/legacy-requests"),
    ]:
        response = getattr(client, method)(path, headers=H)
        assert response.status_code in {404, 405}, (path, response.status_code)


def test_token_invalidation_preserves_completed_claims_and_continuations(test_database):
    from datetime import UTC, datetime, timedelta
    from pathlib import Path
    from uuid import uuid4

    from alembic.config import Config
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from alembic.script import ScriptDirectory
    from sqlalchemy import create_engine, text

    engine = create_engine(test_database)
    profile, account = uuid4(), uuid4()
    future = datetime.now(UTC) + timedelta(days=1)
    consumed = datetime.now(UTC) - timedelta(hours=1)
    with engine.connect() as db:
        transaction = db.begin()
        try:
            db.execute(
                text(
                    "INSERT INTO profiles (id,display_name,preferred_direction) "
                    "VALUES (:id,'test','italian_to_greek')"
                ),
                {"id": profile},
            )
            db.execute(
                text(
                    "INSERT INTO accounts (id,provider_subject,profile_id) "
                    "VALUES (:id,:subject,:profile)"
                ),
                {"id": account, "subject": str(account), "profile": profile},
            )
            for token, used in [("a" * 64, None), ("b" * 64, consumed)]:
                db.execute(
                    text(
                        "INSERT INTO legacy_claim_links "
                        "(token_hash,profile_id,issued_by,expires_at,consumed_at) "
                        "VALUES (:token,:profile,:account,:expires,:used)"
                    ),
                    {
                        "token": token,
                        "profile": profile,
                        "account": account,
                        "expires": future,
                        "used": used,
                    },
                )
            db.execute(
                text(
                    "INSERT INTO legacy_claim_continuations "
                    "(secret_hash,token_hash,expires_at) "
                    "VALUES (:secret,:token,:expires)"
                ),
                {"secret": "c" * 64, "token": "a" * 64, "expires": future},
            )
            scripts = ScriptDirectory.from_config(
                Config(str(Path(__file__).parents[1] / "alembic.ini"))
            )
            with Operations.context(MigrationContext.configure(db)):
                scripts.get_revision("e79a00d2f012").module.upgrade()
            links = db.execute(
                text(
                    "SELECT token_hash,consumed_at,revoked_at FROM legacy_claim_links "
                    "WHERE profile_id=:profile ORDER BY token_hash"
                ),
                {"profile": profile},
            ).all()
            assert links[0].revoked_at is not None and links[0].consumed_at is None
            assert links[1].revoked_at is None and links[1].consumed_at == consumed
            assert db.execute(
                text(
                    "SELECT expires_at <= CURRENT_TIMESTAMP "
                    "FROM legacy_claim_continuations "
                    "WHERE secret_hash=:secret"
                ),
                {"secret": "c" * 64},
            ).scalar_one()
            assert (
                db.execute(
                    text("SELECT profile_id FROM accounts WHERE id=:id"),
                    {"id": account},
                ).scalar_one()
                == profile
            )
        finally:
            transaction.rollback()
            engine.dispose()
