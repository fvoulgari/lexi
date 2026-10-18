from uuid import uuid4

import pytest


def headers(client):
    return {"X-CSRF-Token": client.get("/api/auth/session").json()["csrf_token"]}


def start(client, profile=None, size=25, direction="greek_to_italian"):
    profile = profile or client.get("/api/profiles").json()[0]["id"]
    return client.post(
        "/api/sessions",
        json={"profile_id": profile, "direction": direction, "size": size},
        headers=headers(client),
    )


def test_random_queue_snapshots_and_shortage(logged_in):
    response = start(logged_in)
    assert response.status_code == 201
    session = response.json()
    assert session["available"] == 10
    assert session["requested_size"] == 25
    assert len(session["cards"]) == 10
    assert len({card["entry_id"] for card in session["cards"]}) == 10
    assert [card["position"] for card in session["cards"]] == list(range(10))
    card = session["cards"][0]
    logged_in.patch(
        f"/api/vocabulary/{card['entry_id']}",
        json={"italian": "changed"},
        headers=headers(logged_in),
    )
    assert (
        logged_in.get(f"/api/sessions/{session['id']}").json()["cards"][0]["snapshot"]
        == card["snapshot"]
    )
    assert start(logged_in, size=None).json()["requested_size"] is None
    assert start(logged_in, profile=str(uuid4())).status_code == 404
    assert start(logged_in, size=11).status_code == 422


def test_reveal_review_retry_summary_and_isolation(logged_in):
    session = start(logged_in).json()
    path = f"/api/sessions/{session['id']}"
    body = {"direction": "greek_to_italian", "rating": "hard"}
    review_path = path + "/cards/0/reviews"
    assert (
        logged_in.post(review_path, json=body, headers=headers(logged_in)).status_code
        == 409
    )
    assert logged_in.get(path + "/summary").json()["remembered"] == 0
    assert (
        logged_in.post(
            path + "/cards/0/reveal",
            json={"direction": body["direction"]},
            headers=headers(logged_in),
        ).status_code
        == 200
    )
    saved = logged_in.post(review_path, json=body, headers=headers(logged_in))
    assert saved.status_code == 200
    assert (
        logged_in.post(review_path, json=body, headers=headers(logged_in)).json()
        == saved.json()
    )
    assert (
        logged_in.post(
            review_path, json={**body, "rating": "easy"}, headers=headers(logged_in)
        ).status_code
        == 409
    )
    summary = logged_in.get(path + "/summary").json()
    assert summary["total"] == 1
    assert summary["counts"] == {"again": 0, "hard": 1, "easy": 0}
    assert summary["remembered"] == 100
    profile = session["profile_id"]
    progress_path = f"/api/profiles/{profile}/learning-records"
    records = logged_in.get(progress_path).json()
    assert len(records) == 1
    assert records[0]["reviews"] == 1
    assert records[0]["difficulty"] == 0.5
    assert records[0]["direction"] == "greek_to_italian"
    others = logged_in.get("/api/profiles").json()
    other = next(p["id"] for p in others if p["id"] != profile)
    assert logged_in.get(f"/api/profiles/{other}/learning-records").json() == []
    # Switch the same queue's next card; only the revealed direction is accepted.
    logged_in.post(
        path + "/cards/1/reveal",
        json={"direction": "italian_to_greek"},
        headers=headers(logged_in),
    )
    assert (
        logged_in.post(
            path + "/cards/1/reviews", json=body, headers=headers(logged_in)
        ).status_code
        == 409
    )
    assert (
        logged_in.post(
            path + "/cards/1/reviews",
            json={"direction": "italian_to_greek", "rating": "again"},
            headers=headers(logged_in),
        ).status_code
        == 200
    )
    assert {r["direction"] for r in logged_in.get(progress_path).json()} == {
        "italian_to_greek",
        "greek_to_italian",
    }


def test_sessions_require_gate_csrf_and_validate_input(logged_in):
    session = start(logged_in).json()
    path = f"/api/sessions/{session['id']}"
    for suffix, body in [
        ("", {"profile_id": session["profile_id"], "direction": "greek_to_italian"}),
        (f"/{session['id']}/cards/0/reveal", {"direction": "greek_to_italian"}),
        (
            f"/{session['id']}/cards/0/reviews",
            {"direction": "greek_to_italian", "rating": "easy"},
        ),
    ]:
        assert logged_in.post("/api/sessions" + suffix, json=body).status_code == 403
    assert (
        logged_in.post(
            path + "/cards/0/reveal",
            json={"direction": "unknown"},
            headers=headers(logged_in),
        ).status_code
        == 422
    )
    assert (
        logged_in.post(
            path + "/cards/99/reveal",
            json={"direction": "greek_to_italian"},
            headers=headers(logged_in),
        ).status_code
        == 404
    )
    logged_in.cookies.clear()
    assert logged_in.get(path).status_code == 401
    assert logged_in.get(path + "/summary").status_code == 401
    assert logged_in.post("/api/sessions", json={}).status_code == 401


def test_concurrent_retries_and_aggregate_updates(logged_in):
    from concurrent.futures import ThreadPoolExecutor

    sessions = [start(logged_in, size=None).json() for _ in range(2)]
    entry_id = sessions[0]["cards"][0]["entry_id"]
    positions = [
        next(c["position"] for c in s["cards"] if c["entry_id"] == entry_id)
        for s in sessions
    ]
    paths = [
        f"/api/sessions/{s['id']}/cards/{pos}" for s, pos in zip(sessions, positions)
    ]
    csrf = headers(logged_in)
    for path in paths:
        assert (
            logged_in.post(
                path + "/reveal", json={"direction": "greek_to_italian"}, headers=csrf
            ).status_code
            == 200
        )

    def submit(path):
        return logged_in.post(
            path + "/reviews",
            json={"direction": "greek_to_italian", "rating": "again"},
            headers=csrf,
        )

    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(submit, [paths[0], paths[0], paths[1], paths[1]]))
    assert all(r.status_code == 200 for r in results)
    assert len({r.json()["id"] for r in results}) == 2
    records = logged_in.get(
        f"/api/profiles/{sessions[0]['profile_id']}/learning-records"
    ).json()
    record = next(r for r in records if r["entry_id"] == entry_id)
    assert record["reviews"] == 2
    assert record["counts"] == {"again": 2, "hard": 0, "easy": 0}
    assert record["difficulty"] == 1


def test_weighted_records_and_reviews_survive_application_restart(logged_in):
    from fastapi.testclient import TestClient

    from app.main import create_app

    session = start(logged_in).json()
    entry_id = session["cards"][0]["entry_id"]
    csrf = headers(logged_in)
    path = f"/api/sessions/{session['id']}/cards/0"
    logged_in.post(
        path + "/reveal", json={"direction": "greek_to_italian"}, headers=csrf
    )
    accepted = logged_in.post(
        path + "/reviews",
        json={"direction": "greek_to_italian", "rating": "again"},
        headers=csrf,
    ).json()
    fresh = start(logged_in, size=None).json()
    position = next(c["position"] for c in fresh["cards"] if c["entry_id"] == entry_id)
    path = f"/api/sessions/{fresh['id']}/cards/{position}"
    logged_in.post(
        path + "/reveal", json={"direction": "greek_to_italian"}, headers=csrf
    )
    logged_in.post(
        path + "/reviews",
        json={"direction": "greek_to_italian", "rating": "easy"},
        headers=csrf,
    )
    logged_in.patch(
        f"/api/vocabulary/{entry_id}", json={"italian": "new wording"}, headers=csrf
    )
    with TestClient(create_app()) as restarted:
        restarted.cookies.update(logged_in.cookies)
        summary = restarted.get(f"/api/sessions/{session['id']}/summary").json()
        assert summary["needs_practice"][0] == accepted
        records = restarted.get(
            f"/api/profiles/{session['profile_id']}/learning-records"
        ).json()
        record = next(r for r in records if r["entry_id"] == entry_id)
        assert record["reviews"] == 2
        assert abs(record["difficulty"] - 4 / 9) < 0.00001
        assert record["counts"] == {"again": 1, "hard": 0, "easy": 1}


def test_zero_library_explained_and_transaction_rolls_back(logged_in, test_database):
    from sqlalchemy import create_engine, text

    engine = create_engine(test_database)
    session = start(logged_in).json()
    path = f"/api/sessions/{session['id']}"
    csrf = headers(logged_in)
    logged_in.post(
        path + "/cards/0/reveal", json={"direction": "greek_to_italian"}, headers=csrf
    )
    # Inject a storage failure at the database boundary after the event insert.
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE FUNCTION fail_progress() RETURNS trigger "
                "LANGUAGE plpgsql AS $$ "
                "BEGIN RAISE EXCEPTION 'test storage failure'; END; $$"
            )
        )
        connection.execute(
            text(
                "CREATE TRIGGER fail_progress BEFORE INSERT ON learning_progress "
                "FOR EACH ROW EXECUTE FUNCTION fail_progress()"
            )
        )
    try:
        assert (
            logged_in.post(
                path + "/cards/0/reviews",
                json={"direction": "greek_to_italian", "rating": "hard"},
                headers=csrf,
            ).status_code
            == 503
        )
        assert logged_in.get(path + "/summary").json()["total"] == 0
        assert (
            logged_in.get(
                f"/api/profiles/{session['profile_id']}/learning-records"
            ).json()
            == []
        )
    finally:
        with engine.begin() as connection:
            connection.execute(text("DROP TRIGGER fail_progress ON learning_progress"))
            connection.execute(text("DROP FUNCTION fail_progress()"))
    assert (
        logged_in.post(
            path + "/cards/0/reviews",
            json={"direction": "greek_to_italian", "rating": "hard"},
            headers=csrf,
        ).status_code
        == 200
    )
    # Prepare an empty disposable library, then observe it through HTTP.
    with engine.begin() as connection:
        connection.execute(
            text(
                "TRUNCATE learning_progress, review_events, session_cards, "
                "practice_sessions, entry_tags, vocabulary_entries CASCADE"
            )
        )
    response = start(logged_in)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "no_matches"
    engine.dispose()


def test_sizes_and_same_entry_direction_records(logged_in):
    sessions = [start(logged_in, size=size).json() for size in (10, 25, 50, None)]
    assert all(len(s["cards"]) == 10 for s in sessions)
    assert [s["requested_size"] for s in sessions] == [10, 25, 50, None]
    entry_id = sessions[0]["cards"][0]["entry_id"]
    for session, direction, rating in zip(
        sessions[:2], ("greek_to_italian", "italian_to_greek"), ("again", "easy")
    ):
        position = next(
            c["position"] for c in session["cards"] if c["entry_id"] == entry_id
        )
        path = f"/api/sessions/{session['id']}/cards/{position}"
        logged_in.post(
            path + "/reveal", json={"direction": direction}, headers=headers(logged_in)
        )
        assert (
            logged_in.post(
                path + "/reviews",
                json={"direction": direction, "rating": rating},
                headers=headers(logged_in),
            ).status_code
            == 200
        )
    records = logged_in.get(
        f"/api/profiles/{sessions[0]['profile_id']}/learning-records"
    ).json()
    assert len(records) == 2
    assert {r["entry_id"] for r in records} == {entry_id}
    assert {r["direction"]: r["difficulty"] for r in records} == {
        "greek_to_italian": 1,
        "italian_to_greek": 0,
    }


def test_concurrent_conflicting_reviews_accept_one_and_replay_after_wording_edit(
    logged_in,
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    session = start(logged_in).json()
    card = session["cards"][0]
    path = f"/api/sessions/{session['id']}/cards/0"
    csrf = headers(logged_in)
    direction = "italian_to_greek"
    logged_in.post(path + "/reveal", json={"direction": direction}, headers=csrf)
    barrier = Barrier(2)

    def submit(rating):
        barrier.wait()
        return logged_in.post(
            path + "/reviews",
            json={"direction": direction, "rating": rating},
            headers=csrf,
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(submit, ["again", "hard"]))
    assert sorted(response.status_code for response in responses) == [200, 409]
    accepted = next(r.json() for r in responses if r.status_code == 200)
    assert accepted["direction"] == direction
    assert accepted["snapshot"] == card["snapshot"]
    # Treat the accepted response as lost, edit the shared library, and retry.
    assert (
        logged_in.patch(
            f"/api/vocabulary/{card['entry_id']}",
            json={"italian": "wording for future sessions"},
            headers=csrf,
        ).status_code
        == 200
    )
    retry = logged_in.post(
        path + "/reviews",
        json={"direction": direction, "rating": accepted["rating"]},
        headers=csrf,
    )
    assert retry.json() == accepted
    assert logged_in.get(f"/api/sessions/{session['id']}/summary").json()["total"] == 1
    records = logged_in.get(
        f"/api/profiles/{session['profile_id']}/learning-records"
    ).json()
    assert len(records) == 1
    assert records[0]["reviews"] == 1
    assert records[0]["direction"] == direction
    fresh = start(logged_in, size=None).json()
    fresh_card = next(c for c in fresh["cards"] if c["entry_id"] == card["entry_id"])
    assert fresh_card["snapshot"]["italian"] == "wording for future sessions"
    assert (
        logged_in.get(f"/api/sessions/{session['id']}").json()["cards"]
        == session["cards"]
    )


def test_category_queue_combines_library_filters_and_persists(logged_in):
    client = logged_in
    csrf = headers(client)
    units = client.get("/api/units").json()
    tag_ids = [
        client.post("/api/tags", json={"name": name}, headers=csrf).json()["id"]
        for name in ("Home", "Reading")
    ]
    entries = client.get("/api/vocabulary?page_size=100").json()["items"]
    for index, entry in enumerate(entries[:3]):
        client.patch(
            f"/api/vocabulary/{entry['id']}",
            headers=csrf,
            json={
                "italian_gender": "masculine",
                "greek_gender": "neuter",
                "italian_adjective_gender": "masculine",
                "greek_adjective_gender": "masculine",
                "unit_id": units[0]["id"],
                "word_type": "noun" if index < 2 else "verb",
                "tag_ids": tag_ids if index == 0 else [tag_ids[1]],
            },
        )
    filters = {
        "unit_ids": [units[0]["id"]],
        "no_unit": True,
        "word_types": ["noun"],
        "tag_ids": tag_ids,
    }
    profile = client.get("/api/profiles").json()[0]["id"]
    response = client.post(
        "/api/sessions",
        headers=csrf,
        json={
            "profile_id": profile,
            "direction": "italian_to_greek",
            "size": 10,
            **filters,
        },
    )
    assert response.status_code == 201
    session = response.json()
    assert session["available"] == 2
    assert session["requested_size"] == 10
    assert {c["entry_id"] for c in session["cards"]} == {e["id"] for e in entries[:2]}
    assert len(session["cards"]) == 2
    assert client.get(f"/api/sessions/{session['id']}").json() == session
    path = f"/api/sessions/{session['id']}/cards/0"
    client.post(path + "/reveal", headers=csrf, json={"direction": "italian_to_greek"})
    review = client.post(
        path + "/reviews",
        headers=csrf,
        json={"direction": "italian_to_greek", "rating": "hard"},
    ).json()
    assert review["profile_id"] == profile
    assert review["direction"] == "italian_to_greek"
    assert client.get(f"/api/sessions/{session['id']}/summary").json()["total"] == 1
    only_unassigned = client.post(
        "/api/sessions",
        headers=csrf,
        json={
            "profile_id": profile,
            "direction": "greek_to_italian",
            "size": None,
            "no_unit": True,
        },
    )
    assert only_unassigned.status_code == 409
    assert only_unassigned.json()["error"]["code"] == "no_matches"
    empty = client.post(
        "/api/sessions",
        headers=csrf,
        json={
            "profile_id": profile,
            "direction": "greek_to_italian",
            "unit_ids": [units[1]["id"]],
        },
    )
    assert empty.status_code == 409
    assert empty.json()["error"]["code"] == "no_matches"


def test_category_queue_size_all_and_filter_validation(logged_in):
    client = logged_in
    csrf = headers(client)
    profile = client.get("/api/profiles").json()[0]["id"]
    tag = client.post("/api/tags", json={"name": "Focused"}, headers=csrf).json()["id"]
    expected = set()
    for index in range(12):
        response = client.post(
            "/api/vocabulary",
            headers=csrf,
            json={
                "italian_gender": "masculine",
                "greek_gender": "neuter",
                "italian_adjective_gender": "masculine",
                "greek_adjective_gender": "masculine",
                "unit_id": client.get("/api/units").json()[0]["id"],
                "italian": f"voce {index}",
                "greek": f"λέξη {index}",
                "word_type": "noun" if index < 6 else "verb",
                "tag_ids": [tag],
            },
        )
        assert response.status_code == 201
        expected.add(response.json()["entry"]["id"])
    body = {
        "profile_id": profile,
        "direction": "greek_to_italian",
        "tag_ids": [tag],
        "word_types": ["noun", "verb"],
        "size": 10,
    }
    limited = client.post("/api/sessions", json=body, headers=csrf).json()
    assert limited["available"] == 12
    assert len(limited["cards"]) == 10
    assert len({c["entry_id"] for c in limited["cards"]}) == 10
    assert {c["entry_id"] for c in limited["cards"]} <= expected
    all_cards = client.post(
        "/api/sessions", json={**body, "size": None}, headers=csrf
    ).json()
    assert {c["entry_id"] for c in all_cards["cards"]} == expected
    assert len(all_cards["cards"]) == 12
    library = client.get(
        "/api/vocabulary",
        params=[
            ("tag_ids", tag),
            ("word_types", "noun"),
            ("word_types", "verb"),
            ("page_size", 100),
        ],
    ).json()
    assert {e["id"] for e in library["items"]} == expected
    for filters in (
        {"unit_ids": ["bad"]},
        {"tag_ids": ["bad"]},
        {"word_types": ["bad"]},
    ):
        assert (
            client.post(
                "/api/sessions", headers=csrf, json={**body, **filters}
            ).status_code
            == 422
        )


def test_mixed_small_library_and_persisted_queue(logged_in):
    profile = logged_in.get("/api/profiles").json()[0]["id"]
    for size in (10, 25, 50, None):
        response = logged_in.post(
            "/api/sessions",
            json={
                "profile_id": profile,
                "direction": "greek_to_italian",
                "size": size,
                "mode": "mixed",
            },
            headers=headers(logged_in),
        )
        assert response.status_code == 201
        session = response.json()
        assert len(session["cards"]) == 10
        assert len({c["entry_id"] for c in session["cards"]}) == 10
        assert logged_in.get(f"/api/sessions/{session['id']}").json() == session


@pytest.mark.parametrize(
    "size,difficult_count,recent_count", [(10, 4, 3), (25, 10, 8), (50, 20, 15)]
)
def test_mixed_quotas_overlap_and_recent_boundary(
    logged_in, monkeypatch, size, difficult_count, recent_count
):
    import os
    from datetime import datetime, timedelta, timezone
    from uuid import UUID

    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    import app.practice as practice
    from app.models import LearningProgress

    now = datetime(2026, 10, 13, 12, tzinfo=timezone.utc)

    class Clock:
        @staticmethod
        def now(tz):
            return now

    monkeypatch.setattr(practice, "datetime", Clock)
    client = logged_in
    csrf = headers(client)
    for index in range(90):
        assert (
            client.post(
                "/api/vocabulary",
                headers=csrf,
                json={
                    "italian_gender": "masculine",
                    "greek_gender": "neuter",
                    "unit_id": client.get("/api/units").json()[0]["id"],
                    "italian": f"entry {index}",
                    "greek": f"έννοια {index}",
                    "word_type": "noun",
                },
            ).status_code
            == 201
        )
    entries = client.get("/api/vocabulary?page_size=100").json()["items"]
    profile = client.get("/api/profiles").json()[0]["id"]
    # Overlapping difficult/recent entries followed by recent-only entries.
    # The last recent entry is exactly seven days old.
    engine = create_engine(os.environ["DATABASE_URL"])
    with Session(engine) as db:
        for index, entry in enumerate(entries[: difficult_count + recent_count]):
            db.add(
                LearningProgress(
                    profile_id=UUID(profile),
                    entry_id=UUID(entry["id"]),
                    direction="greek_to_italian",
                    reviews=1,
                    again=int(index < difficult_count),
                    hard=0,
                    easy=int(index >= difficult_count),
                    weighted_sum=1 if index < difficult_count else 0,
                    weight=1,
                    last_reviewed_at=now - timedelta(days=7)
                    if index == difficult_count + recent_count - 1
                    else now,
                )
            )
        db.commit()
    engine.dispose()
    response = client.post(
        "/api/sessions",
        headers=csrf,
        json={
            "profile_id": profile,
            "direction": "greek_to_italian",
            "size": size,
            "mode": "mixed",
        },
    )
    assert response.status_code == 201
    cards = response.json()["cards"]
    selected = {c["entry_id"] for c in cards}
    assert len(selected) == size
    assert {e["id"] for e in entries[: difficult_count + recent_count]} <= selected


@pytest.mark.parametrize(
    "history_direction,partial",
    [
        ("greek_to_italian", False),
        ("italian_to_greek", False),
        ("greek_to_italian", True),
    ],
)
def test_mixed_isolation_excluded_times_and_partial_backfill(
    logged_in, monkeypatch, history_direction, partial
):
    import os
    from datetime import datetime, timedelta, timezone
    from uuid import UUID

    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    import app.practice as practice
    from app.models import LearningProgress, VocabularyEntry

    now = datetime(2026, 10, 13, 12, tzinfo=timezone.utc)

    class Clock:
        @staticmethod
        def now(tz):
            return now

    monkeypatch.setattr(practice, "datetime", Clock)
    # Control sampling order so random backfill cannot accidentally mask bad pools.
    monkeypatch.setattr(practice.func, "random", lambda: VocabularyEntry.italian)
    client = logged_in
    csrf = headers(client)
    entries = []
    for index in range(40):
        response = client.post(
            "/api/vocabulary",
            headers=csrf,
            json={
                "italian_gender": "masculine",
                "greek_gender": "neuter",
                "unit_id": client.get("/api/units").json()[0]["id"],
                "italian": f"aaa entry {index - 12 if index >= 27 else index:02}",
                "greek": f"έννοια {index}",
                "word_type": "noun",
            },
        )
        assert response.status_code == 201
        entries.append(response.json()["entry"])
    profiles = client.get("/api/profiles").json()
    profile = profiles[0]["id"]
    engine = create_engine(os.environ["DATABASE_URL"])
    with Session(engine) as db:
        for index in range(20, 31):
            if partial and index in (22, 23, 25, 26):
                continue
            timestamp = now
            if index == 27:
                timestamp = now - timedelta(days=7, microseconds=1)
            if index == 28:
                timestamp = now + timedelta(microseconds=1)
            db.add(
                LearningProgress(
                    profile_id=UUID(profiles[1]["id"] if index == 30 else profile),
                    entry_id=UUID(entries[index]["id"]),
                    direction="italian_to_greek" if index == 29 else history_direction,
                    reviews=1,
                    again=int(index < 24 or index >= 29),
                    hard=0,
                    easy=int(24 <= index < 29),
                    weighted_sum=int(index < 24 or index >= 29),
                    weight=1,
                    last_reviewed_at=timestamp,
                )
            )
        db.commit()
    engine.dispose()
    response = client.post(
        "/api/sessions",
        headers=csrf,
        json={
            "profile_id": profile,
            "direction": "greek_to_italian",
            "size": 10,
            "mode": "mixed",
        },
    )
    assert response.status_code == 201
    selected = {c["entry_id"] for c in response.json()["cards"]}
    indices = (
        list(range(10))
        if history_direction != "greek_to_italian"
        else list(range(7)) + [20, 21, 24]
        if partial
        else [0, 1, 2, 20, 21, 22, 23, 24, 25, 26]
    )
    assert selected == {entries[i]["id"] for i in indices}


@pytest.mark.parametrize("profile_id", [None, "", "not-a-uuid"])
def test_session_requires_explicit_valid_profile_id(logged_in, profile_id):
    body = {"direction": "greek_to_italian"}
    if profile_id is not None:
        body["profile_id"] = profile_id
    response = logged_in.post("/api/sessions", json=body, headers=headers(logged_in))
    assert response.status_code == 422


def test_unknown_profile_cannot_create_session(logged_in):
    response = start(logged_in, profile=str(uuid4()))
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "profile_not_found"


def test_unavailable_session_profile_blocks_reads_reveals_reviews_and_retries(
    logged_in, monkeypatch
):
    from sqlalchemy.orm import Session

    from app.models import Profile

    session = start(logged_in).json()
    path = f"/api/sessions/{session['id']}"
    csrf = headers(logged_in)
    direction = {"direction": "greek_to_italian"}
    review = {**direction, "rating": "hard"}
    assert (
        logged_in.post(
            path + "/cards/0/reveal", json=direction, headers=csrf
        ).status_code
        == 200
    )
    assert (
        logged_in.post(path + "/cards/0/reviews", json=review, headers=csrf).status_code
        == 200
    )

    # Foreign keys currently prevent deleting a referenced learner. Simulate a
    # missing learner at the database lookup to exercise the defensive API guard.
    original_scalar = Session.scalar

    def missing_profile(db, statement, *args, **kwargs):
        if any(
            column.get("entity") is Profile
            for column in getattr(statement, "column_descriptions", [])
        ):
            return None
        return original_scalar(db, statement, *args, **kwargs)

    with monkeypatch.context() as patch:
        patch.setattr(Session, "scalar", missing_profile)
        responses = [
            logged_in.get(path),
            logged_in.get(path + "/summary"),
            logged_in.post(path + "/cards/1/reveal", json=direction, headers=csrf),
            logged_in.post(path + "/cards/1/reviews", json=review, headers=csrf),
            logged_in.post(path + "/cards/0/reviews", json=review, headers=csrf),
        ]
        for response in responses:
            assert response.status_code == 404
            assert response.json()["error"]["code"] == "profile_not_found"
    assert logged_in.get(path + "/summary").json()["total"] == 1
