# Vocabulary CSV format

Export uses UTF-8 with a BOM (read as `utf-8-sig`), comma delimiters, CRLF record separators, a header row, and double quotes around every field. Quotes inside fields are doubled; commas and embedded newlines remain data. Unicode is preserved without normalization. Entries are ordered by Italian text and entry ID. An empty library still returns the header.

| Column | Meaning |
| --- | --- |
| `italian`, `greek` | Required expression and equivalent, one meaning per row. |
| `word_type` | `noun`, `verb`, `adjective`, `adverb`, `expression`, or `other`. |
| `italian_gender`, `greek_gender` | Independent `masculine`, `feminine`, `neuter`, or blank. |
| `unit_code` | Unit code as text, including leading zeros (`00`, `007`); blank means No unit. |
| `unit_title`, `unit_sort_order` | Optional unit display title and integer order; blank without a unit. |
| `tags` | JSON array of tag names, e.g. `["cibo", "καφές"]`; `[]` means none. JSON safely preserves commas, quotes, semicolons and Unicode in names. |
| `italian_plural`, `greek_plural` | Optional plurals. |
| `italian_example`, `greek_example` | Optional examples, including multiline text. |
| `notes`, `pronunciation` | Optional notes and pronunciation text. |
| `csv_format` | `italian-notebook-v1` on every exported row, identifying reversible escaping and JSON tags. |

Absent optional text is blank. IDs, timestamps and learner records are omitted: this is a reusable vocabulary exchange, not a database backup.

## Spreadsheet safety and text fidelity

CSV quoting alone does not prevent spreadsheet formulas. Every exported cell is prefixed with an apostrophe if it starts with an apostrophe, tab, CR or LF, or its first non-whitespace character is `=`, `+`, `-`, `@` (including their full-width forms). The prefix makes the value text in spreadsheet imports. Literal initial apostrophes are doubled so escaping is reversible. Tags are first encoded as JSON, whose initial `[` makes the whole cell text; tag names are not individually modified.

Import through the spreadsheet's text/CSV dialog and choose **Text** for all columns, particularly `unit_code`. CSV has no type information, and opening it directly may convert `007` to `7` even when quoted. Keep the original downloaded file for reuse; spreadsheet resaving may remove escaping, leading zeros or accents. Do not remove safety prefixes before opening in a spreadsheet.

## Compatibility with import

Upload the original exported CSV in Vocabulary, preview it, then explicitly confirm. The importer accepts all exported headers, restores escaped text only on rows marked `csv_format=italian-notebook-v1`, and reads their `tags` as a JSON array. It strips exactly one initial apostrophe only when the remainder starts with an apostrophe, tab, CR or LF, or its first non-whitespace character is one of the formula markers above. Thus `'=1+1` restores `=1+1` and `''ordinary` restores `'ordinary`. Decode happens before validation and duplicate detection. Unknown format versions and non-array/non-string JSON tags produce row errors.

Hand-written files and the downloadable import example omit `csv_format`: they keep the existing pipe-separated tags convention and literal apostrophes, with no safety decoding. Use the versioned format to exchange tags containing literal pipes. Import also accepts legacy `type`, `unit`, `plural`, `example` and `gender` aliases; conflicting explicit and alias values are row errors. Export uses the canonical columns and separate gender fields.

Duplicate matching compares the Italian–Greek pair after Unicode NFC normalization, case folding and surrounding whitespace trimming; accents and articles remain significant. Export preserves every entry, including distinct meanings with matching pairs. Import previews duplicates within the upload and existing library, then revalidates at confirmation, imports valid nonduplicate rows and skips matching pairs without overwriting. Consequently, reimporting into the same library adds no entries, and importing into an empty library may skip distinct meanings sharing a matching pair. Existing unit metadata must match. Review previews before confirming; use a database backup when every identity and meaning must be restored.

Export has no entry-count limit. Import retains its 1 MiB / 2000-row limits; larger exports must be split into smaller CSV files retaining the header and format marker before import. An empty-library export contains only a header and has no rows to import.
