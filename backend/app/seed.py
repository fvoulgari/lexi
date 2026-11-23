"""Seed local profiles and, when an owner is provided, a private sample library."""

import argparse
import csv
import json
from pathlib import Path
from uuid import NAMESPACE_URL, UUID, uuid5

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.config import Settings
from app.database import database
from app.languages import (
    DIRECTION_PAIRS,
    LANGUAGE_LABELS,
    LANGUAGES,
    LEGACY_DIRECTIONS,
)
from app.models import (
    Account,
    Collection,
    CollectionEntry,
    Language,
    PracticeDirection,
    Profile,
    VocabularyEntry,
)

DATA = Path(__file__).resolve().parents[2] / "data"

# Bootstrap curation: script, text direction and enhanced-grammar support.
BOOTSTRAP_METADATA = {
    "da": ("Latn", "ltr", False),
    "el": ("Grek", "ltr", True),
    "en": ("Latn", "ltr", False),
    "it": ("Latn", "ltr", True),
}


def seed_id(name):
    return uuid5(NAMESPACE_URL, "italian-notebook/seed/" + name)


def seed(owner_id=None):
    engine, sessions = database(Settings().database_url)
    initial = json.loads((DATA / "initial_setup.json").read_text(encoding="utf-8"))
    with sessions.begin() as db:
        for code in LANGUAGES:
            script, text_direction, enhanced = BOOTSTRAP_METADATA[code]
            db.execute(
                insert(Language)
                .values(
                    id=code,
                    display_name=LANGUAGE_LABELS[code],
                    script=script,
                    text_direction=text_direction,
                    enhanced=enhanced,
                    publicly_available=True,
                )
                .on_conflict_do_nothing()
            )
        for name, (prompt, answer) in DIRECTION_PAIRS.items():
            db.execute(
                insert(PracticeDirection)
                .values(
                    name=name,
                    prompt_language=prompt,
                    answer_language=answer,
                    legacy=name in LEGACY_DIRECTIONS,
                )
                .on_conflict_do_nothing()
            )
        for name in initial["profiles"]:
            db.execute(
                insert(Profile)
                .values(
                    id=seed_id("profile/" + name),
                    display_name=name,
                    is_legacy=True,
                    preferred_direction="greek_to_italian",
                )
                .on_conflict_do_nothing()
            )
        if owner_id is not None:
            if db.get(Account, owner_id) is None:
                raise ValueError("The selected owner account does not exist.")
            for group in initial["units"]:
                existing = db.scalar(
                    select(Collection)
                    .where(Collection.id == seed_id("collection/" + group["code"]))
                    .execution_options(unscoped=True)
                )
                if existing is not None and existing.owner_account_id != owner_id:
                    raise ValueError(
                        "Sample Collections already belong to another account."
                    )
            for group in initial["units"]:
                db.execute(
                    insert(Collection)
                    .values(
                        id=seed_id("collection/" + group["code"]),
                        owner_account_id=owner_id,
                        title=group["code"] + " · " + group["title"],
                        visibility="private",
                        source_unit_id=seed_id("unit/" + group["code"]),
                        source_unit_code=group["code"],
                        source_unit_title=group["title"],
                        source_unit_sort_order=group["sort_order"],
                    )
                    .on_conflict_do_nothing()
                )
            with (DATA / "sample_vocabulary.csv").open(
                encoding="utf-8", newline=""
            ) as source:
                for position, row in enumerate(csv.DictReader(source)):
                    values = {
                        key: value or None
                        for key, value in row.items()
                        if key not in {"unit", "type"}
                    }
                    card_id = seed_id("entry/" + row["italian"] + "/" + row["greek"])
                    collection_id = seed_id("collection/" + row["unit"])
                    existing_card = db.scalar(
                        select(VocabularyEntry)
                        .where(VocabularyEntry.id == card_id)
                        .execution_options(unscoped=True, include_archived=True)
                    )
                    if (
                        existing_card is not None
                        and existing_card.owner_account_id != owner_id
                    ):
                        raise ValueError(
                            "Sample cards already belong to another account."
                        )
                    db.execute(
                        insert(VocabularyEntry)
                        .values(
                            id=card_id,
                            owner_account_id=owner_id,
                            visibility="private",
                            source_collection_id=collection_id,
                            word_type=row["type"],
                            **values,
                        )
                        .on_conflict_do_nothing()
                    )
                    db.execute(
                        insert(CollectionEntry)
                        .values(
                            collection_id=collection_id,
                            entry_id=card_id,
                            position=position,
                        )
                        .on_conflict_do_nothing(
                            index_elements=["collection_id", "entry_id"]
                        )
                    )
    engine.dispose()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner-account-id", type=UUID, required=True)
    args = parser.parse_args(argv)
    seed(owner_id=args.owner_account_id)


if __name__ == "__main__":
    main()
