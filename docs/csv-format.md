# Vocabulary CSV format

Export uses UTF-8 with a BOM (read as `utf-8-sig`), comma delimiters, CRLF record separators, a header row, and double quotes around every field. Quotes inside fields are doubled; commas and embedded newlines remain data. Unicode is preserved without normalization. Entries are ordered by Italian text and entry ID. An empty library still returns the header.

| Column | Meaning |
| --- | --- |
| `italian`, `greek` | Required expression and equivalent, one meaning per row. |
| `type` | `noun`, `verb`, `adjective`, `adverb`, `expression`, or `other`. |
| `italian_gender`, `greek_gender` | Independent `masculine`, `feminine`, `neuter`, or blank. |
| `unit` | Unit code as text, including leading zeros (`00`, `007`); blank means No unit. |
| `unit_title`, `unit_sort_order` | Optional unit display title and integer order; blank without a unit. |
| `tags` | JSON array of tag names, e.g. `["cibo", "καφές"]`; `[]` means none. JSON safely preserves commas, quotes, semicolons and Unicode in names. |
| `italian_plural`, `greek_plural` | Optional plurals. |
| `italian_example`, `greek_example` | Optional examples, including multiline text. |
| `notes`, `pronunciation` | Optional notes and pronunciation text. |

Absent optional text is blank. IDs, timestamps and learner records are omitted: this is a reusable vocabulary exchange, not a database backup.

## Spreadsheet safety and text fidelity

CSV quoting alone does not prevent spreadsheet formulas. Every exported cell is prefixed with an apostrophe if it starts with an apostrophe, tab, CR or LF, or its first non-whitespace character is `=`, `+`, `-`, `@` (including their full-width forms). The prefix makes the value text in spreadsheet imports. Literal initial apostrophes are doubled so escaping is reversible. Tags are first encoded as JSON, whose initial `[` makes the whole cell text; tag names are not individually modified.

Import through the spreadsheet's text/CSV dialog and choose **Text** for all columns, particularly `unit`. CSV has no type information, and opening it directly may convert `007` to `7` even when quoted. Keep the original downloaded file for reuse; spreadsheet resaving may remove escaping, leading zeros or accents. Do not remove safety prefixes before opening in a spreadsheet.

## Compatibility with planned import (#11)

CSV import is not implemented yet. Its preview/confirmation workflow must accept these headers and JSON tags, preserve `unit` as text, and accept the optional unit metadata. It must strip exactly one initial apostrophe only when the remainder itself starts with an apostrophe, tab, CR or LF, or its first non-whitespace character is one of the formula markers above. Thus `'=1+1` restores `=1+1`, `''ordinary` restores `'ordinary`, and an unescaped `'ordinary` remains unchanged. Decode before validation and duplicate detection. For hand-written CSV, literal apostrophe-plus-formula text must use the same doubling convention.

The importer must also accept legacy `gender` as an Italian-gender alias and report conflicts with `italian_gender`. Exports always use the separate gender columns.

Duplicate matching follows the current library policy: compare the Italian–Greek pair after Unicode NFC normalization, case folding and surrounding whitespace trimming; accents and articles remain significant. Export preserves every entry, including distinct meanings with matching pairs. Planned import previews duplicates within the upload and existing library, then revalidates at confirmation, imports valid nonduplicate rows and skips matching pairs without overwriting. Consequently, reimporting into the same library adds no entries, and importing into an empty library may skip distinct meanings sharing a matching pair. Review previews before confirming; use a database backup when every identity and meaning must be restored.
