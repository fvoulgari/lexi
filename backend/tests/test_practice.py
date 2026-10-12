from uuid import uuid4


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
