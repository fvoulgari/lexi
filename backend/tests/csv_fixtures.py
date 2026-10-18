"""Supply explicit genders in older fixtures whose subject is not gender validation."""

import csv
import io


def with_genders(content):
    try:
        rows = list(csv.reader(io.StringIO(content.lstrip("\ufeff")), strict=True))
    except csv.Error:
        return content
    if not rows or len(rows[0]) != len(set(rows[0])):
        return content
    header = rows[0]
    type_field = "word_type" if "word_type" in header else "type"
    if type_field not in header:
        return content
    fields = [
        field
        for field in (
            "italian_gender",
            "greek_gender",
            "italian_adjective_gender",
            "greek_adjective_gender",
        )
        if field not in header
        and not (field == "italian_gender" and "gender" in header)
    ]
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(header + fields)
    for row in rows[1:]:
        kind = (
            row[header.index(type_field)] if len(row) > header.index(type_field) else ""
        )
        values = (
            {"italian_gender": "masculine", "greek_gender": "neuter"}
            if kind == "noun"
            else {
                "italian_adjective_gender": "masculine",
                "greek_adjective_gender": "masculine",
            }
            if kind == "adjective"
            else {}
        )
        writer.writerow(row + [values.get(field, "") for field in fields])
    return output.getvalue()
