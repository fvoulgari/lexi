#!/usr/bin/env python3
"""Deterministic row manifests for disposable migration rehearsals.

The manifest records row counts and ordered-row digests for the application
tables and columns present in a restored baseline. When a baseline manifest is
supplied to ``manifest``, only those tables and columns are compared after
migration, so additive columns and new registry tables are reported separately
instead of being mistaken for rewritten legacy data.
"""

import argparse
import hashlib
import json
import sys

from psycopg import connect
from psycopg.rows import dict_row
from psycopg.sql import SQL, Identifier

EXCLUDED_TABLES = frozenset({"alembic_version"})


def _digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _connect(url):
    # Accept the SQLAlchemy-style URL used by the backend and Alembic.
    if url.startswith("postgresql+psycopg://"):
        url = url.replace("postgresql+psycopg://", "postgresql://", 1)
    return connect(url, row_factory=dict_row)


def _tables(db):
    rows = db.execute(
        """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name
        """
    ).fetchall()
    return [row["table_name"] for row in rows if row["table_name"] not in EXCLUDED_TABLES]


def _columns(db, table):
    rows = db.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        ORDER BY ordinal_position
        """,
        (table,),
    ).fetchall()
    return [row["column_name"] for row in rows]


def _primary_key(db, table):
    rows = db.execute(
        """
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_catalog = kcu.constraint_catalog
         AND tc.constraint_schema = kcu.constraint_schema
         AND tc.constraint_name = kcu.constraint_name
        WHERE tc.table_schema = 'public'
          AND tc.table_name = %s
          AND tc.constraint_type = 'PRIMARY KEY'
        ORDER BY kcu.ordinal_position
        """,
        (table,),
    ).fetchall()
    return [row["column_name"] for row in rows]


def _revision(db):
    if "alembic_version" not in _tables_with_version(db):
        return None
    row = db.execute("SELECT version_num FROM alembic_version").fetchone()
    return row["version_num"] if row else None


def _tables_with_version(db):
    return {
        row["table_name"]
        for row in db.execute(
            """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            """
        ).fetchall()
    }


def manifest(url, baseline=None):
    with _connect(url) as db:
        if baseline is None:
            selection = {table: _columns(db, table) for table in _tables(db)}
        else:
            with open(baseline, encoding="utf-8") as handle:
                previous = json.load(handle)
            selection = {}
            for table, details in previous["tables"].items():
                available = set(_columns(db, table))
                missing = [column for column in details["columns"] if column not in available]
                if missing:
                    raise SystemExit(f"{table}: baseline columns missing: {', '.join(missing)}")
                selection[table] = details["columns"]

        tables = {}
        for table, columns in selection.items():
            order = [column for column in _primary_key(db, table) if column in columns]
            if not order:
                order = columns
            statement = SQL("SELECT {fields} FROM {table} ORDER BY {order}").format(
                fields=SQL(", ").join(Identifier(column) for column in columns),
                table=Identifier(table),
                order=SQL(", ").join(Identifier(column) for column in order),
            )
            rows = db.execute(statement).fetchall()
            encoded = [
                json.dumps(row, default=str, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
                for row in rows
            ]
            tables[table] = {
                "rows": len(rows),
                "columns": columns,
                "digest": _digest("\n".join(encoded)),
            }
        return {"revision": _revision(db), "tables": tables}


def compare(before_path, after_path):
    with open(before_path, encoding="utf-8") as handle:
        before = json.load(handle)
    with open(after_path, encoding="utf-8") as handle:
        after = json.load(handle)

    differences = []
    for table, details in before["tables"].items():
        current = after["tables"].get(table)
        if current is None:
            differences.append(f"{table}: table missing after migration")
            continue
        if details["rows"] != current["rows"] or details["digest"] != current["digest"]:
            differences.append(
                f"{table}: rows {details['rows']} -> {current['rows']}, "
                f"digest {details['digest'][:12]} -> {current['digest'][:12]}"
            )

    if differences:
        print("legacy row manifest: FAIL")
        for difference in differences:
            print(f"  {difference}")
        return 1

    rows = sum(details["rows"] for details in before["tables"].values())
    print(
        f"legacy row manifest: PASS ({len(before['tables'])} tables, {rows} rows unchanged)"
    )
    print(f"revision: {before.get('revision')} -> {after.get('revision')}")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    make = sub.add_parser("manifest", help="write a manifest to stdout")
    make.add_argument("url")
    make.add_argument("--baseline", help="use the tables/columns from this manifest")

    check = sub.add_parser("compare", help="compare two legacy manifests")
    check.add_argument("before")
    check.add_argument("after")

    args = parser.parse_args()
    if args.command == "manifest":
        print(json.dumps(manifest(args.url, args.baseline), indent=2, sort_keys=True))
        return 0
    return compare(args.before, args.after)


if __name__ == "__main__":
    sys.exit(main())
