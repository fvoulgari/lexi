"""Explicit, transactional legacy Unit-to-Collection migration.

Run only against the deliberately selected database. Dry run is the default;
--apply commits and requires a separately approved cutover. Input is an operator
verified JSON file, never names inferred from account identities.
"""

import argparse
import json
import os
from uuid import UUID, uuid5

from sqlalchemy import create_engine, text

from app.preservation_manifest import compare, encode, snapshot

NAMESPACE = UUID("ea731c09-1db3-42cc-b256-731a298c36fb")


def rows(db, sql, **values):
    return db.execute(text(sql), values).mappings().all()


def migrate(db, mapping):
    """Apply within caller transaction; reject ambiguous or conflicting data."""
    if len(mapping) != 4 or {m["code"] for m in mapping} != {"00", "30", "50", "610"}:
        raise ValueError("Mapping must identify exactly the four approved Units")
    by_code = {m["code"]: m for m in mapping}
    if len({by_code[c]["account_id"] for c in ("30", "50", "610")}) != 1:
        raise ValueError("Foods, Days and Lorenzo must have the same owner")
    if by_code["00"]["account_id"] == by_code["30"]["account_id"]:
        raise ValueError("Benvenuti and Lorenzo groups require distinct owners")
    if len({m["unit_id"] for m in mapping}) != 4:
        raise ValueError("Unit IDs must be distinct")
    db.execute(
        text(
            "LOCK TABLE accounts, profiles, units, vocabulary_entries, tags, "
            "entry_tags, collections, collection_entries IN SHARE ROW EXCLUSIVE MODE"
        )
    )
    result = []
    for m in mapping:
        unit_id, owner_id, profile_id = (
            UUID(m[k]) for k in ("unit_id", "account_id", "profile_id")
        )
        matches = rows(
            db,
            "SELECT id FROM accounts WHERE id=:account AND profile_id=:profile",
            account=owner_id,
            profile=profile_id,
        )
        if len(matches) != 1:
            raise ValueError(f"Account/profile association changed for {m['code']}")
        units = rows(
            db,
            "SELECT * FROM units WHERE id=:unit AND code=:code AND title=:title",
            unit=unit_id,
            code=m["code"],
            title=m["unit_title"],
        )
        if len(units) != 1:
            raise ValueError(f"Unit identity changed for {m['code']}")
        unit = units[0]
        if not (
            (unit["owner_account_id"] is None and unit["visibility"] == "legacy")
            or (
                unit["owner_account_id"] == owner_id and unit["visibility"] == "private"
            )
        ):
            raise ValueError(f"Unit ownership conflict for {m['code']}")
        cards = rows(
            db,
            "SELECT id,owner_account_id,visibility,source_language,target_language "
            "FROM vocabulary_entries WHERE unit_id=:unit ORDER BY id",
            unit=unit_id,
        )
        if len(cards) != m["expected_cards"]:
            raise ValueError(f"Card count changed for {m['code']}; re-audit")
        if {str(c["id"]) for c in cards} != set(m["expected_card_ids"]):
            raise ValueError(f"Card IDs changed for {m['code']}; re-audit")
        for card in cards:
            if not (
                (card["owner_account_id"] is None and card["visibility"] == "legacy")
                or (
                    card["owner_account_id"] == owner_id
                    and card["visibility"] == "private"
                )
            ):
                raise ValueError(f"Card ownership conflict: {card['id']}")
            if {card["source_language"], card["target_language"]} != {"el", "it"}:
                raise ValueError(f"Card language conflict: {card['id']}")
        tags = rows(
            db,
            """SELECT DISTINCT t.id,t.owner_account_id,t.visibility FROM tags t
            JOIN entry_tags et ON et.tag_id=t.id
            JOIN vocabulary_entries v ON v.id=et.entry_id
            WHERE v.unit_id=:unit ORDER BY t.id""",
            unit=unit_id,
        )
        for tag in tags:
            other = rows(
                db,
                """SELECT v.id FROM entry_tags et
                JOIN vocabulary_entries v ON v.id=et.entry_id
                WHERE et.tag_id=:tag AND v.unit_id IS DISTINCT FROM :unit LIMIT 1""",
                tag=tag["id"],
                unit=unit_id,
            )
            if other:
                raise ValueError(
                    f"Tag {tag['id']} is shared with another Unit; "
                    "review without transferring it"
                )
            if not (
                (tag["owner_account_id"] is None and tag["visibility"] == "legacy")
                or (
                    tag["owner_account_id"] == owner_id
                    and tag["visibility"] == "private"
                )
            ):
                raise ValueError(f"Tag ownership conflict: {tag['id']}")
        candidates = rows(
            db,
            "SELECT id,owner_account_id,visibility,source_language,target_language "
            "FROM collections WHERE title=:title ORDER BY id",
            title=m["collection_title"],
        )
        if len(candidates) > 1 or (
            candidates and candidates[0]["owner_account_id"] != owner_id
        ):
            raise ValueError(f"Ambiguous or foreign Collection for {m['code']}")
        collection_id = (
            candidates[0]["id"] if candidates else uuid5(NAMESPACE, str(unit_id))
        )
        if candidates and (
            candidates[0]["visibility"] != "private"
            or (candidates[0]["source_language"], candidates[0]["target_language"])
            != ("el", "it")
        ):
            raise ValueError(f"Existing Collection requires review for {m['code']}")
        if not candidates:
            db.execute(
                text(
                    "INSERT INTO collections "
                    "(id,owner_account_id,title,source_language,"
                    "target_language,visibility) "
                    "VALUES (:id,:owner,:title,'el','it','private')"
                ),
                {
                    "id": collection_id,
                    "owner": owner_id,
                    "title": m["collection_title"],
                },
            )
        existing = rows(
            db,
            "SELECT entry_id FROM collection_entries WHERE collection_id=:id",
            id=collection_id,
        )
        existing_ids = {x["entry_id"] for x in existing}
        position = db.execute(
            text(
                "SELECT coalesce(max(position),-1)+1 "
                "FROM collection_entries WHERE collection_id=:id"
            ),
            {"id": collection_id},
        ).scalar_one()
        for card in cards:
            if card["id"] not in existing_ids:
                db.execute(
                    text(
                        "INSERT INTO collection_entries "
                        "(collection_id,entry_id,position,publication_confirmed) "
                        "VALUES (:collection,:entry,:position,false)"
                    ),
                    {
                        "collection": collection_id,
                        "entry": card["id"],
                        "position": position,
                    },
                )
                position += 1
        for table, condition, value in (
            ("units", "id", unit_id),
            ("vocabulary_entries", "unit_id", unit_id),
        ):
            db.execute(
                text(
                    f"UPDATE {table} SET owner_account_id=:owner,visibility='private' "
                    f"WHERE {condition}=:value AND owner_account_id IS NULL "
                    "AND visibility='legacy'"
                ),
                {"owner": owner_id, "value": value},
            )
        for tag in tags:
            db.execute(
                text(
                    "UPDATE tags SET owner_account_id=:owner,visibility='private' "
                    "WHERE id=:id AND owner_account_id IS NULL "
                    "AND visibility='legacy'"
                ),
                {"owner": owner_id, "id": tag["id"]},
            )
        result.append(
            {
                "code": m["code"],
                "collection_id": str(collection_id),
                "created": not bool(candidates),
                "cards": len(cards),
                "new_memberships": len({c["id"] for c in cards} - existing_ids),
                "tags": len(tags),
                "visibility": "private",
            }
        )
    for table in ("units", "vocabulary_entries"):
        remaining = db.execute(
            text(f"SELECT count(*) FROM {table} WHERE visibility = 'legacy'")
        ).scalar_one()
        if remaining:
            raise ValueError(
                f"{remaining} legacy {table} remain; review before retirement"
            )
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mapping", help="protected JSON file containing verified IDs")
    parser.add_argument("--report", required=True, help="new protected report file")
    parser.add_argument(
        "--apply", action="store_true", help="commit after separate cutover approval"
    )
    args = parser.parse_args()
    with open(args.mapping) as source:
        mapping = json.load(source)
    engine = create_engine(os.environ["DATABASE_URL"], isolation_level="SERIALIZABLE")
    with engine.connect() as db:
        tx = db.begin()
        try:
            before = snapshot(db)
            result = migrate(db, mapping)
            after = snapshot(db)
            changes = compare(before, after)
            for change in changes:
                table, kind = change["table"], change["change"]
                allowed = (
                    table in {"units", "vocabulary_entries", "tags"}
                    and kind == "columns_changed"
                    and set(change["columns"]) <= {"owner_account_id", "visibility"}
                ) or (
                    table in {"collections", "collection_entries"}
                    and kind == "row_added"
                )
                if not allowed:
                    raise ValueError(f"Unexpected data difference: {table} {kind}")
            report = {
                "groups": result,
                "changes": changes,
                "before": before,
                "after": after,
            }
            fd = os.open(args.report, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w") as output:
                output.write(encode(report) + "\n")
            if args.apply:
                tx.commit()
            else:
                tx.rollback()
            print(json.dumps({"committed": args.apply, "groups": result}, indent=2))
        except Exception:
            tx.rollback()
            raise
    engine.dispose()


if __name__ == "__main__":
    main()
