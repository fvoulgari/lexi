"""CSV preview is read-only; confirmation reparses and serializes library writes."""

import csv
import io
import json
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import ValidationError
from sqlalchemy import func, select, text

from app.access import current_account, require_write
from app.csv_format import FORMAT_VERSION, restore_text
from app.duplicates import normalized_pair
from app.grammar import clean_grammar
from app.models import Collection, CollectionEntry, Tag, VocabularyEntry
from app.schemas import TagCreate, UnitCreate, VocabularyCreate

MAX_BYTES = 1_048_576
MAX_ROWS = 2000
ALIASES = {
    "type": "word_type",
    "unit": "unit_code",
    "plural": "italian_plural",
    "example": "italian_example",
    "gender": "italian_gender",
}
COLUMNS = {
    "italian",
    "greek",
    "word_type",
    "gender",
    "italian_gender",
    "greek_gender",
    "italian_feminine_singular",
    "italian_masculine_plural",
    "italian_feminine_plural",
    "italian_plural",
    "greek_plural",
    "italian_example",
    "greek_example",
    "notes",
    "italian_masculine_singular",
    "greek_masculine_singular",
    "greek_masculine_plural",
    "greek_feminine_singular",
    "greek_feminine_plural",
    "greek_neuter_singular",
    "greek_neuter_plural",
    "italian_adjective_gender",
    "greek_adjective_gender",
    "greek_pronunciation",
    "pronunciation",
    "unit_code",
    "unit_title",
    "unit_sort_order",
    "tags",
    "csv_format",
}


def invalid(message):
    raise HTTPException(422, {"code": "invalid_csv", "message": message})


async def read_csv(request):
    content = bytearray()
    async for chunk in request.stream():
        content.extend(chunk)
        if len(content) > MAX_BYTES:
            invalid("CSV exceeds the 1 MiB limit.")
    try:
        reader = csv.DictReader(io.StringIO(content.decode("utf-8-sig")), strict=True)
        fields = reader.fieldnames
        if not fields or len(fields) != len(set(fields)):
            invalid("CSV needs unique column headers.")
        if set(fields) - (COLUMNS | ALIASES.keys()):
            invalid(
                "Unsupported columns: "
                + ", ".join(sorted(set(fields) - (COLUMNS | ALIASES.keys())))
            )
        if not {"italian", "greek", "word_type"} <= {
            ALIASES.get(field, field) for field in fields
        }:
            invalid("Required columns: italian, greek, word_type.")
        rows = []
        for row in reader:
            if len(rows) >= MAX_ROWS:
                invalid("CSV exceeds the 2000 row limit.")
            rows.append(row)
        if not rows:
            invalid("CSV has no vocabulary rows.")
        return rows
    except UnicodeDecodeError, csv.Error:
        invalid("Upload a valid UTF-8 CSV file.")


def evaluate(db, rows, confirm, destination, collection):
    require_write(destination)
    tags = {
        t.name: t
        for t in db.scalars(
            select(Tag).where(
                Tag.owner_account_id == destination.owner_account_id,
                Tag.visibility == destination.visibility,
            )
        )
    }
    # Keep a simulated library during preview too, so later rows see earlier changes.
    pairs = {}
    for existing in db.scalars(
        select(VocabularyEntry)
        .where(
            VocabularyEntry.owner_account_id == destination.owner_account_id,
            VocabularyEntry.visibility == destination.visibility,
            VocabularyEntry.source_language == "it",
            VocabularyEntry.target_language == "el",
        )
        .order_by(VocabularyEntry.id)
    ):
        pair = normalized_pair(existing.italian, existing.greek)
        pairs.setdefault(pair, []).append(
            {
                "entry": existing,
                "values": {
                    field: getattr(existing, field)
                    for field in VocabularyCreate.model_fields
                    if field not in {"unit_id", "tag_ids", "visibility"}
                },
                "tags": {tag.name for tag in existing.tags},
            }
        )
    proposed_tags, results = set(), []
    mapped_query = (
        select(Collection)
        .where(
            Collection.owner_account_id == destination.owner_account_id,
            Collection.source_unit_code.is_not(None),
        )
        .order_by(Collection.id)
    )
    if confirm:
        mapped_query = mapped_query.with_for_update()
    mapped = list(db.scalars(mapped_query))
    member_cache, positions = {}, {}

    def membership(target):
        if target.id not in member_cache:
            member_cache[target.id] = set(
                db.scalars(
                    select(CollectionEntry.entry_id).where(
                        CollectionEntry.collection_id == target.id
                    )
                )
            )
            positions[target.id] = 1 + db.scalar(
                select(func.coalesce(func.max(CollectionEntry.position), -1)).where(
                    CollectionEntry.collection_id == target.id
                )
            )
        return member_cache[target.id]

    counts = dict(imported=0, updated=0, valid=0, skipped=0, duplicate=0, error=0)
    for number, original in enumerate(rows, 2):
        row = {
            key: value.strip() if isinstance(value, str) else value
            for key, value in original.items()
        }
        errors = []
        entry = None
        conflict = False
        names = []
        changed_fields = []
        target = collection
        try:
            if None in row or any(value is None for value in row.values()):
                raise ValueError("Column count does not match the header.")
            version = row.pop("csv_format", "")
            if version and version != FORMAT_VERSION:
                raise ValueError("Unsupported csv_format version.")
            if version:
                row = {key: restore_text(value) for key, value in row.items()}
            for alias, field in ALIASES.items():
                alias_supplied = alias in row
                value = row.pop(alias, "")
                if value and row.get(field) and value != row[field]:
                    raise ValueError(f"{alias} conflicts with {field}.")
                if value or (alias_supplied and field not in row):
                    row[field] = value
            code = row.pop("unit_code", "")
            title = row.pop("unit_title", "")
            order = row.pop("unit_sort_order", "")
            tag_text = row.pop("tags", "")
            if version:
                decoded_names = json.loads(tag_text or "[]")
                if not isinstance(decoded_names, list) or any(
                    not isinstance(name, str) for name in decoded_names
                ):
                    raise ValueError("tags must be a JSON array of names.")
                names = decoded_names
            else:
                names = tag_text.split("|")
            names = list(
                dict.fromkeys(
                    TagCreate(name=name).name for name in names if name.strip()
                )
            )
            if not code and (title or order):
                raise ValueError("unit_title/unit_sort_order require unit_code.")
            if code:
                UnitCreate(
                    code=code,
                    title=title or destination.title,
                    sort_order=int(order) if order else 0,
                )
            candidates = [c for c in mapped if code and c.source_unit_code == code]
            if title:
                candidates = [c for c in candidates if c.source_unit_title == title]
            if order:
                candidates = [
                    c for c in candidates if c.source_unit_sort_order == int(order)
                ]
            if len(candidates) > 1:
                raise ValueError("CSV Unit metadata matches multiple Collections.")
            if candidates:
                target = candidates[0]
                if target.visibility != "private":
                    raise ValueError("Import into a private Collection first.")
                if {target.source_language, target.target_language} != {"it", "el"}:
                    raise ValueError("CSV import requires an Italian–Greek Collection.")
            if (
                target is not None
                and target.source_unit_code
                and (
                    (code and code != target.source_unit_code)
                    or (title and title != target.source_unit_title)
                    or (order and int(order) != target.source_unit_sort_order)
                )
            ):
                raise ValueError(
                    "CSV Unit metadata does not match the selected Collection."
                )
            matches = pairs.get(
                normalized_pair(row.get("italian", ""), row.get("greek", "")), []
            )
            # A CSV update may omit gender if the existing card already has it.
            # Missing legacy genders must be corrected explicitly in this row.
            previous = matches[0]["values"] if len(matches) == 1 else {}
            entry = VocabularyCreate(
                **{**previous, **{k: v or None for k, v in row.items()}},
            )
        except ValidationError as exc:
            errors = [
                ".".join(map(str, e["loc"])) + ": " + e["msg"] for e in exc.errors()
            ]
        except (ValueError, TypeError) as exc:
            errors = [str(exc)]
        publication_forbidden = (
            not errors
            and destination.visibility == "published"
            and current_account().role != "admin"
            and (
                not pairs.get(normalized_pair(entry.italian, entry.greek))
                or any(name not in tags for name in names)
            )
        )
        if publication_forbidden:
            errors = [
                "forbidden_new_publication: Ask an administrator to publish "
                "new shared cards or tags; import drafts into the legacy library."
            ]
        status = "error" if errors else "valid"
        if not errors:
            pair = normalized_pair(entry.italian, entry.greek)
            matches = pairs.get(pair, [])
            values = entry.model_dump(exclude={"unit_id", "tag_ids", "visibility"})
            # An omitted column is not an instruction to erase stored content.
            supplied = clean_grammar(
                {key: value for key, value in values.items() if key in row},
                entry.word_type,
            )
            if len(matches) > 1:
                status = "error"
                errors = [
                    "Multiple cards match this Italian–Greek pair. "
                    "Edit them individually."
                ]
            else:
                current = matches[0] if matches else None
                members = membership(target)
                marker = (
                    current["entry"].id
                    if current and current["entry"]
                    else ("new", pair)
                )
                if current:
                    changed_fields = [
                        key
                        for key, value in supplied.items()
                        if current["values"][key] != value
                    ]
                    if marker not in members:
                        changed_fields.append("collection_id")
                    if "tags" in original and current["tags"] != set(names):
                        changed_fields.append("tags")
                    status = "updated" if changed_fields else "duplicate"
                if status != "duplicate":
                    if not current:
                        current = {
                            "entry": None,
                            "values": values,
                            "tags": set(names),
                        }
                        pairs[pair] = [current]
                    current["values"].update(supplied)
                    if "tags" in original:
                        current["tags"] = set(names)
                    proposed_tags.update(name for name in names if name not in tags)
                    if confirm:
                        stored = current["entry"]
                        if stored is None:
                            stored = VocabularyEntry(
                                **current["values"],
                                owner_account_id=destination.owner_account_id,
                                visibility=destination.visibility,
                                source_collection_id=target.id
                                if target.source_unit_code
                                else None,
                            )
                            db.add(stored)
                            current["entry"] = stored
                            counts["imported"] += 1
                        else:
                            for key in changed_fields:
                                if key not in {"unit_id", "tags", "collection_id"}:
                                    setattr(stored, key, supplied[key])
                        if "tags" in original:
                            assigned_tags = []
                            for name in names:
                                if name not in tags:
                                    tags[name] = Tag(
                                        name=name,
                                        owner_account_id=destination.owner_account_id,
                                        visibility=destination.visibility,
                                    )
                                    db.add(tags[name])
                                assigned_tags.append(tags[name])
                            stored.tags = assigned_tags
                        db.flush()
                        if marker not in members:
                            db.add(
                                CollectionEntry(
                                    collection_id=target.id,
                                    entry_id=stored.id,
                                    position=positions[target.id],
                                )
                            )
                            positions[target.id] += 1
                        members.add(stored.id)
                    else:
                        members.add(marker)
        counts[status] += 1
        if status == "updated":
            counts["valid"] += 1
        if status in {"error", "duplicate"}:
            counts["skipped"] += 1
        results.append(
            {
                "unit_conflict": conflict,
                "collection_name": target.title if target else None,
                "row": number,
                "italian": original.get("italian", ""),
                "greek": original.get("greek", ""),
                "status": status,
                "changed_fields": changed_fields,
                "errors": errors,
                "error_code": "forbidden_new_publication"
                if publication_forbidden
                else None,
                "entry": entry.model_dump(exclude={"unit_id", "tag_ids", "visibility"})
                if entry
                else None,
                "unit": None,
                "tags": names,
            }
        )
    return {
        "destination_collection": {"id": str(collection.id), "name": collection.title},
        "destination_unit": None,
        "unit_conflicts": sum(row["unit_conflict"] for row in results),
        "counts": counts,
        "rows": results,
        "proposed_units": [],
        "proposed_tags": sorted(proposed_tags),
    }


def import_router(sessions, gate):
    router = APIRouter(
        prefix="/api/imports",
        dependencies=[
            Depends(gate.require),
        ],
    )

    def destination_for_collection(db, collection_id, confirm):
        collection = db.scalar(
            select(Collection).where(Collection.id == collection_id).with_for_update()
            if confirm
            else select(Collection).where(Collection.id == collection_id)
        )
        if collection is None or collection.owner_account_id != current_account().id:
            raise HTTPException(403, "Choose a collection you own.")
        if collection.visibility != "private":
            raise HTTPException(
                409, "Import into a private collection before publishing it."
            )
        if {collection.source_language, collection.target_language} != {"it", "el"}:
            raise HTTPException(422, "CSV import requires an Italian–Greek collection.")
        return collection, collection

    def resolve_destination(db, unit_id, collection_id, confirm):
        if (unit_id is None) == (collection_id is None):
            raise HTTPException(422, "Choose one destination.")
        if unit_id is not None:
            # Old import clients may still send the original Unit ID. The
            # migration records it on the existing Collection, so it is never
            # necessary to recreate or query a Unit.
            matches = list(
                db.scalars(
                    select(Collection.id).where(
                        Collection.source_unit_id == unit_id,
                        Collection.owner_account_id == current_account().id,
                    )
                )
            )
            if len(matches) > 1:
                raise HTTPException(409, "Legacy collection mapping is ambiguous.")
            collection_id = matches[0] if matches else None
            if collection_id is None:
                raise HTTPException(422, "Choose a collection you own.")
        return destination_for_collection(db, collection_id, confirm)

    @router.get("/example")
    def example():
        sample = json.loads(Path(__file__).with_name("csv_example.json").read_text())
        output = io.StringIO(newline="")
        writer = csv.writer(output, lineterminator="\n")
        writer.writerow(sample["headers"])
        writer.writerows(sample["rows"])
        return Response(
            output.getvalue(),
            media_type="text/csv; charset=utf-8",
            headers={
                "Content-Disposition": 'attachment; filename="vocabulary-example.csv"'
            },
        )

    @router.post("/preview", dependencies=[Depends(gate.check_csrf)])
    async def preview(
        request: Request, unit_id: UUID | None = None, collection_id: UUID | None = None
    ):
        rows = await read_csv(request)
        with sessions() as db:
            collection, destination = resolve_destination(
                db, unit_id, collection_id, False
            )
            return evaluate(db, rows, False, destination, collection)

    @router.post("/confirm", dependencies=[Depends(gate.check_csrf)])
    async def confirm(
        request: Request, unit_id: UUID | None = None, collection_id: UUID | None = None
    ):
        rows = await read_csv(request)
        with sessions.begin() as db:
            # Also blocks normal vocabulary/unit/tag writes until commit.
            db.execute(
                text(
                    "LOCK TABLE vocabulary_entries, tags, "
                    "collections, collection_entries "
                    "IN SHARE ROW EXCLUSIVE MODE"
                )
            )
            collection, destination = resolve_destination(
                db, unit_id, collection_id, True
            )
            return evaluate(db, rows, True, destination, collection)

    return router
