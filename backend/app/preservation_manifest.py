"""Private, row-level comparison manifests for a frozen migration database.

Manifests contain primary keys and column hashes, so protect them as learner data.
They are evidence, not a backup; restore the actual PostgreSQL archive separately.
"""

import argparse
import hashlib
import json
import os
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from uuid import UUID

from sqlalchemy import MetaData, create_engine, inspect, select, text


def canonical(value):
    if isinstance(value, (datetime, date, UUID, Decimal)):
        return str(value)
    if isinstance(value, bytes):
        return {"bytes_hex": value.hex()}
    raise TypeError(f"Unsupported database value: {type(value).__name__}")


def encode(value):
    return json.dumps(
        value,
        default=canonical,
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
        allow_nan=False,
    )


def snapshot(connection):
    """Capture every public table, key and column; fail rather than omit a table."""
    inspector = inspect(connection)
    metadata = MetaData()
    tables = {}
    for name in sorted(inspector.get_table_names(schema="public")):
        metadata.reflect(connection, schema="public", only=[name])
        table = metadata.tables[f"public.{name}"]
        keys = [column.name for column in table.primary_key.columns]
        if not keys:
            raise ValueError(f"Table {name} has no primary key; review it explicitly")
        rows = {}
        for row in connection.execute(select(table)).mappings():
            key = encode([row[column] for column in keys])
            if key in rows:
                raise ValueError(f"Duplicate primary key in {name}")
            rows[key] = {
                column.name: hashlib.sha256(
                    encode(row[column.name]).encode()
                ).hexdigest()
                for column in table.columns
            }
        tables[name] = {
            "primary_key": keys,
            "columns": sorted(table.columns.keys()),
            "rows": rows,
        }
    return {"format": 1, "tables": tables}


def compare(before, after):
    """Report exact key and column differences, including schema differences."""
    changes = []
    first, second = before["tables"], after["tables"]
    for name in sorted(first.keys() | second.keys()):
        if name not in first or name not in second:
            changes.append(
                {
                    "table": name,
                    "change": "table_added" if name not in first else "table_removed",
                }
            )
            continue
        a, b = first[name], second[name]
        if a["primary_key"] != b["primary_key"] or a["columns"] != b["columns"]:
            changes.append({"table": name, "change": "schema_changed"})
        for key in sorted(a["rows"].keys() | b["rows"].keys()):
            if key not in a["rows"] or key not in b["rows"]:
                changes.append(
                    {
                        "table": name,
                        "key": key,
                        "change": "row_added"
                        if key not in a["rows"]
                        else "row_removed",
                    }
                )
                continue
            columns = [
                c
                for c in sorted(a["rows"][key].keys() | b["rows"][key].keys())
                if a["rows"][key].get(c) != b["rows"][key].get(c)
            ]
            if columns:
                changes.append(
                    {
                        "table": name,
                        "key": key,
                        "change": "columns_changed",
                        "columns": columns,
                    }
                )
    return changes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    capture = sub.add_parser("capture")
    capture.add_argument("output", type=Path)
    diff = sub.add_parser("compare")
    diff.add_argument("before", type=Path)
    diff.add_argument("after", type=Path)
    args = parser.parse_args()
    if args.command == "compare":
        changes = compare(
            json.loads(args.before.read_text()), json.loads(args.after.read_text())
        )
        print(encode(changes))
        return int(bool(changes))
    url = os.environ["DATABASE_URL"]
    engine = create_engine(url, isolation_level="REPEATABLE READ")
    if engine.dialect.name != "postgresql":
        raise ValueError("Capture requires PostgreSQL")
    with engine.connect() as connection, connection.begin():
        connection.execute(text("SET TRANSACTION READ ONLY"))
        manifest = snapshot(connection)
    # Exclusive creation and restrictive permissions avoid overwriting evidence.
    fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as output:
        output.write(encode(manifest) + "\n")
    engine.dispose()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
