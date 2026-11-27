"""CSV preview is read-only; confirmation reparses and serializes library writes."""

import csv
import hashlib
import io
import json
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import ValidationError
from sqlalchemy import func, select, text

from app.access import collection_capabilities, current_account, require_write
from app.collections import CollectionBody, gender_message
from app.csv_format import (
    FORMAT_VERSION,
    FORMAT_VERSION_SIMPLE,
    FORMAT_VERSION_V2,
    FORMAT_VERSION_V3,
    restore_text,
    spreadsheet_text,
)
from app.csv_v2 import (
    decode_grammar_cell,
    grammar_column,
    grammar_columns,
    template_columns,
    text_column,
    text_columns,
    v2_columns,
    v3_columns,
)
from app.duplicates import normalized_language_pair
from app.grammar import (
    DEFINITIONS,
    GRAMMAR_DEFINITIONS,
    GRAMMAR_FIELDS,
    clean_grammar,
    invalid_grammar_fields,
    iter_fields,
    merge_structured,
    missing_gender_fields,
    sync_entry_grammar,
    validate_structured_grammar,
)
from app.languages import card_languages, card_slots, pair, same_pair
from app.models import Collection, CollectionEntry, Tag, VocabularyEntry
from app.registry import get_registry
from app.schemas import TagCreate, UnitCreate, VocabularyCreate, VocabularyImport

MAX_BYTES = 1_048_576
MAX_ROWS = 2000
ALIASES = {
    "type": "word_type",
    "unit": "unit_code",
    "plural": "italian_plural",
    "example": "italian_example",
    "gender": "italian_gender",
}
LEGACY_COLUMNS = {
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
    "schema_version",
    "metadata",
    "base",
    "learning",
}


def allowed_columns():
    """Legacy aliases plus v2 columns for the currently registered languages."""
    return LEGACY_COLUMNS | set(v2_columns()) | set(ALIASES)


def invalid(message):
    raise HTTPException(422, {"code": "invalid_csv", "message": message})


def column_mapping(request):
    """Optional explicit mapping from uploaded headers to Lexi columns."""
    raw = request.query_params.get("column_mapping")
    if not raw:
        return {}
    try:
        supplied = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        invalid("Column mapping must be a JSON object.")
    if not isinstance(supplied, dict) or any(
        not isinstance(key, str) or not isinstance(value, str)
        for key, value in supplied.items()
    ):
        invalid("Column mapping must map header names to column names.")
    supported = allowed_columns()
    for source, target in supplied.items():
        if target and target not in supported:
            invalid(f"Column “{source}” cannot map to “{target}”.")
    return supplied


def detect_format(fields, explicit_versions):
    """Recognise a supported exchange format without asking for a version."""
    names = {ALIASES.get(field, field) for field in fields}
    explicit = {version for version in explicit_versions if version}
    if len(explicit) > 1:
        invalid("This CSV contains conflicting format identifiers.")
    version = next(iter(explicit), "")
    language_texts = sorted(
        name.removeprefix("text_")
        for name in names
        if name.startswith("text_")
        and get_registry().has_language(name.removeprefix("text_"))
    )
    simple = {"base", "learning"} <= names
    legacy = {"italian", "greek"} <= names
    if version:
        if version == FORMAT_VERSION_SIMPLE and not simple:
            invalid("The simple template needs base and learning columns.")
        if version in (FORMAT_VERSION_V2, FORMAT_VERSION_V3) and (
            len(language_texts) < 2
            or not (
                {"card_source_language", "card_target_language"} <= names
                or len(language_texts) == 2
            )
        ):
            invalid("Metadata templates need two language-keyed text columns.")
        if version == FORMAT_VERSION_V2 and {"schema_version", "metadata"} & names:
            invalid(
                "This file contains metadata; import it with automatic detection "
                "so no grammar information is discarded."
            )
        if version == FORMAT_VERSION and not legacy:
            invalid("Legacy templates need italian and greek columns.")
        return version
    if "schema_version" in names or "metadata" in names:
        return FORMAT_VERSION_V3
    if simple:
        return FORMAT_VERSION_SIMPLE
    if len(language_texts) >= 2:
        return FORMAT_VERSION_V2
    if legacy:
        # Unversioned historical files keep pipe-separated tags and legacy
        # aliases, so they must not be rewritten with a version marker.
        return ""
    invalid(
        "Lexi could not identify the language columns. Map each column to a "
        "language or vocabulary field and try again."
    )


async def read_csv(request):
    content = bytearray()
    async for chunk in request.stream():
        content.extend(chunk)
        if len(content) > MAX_BYTES:
            invalid("CSV exceeds the 1 MiB limit.")
    try:
        reader = csv.reader(io.StringIO(content.decode("utf-8-sig")), strict=True)
        original_fields = next(reader)
        if not original_fields:
            invalid("CSV needs a header row.")
        mapping = column_mapping(request)
        fields = []
        kept = []
        for index, header in enumerate(original_fields):
            target = mapping.get(header, header)
            if target == "":
                continue
            fields.append(target)
            kept.append(index)
        if not fields or len(fields) != len(set(fields)):
            invalid("CSV needs unique column headers after mapping.")
        supported = allowed_columns()
        if set(fields) - supported:
            invalid(
                "Unsupported columns: "
                + ", ".join(sorted(set(fields) - supported))
                + ". Map or ignore them before importing."
            )
        if "word_type" not in {ALIASES.get(field, field) for field in fields}:
            invalid("Required column: word_type. Map a column to it before importing.")
        raw_rows = []
        for raw_row in reader:
            if len(raw_rows) >= MAX_ROWS:
                invalid("CSV exceeds the 2000 row limit.")
            padded = list(raw_row)
            if len(padded) < len(original_fields):
                padded.extend([""] * (len(original_fields) - len(padded)))
            row = {
                field: padded[index] for field, index in zip(fields, kept, strict=True)
            }
            if len(raw_row) > len(original_fields):
                row[None] = "extra columns"
            raw_rows.append(row)
        if not raw_rows:
            invalid("CSV has no vocabulary rows.")
        rows = raw_rows
        version = detect_format(
            fields, [row.get("csv_format", "") for row in rows]
        )
        language_texts = sorted(
            name.removeprefix("text_")
            for name in fields
            if name.startswith("text_")
            and get_registry().has_language(name.removeprefix("text_"))
        )
        inferred_languages = (
            version in (FORMAT_VERSION_V2, FORMAT_VERSION_V3)
            and len(language_texts) == 2
            and not {"card_source_language", "card_target_language"} <= set(fields)
        )
        for row in rows:
            if version and not row.get("csv_format"):
                row["csv_format"] = version
            if inferred_languages:
                row["card_source_language"] = language_texts[0]
                row["card_target_language"] = language_texts[1]
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


def parse_v2_row(row, destination_languages):
    """Normalize a v2 row into the common (language-named) import fields.

    Returns the card's explicit language IDs. Collection languages are checked
    against the destination, while texts and grammar are read from columns
    named after the card's own language IDs.
    """
    collection_languages = (
        row.pop("source_language", ""),
        row.pop("target_language", ""),
    )
    if any(collection_languages) and not all(collection_languages):
        raise ValueError("Both Collection languages are required.")
    if all(collection_languages) and not same_pair(
        *collection_languages, *destination_languages
    ):
        raise ValueError("CSV Collection languages do not match the destination.")
    row.pop("collection_id", "")
    row.pop("collection_name", "")
    source = row.pop("card_source_language", "")
    target = row.pop("card_target_language", "")
    if not source or not target:
        raise ValueError("Card language IDs are required.")
    pair(source, target)
    if not same_pair(source, target, *destination_languages):
        raise ValueError("Card language pair does not match the destination.")

    supplied_texts = {column: row.pop(column, "") for column in text_columns()}
    texts = {}
    for language in (source, target):
        texts[language] = supplied_texts[text_column(language)]
        if not texts[language]:
            raise ValueError(f"Missing text for {language}.")
    for column, value in supplied_texts.items():
        if value and column not in (text_column(source), text_column(target)):
            raise ValueError(
                f"Text for {column.removeprefix('text_')} is not in this card."
            )

    legacy_grammar = {field: row.get(field, "") for field in GRAMMAR_FIELDS}
    structured = {}
    for column in grammar_columns():
        value = row.pop(column, "")
        language = column.removeprefix("grammar_")
        fields, cell = decode_grammar_cell(value, language)
        if cell and language not in (source, target):
            raise ValueError(f"Grammar for {language} is not in this card.")
        if cell:
            structured[language] = cell
        for field, field_value in fields.items():
            if legacy_grammar[field] and legacy_grammar[field] != field_value:
                raise ValueError(f"{field} conflicts with {column}.")
            row[field] = field_value
    for field, value in legacy_grammar.items():
        if value and row.get(field) != value:
            raise ValueError(f"{field} conflicts with language-keyed grammar.")
    row["_structured_grammar"] = structured

    # Keep the historical it/el storage slots authoritative even when a row
    # supplies those two IDs in reverse order. API card creation applies the
    # same canonicalisation, so text always follows its explicit language ID.
    canonical_source, canonical_target, italian, greek = card_slots(
        source, target, texts[source], texts[target]
    )
    row["italian"], row["greek"] = italian, greek
    return canonical_source, canonical_target


def parse_simple_row(row, destination_languages):
    """Map the simple Base/Learning template onto the shared card text slots.

    The columns hold texts, not language IDs. Their orientation comes from the
    chosen destination, so the same file works in either collection direction.
    """
    base_text = row.pop("base", "")
    learning_text = row.pop("learning", "")
    if not base_text or not learning_text:
        raise ValueError("Base and Learning texts are required.")
    source, target = destination_languages
    pair(source, target)
    canonical_source, canonical_target, italian, greek = card_slots(
        source, target, base_text, learning_text
    )
    row["italian"], row["greek"] = italian, greek
    return canonical_source, canonical_target


def grammar_cell_conflict(cells, metadata_grammar):
    """Return the first field where a v3 cell disagrees with metadata."""
    for language, cell in (cells or {}).items():
        supplied = (metadata_grammar or {}).get(language) or {}
        for key, value in cell.items():
            if key == "forms" and isinstance(value, dict):
                forms = supplied.get("forms") or {}
                for form, form_value in value.items():
                    if forms.get(form, form_value) != form_value:
                        return f"grammar_{language}.forms.{form}"
            elif supplied.get(key, value) != value:
                return f"grammar_{language}.{key}"
    return None


def parse_v3_metadata(row, incoming, languages):
    """Read the lossless metadata cell without changing identity or texts.

    v3 repeats the structured grammar in a versioned JSON cell so advanced
    exports can carry custom metadata without adding card columns. Unknown
    fields are rejected rather than silently dropped.
    """
    version = row.pop("schema_version", "")
    value = row.pop("metadata", "")
    if version and version != str(DEFINITIONS["version"]):
        raise ValueError(
            f"Grammar schema version {version} is not supported."
        )
    if not value:
        return incoming
    try:
        metadata = json.loads(value)
    except (TypeError, json.JSONDecodeError):
        raise ValueError("metadata must be a JSON object.") from None
    if not isinstance(metadata, dict):
        raise ValueError("metadata must be a JSON object.")
    unknown = set(metadata) - {"grammar"}
    if unknown:
        raise ValueError("Unsupported metadata: " + ", ".join(sorted(unknown)))
    grammar = metadata.get("grammar") or {}
    errors = validate_structured_grammar(grammar, languages)
    if errors:
        raise ValueError(
            "; ".join(f"{error['path']}: {error['message']}" for error in errors)
        )
    conflict = grammar_cell_conflict(incoming, grammar)
    if conflict:
        raise ValueError(f"{conflict} conflicts with metadata.grammar.")
    return merge_structured(incoming or {}, grammar, languages)


def evaluate(db, rows, confirm, destination, collection, *, fixed_destination=False):
    require_write(destination)
    destination_languages = (destination.source_language, destination.target_language)
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
            VocabularyEntry.source_language.in_(destination_languages),
            VocabularyEntry.target_language.in_(destination_languages),
            VocabularyEntry.source_language != VocabularyEntry.target_language,
        )
        .order_by(VocabularyEntry.id)
    ):
        pair_key = normalized_language_pair(
            card_languages(existing), (existing.italian, existing.greek)
        )
        pairs.setdefault(pair_key, []).append(
            {
                "entry": existing,
                "source_collection_id": existing.source_collection_id,
                "values": {
                    field: getattr(existing, field)
                    for field in VocabularyCreate.model_fields
                    if field not in {"unit_id", "tag_ids", "visibility"}
                }
                | {
                    "source_language": existing.source_language,
                    "target_language": existing.target_language,
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
        incoming_grammar = None
        row_languages = ("it", "el")
        try:
            if None in row or any(value is None for value in row.values()):
                raise ValueError("Column count does not match the header.")
            version = row.pop("csv_format", "")
            if version not in (
                "",
                FORMAT_VERSION_SIMPLE,
                FORMAT_VERSION,
                FORMAT_VERSION_V2,
                FORMAT_VERSION_V3,
            ):
                raise ValueError("Unsupported csv_format version.")
            if version:
                row = {key: restore_text(value) for key, value in row.items()}
            if version in (FORMAT_VERSION_V2, FORMAT_VERSION_V3):
                conflicting = [alias for alias in ALIASES if row.get(alias)]
                if conflicting:
                    raise ValueError(
                        "Legacy aliases cannot be used with CSV format v2/v3: "
                        + ", ".join(sorted(conflicting))
                    )
                row_languages = parse_v2_row(row, destination_languages)
                incoming_grammar = row.pop("_structured_grammar", None)
                if version == FORMAT_VERSION_V3:
                    incoming_grammar = parse_v3_metadata(
                        row, incoming_grammar, row_languages
                    )
                invalid = invalid_grammar_fields(row, row_languages)
                if invalid:
                    raise ValueError(
                        "Invalid grammar for: " + ", ".join(invalid) + "."
                    )
            elif version == FORMAT_VERSION_SIMPLE:
                row_languages = parse_simple_row(row, destination_languages)
            elif not same_pair(*destination_languages, "it", "el"):
                raise ValueError("Legacy CSV rows require an Italian–Greek Collection.")
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
                if reference is None or not same_pair(
                    *card_languages(reference), *destination_languages
                ):
                    raise ValueError("Card reference is unavailable.")
                row_languages = card_languages(reference)
                incoming_grammar = None
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
                        "Choose a Collection you can import into."
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
                normalized_language_pair(
                    row_languages, (row.get("italian", ""), row.get("greek", ""))
                ),
                [],
            )
            # A CSV update may omit gender if the existing card already has it.
            # Missing legacy genders must be corrected explicitly in this row.
            previous = (
                matches[0]["values"]
                if len(matches) == 1 and not fixed_destination
                else {}
            )
            if reference is None:
                fields = {**previous, **{k: v or None for k, v in row.items()}}
                fields.pop("source_language", None)
                fields.pop("target_language", None)
                entry = VocabularyImport(**fields)
                missing = missing_gender_fields(
                    entry.model_dump(), row_languages
                )
                if missing:
                    raise ValueError(gender_message(missing))
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
            pair_key = normalized_language_pair(
                row_languages, (entry.italian, entry.greek)
            )
            matches = pairs.get(pair_key, [])
            values = {
                **entry.model_dump(
                    exclude={"unit_id", "tag_ids", "visibility"}
                ),
                "source_language": row_languages[0],
                "target_language": row_languages[1],
            }
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
                    "Multiple cards match this language pair. "
                    "Edit them individually."
                ]
            else:
                if proposed_metadata is not None:
                    pending_metadata[target.id] = proposed_metadata
                current = matches[0] if matches else None
                if current and current["entry"]:
                    row_languages = card_languages(current["entry"])
                    values["source_language"], values["target_language"] = row_languages
                members = membership(target)
                marker = (
                    current["entry"].id
                    if current and current["entry"]
                    else ("new", pair_key, tuple(values.items()), tuple(sorted(names)))
                    if fixed_destination
                    else ("new", pair_key)
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
                            pairs.setdefault(pair_key, []).append(current)
                        else:
                            pairs[pair_key] = [current]
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
                        sync_entry_grammar(stored, incoming_grammar)
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
                "italian": row.get("italian", original.get("italian", "")),
                "greek": row.get("greek", original.get("greek", "")),
                "source_language": row_languages[0],
                "target_language": row_languages[1],
                "status": status,
                "changed_fields": changed_fields,
                "errors": errors,
                "error_code": None,
                "entry": (
                    entry.model_dump(
                        exclude={"unit_id", "tag_ids", "visibility"}
                    )
                    | ({"grammar": incoming_grammar} if incoming_grammar else {})
                )
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
            raise HTTPException(422, "Choose a collection you can import into.")
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

    def example_rows(source, target):
        # Text samples make the template readable; grammar values themselves
        # come from the definitions, so a new option never needs a code edit.
        samples = {
            "it": {
                "noun": "casa",
                "verb": "parlare",
                "adjective": "bello",
                "plural": "case",
            },
            "el": {
                "noun": "σπίτι",
                "verb": "μιλάω",
                "adjective": "όμορφος",
                "plural": "σπίτια",
            },
            "en": {"noun": "house", "verb": "speak", "adjective": "beautiful"},
            "da": {
                "noun": "hus",
                "verb": "tale",
                "adjective": "smuk",
                "plural": "huse",
            },
            "ja": {"noun": "家", "verb": "話す", "adjective": "美しい"},
            "ar": {"noun": "بيت", "verb": "يتكلم", "adjective": "جميل"},
        }
        plural_samples = {"da": "huse", "it": "case", "el": "σπίτια"}
        gender_samples = {"da": "common", "it": "masculine", "el": "neuter"}

        def text(language, kind):
            return samples.get(language, {}).get(kind, f"{language}-{kind}")

        def grammar(language, kind):
            definition = GRAMMAR_DEFINITIONS.get(language)
            if definition is None:
                return ""
            cell = {}
            for path, spec in iter_fields(definition):
                if spec.get("type") != "enum":
                    continue
                expected = {"noun": "gender", "adjective": "adjective_gender"}.get(kind)
                if path == expected and spec.get("options"):
                    preferred = (
                        gender_samples.get(language)
                        if path == "gender"
                        else None
                    ) or spec["options"][0]
                    cell[path] = (
                        preferred
                        if preferred in spec["options"]
                        else spec["options"][0]
                    )
            if kind == "noun" and language in plural_samples:
                cell["plural"] = plural_samples[language]
            if not cell:
                return ""
            errors = validate_structured_grammar({language: cell}, (language,))
            if errors:
                return ""
            return json.dumps(cell, ensure_ascii=False, sort_keys=True)

        rows = []
        for kind in ("noun", "verb", "adjective"):
            row = {
                "csv_format": FORMAT_VERSION_V2,
                "source_language": source,
                "target_language": target,
                "card_source_language": source,
                "card_target_language": target,
                text_column(source): text(source, kind),
                text_column(target): text(target, kind),
                "word_type": kind,
                "tags": "[]",
            }
            for language in (source, target):
                value = grammar(language, kind)
                if value:
                    row[grammar_column(language)] = value
            rows.append(row)
        return rows

    @router.get("/example")
    def example(
        collection_id: UUID | None = None,
        source_language: str | None = None,
        target_language: str | None = None,
        format: str = "v2",
    ):
        if format not in ("template", "simple", "v2", "v3"):
            raise HTTPException(422, "Choose a supported CSV template format.")
        languages = None
        if collection_id is not None:
            with sessions() as db:
                collection = db.get(Collection, collection_id)
                capabilities = (
                    collection_capabilities(collection) if collection else None
                )
                if (
                    collection is None
                    or not capabilities["can_edit"]
                ):
                    raise HTTPException(404, "Collection not found.")
                languages = (collection.source_language, collection.target_language)
        elif source_language and target_language:
            try:
                pair(source_language, target_language)
            except ValueError:
                raise HTTPException(422, "Choose a supported language pair.") from None
            languages = (source_language, target_language)
        else:
            languages = ("el", "it")

        source, target = languages
        rows = example_rows(source, target)
        if format == "simple":
            columns = (
                "csv_format",
                "base",
                "learning",
                "word_type",
                "notes",
                "tags",
            )
            rows = [
                {
                    "csv_format": FORMAT_VERSION_SIMPLE,
                    "base": row[text_column(source)],
                    "learning": row[text_column(target)],
                    "word_type": row["word_type"],
                    "notes": "",
                    "tags": "[]",
                }
                for row in rows
            ]
        elif format == "template":
            columns = template_columns((source, target))
        elif format == "v3":
            columns = v3_columns(sorted((source, target)))
            for row in rows:
                row["schema_version"] = str(DEFINITIONS["version"])
                row["metadata"] = json.dumps(
                    {
                        "grammar": {
                            language: json.loads(row[grammar_column(language)])
                            for language in (source, target)
                            if row.get(grammar_column(language))
                        },
                    },
                    ensure_ascii=False,
                    sort_keys=True,
                )
        else:
            columns = v2_columns(sorted((source, target)))
        output = io.StringIO(newline="")
        writer = csv.writer(output, quoting=csv.QUOTE_ALL, lineterminator="\r\n")
        writer.writerow(columns)
        for row in rows:
            writer.writerow(spreadsheet_text(row.get(column)) for column in columns)
        suffix = "" if format in ("v2", "template") else f"-{format}"
        filename = f"vocabulary-example-{source}-{target}{suffix}.csv"
        return Response(
            output.getvalue().encode("utf-8-sig"),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
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
