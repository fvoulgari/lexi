from uuid import uuid4

from test_export import historical_collection, rows
from test_shareable_collections import H, add, card, collection, publish

CSV_HEADERS = "italian,greek,word_type,unit_code,notes\n"


def upload(client, action, data, **params):
    return client.post(
        f"/api/imports/{action}",
        headers={**H, "Content-Type": "text/csv"},
        content=data.encode(),
        params=params,
    )


def export(client, **params):
    return client.get(
        "/api/vocabulary/export.csv", params={"include_ids": True, **params}
    )


def test_new_destinations_are_atomic_and_export_their_own_cards(logged_in):
    legacy = historical_collection(logged_in, "07", "Historical", 7)
    initial = logged_in.get("/api/collections").json()
    invalid = CSV_HEADERS + "bad,,expression,07,\n"
    failed = upload(logged_in, "confirm", invalid, new_name="Orphan")
    assert failed.status_code == 422
    assert logged_in.get("/api/collections").json() == initial

    mismatched = upload(
        logged_in,
        "confirm",
        CSV_HEADERS + "salve,χαίρετε,expression,07,\n",
        new_name="Rolled back",
        expected_valid=2,
    )
    assert mismatched.status_code == 409
    assert logged_in.get("/api/collections").json() == initial
    assert not rows(export(logged_in, q="salve", word_types="expression"))

    destinations = []
    files = {
        "Lezione 01": [f"parola {n},λέξη {n},expression,07,\n" for n in range(14)],
        "Verbi": ["andare,πηγαίνω,verb,07,\n"],
    }
    for name, lines in files.items():
        data = CSV_HEADERS + "".join(lines)
        preview = upload(logged_in, "preview", data, new_name=name)
        assert preview.status_code == 200, preview.text
        assert preview.json()["counts"]["valid"] == len(lines)
        assert not any(
            c["name"] == name for c in logged_in.get("/api/collections").json()
        )
        params = dict(
            new_name=name, new_collection_id=str(uuid4()), expected_valid=len(lines)
        )
        confirmed = upload(logged_in, "confirm", data, **params)
        assert confirmed.status_code == 200, confirmed.text
        destination = confirmed.json()["destination_collection"]
        destinations.append(destination)
        retry = upload(logged_in, "confirm", data, **params)
        assert retry.status_code == 200, retry.text
        assert retry.json()["destination_collection"] == destination
        exported = export(logged_in, collection_id=destination["id"], page_size=1)
        assert exported.status_code == 200
        assert len(rows(exported)) == len(lines)
        assert {row["italian"] for row in rows(exported)} == {
            line.split(",")[0] for line in lines
        }
        assert all(not row["unit_code"] for row in rows(exported))
    assert not rows(export(logged_in, collection_id=legacy["id"]))
    scoped = export(logged_in, collection_id=destinations[0]["id"], q="parola 13")
    assert "Lezione%2001.csv" in scoped.headers["content-disposition"]
    assert [row["italian"] for row in rows(scoped)] == ["parola 13"]
    assert not rows(
        export(logged_in, collection_id=destinations[0]["id"], word_types="verb")
    )


def test_reference_import_preserves_identity_and_does_not_merge_text(logged_in):
    existing = collection(logged_in, "Existing")
    other = collection(logged_in, "Other")
    original = card(logged_in, existing, source="πηγαίνω", target="andare")
    data = (
        "italian,greek,word_type,entry_id\nandare,πηγαίνω,verb," + original["id"] + "\n"
    )
    response = upload(
        logged_in,
        "confirm",
        data,
        collection_id=other["id"],
        fixed_destination=True,
        expected_valid=1,
    )
    assert response.status_code == 200, response.text
    assert (
        rows(export(logged_in, collection_id=other["id"]))[0]["entry_id"]
        == original["id"]
    )
    assert (
        sum(row["entry_id"] == original["id"] for row in rows(export(logged_in))) == 1
    )

    unlinked = CSV_HEADERS + "andare,πηγαίνω,verb,,A distinct card\n"
    response = upload(
        logged_in,
        "confirm",
        unlinked,
        collection_id=other["id"],
        fixed_destination=True,
        expected_valid=1,
    )
    assert response.status_code == 200, response.text
    distinct = rows(export(logged_in, collection_id=other["id"]))
    assert len({row["entry_id"] for row in distinct}) == 2
    assert {row["notes"] for row in distinct} == {"", "A distinct card"}


def test_scoped_csv_enforces_read_access_and_keeps_publication_rules(
    client, account_client
):
    account_client("owner")
    private = collection(client, "Private")
    public = collection(client, "Shared")
    secret = card(client, private, source="κρυφό", target="segreto")
    shared = card(client, public)
    assert publish(client, public).status_code == 200
    data = CSV_HEADERS + "andare,πηγαίνω,verb,,\n"
    restricted = upload(
        client, "confirm", data, collection_id=public["id"], fixed_destination=True
    )
    assert restricted.status_code == 409
    account_client("visitor")
    assert export(client, collection_id=private["id"]).status_code == 404
    visible = rows(export(client, collection_id=public["id"]))
    assert [row["entry_id"] for row in visible] == [shared["id"]]
    assert secret["id"] not in {row["entry_id"] for row in rows(export(client))}
    mine = collection(client, "My references")
    assert add(client, mine, shared).status_code == 204
    assert sum(row["entry_id"] == shared["id"] for row in rows(export(client))) == 1


def test_export_supports_tag_filters_and_includes_accessible_language_pairs(logged_in):
    danish = collection(logged_in, "Danish", a="da", b="en")
    translated = card(logged_in, danish, source="hej", target="hello")
    all_cards = rows(export(logged_in))
    row = next(row for row in all_cards if row["entry_id"] == translated["id"])
    assert {row["source_language"], row["target_language"]} == {"da", "en"}
    assert len(rows(export(logged_in, collection_id=danish["id"]))) == 1

    italian = collection(logged_in, "Tagged")
    data = "italian,greek,word_type,tags\ncapire,καταλαβαίνω,verb,Lesson\n"
    assert (
        upload(
            logged_in,
            "confirm",
            data,
            collection_id=italian["id"],
            fixed_destination=True,
        ).status_code
        == 200
    )
    tag = next(t for t in logged_in.get("/api/tags").json() if t["name"] == "Lesson")
    filtered = rows(export(logged_in, collection_id=italian["id"], tag_ids=tag["id"]))
    assert [row["italian"] for row in filtered] == ["capire"]
    assert not rows(export(logged_in, collection_id=danish["id"], tag_ids=tag["id"]))
