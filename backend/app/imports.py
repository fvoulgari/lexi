"""CSV preview is read-only; confirmation reparses and serializes library writes."""

import csv
import hashlib
import io
import json
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import ValidationError
from sqlalchemy import func, select, text

from app.access import collection_capabilities, current_account, require_write
from app.collections import CollectionBody
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
    "entry_id",
    "source_language",
    "target_language",
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


def import_preview_token(
    rows,
    *,
    collection_id,
    new_name,
    source_language,
    target_language,
    fixed_destination,
    make_public,
):
    def normalize(value):
        if isinstance(value, dict):
            return {
                ("__extra__" if key is None else str(key)): normalize(item)
                for key, item in value.items()
            }
        if isinstance(value, (list, tuple)):
            return [normalize(item) for item in value]
        if value is None or isinstance(value, (str, int, float, bool)):
            return value
        return str(value)

    payload = {
        "rows": normalize(rows),
        "collection_id": str(collection_id) if collection_id else None,
        "new_name": new_name,
        "source_language": source_language,
        "target_language": target_language,
        "fixed_destination": bool(fixed_destination),
        "make_public": bool(make_public),
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()


def evaluate(db, rows, confirm, destination, collection, *, fixed_destination=False):
    require_write(destination)
    # Imported cards and tags stay privately owned even when their collection is
    # public; a published collection shares them through confirmed references.
    card_visibility = (
        "private"
        if destination.owner_account_id == current_account().id
        else destination.visibility
    )
    tags = {
        t.name: t
        for t in db.scalars(
            select(Tag).where(
                Tag.owner_account_id == destination.owner_account_id,
                Tag.visibility == card_visibility,
            )
        )
    }
    if fixed_destination:
        existing_scope = VocabularyEntry.id.in_(
            select(CollectionEntry.entry_id).where(
                CollectionEntry.collection_id == collection.id
            )
        )
    else:
        existing_scope = True
    # Keep a simulated library during preview too, so later rows see earlier changes.
    pairs = {}
    for existing in db.scalars(
        select(VocabularyEntry)
        .where(
            existing_scope,
            VocabularyEntry.owner_account_id == destination.owner_account_id,
            VocabularyEntry.visibility == card_visibility,
            VocabularyEntry.source_language == "it",
            VocabularyEntry.target_language == "el",
        )
        .order_by(VocabularyEntry.id)
    ):
        pair = normalized_pair(existing.italian, existing.greek)
        pairs.setdefault(pair, []).append(
            {
                "entry": existing,
                "source_collection_id": existing.source_collection_id,
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
    mapped = [] if fixed_destination else list(db.scalars(mapped_query))
    member_cache, positions, pending_metadata = {}, {}, {}

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
        proposed_metadata = None
        metadata_is_new = False
        reference = None
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
            reference_id = row.pop("entry_id", "")
            languages = {row.pop("source_language", ""), row.pop("target_language", "")}
            if languages not in (
                {
                    "",
                },
                {"it", "el"},
            ):
                raise ValueError("CSV import requires Italian and Greek cards.")
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
            if fixed_destination:
                code = title = order = ""
            if reference_id and not fixed_destination:
                raise ValueError("Choose a fixed destination for card references.")
            if reference_id:
                reference = db.get(VocabularyEntry, UUID(reference_id))
                if reference is None or {
                    reference.source_language,
                    reference.target_language,
                } != {"it", "el"}:
                    raise ValueError("Card reference is unavailable.")
                row = {
                    field: getattr(reference, field)
                    for field in VocabularyCreate.model_fields
                    if field not in {"unit_id", "tag_ids", "visibility"}
                }
                names = []
            if not code and (title or order):
                raise ValueError("unit_title/unit_sort_order require unit_code.")
            if code:
                UnitCreate(
                    code=code,
                    title=title or destination.title,
                    sort_order=int(order) if order else 0,
                )
            code_candidates = [c for c in mapped if code and c.source_unit_code == code]
            candidates = code_candidates
            if title:
                candidates = [
                    c for c in candidates if c.source_unit_title in (None, title)
                ]
            if order:
                candidates = [
                    c
                    for c in candidates
                    if c.source_unit_sort_order in (None, int(order))
                ]
            if len(candidates) > 1:
                raise ValueError("CSV Unit metadata matches multiple Collections.")
            if code_candidates and not candidates:
                raise ValueError(
                    "CSV Unit metadata conflicts with an existing Collection."
                )
            if candidates:
                target = candidates[0]
                if not collection_capabilities(target)["can_import"]:
                    raise ValueError(
                        "Choose an Italian–Greek Collection you can import into."
                    )
            if code:
                prior = pending_metadata.get(
                    target.id,
                    (
                        target.source_unit_code,
                        target.source_unit_title,
                        target.source_unit_sort_order,
                    ),
                )
                supplied = (code, title or None, int(order) if order else None)
                if any(
                    old is not None and new is not None and old != new
                    for old, new in zip(prior, supplied, strict=True)
                ):
                    raise ValueError(
                        "CSV Unit metadata conflicts with the selected Collection."
                    )
                merged = tuple(
                    old if old is not None else new
                    for old, new in zip(prior, supplied, strict=True)
                )
                metadata_is_new = merged != prior
                if metadata_is_new:
                    proposed_metadata = merged
            matches = pairs.get(
                normalized_pair(row.get("italian", ""), row.get("greek", "")), []
            )
            # A CSV update may omit gender if the existing card already has it.
            # Missing legacy genders must be corrected explicitly in this row.
            previous = (
                matches[0]["values"]
                if len(matches) == 1 and not fixed_destination
                else {}
            )
            if reference is None:
                entry = VocabularyCreate(
                    **{**previous, **{k: v or None for k, v in row.items()}},
                )
        except ValidationError as exc:
            errors = [
                ".".join(map(str, e["loc"])) + ": " + e["msg"] for e in exc.errors()
            ]
        except (ValueError, TypeError) as exc:
            errors = [str(exc)]
        status = "error" if errors else "valid"
        if not errors and reference is not None:
            members = membership(target)
            status = "duplicate" if reference.id in members else "updated"
            if status == "updated":
                members.add(reference.id)
                changed_fields.append("collection_id")
                if confirm:
                    db.add(
                        CollectionEntry(
                            collection_id=target.id,
                            entry_id=reference.id,
                            position=positions[target.id],
                            publication_confirmed=target.visibility == "published",
                        )
                    )
                    positions[target.id] += 1
        elif not errors:
            pair = normalized_pair(entry.italian, entry.greek)
            matches = pairs.get(pair, [])
            values = entry.model_dump(exclude={"unit_id", "tag_ids", "visibility"})
            # An omitted column is not an instruction to erase stored content.
            supplied = clean_grammar(
                {key: value for key, value in values.items() if key in row},
                entry.word_type,
            )
            if fixed_destination:
                matches = [
                    match
                    for match in matches
                    if match["values"] == values and match["tags"] == set(names)
                ][:1]
            if len(matches) > 1:
                status = "error"
                errors = [
                    "Multiple cards match this Italian–Greek pair. "
                    "Edit them individually."
                ]
            else:
                if proposed_metadata is not None:
                    pending_metadata[target.id] = proposed_metadata
                current = matches[0] if matches else None
                members = membership(target)
                marker = (
                    current["entry"].id
                    if current and current["entry"]
                    else ("new", pair, tuple(values.items()), tuple(sorted(names)))
                    if fixed_destination
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
                    if proposed_metadata and metadata_is_new:
                        changed_fields.append("collection_metadata")
                    if code and current["source_collection_id"] is None:
                        changed_fields.append("collection_provenance")
                    status = "updated" if changed_fields else "duplicate"
                if status != "duplicate":
                    if not current:
                        current = {
                            "entry": None,
                            "values": values,
                            "source_collection_id": target.id
                            if code or target.source_unit_code
                            else None,
                            "tags": set(names),
                        }
                        if fixed_destination:
                            pairs.setdefault(pair, []).append(current)
                        else:
                            pairs[pair] = [current]
                    current["values"].update(supplied)
                    if "collection_provenance" in changed_fields:
                        current["source_collection_id"] = target.id
                    if "tags" in original:
                        current["tags"] = set(names)
                    proposed_tags.update(name for name in names if name not in tags)
                    if confirm:
                        if proposed_metadata:
                            (
                                target.source_unit_code,
                                target.source_unit_title,
                                target.source_unit_sort_order,
                            ) = proposed_metadata
                            if target not in mapped:
                                mapped.append(target)
                        stored = current["entry"]
                        if stored is None:
                            stored = VocabularyEntry(
                                **current["values"],
                                owner_account_id=destination.owner_account_id,
                                visibility=card_visibility,
                                source_collection_id=current["source_collection_id"],
                            )
                            db.add(stored)
                            current["entry"] = stored
                            counts["imported"] += 1
                        else:
                            for key in changed_fields:
                                if key not in {
                                    "unit_id",
                                    "tags",
                                    "collection_id",
                                    "collection_metadata",
                                    "collection_provenance",
                                }:
                                    setattr(stored, key, supplied[key])
                            if "collection_provenance" in changed_fields:
                                stored.source_collection_id = target.id
                        if "tags" in original:
                            assigned_tags = []
                            for name in names:
                                if name not in tags:
                                    tags[name] = Tag(
                                        name=name,
                                        owner_account_id=destination.owner_account_id,
                                        visibility=card_visibility,
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
                                    publication_confirmed=target.visibility
                                    == "published",
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
                "error_code": None,
                "entry": entry.model_dump(exclude={"unit_id", "tag_ids", "visibility"})
                if entry
                else None,
                "unit": None,
                "tags": names,
            }
        )
    return {
        "destination_collection": {
            "id": str(collection.id),
            "name": collection.title,
            "visibility": collection.visibility,
        },
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
        capabilities = collection_capabilities(collection)
        if not capabilities["can_edit"]:
            raise HTTPException(403, "Choose a collection you own.")
        if not capabilities["can_import"]:
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

    def import_destination(
        db,
        unit_id,
        collection_id,
        new_name,
        source,
        target,
        confirm,
        make_public=False,
    ):
        if new_name is None:
            if make_public:
                raise HTTPException(
                    422, "Choose a new collection to publish it during import."
                )
            return resolve_destination(db, unit_id, collection_id, confirm)
        if unit_id is not None or collection_id is not None:
            raise HTTPException(422, "Choose one destination.")
        try:
            body = CollectionBody(
                name=new_name, source_language=source, target_language=target
            )
        except ValidationError:
            raise HTTPException(
                422, "Choose a valid collection name and language pair."
            ) from None
        if {body.source_language, body.target_language} != {"it", "el"}:
            raise HTTPException(422, "CSV import requires an Italian–Greek collection.")
        collection = Collection(
            id=uuid4(),
            title=body.name.strip(),
            owner_account_id=current_account().id,
            source_language=body.source_language,
            target_language=body.target_language,
            visibility="published" if make_public else "private",
        )
        return collection, collection

    def require_public_consent(collection, consent):
        if collection.visibility == "published" and not consent:
            raise HTTPException(
                409, "Confirm that the imported cards will be publicly visible."
            )

    def token_for(rows, collection, new_name, source, target, fixed, make_public):
        return import_preview_token(
            rows,
            collection_id=None if new_name is not None else collection.id,
            new_name=new_name,
            source_language=source,
            target_language=target,
            fixed_destination=fixed,
            make_public=make_public,
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
    async def preview(
        request: Request,
        unit_id: UUID | None = None,
        collection_id: UUID | None = None,
        fixed_destination: bool = False,
        new_name: str | None = None,
        source_language: str = "el",
        target_language: str = "it",
        make_public: bool = False,
    ):
        rows = await read_csv(request)
        with sessions() as db:
            collection, destination = import_destination(
                db,
                unit_id,
                collection_id,
                new_name,
                source_language,
                target_language,
                False,
                make_public,
            )
            fixed = fixed_destination or new_name is not None
            report = evaluate(
                db,
                rows,
                False,
                destination,
                collection,
                fixed_destination=fixed,
            )
            report["preview_token"] = token_for(
                rows,
                collection,
                new_name,
                source_language,
                target_language,
                fixed,
                make_public,
            )
            return report

    @router.post("/confirm", dependencies=[Depends(gate.check_csrf)])
    async def confirm(
        request: Request,
        unit_id: UUID | None = None,
        collection_id: UUID | None = None,
        fixed_destination: bool = False,
        new_name: str | None = None,
        source_language: str = "el",
        target_language: str = "it",
        make_public: bool = False,
        confirm_public_exposure: bool = False,
        preview_token: str | None = None,
        new_collection_id: UUID | None = None,
        expected_valid: int | None = None,
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
            collection, destination = import_destination(
                db,
                unit_id,
                collection_id,
                new_name,
                source_language,
                target_language,
                True,
                make_public,
            )
            fixed = fixed_destination or new_name is not None
            expected_token = token_for(
                rows,
                collection,
                new_name,
                source_language,
                target_language,
                fixed,
                make_public,
            )
            if preview_token is not None and preview_token != expected_token:
                raise HTTPException(409, "The import preview changed. Preview again.")
            require_public_consent(collection, confirm_public_exposure)
            if collection.visibility == "published" and not preview_token:
                raise HTTPException(
                    409, "Preview this public import before confirming."
                )
            if new_collection_id is not None:
                if new_name is None or expected_valid is None or expected_valid < 1:
                    raise HTTPException(
                        422, "Choose a new collection and preview the CSV."
                    )
                existing = db.get(Collection, new_collection_id)
                if existing is not None:
                    if (
                        existing.owner_account_id != collection.owner_account_id
                        or existing.visibility != collection.visibility
                        or existing.title != collection.title
                        or existing.source_language != collection.source_language
                        or existing.target_language != collection.target_language
                    ):
                        raise HTTPException(409, "Collection already exists.")
                    report = evaluate(
                        db, rows, False, existing, existing, fixed_destination=True
                    )
                    if (
                        report["counts"]["valid"]
                        or report["counts"]["duplicate"] < expected_valid
                    ):
                        raise HTTPException(409, "Preview the CSV again.")
                    report["counts"]["valid"] = expected_valid
                    report["preview_token"] = expected_token
                    return report
                collection.id = new_collection_id
            if new_name is not None:
                db.add(collection)
                db.flush()
            report = evaluate(
                db,
                rows,
                True,
                destination,
                collection,
                fixed_destination=fixed,
            )
            valid = report["counts"]["valid"]
            if new_name is not None and not valid:
                raise HTTPException(422, "No valid cards to import.")
            if expected_valid is not None and expected_valid != valid:
                raise HTTPException(409, "The cards changed. Preview the CSV again.")
            report["preview_token"] = expected_token
            return report

    return router
