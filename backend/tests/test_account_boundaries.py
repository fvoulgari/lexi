"""Read/write boundaries are checked through the same ORM seam as HTTP handlers."""

import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.access import account_context, require_write
from app.models import (
    Account,
    LearningProgress,
    PracticeSession,
    Profile,
    ReviewEvent,
    SessionCard,
    Unit,
    VocabularyEntry,
)
from app.vocabulary_deletion import delete_entries


@pytest.fixture
def scoped_db(test_database):
    engine = create_engine(test_database)
    connection = engine.connect()
    transaction = connection.begin()
    db = Session(connection)
    try:
        yield db
    finally:
        account_context.set(None)
        db.close()
        transaction.rollback()
        connection.close()
        engine.dispose()


def setup_accounts(db):
    profiles = [Profile(display_name="Boundary A"), Profile(display_name="Boundary B")]
    db.add_all(profiles)
    db.flush()
    accounts = [
        Account(provider_subject=str(uuid.uuid4()), profile_id=p.id) for p in profiles
    ]
    db.add_all(accounts)
    db.flush()
    return accounts


def test_private_and_legacy_content_do_not_leak_in_count_or_projection(scoped_db):
    db = scoped_db
    a, b = setup_accounts(db)
    units = [
        Unit(
            code=str(uuid.uuid4())[:12],
            title="Scope",
            sort_order=0,
            owner_account_id=owner,
            visibility=visibility,
        )
        for owner, visibility in [
            (a.id, "private"),
            (b.id, "private"),
            (None, "legacy"),
            (None, "published"),
        ]
    ]
    db.add_all(units)
    db.flush()
    ids = [u.id for u in units]
    account_context.set(a)
    assert set(db.scalars(select(Unit.id).where(Unit.id.in_(ids)))) == {ids[0], ids[3]}
    assert (
        db.scalar(select(func.count()).select_from(Unit).where(Unit.id.in_(ids))) == 2
    )
    a.legacy_access = True
    assert set(db.scalars(select(Unit.id).where(Unit.id.in_(ids)))) == {
        ids[0],
        ids[2],
        ids[3],
    }
    with pytest.raises(HTTPException):
        require_write(units[3])
    a.role = "editor"
    require_write(units[3])
    with pytest.raises(HTTPException):
        require_write(units[1])


def test_archive_retains_card_and_excludes_future_reads(scoped_db):
    db = scoped_db
    a, _ = setup_accounts(db)
    unit = Unit(
        code=str(uuid.uuid4())[:12],
        title="Private",
        sort_order=0,
        owner_account_id=a.id,
        visibility="private",
    )
    db.add(unit)
    db.flush()
    entry = VocabularyEntry(
        italian="ciao",
        greek="γεια",
        word_type="expression",
        unit_id=unit.id,
        owner_account_id=a.id,
        visibility="private",
    )
    db.add(entry)
    db.flush()
    session = PracticeSession(
        profile_id=a.profile_id,
        direction="greek_to_italian",
        requested_size=10,
        available=1,
    )
    db.add(session)
    db.flush()
    db.add(
        SessionCard(
            session_id=session.id,
            position=0,
            entry_id=entry.id,
            snapshot={"italian": "ciao"},
        )
    )
    db.flush()
    event = ReviewEvent(
        session_id=session.id,
        position=0,
        profile_id=a.profile_id,
        entry_id=entry.id,
        direction="greek_to_italian",
        rating="easy",
        snapshot={"italian": "ciao"},
    )
    progress = LearningProgress(
        profile_id=a.profile_id,
        entry_id=entry.id,
        direction="greek_to_italian",
        reviews=1,
        last_reviewed_at=datetime.now(timezone.utc),
    )
    db.add_all([event, progress])
    db.flush()
    account_context.set(a)
    delete_entries(db, [entry.id])
    db.flush()
    assert (
        db.scalar(select(VocabularyEntry.id).where(VocabularyEntry.id == entry.id))
        is None
    )
    assert (
        db.scalar(
            select(VocabularyEntry.id)
            .where(VocabularyEntry.id == entry.id)
            .execution_options(include_archived=True)
        )
        == entry.id
    )

    assert (
        db.scalar(select(ReviewEvent.id).where(ReviewEvent.id == event.id)) == event.id
    )
    assert (
        db.scalar(
            select(LearningProgress.reviews).where(
                LearningProgress.entry_id == entry.id
            )
        )
        == 1
    )
    assert db.scalar(
        select(SessionCard.snapshot).where(SessionCard.session_id == session.id)
    ) == {"italian": "ciao"}


def test_unpublication_redacts_snapshots_without_erasing_personal_history(
    logged_in, account_client
):
    from conftest import signin
    from test_practice import headers, start
    from test_progress import submit

    client = logged_in
    card = client.get("/api/vocabulary").json()["items"][0]
    path = f"/api/vocabulary/{card['id']}/visibility"
    assert (
        client.patch(
            path, json={"visibility": "published"}, headers=headers(client)
        ).status_code
        == 200
    )
    account = account_client("published-reader")
    collection = client.post(
        "/api/collections", json={"name": "Reading"}, headers=headers(client)
    ).json()
    assert (
        client.post(
            f"/api/collections/{collection['id']}/entries",
            json={"entry_id": card["id"]},
            headers=headers(client),
        ).status_code
        == 204
    )
    session = start(client).json()
    submit(client, session, card["id"], "greek_to_italian", "hard")
    signin(client)
    assert (
        client.patch(
            path, json={"visibility": "legacy"}, headers=headers(client)
        ).status_code
        == 200
    )
    signin(client, "published-reader")
    progress = client.get(f"/api/profiles/{account['profile_id']}/progress").json()
    assert progress["total_reviews"] == 1
    assert progress["units"] == progress["word_types"] == []
    summary = client.get(f"/api/sessions/{session['id']}/summary").json()
    assert summary["total"] == 1
    assert summary["needs_practice"][0]["snapshot"] is None
    assert client.get(f"/api/collections/{collection['id']}/entries").json() == []
    queued = client.get(f"/api/sessions/{session['id']}").json()["cards"][0]
    assert queued["skipped"] is True and queued["snapshot"] is None
    assert (
        client.post(
            f"/api/vocabulary/{card['id']}/restore", headers=headers(client)
        ).status_code
        == 404
    )
