import csv
import io
import json

from test_vocabulary_editing import headers


def rows(response):
    return list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"))))


def test_export_full_library_with_unicode_and_metadata(logged_in):
    unit = logged_in.post(
        "/api/units",
        headers=headers(logged_in),
        json={
            "code": "007",
            "title": "Έβδομο",
            "sort_order": 7,
        },
    ).json()
    tag = logged_in.post(
        "/api/tags",
        headers=headers(logged_in),
        json={
            "name": 'cibo, "καφές"',
        },
    ).json()
    saved = logged_in.post(
        "/api/vocabulary",
        headers=headers(logged_in),
        json={
            "italian": "il perché",
            "greek": "το γιατί",
            "word_type": "noun",
            "unit_id": unit["id"],
            "tag_ids": [tag["id"]],
            "italian_gender": "masculine",
            "greek_gender": "neuter",
            "italian_plural": "i perché",
            "greek_plural": "τα γιατί",
            "italian_example": 'Dice: "perché, sì".\nPoi tace.',
            "greek_example": "Γιατί;",
            "notes": "Μία σημασία",
            "pronunciation": "perˈke",
        },
    ).json()["entry"]
    response = logged_in.get("/api/vocabulary/export.csv?q=missing&page_size=1")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "attachment;" in response.headers["content-disposition"]
    assert response.headers["cache-control"] == "no-store"
    exported = rows(response)
    assert len(exported) == 11
    entry = next(row for row in exported if row["italian"] == "il perché")
    for field in (
        "italian",
        "greek",
        "italian_gender",
        "greek_gender",
        "italian_plural",
        "greek_plural",
        "italian_example",
        "greek_example",
        "notes",
        "pronunciation",
    ):
        assert entry[field] == saved[field]
    assert entry["type"] == "noun"
    assert entry["unit"] == "007"
    assert entry["unit_title"] == "Έβδομο"
    assert entry["unit_sort_order"] == "7"
    assert json.loads(entry["tags"]) == ['cibo, "καφές"']
    assert logged_in.get("/api/vocabulary/export.csv").content == response.content


def test_export_neutralizes_formulas_and_preserves_literal_apostrophes(logged_in):
    for value in (
        "=1+1",
        "+SUM(A1)",
        "-1+2",
        "@SUM(A1)",
        "\t=1",
        "\r=1",
        "\n=1",
        "  =1",
        "'=literal",
        "'ordinary",
    ):
        # Internal whitespace stays significant; use notes for all payloads.
        saved = logged_in.post(
            "/api/vocabulary",
            headers=headers(logged_in),
            json={
                "italian": value.strip() or "literal",
                "greek": "δοκιμή",
                "word_type": "expression",
                "notes": "prefix\n" + value,
            },
        ).json()["entry"]
        # Required fields trim whitespace. Embedded line breaks are CSV data, not cells.
        entry = next(
            row
            for row in rows(logged_in.get("/api/vocabulary/export.csv"))
            if row["notes"] == saved["notes"]
        )
        assert entry["italian"] == "'" + saved["italian"]
        assert entry["notes"] == "prefix\n" + value


def test_export_requires_admission_and_handles_empty_library(logged_in):
    for entry in logged_in.get("/api/vocabulary?page_size=100").json()["items"]:
        assert (
            logged_in.delete(
                f"/api/vocabulary/{entry['id']}", headers=headers(logged_in)
            ).status_code
            == 200
        )
    response = logged_in.get("/api/vocabulary/export.csv")
    assert response.status_code == 200
    assert rows(response) == []
    assert response.content.startswith(b"\xef\xbb\xbf")
    logged_in.cookies.clear()
    assert logged_in.get("/api/vocabulary/export.csv").status_code == 401


def test_export_escapes_every_free_text_column_and_json_encodes_tags(logged_in):
    unit = logged_in.post(
        "/api/units",
        headers=headers(logged_in),
        json={
            "code": "=007",
            "title": "+title",
            "sort_order": -7,
        },
    ).json()
    tag = logged_in.post(
        "/api/tags",
        headers=headers(logged_in),
        json={
            "name": '=SUM(A1); "Ελλάδα"',
        },
    ).json()
    saved = logged_in.post(
        "/api/vocabulary",
        headers=headers(logged_in),
        json={
            "italian": "＠formula",
            "greek": "＝τύπος",
            "word_type": "other",
            "unit_id": unit["id"],
            "tag_ids": [tag["id"]],
            "italian_plural": "-plural",
            "greek_plural": "+πληθυντικός",
            "italian_example": "@example",
            "greek_example": "=παράδειγμα",
            "notes": "'notes",
            "pronunciation": "=sound",
        },
    ).json()["entry"]
    row = next(
        row
        for row in rows(logged_in.get("/api/vocabulary/export.csv"))
        if row["italian"] == "'＠formula"
    )
    for field in (
        "italian",
        "greek",
        "italian_plural",
        "greek_plural",
        "italian_example",
        "greek_example",
        "notes",
        "pronunciation",
    ):
        assert row[field] == "'" + saved[field]
    assert row["unit"] == "'=007"
    assert row["unit_title"] == "'+title"
    assert row["unit_sort_order"] == "'-7"
    assert json.loads(row["tags"]) == ['=SUM(A1); "Ελλάδα"']
    ordinary = next(
        row
        for row in rows(logged_in.get("/api/vocabulary/export.csv"))
        if row["italian"] == "essere"
    )
    assert ordinary["italian_gender"] == ""
    assert ordinary["notes"] == ""
    assert ordinary["tags"] == "[]"
