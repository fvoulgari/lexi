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
    assert entry["word_type"] == "noun"
    assert entry["unit_code"] == "007"
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
    assert row["unit_code"] == "'=007"
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


def test_export_round_trip_restores_text_metadata_and_duplicate_policy(logged_in):
    unit = logged_in.post(
        "/api/units",
        headers=headers(logged_in),
        json={
            "code": "007",
            "title": "=Έβδομο",
            "sort_order": -7,
        },
    ).json()
    tag = logged_in.post(
        "/api/tags",
        headers=headers(logged_in),
        json={
            "name": 'cibo|καφές, "Ελλάδα"',
        },
    ).json()
    saved = logged_in.post(
        "/api/vocabulary",
        headers=headers(logged_in),
        json={
            "italian": "'=literal",
            "greek": "=τύπος",
            "word_type": "noun",
            "unit_id": unit["id"],
            "tag_ids": [tag["id"]],
            "italian_gender": "masculine",
            "greek_gender": "neuter",
            "italian_plural": "+plural",
            "greek_plural": "πληθυντικός",
            "italian_example": '"Quoted",\nexample',
            "greek_example": "Ελλάδα",
            "notes": "'ordinary",
            "pronunciation": "@sound",
        },
    ).json()["entry"]
    content = logged_in.get("/api/vocabulary/export.csv").content

    def upload(action):
        return logged_in.post(
            f"/api/imports/{action}",
            content=content,
            headers={**headers(logged_in), "Content-Type": "text/csv"},
        )

    preview = upload("preview")
    assert preview.status_code == 200
    assert preview.json()["counts"]["duplicate"] == 11
    for entry in logged_in.get("/api/vocabulary?page_size=100").json()["items"]:
        assert (
            logged_in.delete(
                f"/api/vocabulary/{entry['id']}", headers=headers(logged_in)
            ).status_code
            == 200
        )
    preview = upload("preview").json()
    assert preview["counts"]["valid"] == 11
    assert logged_in.get("/api/vocabulary").json()["total"] == 0
    result = upload("confirm").json()
    assert result["counts"]["imported"] == 11
    restored = next(
        entry
        for entry in logged_in.get("/api/vocabulary?page_size=100").json()["items"]
        if entry["italian"] == "'=literal"
    )
    for field in (
        "italian",
        "greek",
        "word_type",
        "italian_gender",
        "greek_gender",
        "italian_plural",
        "greek_plural",
        "italian_example",
        "greek_example",
        "notes",
        "pronunciation",
        "unit",
        "tags",
    ):
        assert restored[field] == saved[field]
    assert upload("confirm").json()["counts"]["duplicate"] == 11


def test_versioned_import_validates_tags_and_leaves_legacy_text_unchanged(logged_in):
    def upload(row):
        content = io.StringIO(newline="")
        writer = csv.writer(content)
        writer.writerow(["italian", "greek", "word_type", "csv_format", "tags"])
        writer.writerow(row)
        return logged_in.post(
            "/api/imports/preview",
            content=content.getvalue(),
            headers={**headers(logged_in), "Content-Type": "text/csv"},
        ).json()

    for version, tags in [
        ("future-v2", "[]"),
        ("italian-notebook-v1", "bad json"),
        ("italian-notebook-v1", "{}"),
        ("italian-notebook-v1", "[1]"),
    ]:
        result = upload(["nuovo", "νέο", "noun", version, tags])
        assert result["counts"]["error"] == 1
        assert result["proposed_tags"] == []
    legacy = upload(["'=literal", "νέο", "noun", "", "daily|questions"])
    assert legacy["rows"][0]["entry"]["italian"] == "'=literal"
    assert legacy["rows"][0]["tags"] == ["daily", "questions"]
    versioned = upload(
        ["''=literal", "νέο", "noun", "italian-notebook-v1", '["daily|questions"]']
    )
    assert versioned["rows"][0]["entry"]["italian"] == "'=literal"
    assert versioned["proposed_tags"] == ["daily|questions"]
