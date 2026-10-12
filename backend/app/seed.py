import csv
import json
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy.dialects.postgresql import insert

from app.config import Settings
from app.database import database
from app.models import Profile, Unit, VocabularyEntry

DATA = Path(__file__).resolve().parents[2] / "data"


def seed_id(name):
    return uuid5(NAMESPACE_URL, "italian-notebook/seed/" + name)


def seed():
    engine, sessions = database(Settings().database_url)
    initial = json.loads((DATA / "initial_setup.json").read_text(encoding="utf-8"))
    with sessions.begin() as db:
        for name in initial["profiles"]:
            db.execute(
                insert(Profile)
                .values(
                    id=seed_id("profile/" + name),
                    display_name=name,
                    preferred_direction="greek_to_italian",
                )
                .on_conflict_do_nothing()
            )
        for unit in initial["units"]:
            db.execute(
                insert(Unit)
                .values(
                    id=seed_id("unit/" + unit["code"]),
                    **unit,
                )
                .on_conflict_do_nothing()
            )
        with (DATA / "sample_vocabulary.csv").open(
            encoding="utf-8", newline=""
        ) as source:
            for row in csv.DictReader(source):
                values = {
                    key: value or None
                    for key, value in row.items()
                    if key not in {"unit", "type"}
                }
                db.execute(
                    insert(VocabularyEntry)
                    .values(
                        id=seed_id("entry/" + row["italian"] + "/" + row["greek"]),
                        unit_id=seed_id("unit/" + row["unit"]),
                        word_type=row["type"],
                        **values,
                    )
                    .on_conflict_do_nothing()
                )
    engine.dispose()


if __name__ == "__main__":
    seed()
