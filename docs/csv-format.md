# Vocabulary CSV format

Both versions use UTF-8 with a BOM (read as `utf-8-sig`), comma delimiters, CRLF record separators, a header row, and double quotes around every field. Quotes inside fields are doubled; commas and embedded newlines remain data. Unicode is preserved without normalization. An empty library still returns only the header. Collection-scoped exports use CSV v2; the aggregate library export and `format=v1` remain version 1.

## Version 1 columns

Version 1 orders entries by Italian text and entry ID.

| Column | Meaning |
| --- | --- |
| `italian`, `greek` | Required expression and equivalent, one meaning per row. |
| `word_type` | `noun`, `verb`, `adjective`, `adverb`, `expression`, or `other`. |
| `italian_gender`, `greek_gender` | Required noun genders on save: Italian `masculine`, `feminine`; Greek also `neuter`. Blank is invalid for noun saves. `common` is rejected on import; legacy stored values export blank for correction. |
| `unit_code` | Unit code as text, including leading zeros (`00`, `007`); blank means No unit. |
| `unit_title`, `unit_sort_order` | Optional unit display title and integer order; blank without a unit. |
| `tags` | JSON array of tag names, e.g. `["cibo", "καφές"]`; `[]` means none. JSON safely preserves commas, quotes, semicolons and Unicode in names. |
| `italian_plural`, `greek_plural` | Optional plurals. |
| `italian_example`, `greek_example` | Optional examples, including multiline text. |
| `notes` | Retained for legacy data exchange. Not shown or editable in the card UI. |
| `pronunciation`, `greek_pronunciation` | Independent free-text pronunciation for Italian and Greek. `pronunciation` retains its legacy Italian meaning; notation/alphabet is unrestricted. |
| `csv_format` | `italian-notebook-v1` on every exported row, identifying reversible escaping and JSON tags. |

Absent optional text is blank. IDs, timestamps and learner records are omitted: this is a reusable vocabulary exchange, not a database backup.

## Version 2: language-ID-keyed columns

CSV v2 is the exchange format for every Collection, including `it/el`. Every exported row carries `csv_format=italian-notebook-v2`. Request it explicitly with `GET /api/vocabulary/export.csv?collection_id=…&format=v2`; a Collection-scoped export uses v2 by default. The aggregate library export stays v1 unless `format=v2` is supplied. “v2” names this file format only: it was introduced in the v1.4.0 release, but v1 files remain importable and the two version numbers are independent. Card language IDs are fixed at creation; a file that changes them is rejected rather than silently remapped. See the [multilingual acceptance matrix](multilingual-acceptance.md) for the tested round-trip rules.

| Column | Meaning |
| --- | --- |
| `csv_format` | `italian-notebook-v2`; identifies reversible escaping and JSON `tags`/`grammar_*` cells. |
| `entry_id`, `collection_id`, `collection_name` | Stable card and Collection identity plus a readable Collection name. Keeping `entry_id` on a round trip preserves the card, its references, wording snapshots and learning progress. `collection_id`/`collection_name` are metadata, never import instructions. |
| `source_language`, `target_language` | The Collection's unordered language pair; reversed order is accepted. When present they must match the destination pair. |
| `card_source_language`, `card_target_language` | The card's own language IDs. Required on import and checked against the destination pair. |
| `text_<lang>` | One primary text per language ID (`text_da`, `text_el`, `text_en`, `text_it`). Both card languages are required; texts are never inferred from column order or from `italian`/`greek` position. |
| `word_type`, `notes`, `unit_*` | Common fields, with the same meaning and constraints as v1. |
| `grammar_<lang>` | Optional JSON object for a language with a grammar definition (`it`, `el`). Keys are `gender`, `plural`, `example`, `pronunciation`, `adjective_gender` and a nested `forms` object keyed by form name; unknown keys or invalid genders are row errors. Languages without a definition use common fields only. |
| `tags` | JSON array of tag names, as in v1. |

A v2 row validates both texts, the Collection pair and the card pair before it can be previewed. Missing texts, a wrong-pair destination, grammar for a language outside the card, conflicting legacy aliases, and unknown `csv_format` values are preview row errors. Italian/Greek storage columns keep their canonical `italian`/`greek` values regardless of pair order, while grammar JSON keeps language IDs. Spreadsheet escaping, Unicode fidelity, the 1 MiB / 2000-row limits and preview-before-confirm rules are identical to v1.

The standard Vocabulary import still offers `el`/`it` defaults and accepts both v1 and v2 files for that pair. The Collections workspace exposes import destinations for every supported Collection pair, so `en/da`, `en/el`, `it/el` and their reversed orders can be round-tripped without changing the stateless Vocabulary importer defaults.

## Reviewing an import

The inline preview shows 10 rows per page, with filters for valid rows (including updates), duplicates and errors. Pagination and filters only change what is displayed: confirmation submits the complete selected CSV and the server rechecks every row. Close hides the preview while retaining the file and settings; reopen displays the saved preview. Cancel before confirmation aborts validation and clears the file, report and destination selection. Late validation responses cannot restore a cancelled or replaced preview.

Confirmation closes the preview and shows progress followed by a green completion banner or a red error banner. Database import uses a server transaction and has no safe cancellation endpoint. Cancellation and file/settings changes are disabled during confirmation; aborting a browser request would not undo committed writes. On a connection failure the result may be unknown; the retained file and preview allow a retry, and the server rechecks existing pairs using the same duplicate/update rules.

Pronunciation is displayed exactly as supplied, including hyphens and stress marks. For newly authored vocabulary, prefer readable cues with hyphens and marked stress, for example `αμπ-μπι-νά-ρε` for `abbinare`. This is a content convention, never an automatic transformation; existing CSV text is not transliterated, resegmented or stripped of hyphens.

## Spreadsheet safety and text fidelity

CSV quoting alone does not prevent spreadsheet formulas. Every exported cell is prefixed with an apostrophe if it starts with an apostrophe, tab, CR or LF, or its first non-whitespace character is `=`, `+`, `-`, `@` (including their full-width forms). The prefix makes the value text in spreadsheet imports. Literal initial apostrophes are doubled so escaping is reversible. Tags are first encoded as JSON, whose initial `[` makes the whole cell text; tag names are not individually modified.

Import through the spreadsheet's text/CSV dialog and choose **Text** for all columns, particularly `unit_code`. CSV has no type information, and opening it directly may convert `007` to `7` even when quoted. Keep the original downloaded file for reuse; spreadsheet resaving may remove escaping, leading zeros or accents. Do not remove safety prefixes before opening in a spreadsheet.

Required adjective main-form gender metadata uses `italian_adjective_gender` (masculine/feminine) and `greek_adjective_gender` (masculine/feminine/neuter). These describe the singular main entry independently of noun gender. There are no defaults or inferred genders. New adjective rows require both selectors; a CSV update may omit them only if the existing card has valid stored genders. Missing legacy values require correction, and blank selectors are row errors. Forms use `italian_masculine_singular`, `italian_masculine_plural`, `italian_feminine_singular`, `italian_feminine_plural`, and the six Greek counterparts for masculine, feminine and neuter. Each form accepts up to 500 characters, including identical/invariable forms. Greek forms are nominative. No forms are generated, and combined Greek translations are never split. Card/form ordering starts with the selected gender's plural, then the other genders' singular/plural pairs; the selected singular is not repeated. Gender changes preserve stored forms under their original labels and never overwrite main text.

The original column names and aliases remain accepted. For new noun/adjective rows or legacy rows with missing gender, supply the appropriate Italian and Greek gender columns; other categories need neither. Both pronunciation fields and all additional forms are optional; missing compatible columns preserve values on update. Saving a row clears grammar incompatible with its part of speech. Generic noun plurals are never reinterpreted as adjective forms.

## Compatibility with import

Upload the original exported CSV in Vocabulary, preview it, then explicitly confirm. The importer accepts all exported headers, restores escaped text only on rows marked `csv_format=italian-notebook-v1`, and reads their `tags` as a JSON array. It strips exactly one initial apostrophe only when the remainder starts with an apostrophe, tab, CR or LF, or its first non-whitespace character is one of the formula markers above. Thus `'=1+1` restores `=1+1` and `''ordinary` restores `'ordinary`. Decode happens before validation and duplicate detection. Unknown format versions and non-array/non-string JSON tags produce row errors.

Hand-written files and the downloadable import example omit `csv_format`: they keep the existing pipe-separated tags convention and literal apostrophes, with no safety decoding. Use the versioned format to exchange tags containing literal pipes. Import also accepts legacy `type`, `unit`, `plural`, `example` and `gender` aliases; conflicting explicit and alias values are row errors. These aliases apply to v1 and unversioned files only; v2 rejects them as row errors. Export uses canonical columns: language-named fields in v1 and language-ID fields in v2.

A v2 file can be imported through either workspace. Its `entry_id` and language IDs are used only after the destination pair and both texts validate. Re-importing the same `entry_id` into another Collection with the same language pair adds a reference without changing identity or progress, while the same texts without an ID create a distinct card. Matching otherwise compares the card's language-ID keyed texts after NFC normalization, case folding and whitespace trimming, so changing column order cannot silently match a different language.

Matching compares the Italian–Greek pair after Unicode NFC normalization, case folding and surrounding whitespace trimming; accents and articles remain significant. Export preserves every entry, including distinct meanings with matching pairs. Import inserts new pairs, updates changed supplied fields on uniquely matching cards and skips unchanged rows. Missing optional columns preserve existing values; blank cells clear optional fields. Tags compare as sets. Existing card IDs, practice history and statistics are preserved. If multiple existing cards match the pair, the row is an error and must be edited individually. Preview simulates updates within the file; confirmation rechecks the current library. Choose a required destination unit before previewing or importing. Every new or updated card uses that destination; mismatching CSV unit metadata is flagged in preview. Imports do not create units from CSV metadata. Review previews before confirming; use a database backup when every identity and meaning must be restored.

Export has no entry-count limit. Import retains its 1 MiB / 2000-row limits; larger exports must be split into smaller CSV files retaining the header and format marker before import. An empty-library export contains only a header and has no rows to import.
