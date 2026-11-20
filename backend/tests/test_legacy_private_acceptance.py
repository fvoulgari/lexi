"""Acceptance rules for the private default, using synthetic learners/cards.

This exercises the sharing model only; it does not validate the migration itself.
"""

from sqlalchemy import create_engine, text
from test_collection_review_regressions import reviewed
from test_shareable_collections import H, card, collection, publish, session


def test_private_groups_and_republication_retain_personal_history(
    client, account_client, test_database
):
    fofo = account_client("synthetic-fofo")
    benvenuti = collection(client, "00 · Benvenuti")
    welcome = card(client, benvenuti)
    lollo = account_client("synthetic-lollo")
    foods = collection(client, "30 · Foods")
    days = collection(client, "50 · Days")
    lorenzo = collection(client, "610 · Lorenzo")
    food = card(client, foods)
    day = card(client, days)
    spyros = account_client("synthetic-spyros")

    # Simulate Spyros's historic practice while a card was available, before
    # the approved withdrawal of legacy-wide access.
    account_client("synthetic-fofo")
    assert publish(client, benvenuti).status_code == 200
    account_client("synthetic-spyros")
    queue = session(client, spyros, [benvenuti]).json()
    reviewed(client, queue)
    engine = create_engine(test_database)
    with engine.connect() as db:
        before = db.execute(
            text(
                "SELECT to_jsonb(p) FROM learning_progress p "
                "WHERE profile_id=:profile AND entry_id=:entry"
            ),
            {"profile": spyros["profile_id"], "entry": welcome["id"]},
        ).scalar_one()
        review_ids = (
            db.execute(
                text(
                    "SELECT id FROM review_events "
                    "WHERE profile_id=:profile AND entry_id=:entry"
                ),
                {"profile": spyros["profile_id"], "entry": welcome["id"]},
            )
            .scalars()
            .all()
        )

    account_client("synthetic-fofo")
    assert (
        client.post(
            f"/api/collections/{benvenuti['id']}/unpublish", headers=H
        ).status_code
        == 200
    )
    assert client.get(f"/api/vocabulary/{welcome['id']}").status_code == 200
    assert client.get(f"/api/vocabulary/{food['id']}").status_code == 404
    account_client("synthetic-lollo")
    assert client.get(f"/api/vocabulary/{welcome['id']}").status_code == 404
    for group, entry in [(foods, food), (days, day)]:
        assert (
            next(
                c
                for c in client.get("/api/collections").json()
                if c["id"] == group["id"]
            )["visibility"]
            == "private"
        )
        assert client.get(f"/api/vocabulary/{entry['id']}").status_code == 200
    assert (
        next(
            c for c in client.get("/api/collections").json() if c["id"] == lorenzo["id"]
        )["visibility"]
        == "private"
    )
    account_client("synthetic-spyros")
    for entry in [welcome, food, day]:
        assert client.get(f"/api/vocabulary/{entry['id']}").status_code == 404
    assert (
        client.get(f"/api/sessions/{queue['id']}").json()["cards"][0]["snapshot"]
        is None
    )

    account_client("synthetic-fofo")
    assert publish(client, benvenuti).status_code == 200
    account_client("synthetic-spyros")
    assert client.get(f"/api/vocabulary/{welcome['id']}").status_code == 200
    assert (
        session(client, spyros, [benvenuti], mode="difficult").json()["available"] == 1
    )
    with engine.connect() as db:
        after = db.execute(
            text(
                "SELECT to_jsonb(p) FROM learning_progress p "
                "WHERE profile_id=:profile AND entry_id=:entry"
            ),
            {"profile": spyros["profile_id"], "entry": welcome["id"]},
        ).scalar_one()
        assert (
            db.execute(
                text(
                    "SELECT id FROM review_events "
                    "WHERE profile_id=:profile AND entry_id=:entry"
                ),
                {"profile": spyros["profile_id"], "entry": welcome["id"]},
            )
            .scalars()
            .all()
            == review_ids
        )
    assert after == before
    assert client.get(f"/api/profiles/{fofo['profile_id']}/progress").status_code == 404
    assert (
        client.get(f"/api/profiles/{lollo['profile_id']}/progress").status_code == 404
    )
    engine.dispose()
