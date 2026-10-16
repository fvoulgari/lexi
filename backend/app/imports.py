"""CSV preview is read-only; confirmation reparses and serializes library writes."""

import csv
import io
import json
from pathlib import Path

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


def evaluate(db, rows, confirm):
    units = {u.code: u for u in db.scalars(select(Unit))}
    tags = {t.name: t for t in db.scalars(select(Tag))}
    pairs = {
        normalized_pair(it, el)
        for it, el in db.execute(select(VocabularyEntry.italian, VocabularyEntry.greek))
    }
    proposed_units, proposed_tags, results = {}, set(), []
    counts = dict(imported=0, valid=0, skipped=0, duplicate=0, error=0)
    for number, original in enumerate(rows, 2):
        row = {
            key: value.strip() if isinstance(value, str) else value
            for key, value in original.items()
        }
        errors = []
        entry = unit_spec = None
        names = []
        try:
            if None in row or any(value is None for value in row.values()):
                raise ValueError("Column count does not match the header.")
            version = row.pop("csv_format", "")
            if version and version != FORMAT_VERSION:
                raise ValueError("Unsupported csv_format version.")
            if version:
                row = {key: restore_text(value) for key, value in row.items()}
            for alias, field in ALIASES.items():
                value = row.pop(alias, "")
                if value and row.get(field) and value != row[field]:
                    raise ValueError(f"{alias} conflicts with {field}.")
                if value:
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
            if code:
                unit_spec = UnitCreate(
                    code=code,
                    title=title or (units[code].title if code in units else ""),
                    sort_order=int(order)
                    if order
                    else (units[code].sort_order if code in units else 0),
                )
                existing = units.get(code) or proposed_units.get(code)
                if existing and (
                    existing.title != unit_spec.title
                    or existing.sort_order != unit_spec.sort_order
                ):
                    raise ValueError("Unit metadata conflicts with this unit code.")
            elif title or order:
                raise ValueError("unit_title/unit_sort_order require unit_code.")
            entry = VocabularyCreate(**{k: v or None for k, v in row.items()})
        except ValidationError as exc:
            errors = [
                ".".join(map(str, e["loc"])) + ": " + e["msg"] for e in exc.errors()
            ]
        except (ValueError, TypeError) as exc:
            errors = [str(exc)]
        status = "error" if errors else "valid"
        if not errors:
            pair = normalized_pair(entry.italian, entry.greek)
            if pair in pairs:
                status = "duplicate"
            else:
                pairs.add(pair)
                if unit_spec and unit_spec.code not in units:
                    proposed_units[unit_spec.code] = unit_spec
                proposed_tags.update(name for name in names if name not in tags)
                if confirm:
                    unit = None
                    if unit_spec:
                        unit = units.get(unit_spec.code)
                        if unit is None:
                            unit = Unit(**unit_spec.model_dump())
                            db.add(unit)
                            db.flush()
                            units[unit.code] = unit
                    assigned_tags = []
                    for name in names:
                        if name not in tags:
                            tags[name] = Tag(name=name)
                            db.add(tags[name])
                        assigned_tags.append(tags[name])
                    values = entry.model_dump(exclude={"unit_id", "tag_ids"})
                    db.add(VocabularyEntry(**values, unit=unit, tags=assigned_tags))
                    counts["imported"] += 1
        counts[status] += 1
        if status != "valid":
            counts["skipped"] += 1
        results.append(
            {
                "row": number,
                "italian": original.get("italian", ""),
                "greek": original.get("greek", ""),
                "status": status,
                "errors": errors,
                "entry": entry.model_dump(exclude={"unit_id", "tag_ids"})
                if entry
                else None,
                "unit": unit_spec.model_dump() if unit_spec else None,
                "tags": names,
            }
        )
    return {
        "counts": counts,
        "rows": results,
        "proposed_units": [u.model_dump() for u in proposed_units.values()],
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
    async def preview(request: Request):
        rows = await read_csv(request)
        with sessions() as db:
            return evaluate(db, rows, False)

    @router.post("/confirm", dependencies=[Depends(gate.check_csrf)])
    async def confirm(request: Request):
        rows = await read_csv(request)
        with sessions.begin() as db:
            # Also blocks normal vocabulary/unit/tag writes until commit.
            db.execute(
                text(
                    "LOCK TABLE vocabulary_entries, units, tags "
                    "IN SHARE ROW EXCLUSIVE MODE"
                )
            )
            return evaluate(db, rows, True)

    return router
