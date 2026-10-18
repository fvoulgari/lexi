"""CSV preview is read-only; confirmation reparses and serializes library writes."""

import csv
import io
import json
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import ValidationError
from sqlalchemy import select, text

from app.csv_format import FORMAT_VERSION, restore_text
from app.duplicates import normalized_pair
from app.models import Tag, Unit, VocabularyEntry
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
    "italian_plural",
    "greek_plural",
    "italian_example",
    "greek_example",
    "notes",
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


def evaluate(db, rows, confirm, destination):
    tags = {t.name: t for t in db.scalars(select(Tag))}
    # Keep a simulated library during preview too, so later rows see earlier changes.
    pairs = {}
    for existing in db.scalars(select(VocabularyEntry).order_by(VocabularyEntry.id)):
        pair = normalized_pair(existing.italian, existing.greek)
        pairs.setdefault(pair, []).append(
            {
                "entry": existing,
                "values": {
                    field: getattr(existing, field)
                    for field in VocabularyCreate.model_fields
                    if field not in {"unit_id", "tag_ids"}
                },
                "unit_id": existing.unit_id,
                "tags": {tag.name for tag in existing.tags},
            }
        )
    proposed_tags, results = set(), []
    counts = dict(imported=0, updated=0, valid=0, skipped=0, duplicate=0, error=0)
    for number, original in enumerate(rows, 2):
        row = {
            key: value.strip() if isinstance(value, str) else value
            for key, value in original.items()
        }
        errors = []
        entry = unit_spec = None
        conflict = False
        names = []
        changed_fields = []
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
            conflict = bool(
                (code and code != destination.code)
                or (title and title != destination.title)
                or (order and int(order) != destination.sort_order)
            )
            unit_spec = UnitCreate(
                code=destination.code,
                title=destination.title,
                sort_order=destination.sort_order,
            )
            entry = VocabularyCreate(
                unit_id=destination.id, **{k: v or None for k, v in row.items()}
            )
        except ValidationError as exc:
            errors = [
                ".".join(map(str, e["loc"])) + ": " + e["msg"] for e in exc.errors()
            ]
        except (ValueError, TypeError) as exc:
            errors = [str(exc)]
        status = "error" if errors else "valid"
        if not errors:
            pair = normalized_pair(entry.italian, entry.greek)
            matches = pairs.get(pair, [])
            values = entry.model_dump(exclude={"unit_id", "tag_ids"})
            # An omitted column is not an instruction to erase stored content.
            supplied = {key: value for key, value in values.items() if key in row}
            if len(matches) > 1:
                status = "error"
                errors = [
                    "Multiple cards match this Italian–Greek pair. "
                    "Edit them individually."
                ]
            else:
                current = matches[0] if matches else None
                if current:
                    changed_fields = [
                        key
                        for key, value in supplied.items()
                        if current["values"][key] != value
                    ]
                    if current["unit_id"] != destination.id:
                        changed_fields.append("unit_id")
                    if "tags" in original and current["tags"] != set(names):
                        changed_fields.append("tags")
                    status = "updated" if changed_fields else "duplicate"
                if status != "duplicate":
                    if not current:
                        current = {
                            "entry": None,
                            "values": values,
                            "unit_id": destination.id,
                            "tags": set(names),
                        }
                        pairs[pair] = [current]
                    current["values"].update(supplied)
                    current["unit_id"] = destination.id
                    if "tags" in original:
                        current["tags"] = set(names)
                    proposed_tags.update(name for name in names if name not in tags)
                    if confirm:
                        stored = current["entry"]
                        if stored is None:
                            stored = VocabularyEntry(
                                **current["values"], unit=destination
                            )
                            db.add(stored)
                            current["entry"] = stored
                            counts["imported"] += 1
                        else:
                            for key in changed_fields:
                                if key not in {"unit_id", "tags"}:
                                    setattr(stored, key, supplied[key])
                            if "unit_id" in changed_fields:
                                stored.unit = destination
                        if "tags" in original:
                            assigned_tags = []
                            for name in names:
                                if name not in tags:
                                    tags[name] = Tag(name=name)
                                    db.add(tags[name])
                                assigned_tags.append(tags[name])
                            stored.tags = assigned_tags
        counts[status] += 1
        if status == "updated":
            counts["valid"] += 1
        if status in {"error", "duplicate"}:
            counts["skipped"] += 1
        results.append(
            {
                "unit_conflict": conflict,
                "row": number,
                "italian": original.get("italian", ""),
                "greek": original.get("greek", ""),
                "status": status,
                "changed_fields": changed_fields,
                "errors": errors,
                "entry": entry.model_dump(exclude={"unit_id", "tag_ids"})
                if entry
                else None,
                "unit": unit_spec.model_dump() if unit_spec else None,
                "tags": names,
            }
        )
    return {
        "destination_unit": {
            "id": str(destination.id),
            "code": destination.code,
            "title": destination.title,
        },
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
    async def preview(request: Request, unit_id: UUID):
        rows = await read_csv(request)
        with sessions() as db:
            destination = db.get(Unit, unit_id)
            if destination is None:
                raise HTTPException(
                    422,
                    detail={
                        "code": "invalid_unit",
                        "message": "Choose an existing destination unit.",
                    },
                )
            return evaluate(db, rows, False, destination)

    @router.post("/confirm", dependencies=[Depends(gate.check_csrf)])
    async def confirm(request: Request, unit_id: UUID):
        rows = await read_csv(request)
        with sessions.begin() as db:
            # Also blocks normal vocabulary/unit/tag writes until commit.
            db.execute(
                text(
                    "LOCK TABLE vocabulary_entries, units, tags "
                    "IN SHARE ROW EXCLUSIVE MODE"
                )
            )
            destination = db.get(Unit, unit_id)
            if destination is None:
                raise HTTPException(
                    422,
                    detail={
                        "code": "invalid_unit",
                        "message": "Choose an existing destination unit.",
                    },
                )
            return evaluate(db, rows, True, destination)

    return router
