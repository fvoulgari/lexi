from uuid import uuid4

from test_practice import headers, start


def submit(client, session, entry_id, direction, rating):
    position = next(
        c["position"] for c in session["cards"] if c["entry_id"] == entry_id
    )
    path = f"/api/sessions/{session['id']}/cards/{position}"
    assert (
        client.post(
            path + "/reveal", json={"direction": direction}, headers=headers(client)
        ).status_code
        == 200
    )
    body = {"direction": direction, "rating": rating}
    assert (
        client.post(path + "/reviews", json=body, headers=headers(client)).status_code
        == 200
    )
    # A replay must not inflate history.
    assert (
        client.post(path + "/reviews", json=body, headers=headers(client)).status_code
        == 200
    )


def test_progress_counts_history_and_deduplicates_directions(logged_in):
    client = logged_in
    first = start(client, size=None).json()
    entry = first["cards"][0]
    submit(client, first, entry["entry_id"], "greek_to_italian", "again")
    second = start(client, size=None).json()
    submit(client, second, entry["entry_id"], "italian_to_greek", "hard")
    both = client.get(f"/api/profiles/{first['profile_id']}/progress").json()
    assert both["difficult_entries"] == 1
    assert [row["difficult_entries"] for row in both["directions"]] == [1, 1]
    third = start(client, size=None).json()
    submit(client, third, entry["entry_id"], "greek_to_italian", "easy")
    # Unreviewed sessions do not replace the recent review summary.
    start(client)
    response = client.get(f"/api/profiles/{first['profile_id']}/progress")
    assert response.status_code == 200
    data = response.json()
    assert data["vocabulary_count"] == 10
    assert data["total_reviews"] == 3
    assert data["entries_practised"] == 1
    assert data["counts"] == {"again": 1, "hard": 1, "easy": 1}
    assert data["difficult_entries"] == 1
    assert {
        r["key"]: (r["total_reviews"], r["entries_practised"], r["difficult_entries"])
        for r in data["directions"]
    } == {"greek_to_italian": (2, 1, 0), "italian_to_greek": (1, 1, 1)}
    assert data["word_types"] == [
        {
            "key": entry["snapshot"]["word_type"],
            "total_reviews": 3,
            "entries_practised": 1,
            "counts": {"again": 1, "hard": 1, "easy": 1},
        }
    ]
    assert sum(r["total_reviews"] for r in data["units"]) == 3
    assert data["recent_session"]["id"] == third["id"]
    assert data["recent_session"]["remembered"] == 100
    assert data["recent_session"]["total_reviews"] == 1
    other = next(
        p for p in client.get("/api/profiles").json() if p["id"] != first["profile_id"]
    )
    empty = client.get(f"/api/profiles/{other['id']}/progress").json()
    assert (
        empty["total_reviews"]
        == empty["entries_practised"]
        == empty["difficult_entries"]
        == 0
    )
    assert empty["recent_session"] is None
    assert empty["counts"] == {"again": 0, "hard": 0, "easy": 0}
    assert empty["units"] == empty["word_types"] == []
    assert client.get(f"/api/profiles/{uuid4()}/progress").status_code == 404
    client.cookies.clear()
    assert (
        client.get(f"/api/profiles/{first['profile_id']}/progress").status_code == 401
    )


def test_breakdowns_preserve_review_time_units_and_types(logged_in):
    client = logged_in
    entries = client.get("/api/vocabulary?page_size=100").json()["items"]
    units = client.get("/api/units").json()
    for entry, unit_id, word_type in [
        (entries[0], None, "noun"),
        (entries[1], units[0]["id"], "verb"),
    ]:
        assert (
            client.patch(
                f"/api/vocabulary/{entry['id']}",
                json={"unit_id": unit_id, "word_type": word_type},
                headers=headers(client),
            ).status_code
            == 200
        )
    session = start(client, size=None).json()
    submit(client, session, entries[0]["id"], "greek_to_italian", "again")
    submit(client, session, entries[1]["id"], "greek_to_italian", "easy")
    client.patch(
        f"/api/vocabulary/{entries[0]['id']}",
        json={"unit_id": units[0]["id"], "word_type": "verb"},
        headers=headers(client),
    )
    data = client.get(f"/api/profiles/{session['profile_id']}/progress").json()
    assert data["entries_practised"] == data["total_reviews"] == 2
    assert {row["key"]: row["total_reviews"] for row in data["word_types"]} == {
        "noun": 1,
        "verb": 1,
    }
    assert {row["key"]: row["total_reviews"] for row in data["units"]} == {
        None: 1,
        units[0]["code"]: 1,
    }
    assert data["recent_session"]["remembered"] == 50
    assert data["recent_session"]["counts"] == {"again": 1, "hard": 0, "easy": 1}
