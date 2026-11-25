"""End-to-end proof that basic languages are registry data, not code paths."""

import csv
import io
import os

import pytest
from conftest import TEST_CSRF, signin
from sqlalchemy import create_engine, text
from test_generic_directions import card, collection, queue, rate, records

from app.csv_v2 import v2_columns
from app.registry import get_registry, refresh_registry

H = {"X-CSRF-Token": TEST_CSRF}


@pytest.fixture
def client(client):
    return signin(client)


def utf8_csv(rows, columns):
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(columns)
    for row in rows:
        writer.writerow(row.get(column, "") for column in columns)
    return output.getvalue().encode("utf-8-sig")


def import_csv(client, action, content, **params):
    return client.post(
        f"/api/imports/{action}",
        params=params,
        headers={**H, "Content-Type": "text/csv"},
        content=content,
    )


def register_data_only_language(code, label):
    """Add a language with SQL rows only: no app module, schema or fixture edit."""
    engine = create_engine(os.environ["DATABASE_URL"])
    with engine.begin() as db:
        db.execute(
            text(
                "INSERT INTO languages "
                "(id, display_name, script, text_direction, enhanced, "
                "publicly_available) VALUES (:id, :label, 'Latn', 'ltr', "
                "false, false)"
            ),
            {"id": code, "label": label},
        )
        for prompt, answer in ((code, "en"), ("en", code)):
            db.execute(
                text(
                    "INSERT INTO practice_directions "
                    "(name, prompt_language, answer_language, legacy) "
                    "VALUES (:name, :prompt, :answer, false)"
                ),
                {
                    "name": f"{prompt}_to_{answer}",
                    "prompt": prompt,
                    "answer": answer,
                },
            )
    engine.dispose()


def test_basic_languages_have_common_fields_and_no_grammar(client):
    owner = collection(client, "ja", "ar", "Universal pair")
    entry = card(client, owner, "ja", "ar", "日本語", "العربية")
    assert entry["source_language"] == "ja"
    assert entry["target_language"] == "ar"
    assert entry["source_text"] == "日本語"
    assert entry["target_text"] == "العربية"
    assert entry["grammar"] in (None, {})

    rejected = client.post(
        f"/api/collections/{owner['id']}/cards",
        headers=H,
        json={
            "source_language": "ja",
            "target_language": "ar",
            "source_text": "家庭",
            "target_text": "عائلة",
            "grammar": {"ja": {"gender": "masculine"}},
        },
    )
    assert rejected.status_code == 422
    assert "ja" in rejected.text


def test_universal_card_text_survives_search_progress_and_visibility(
    client, account_client
):
    learner = account_client("universal-learner")
    owner = collection(client, "ar", "ja", "Universal visibility")
    entry = card(client, owner, "ar", "ja", "كتاب", "本")
    found = client.get(
        "/api/vocabulary", params={"q": "كتاب", "all_languages": "true"}
    ).json()
    assert any(item["id"] == entry["id"] for item in found["items"])
    found = client.get(
        "/api/vocabulary", params={"q": "本", "all_languages": "true"}
    ).json()
    assert any(item["id"] == entry["id"] for item in found["items"])

    for direction in ("ar_to_ja", "ja_to_ar"):
        session = queue(client, learner, [owner], direction)
        rate(client, session, entry["id"], direction, "easy")
    directions = {
        record["direction"] for record in records(client, learner["profile_id"])
    }
    assert {"ar_to_ja", "ja_to_ar"} <= directions

    published = client.get(f"/api/collections/{owner['id']}/publish-preview")
    assert published.status_code == 200
    visible = client.get("/api/collections").json()
    assert any(item["id"] == owner["id"] for item in visible)


def test_synthetic_language_is_data_only_across_cards_csv_and_progress(
    client, account_client
):
    register_data_only_language("zz", "Synthetic")
    refresh = create_engine(os.environ["DATABASE_URL"])
    with refresh.connect() as db:
        refresh_registry(db)
    refresh.dispose()

    # The synthetic language is internal, so it is absent from the public API.
    catalogue = client.get("/api/languages").json()
    assert "zz" not in {item["id"] for item in catalogue["languages"]}
    assert "zz" in get_registry().ids

    learner = account_client("synthetic-learner")
    owner = collection(client, "zz", "en", "Synthetic pair")
    entry = card(client, owner, "zz", "en", "sintetico", "synthetic")
    assert entry["source_language"] == "zz"

    for direction in ("zz_to_en", "en_to_zz"):
        session = queue(client, learner, [owner], direction)
        rate(client, session, entry["id"], direction, "hard")
    directions = {
        record["direction"] for record in records(client, learner["profile_id"])
    }
    assert {"zz_to_en", "en_to_zz"} <= directions

    exported = client.get(
        "/api/vocabulary/export.csv",
        params={"collection_id": owner["id"], "include_ids": "true"},
    )
    assert exported.status_code == 200
    reader = csv.DictReader(io.StringIO(exported.content.decode("utf-8-sig")))
    rows = list(reader)
    assert "text_zz" in reader.fieldnames
    assert "text_zz" in v2_columns()
    assert rows[0]["text_zz"] == "sintetico"

    content = utf8_csv(rows, v2_columns())
    preview = import_csv(
        client,
        "preview",
        content,
        collection_id=owner["id"],
        fixed_destination="true",
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["counts"]["duplicate"] == 1
    confirmed = import_csv(
        client,
        "confirm",
        content,
        collection_id=owner["id"],
        fixed_destination="true",
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["counts"]["error"] == 0
