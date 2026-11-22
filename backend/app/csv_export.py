import csv
import io
import json

from app.csv_format import FORMAT_VERSION, spreadsheet_text

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
