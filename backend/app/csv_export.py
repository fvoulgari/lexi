import csv
import io
import json

from app.csv_format import (
    FORMAT_VERSION,
    FORMAT_VERSION_V2,
    FORMAT_VERSION_V3,
    spreadsheet_text,
)
from app.csv_v2 import (
    encode_grammar,
    grammar_column,
    text_column,
    v2_columns,
    v3_columns,
    vocabulary_columns,
)
from app.grammar import DEFINITIONS, grammar_languages
from app.languages import card_languages, card_text

COLUMNS = (
    "italian",
    "greek",
    "word_type",
    "italian_gender",
    "greek_gender",
    "unit_code",
    "unit_title",
    "unit_sort_order",
    "tags",
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
    "csv_format",
)


def export_library(entries, account_id, *, include_ids=False):
    output = io.StringIO(newline="")
    writer = csv.writer(output, quoting=csv.QUOTE_ALL)
    columns = (
        (*COLUMNS, "entry_id", "source_language", "target_language")
        if include_ids
        else COLUMNS
    )
    writer.writerow(columns)
    for entry in entries:
        source = entry.source_collection
        if source is not None and source.owner_account_id != account_id:
            source = None
        values = {
            **{field: getattr(entry, field, None) for field in columns},
            "csv_format": FORMAT_VERSION,
            "entry_id": str(entry.id),
            "unit_code": source.source_unit_code if source else "",
            "unit_title": source.source_unit_title if source else "",
            "unit_sort_order": source.source_unit_sort_order if source else "",
            "tags": json.dumps([tag.name for tag in entry.tags], ensure_ascii=False),
        }
        for field in ("italian_gender", "greek_gender"):
            if values[field] == "common":
                values[field] = None
        writer.writerow(spreadsheet_text(values[field]) for field in columns)
    return output.getvalue().encode("utf-8-sig")


def export_collections(
    entries,
    account_id,
    collection=None,
    version=FORMAT_VERSION_V2,
    *,
    vocabulary_only=False,
):
    """Export v2/v3 scoped to the destination pair, not the whole registry."""
    if version not in (FORMAT_VERSION_V2, FORMAT_VERSION_V3):
        raise ValueError(f"Unsupported collection CSV format: {version}")
    output = io.StringIO(newline="")
    writer = csv.writer(output, quoting=csv.QUOTE_ALL)
    if collection is not None:
        languages = tuple(
            sorted({collection.source_language, collection.target_language})
        )
    else:
        languages = tuple(
            sorted(
                {
                    language
                    for entry in entries
                    for language in card_languages(entry)
                }
            )
        )
    if vocabulary_only:
        columns = vocabulary_columns(languages)
    elif version == FORMAT_VERSION_V3:
        columns = v3_columns(languages)
    else:
        columns = v2_columns(languages)
    writer.writerow(columns)
    for entry in entries:
        source = entry.source_collection
        if source is not None and source.owner_account_id != account_id:
            source = None
        scope = collection or source
        card_source, card_target = card_languages(entry)
        values = {
            "csv_format": version,
            "entry_id": str(entry.id),
            "collection_id": str(scope.id) if scope is not None else "",
            "collection_name": scope.title if scope is not None else "",
            "source_language": (
                scope.source_language if scope is not None else card_source
            ),
            "target_language": (
                scope.target_language if scope is not None else card_target
            ),
            "card_source_language": card_source,
            "card_target_language": card_target,
            "word_type": entry.word_type,
            "tags": json.dumps([tag.name for tag in entry.tags], ensure_ascii=False),
            "notes": entry.notes,
            "unit_code": source.source_unit_code if source else "",
            "unit_title": source.source_unit_title if source else "",
            "unit_sort_order": source.source_unit_sort_order if source else "",
        }
        for language in (card_source, card_target):
            values[text_column(language)] = card_text(entry, language)
        for language in grammar_languages(languages):
            values[grammar_column(language)] = encode_grammar(entry, language)
        if version == FORMAT_VERSION_V3:
            values["schema_version"] = str(DEFINITIONS["version"])
            values["metadata"] = json.dumps(
                {
                    "grammar": {
                        language: cell
                        for language, cell in (entry.grammar or {}).items()
                        if language in (card_source, card_target)
                    },
                },
                ensure_ascii=False,
                sort_keys=True,
            )
        writer.writerow(spreadsheet_text(values.get(field)) for field in columns)
    return output.getvalue().encode("utf-8-sig")
