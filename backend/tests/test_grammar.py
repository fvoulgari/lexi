"""Category grammar is optional, manual, and cleaned only when saving a card."""

import csv
import io

import pytest
from csv_fixtures import with_genders
from test_vocabulary_editing import headers

from app.grammar import ADJECTIVE_FORM_FIELDS, NOUN_FIELDS

ORIGINAL_FORMS = (
    "italian_feminine_singular",
    "italian_masculine_plural",
    "italian_feminine_plural",
)


def create(client, **values):
    return client.post(
        "/api/vocabulary",
        json={
            "unit_id": client.get("/api/units").json()[0]["id"],
            "italian": "il biglietto",
            "greek": "το εισιτήριο",
            "word_type": "noun",
            "italian_gender": "masculine",
            "greek_gender": "neuter",
            "italian_adjective_gender": "masculine",
            "greek_adjective_gender": "masculine",
            **values,
        },
        headers=headers(client),
    )


def test_nouns_preserve_independent_genders_articles_and_invariable_plurals(logged_in):
    client = logged_in
    card = create(
        client,
        italian_plural="i biglietti",
        italian_gender="masculine",
        greek_gender="neuter",
    ).json()["entry"]
    assert card["italian"] == "il biglietto"
    assert card["italian_plural"] == "i biglietti"
    assert card["greek_gender"] == "neuter"
    for gender in ("masculine", "feminine"):
        barista = create(
            client,
            italian="il barista" if gender == "masculine" else "la barista",
            italian_gender=gender,
        ).json()["entry"]
        assert barista["italian_gender"] == gender
    for field in ("italian_gender", "greek_gender"):
        rejected = create(client, **{field: "common"})
        assert rejected.status_code == 422
        assert field in rejected.json()["error"]["fields"]
    film = create(client, italian="il film", italian_plural="i film").json()["entry"]
    assert film["italian_plural"] == "i film"
    assert film["italian_gender"] == "masculine"
    rejected = create(client, italian_gender="neuter")
    assert rejected.status_code == 422
    assert "italian_gender" in rejected.json()["error"]["fields"]


@pytest.mark.parametrize(
    "forms",
    [
        ("italiano", "italiana", "italiani", "italiane"),
        ("inglese", "inglese", "inglesi", "inglesi"),
    ],
)
def test_adjective_forms_are_manual_optional_and_available_in_session_snapshots(
    logged_in, forms
):
    from test_practice import start

    main, *other = forms
    saved = create(
        logged_in,
        italian=main,
        greek="αγγλικός, -ή, -ό",
        word_type="adjective",
        **dict(zip(ORIGINAL_FORMS, other)),
        italian_plural="legacy plural",
        italian_gender="invalid",
    ).json()["entry"]
    assert [saved[field] for field in ORIGINAL_FORMS] == other
    assert all(saved[field] is None for field in NOUN_FIELDS)
    assert saved["greek"] == "αγγλικός, -ή, -ό"
    assert all(
        saved[field] is None
        for field in ADJECTIVE_FORM_FIELDS
        if field.startswith("greek_")
    )
    session = start(logged_in, size=None).json()
    snapshot = next(
        c["snapshot"] for c in session["cards"] if c["entry_id"] == saved["id"]
    )
    assert [snapshot[field] for field in ORIGINAL_FORMS] == other
    empty = create(logged_in, italian="blu", word_type="adjective").json()["entry"]
    assert all(empty[field] is None for field in ADJECTIVE_FORM_FIELDS)
    assert (
        empty["italian_adjective_gender"]
        == empty["greek_adjective_gender"]
        == "masculine"
    )


@pytest.mark.parametrize("category", ["verb", "adverb", "expression", "other"])
def test_category_save_clears_incompatible_grammar_and_preserves_common_fields(
    logged_in, category
):
    client = logged_in
    original = create(
        client,
        italian="formare",
        italian_gender="masculine",
        italian_plural="draft plural",
    ).json()["entry"]
    result = client.patch(
        f"/api/vocabulary/{original['id']}",
        json={
            "word_type": category,
            "italian_gender": "invalid hidden gender",
            "italian_feminine_singular": "x" * 501,
            "italian_example": "Un esempio.",
            "greek_example": "Ένα παράδειγμα.",
            "pronunciation": "sound",
            "notes": "note",
        },
        headers=headers(client),
    )
    assert result.status_code == 200
    saved = result.json()["entry"]
    assert saved["id"] == original["id"]
    assert all(saved[field] is None for field in NOUN_FIELDS + ADJECTIVE_FORM_FIELDS)
    assert saved["notes"] == "note"
    assert saved["italian_example"] == "Un esempio."
    assert saved["greek_example"] == "Ένα παράδειγμα."
    assert saved["pronunciation"] == "sound"


def test_adjective_csv_round_trip_and_legacy_plural_compatibility(
    logged_in,
):
    client = logged_in
    unit = client.get("/api/units").json()[0]["id"]
    content = (
        "italian,greek,word_type,italian_feminine_singular,"
        "italian_masculine_plural,italian_feminine_plural\n"
        "italiano,ιταλικός,adjective,italiana,italiani,italiane\n"
    )

    def upload(content, action):
        content = with_genders(content)
        return client.post(
            f"/api/imports/{action}?unit_id={unit}",
            content=content.encode(),
            headers=headers(client),
        ).json()

    assert upload(content, "preview")["counts"]["valid"] == 1
    assert upload(content, "confirm")["counts"]["imported"] == 1
    exported = list(
        csv.DictReader(
            io.StringIO(
                client.get("/api/vocabulary/export.csv").content.decode("utf-8-sig")
            )
        )
    )
    row = next(row for row in exported if row["italian"] == "italiano")
    assert [row[field] for field in ORIGINAL_FORMS] == [
        "italiana",
        "italiani",
        "italiane",
    ]
    row["italian_feminine_singular"] = "manual correction"
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=row.keys())
    writer.writeheader()
    writer.writerow(row)
    assert upload(out.getvalue(), "confirm")["counts"]["updated"] == 1
    assert upload(out.getvalue(), "confirm")["counts"]["duplicate"] == 1
    old = (
        "italian,greek,word_type,gender,plural\n"
        "inglese,αγγλικός,adjective,masculine,inglesi\n"
    )
    assert upload(old, "confirm")["counts"]["imported"] == 1
    saved = client.get("/api/vocabulary?q=inglese").json()["items"][0]
    assert all(saved[field] is None for field in NOUN_FIELDS + ADJECTIVE_FORM_FIELDS)


def test_migration_adds_nullable_forms_without_rewriting_legacy_metadata(test_database):
    from pathlib import Path
    from uuid import uuid4

    from alembic.config import Config
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from alembic.script import ScriptDirectory
    from sqlalchemy import create_engine, text

    schema = "grammar_" + uuid4().hex
    engine = create_engine(test_database)
    scripts = ScriptDirectory.from_config(
        Config(str(Path(__file__).parents[1] / "alembic.ini"))
    )
    with engine.connect() as connection:
        try:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
            connection.execute(text(f'SET search_path TO "{schema}"'))
            with Operations.context(MigrationContext.configure(connection)):
                for revision in reversed(
                    list(scripts.walk_revisions(base="base", head="f24a55e7b006"))
                ):
                    revision.module.upgrade()
                unit = uuid4()
                connection.execute(
                    text(
                        "INSERT INTO units (id, code, title, sort_order) "
                        "VALUES (:id, 'test', 'Legacy unit', 0)"
                    ),
                    {"id": unit},
                )
                connection.execute(
                    text(
                        "INSERT INTO vocabulary_entries (id, italian, greek, "
                        "word_type, unit_id, italian_plural, italian_gender) "
                        "VALUES (:id, 'inglese', 'αγγλικός, -ή, -ό', 'adjective', "
                        ":unit, 'legacy plural', 'masculine')"
                    ),
                    {"id": uuid4(), "unit": unit},
                )
                before = dict(
                    connection.execute(text("SELECT * FROM vocabulary_entries"))
                    .mappings()
                    .one()
                )
                migration = scripts.get_revision("a35b66f8c007").module
                migration.upgrade()
                after = dict(
                    connection.execute(text("SELECT * FROM vocabulary_entries"))
                    .mappings()
                    .one()
                )
                assert {key: after[key] for key in before} == before
                assert all(after[field] is None for field in ORIGINAL_FORMS)
                bilingual = scripts.get_revision("b46c77a9d008").module
                bilingual.upgrade()
                expanded = dict(
                    connection.execute(text("SELECT * FROM vocabulary_entries"))
                    .mappings()
                    .one()
                )
                assert {field: expanded[field] for field in after} == after
                for field in (
                    bilingual.FORMS + bilingual.GENDERS + ("greek_pronunciation",)
                ):
                    assert expanded[field] is None
                assert expanded["greek"] == "αγγλικός, -ή, -ό"
                bilingual.downgrade()
                migration.downgrade()
                assert (
                    dict(
                        connection.execute(text("SELECT * FROM vocabulary_entries"))
                        .mappings()
                        .one()
                    )
                    == before
                )
        finally:
            connection.rollback()
    engine.dispose()


def test_legacy_common_opens_unset_and_can_be_corrected_without_losing_progress(
    logged_in, test_database
):
    from sqlalchemy import create_engine, text
    from test_practice import start

    client = logged_in
    original = create(client, italian="l’artista", greek="ο/η καλλιτέχνης").json()[
        "entry"
    ]
    session = start(client, size=None).json()
    card = next(card for card in session["cards"] if card["entry_id"] == original["id"])
    path = f"/api/sessions/{session['id']}/cards/{card['position']}"
    client.post(
        path + "/reveal",
        json={"direction": session["direction"]},
        headers=headers(client),
    )
    client.post(
        path + "/reviews",
        json={"direction": session["direction"], "rating": "easy"},
        headers=headers(client),
    )
    before = client.get(f"/api/profiles/{session['profile_id']}/progress").json()
    engine = create_engine(test_database)
    with engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE vocabulary_entries SET italian_gender='common', "
                "greek_gender='common' WHERE id=:id"
            ),
            {"id": original["id"]},
        )
    entry = client.get(f"/api/vocabulary/{original['id']}").json()
    assert entry["italian_gender"] is None
    assert entry["greek_gender"] is None
    assert entry["italian"] == "l’artista"
    assert entry["greek"] == "ο/η καλλιτέχνης"
    with engine.connect() as connection:
        assert (
            connection.scalar(
                text("SELECT italian_gender FROM vocabulary_entries WHERE id=:id"),
                {"id": original["id"]},
            )
            == "common"
        )
    exported = list(
        csv.DictReader(
            io.StringIO(
                client.get("/api/vocabulary/export.csv").content.decode("utf-8-sig")
            )
        )
    )
    row = next(row for row in exported if row["italian"] == original["italian"])
    assert row["italian_gender"] == row["greek_gender"] == ""
    saved = client.patch(
        f"/api/vocabulary/{original['id']}",
        json={
            "italian_gender": "masculine",
            "greek_gender": "feminine",
            "notes": "Corrected manually",
        },
        headers=headers(client),
    )
    assert saved.status_code == 200
    assert saved.json()["entry"]["id"] == original["id"]
    assert saved.json()["entry"]["italian_gender"] == "masculine"
    assert saved.json()["entry"]["greek_gender"] == "feminine"
    assert (
        client.get(f"/api/profiles/{session['profile_id']}/progress").json() == before
    )
    engine.dispose()


def test_csv_rejects_removed_genders_and_preserves_greek_neuter(logged_in):
    client = logged_in
    unit = client.get("/api/units").json()[0]["id"]
    for field, value, valid in [
        ("italian_gender", "common", False),
        ("greek_gender", "common", False),
        ("gender", "common", False),
        ("italian_gender", "neuter", False),
        ("greek_gender", "neuter", True),
        ("italian_gender", "", False),
    ]:
        content = with_genders(
            f"italian,greek,word_type,{field}\nil barista,μπαρίστα,noun,{value}\n"
        )
        for action in ("preview", "confirm"):
            result = client.post(
                f"/api/imports/{action}?unit_id={unit}",
                content=content.encode(),
                headers=headers(client),
            ).json()
            assert result["counts"]["error"] == (0 if valid else 1)


@pytest.mark.parametrize("italian_gender", ["masculine", "feminine"])
@pytest.mark.parametrize("greek_gender", ["masculine", "feminine", "neuter"])
def test_independent_adjective_genders_and_free_text_pronunciations(
    logged_in, italian_gender, greek_gender
):
    from test_practice import start

    client = logged_in
    body = {
        "word_type": "adjective",
        "italian": "alto" if italian_gender == "masculine" else "alta",
        "greek": {"masculine": "ψηλός", "feminine": "ψηλή", "neuter": "ψηλό"}[
            greek_gender
        ],
        "italian_adjective_gender": italian_gender,
        "greek_adjective_gender": greek_gender,
        "italian_masculine_singular": "alto",
        "italian_masculine_plural": "alti",
        "italian_feminine_singular": "alta",
        "italian_feminine_plural": "alte",
        "greek_masculine_singular": "ψηλός",
        "greek_masculine_plural": "ψηλοί",
        "greek_feminine_singular": "ψηλή",
        "greek_feminine_plural": "ψηλές",
        "greek_neuter_singular": "ψηλό",
        "greek_neuter_plural": "ψηλά",
        "pronunciation": "άλτο",
        "greek_pronunciation": "psee-LO",
    }
    response = create(client, **body)
    assert response.status_code == 201
    saved = response.json()["entry"]
    for field, value in body.items():
        assert saved[field] == value
    assert saved["italian_gender"] is None
    assert saved["greek_gender"] is None
    session = start(client, size=None).json()
    card = next(c for c in session["cards"] if c["entry_id"] == saved["id"])
    path = f"/api/sessions/{session['id']}/cards/{card['position']}"
    client.post(
        path + "/reveal",
        json={"direction": session["direction"]},
        headers=headers(client),
    )
    client.post(
        path + "/reviews",
        json={"direction": session["direction"], "rating": "easy"},
        headers=headers(client),
    )
    before = client.get(f"/api/profiles/{session['profile_id']}/progress").json()
    updated = client.patch(
        f"/api/vocabulary/{saved['id']}",
        json={
            "italian_adjective_gender": "feminine"
            if italian_gender == "masculine"
            else "masculine",
            "greek_adjective_gender": "neuter",
        },
        headers=headers(client),
    ).json()["entry"]
    # Changing the main gender never moves grammatical forms or rewrites text.
    for field, value in body.items():
        if field not in {"italian_adjective_gender", "greek_adjective_gender"}:
            assert updated[field] == value
    assert (
        client.get(f"/api/profiles/{session['profile_id']}/progress").json() == before
    )
    assert card["snapshot"]["greek_pronunciation"] == "psee-LO"


def test_bilingual_csv_round_trip_and_old_pronunciation_column(logged_in):
    client = logged_in
    unit = client.get("/api/units").json()[0]["id"]
    content = (
        "italian,greek,word_type,italian_adjective_gender,greek_adjective_gender,"
        "italian_masculine_singular,italian_masculine_plural,"
        "greek_masculine_plural,greek_neuter_singular,greek_neuter_plural,"
        "pronunciation,greek_pronunciation\n"
        "alta,ψηλή,adjective,feminine,feminine,alto,alti,ψηλοί,ψηλό,ψηλά,άλτα,psee-LEE\n"
    )

    def upload(content, action):
        return client.post(
            f"/api/imports/{action}?unit_id={unit}",
            content=content.encode(),
            headers=headers(client),
        ).json()

    assert upload(content, "preview")["counts"]["valid"] == 1
    assert upload(content, "confirm")["counts"]["imported"] == 1
    saved = client.get("/api/vocabulary?q=alta").json()["items"][0]
    exported = list(
        csv.DictReader(
            io.StringIO(
                client.get("/api/vocabulary/export.csv").content.decode("utf-8-sig")
            )
        )
    )
    row = next(row for row in exported if row["italian"] == "alta")
    assert (
        row["italian_adjective_gender"] == row["greek_adjective_gender"] == "feminine"
    )
    assert row["greek_neuter_plural"] == "ψηλά"
    assert row["pronunciation"] == "άλτα"
    assert row["greek_pronunciation"] == "psee-LEE"
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=row.keys())
    writer.writeheader()
    writer.writerow(row)
    assert upload(out.getvalue(), "confirm")["counts"]["duplicate"] == 1
    old = "italian,greek,word_type,pronunciation\nalta,ψηλή,adjective,άλτα updated\n"
    assert upload(old, "confirm")["counts"]["updated"] == 1
    after = client.get(f"/api/vocabulary/{saved['id']}").json()
    assert after["greek_pronunciation"] == "psee-LEE"
    assert after["greek_neuter_plural"] == "ψηλά"
    assert after["greek_adjective_gender"] == "feminine"
    assert after["pronunciation"] == "άλτα updated"


def test_adjective_gender_validation_is_language_specific(logged_in):
    assert (
        create(
            logged_in, word_type="adjective", italian_adjective_gender="neuter"
        ).status_code
        == 422
    )
    assert (
        create(
            logged_in, word_type="adjective", greek_adjective_gender="neuter"
        ).status_code
        == 201
    )
    assert (
        create(
            logged_in, word_type="adjective", greek_adjective_gender="common"
        ).status_code
        == 422
    )
