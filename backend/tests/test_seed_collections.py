"""Local sample data is seeded only for an explicitly selected account."""

from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select

from app.models import Collection, VocabularyEntry
from app.seed import main, seed


def test_seed_requires_owner_and_is_idempotent_for_that_owner(logged_in):
    client = logged_in
    account = client.get("/api/auth/session").json()["account"]
    owner_id = UUID(account["id"])
    with pytest.raises(SystemExit):
        main([])
    seed(owner_id=owner_id)
    seed(owner_id=owner_id)
    with client.app.state.sessions() as db:
        assert db.scalar(select(func.count()).select_from(Collection)) == 2
        assert db.scalar(select(func.count()).select_from(VocabularyEntry)) == 10
        assert all(
            c.owner_account_id == owner_id for c in db.scalars(select(Collection))
        )
    with pytest.raises(ValueError, match="does not exist"):
        seed(owner_id=uuid4())


def test_seed_does_not_reassign_another_owners_sample_library(
    logged_in, account_client
):
    client = logged_in
    owner = client.get("/api/auth/session").json()["account"]
    other = account_client("other-seed-owner")
    with pytest.raises(ValueError, match="another account"):
        seed(owner_id=UUID(other["id"]))
    with client.app.state.sessions() as db:
        groups = db.scalars(select(Collection).execution_options(unscoped=True)).all()
        assert len(groups) == 2
        assert all(str(c.owner_account_id) == owner["id"] for c in groups)


def test_seed_rejects_foreign_cards_after_source_collections_are_deleted(
    logged_in, account_client
):
    client = logged_in
    owner = client.get("/api/auth/session").json()["account"]
    csrf = {"X-CSRF-Token": client.get("/api/auth/session").json()["csrf_token"]}
    for group in client.get("/api/collections").json():
        assert (
            client.delete(f"/api/collections/{group['id']}", headers=csrf).status_code
            == 204
        )
    assert client.get("/api/vocabulary").json()["total"] == 10
    other = account_client("foreign-seed-attempt")
    with pytest.raises(ValueError, match="Sample cards already belong"):
        seed(owner_id=UUID(other["id"]))
    with client.app.state.sessions() as db:
        cards = db.scalars(
            select(VocabularyEntry).execution_options(unscoped=True)
        ).all()
        assert len(cards) == 10
        assert all(str(c.owner_account_id) == owner["id"] for c in cards)
        assert not db.scalars(select(Collection).execution_options(unscoped=True)).all()
