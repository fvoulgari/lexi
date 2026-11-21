"""Prevent the release from hiding any unmigrated legacy cards or units."""

import os

from sqlalchemy import create_engine, text


def check_legacy_retired(url: str) -> None:
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            for table in ("units", "vocabulary_entries"):
                remaining = connection.scalar(
                    text(f"SELECT count(*) FROM {table} WHERE visibility = 'legacy'")
                )
                if remaining:
                    raise RuntimeError(
                        "Unmigrated legacy content remains; review the migration first."
                    )
    finally:
        engine.dispose()


if __name__ == "__main__":
    check_legacy_retired(os.environ["DATABASE_URL"])
