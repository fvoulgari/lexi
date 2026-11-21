"""Prevent the release from hiding unmigrated legacy cards."""

import os

from sqlalchemy import create_engine, text


def check_legacy_retired(url: str) -> None:
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            remaining = connection.scalar(
                text(
                    "SELECT count(*) FROM vocabulary_entries "
                    "WHERE visibility = 'legacy'"
                )
            )
            if remaining:
                raise RuntimeError(
                    "Unmigrated legacy content remains; review the migration first."
                )
    finally:
        engine.dispose()


if __name__ == "__main__":
    check_legacy_retired(os.environ["DATABASE_URL"])
