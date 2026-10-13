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
    "italian_plural",
    "greek_plural",
    "italian_example",
    "greek_example",
    "notes",
    "pronunciation",
    "csv_format",
)


def export_library(entries):
    output = io.StringIO(newline="")
    writer = csv.writer(output, quoting=csv.QUOTE_ALL)
    writer.writerow(COLUMNS)
    for entry in entries:
        values = {
            **{field: getattr(entry, field, None) for field in COLUMNS},
            "csv_format": FORMAT_VERSION,
            "unit_code": entry.unit.code if entry.unit else "",
            "unit_title": entry.unit.title if entry.unit else "",
            "unit_sort_order": entry.unit.sort_order if entry.unit else "",
            "tags": json.dumps([tag.name for tag in entry.tags], ensure_ascii=False),
        }
        writer.writerow(spreadsheet_text(values[field]) for field in COLUMNS)
    return output.getvalue().encode("utf-8-sig")
