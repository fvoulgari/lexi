"""Seed local profiles and, when an owner is provided, a private sample library."""

import csv
import json
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy.dialects.postgresql import insert

from app.config import Settings
from app.database import database
from app.models import Collection, CollectionEntry, Profile, VocabularyEntry

DATA = Path(__file__).resolve().parents[2] / "data"


def seed_id(name):
    return uuid5(NAMESPACE_URL, "italian-notebook/seed/" + name)


def seed(owner_id=None):
    engine, sessions = database(Settings().database_url)
    initial = json.loads((DATA / "initial_setup.json").read_text(encoding="utf-8"))
    with sessions.begin() as db:
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


if __name__ == "__main__":
    seed()
