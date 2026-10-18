from test_practice import headers, start


def test_delete_unreviewed_entry_removes_search_and_future_selections(logged_in):
    entry = logged_in.get("/api/vocabulary").json()["items"][0]
    path = f"/api/vocabulary/{entry['id']}"
    assert logged_in.delete(path).status_code == 403
    assert logged_in.delete(path, headers=headers(logged_in)).status_code == 200
    assert logged_in.get(path).status_code == 404
    results = logged_in.get("/api/vocabulary", params={"q": entry["italian"]}).json()
    assert entry["id"] not in [e["id"] for e in results["items"]]
    assert logged_in.get("/api/vocabulary").json()["total"] == 9
    assert entry["id"] not in [c["entry_id"] for c in start(logged_in).json()["cards"]]
    assert logged_in.delete(path, headers=headers(logged_in)).status_code == 404
    logged_in.cookies.clear()
    assert logged_in.delete(path).status_code == 401


def test_reviewed_entry_deletion_removes_reviews_and_stats(logged_in):
    session = start(logged_in).json()
    path = f"/api/sessions/{session['id']}/cards/0"
    csrf = headers(logged_in)
    body = {"direction": "greek_to_italian", "rating": "hard"}
    logged_in.post(
        path + "/reveal", json={"direction": body["direction"]}, headers=csrf
    )
    assert logged_in.post(path + "/reviews", json=body, headers=csrf).status_code == 200
    profile = session["profile_id"]
    assert (
        logged_in.get(f"/api/profiles/{profile}/progress").json()["total_reviews"] == 1
    )
    assert (
        logged_in.delete(
            f"/api/vocabulary/{session['cards'][0]['entry_id']}", headers=csrf
        ).status_code
        == 200
    )
    stats = logged_in.get(f"/api/profiles/{profile}/progress").json()
    assert stats["total_reviews"] == 0
    assert stats["entries_practised"] == 0
    assert stats["difficult_entries"] == 0
    assert stats["recent_session"] is None
    assert logged_in.get(f"/api/profiles/{profile}/learning-records").json() == []
    assert logged_in.get(f"/api/sessions/{session['id']}/summary").json()["total"] == 0
    assert logged_in.post(path + "/reviews", json=body, headers=csrf).status_code == 409


def test_deleted_queued_entry_is_skipped_without_changing_other_cards(logged_in):
    session = start(logged_in).json()
    path = f"/api/sessions/{session['id']}"
    csrf = headers(logged_in)
    # A reveal alone must not protect an accidental entry.
    logged_in.post(
        path + "/cards/0/reveal", json={"direction": "greek_to_italian"}, headers=csrf
    )
    assert (
        logged_in.delete(
            f"/api/vocabulary/{session['cards'][0]['entry_id']}", headers=csrf
        ).status_code
        == 200
    )
    current = logged_in.get(path).json()
    assert current["cards"][0]["skipped"] is True
    assert current["active_count"] == 9
    assert current["cards"][1:] == session["cards"][1:]
    for suffix, body in [
        ("reveal", {"direction": "greek_to_italian"}),
        ("reviews", {"direction": "greek_to_italian", "rating": "easy"}),
    ]:
        response = logged_in.post(path + "/cards/0/" + suffix, json=body, headers=csrf)
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "entry_deleted"
    assert logged_in.get(path + "/summary").json()["total"] == 0
    assert (
        logged_in.post(
            path + "/cards/1/reveal",
            json={"direction": "greek_to_italian"},
            headers=csrf,
        ).status_code
        == 200
    )
    assert (
        logged_in.post(
            path + "/cards/1/reviews",
            json={"direction": "greek_to_italian", "rating": "easy"},
            headers=csrf,
        ).status_code
        == 200
    )


def test_concurrent_review_and_deletion_leave_no_history_or_stats(logged_in):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    csrf = headers(logged_in)
    # Race on fresh entries so every run starts without history.
    for number in range(8):
        entry = logged_in.post(
            "/api/vocabulary",
            json={
                "unit_id": logged_in.get("/api/units").json()[0]["id"],
                "italian": f"accidentale {number}",
                "greek": f"λάθος {number}",
                "word_type": "other",
            },
            headers=csrf,
        ).json()["entry"]
        session = start(logged_in, size=None).json()
        card = next(c for c in session["cards"] if c["entry_id"] == entry["id"])
        path = f"/api/sessions/{session['id']}/cards/{card['position']}"
        body = {"direction": "greek_to_italian", "rating": "hard"}
        logged_in.post(
            path + "/reveal", json={"direction": body["direction"]}, headers=csrf
        )
        barrier = Barrier(2)

        def review():
            barrier.wait()
            return logged_in.post(path + "/reviews", json=body, headers=csrf)

        def delete():
            barrier.wait()
            return logged_in.delete(f"/api/vocabulary/{entry['id']}", headers=csrf)

        with ThreadPoolExecutor(max_workers=2) as executor:
            review_future = executor.submit(review)
            delete_future = executor.submit(delete)
            saved, deleted = (
                review_future.result(timeout=10),
                delete_future.result(timeout=10),
            )
        summary = logged_in.get(f"/api/sessions/{session['id']}/summary").json()
        records = logged_in.get(
            f"/api/profiles/{session['profile_id']}/learning-records"
        ).json()
        record = next((r for r in records if r["entry_id"] == entry["id"]), None)
        assert saved.status_code in (200, 409)
        assert deleted.status_code == 200
        assert summary["total"] == 0
        assert record is None
        assert logged_in.get(f"/api/vocabulary/{entry['id']}").status_code == 404


def test_deletion_clears_all_learners_and_directions_but_keeps_other_cards(logged_in):
    client = logged_in
    csrf = headers(client)
    profiles = [client.get("/api/profiles").json()[0]["id"]]
    profiles.append(
        client.post(
            "/api/profiles", json={"display_name": "Second learner"}, headers=csrf
        ).json()["id"]
    )
    entries = client.get("/api/vocabulary").json()["items"]
    removed, retained = [entry["id"] for entry in entries[:2]]
    for profile in profiles:
        for direction in ("greek_to_italian", "italian_to_greek"):
            session = start(client, profile=profile, direction=direction).json()
            for entry_id in (removed, retained):
                card = next(c for c in session["cards"] if c["entry_id"] == entry_id)
                path = f"/api/sessions/{session['id']}/cards/{card['position']}"
                client.post(
                    path + "/reveal", json={"direction": direction}, headers=csrf
                )
                assert (
                    client.post(
                        path + "/reviews",
                        json={
                            "direction": direction,
                            "rating": "again" if entry_id == removed else "easy",
                        },
                        headers=csrf,
                    ).status_code
                    == 200
                )
    assert client.delete(f"/api/vocabulary/{removed}", headers=csrf).status_code == 200
    for profile in profiles:
        stats = client.get(f"/api/profiles/{profile}/progress").json()
        assert stats["total_reviews"] == 2
        assert stats["entries_practised"] == 1
        assert stats["counts"] == {"again": 0, "hard": 0, "easy": 2}
        assert stats["difficult_entries"] == 0
        assert all(d["total_reviews"] == 1 for d in stats["directions"])
        records = client.get(f"/api/profiles/{profile}/learning-records").json()
        assert {record["entry_id"] for record in records} == {retained}
