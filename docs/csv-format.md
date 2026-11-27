# Vocabulary CSV format

Lexi exchanges vocabulary through four formats: **v1** (the aggregate library export), **v2** (language-ID-keyed Collection exchange), **v3** (lossless v2 plus a versioned metadata cell), and **simple** (a Base/Learning vocabulary template). All use UTF-8 with a BOM (read as `utf-8-sig`), comma delimiters, CRLF record separators, a header row, and double quotes around every field. Quotes inside fields are doubled; commas and embedded newlines remain data. Unicode is preserved without normalization. An empty library still returns only the header.

Collection-scoped export defaults to v2 and can request v3 with `GET /api/vocabulary/export.csv?collection_id=…&format=v3`; the aggregate library export stays v1 unless `format=v2` or `format=v3` is supplied. Downloadable templates come from `GET /api/imports/example?format=simple|v2|v3`, optionally scoped by `collection_id` or an explicit language pair. “v2/v3” name file formats; they are independent of the unpublished v1.4.0 work label.

Ready-to-import manual fixtures for v1 and v2 (`en/da`, `en/el` and reversed `it/el`, plus a v1 sample) are in [`data/v140-csv-tests/`](../data/v140-csv-tests/).

## Version 1 columns

Version 1 orders entries by Italian text and entry ID.

| Column | Meaning |
| --- | --- |
| `italian`, `greek` | Required expression and equivalent, one meaning per row. |
| `word_type` | `noun`, `verb`, `adjective`, `adverb`, `expression`, or `other`. |
| `italian_gender`, `greek_gender` | Required noun genders on save: Italian `masculine`, `feminine`; Greek `masculine`, `feminine`, `neuter`. Blank is invalid for noun saves. Unresolved legacy `common` is rejected for Italian/Greek and exports blank for correction; Danish `common` is a real value and is only valid in a Danish grammar cell. |
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

Every exported row carries `csv_format=italian-notebook-v2`. The header is scoped to the destination Collection's unordered pair, so an `en/da` export contains `text_en`, `text_da`, `grammar_en` and `grammar_da` rather than columns for every curated language. Historical registry-wide v2 files remain importable: the importer reads the columns named after each card's explicit language IDs and ignores unused text/grammar columns. Reversed pair order is accepted because the pair is unordered and text is never inferred from position. See the [multilingual acceptance matrix](multilingual-acceptance.md) for the tested round-trip rules.

| Column | Meaning |
| --- | --- |
| `csv_format` | `italian-notebook-v2`; identifies reversible escaping and JSON `tags`/`grammar_*` cells. |
| `entry_id`, `collection_id`, `collection_name` | Stable card and Collection identity plus a readable Collection name. Keeping `entry_id` on a round trip preserves the card, its references, wording snapshots and learning progress. `collection_id`/`collection_name` are metadata, never import instructions. |
| `source_language`, `target_language` | The Collection's unordered language pair; reversed order is accepted. When present they must match the destination pair. |
| `card_source_language`, `card_target_language` | The card's own language IDs. Required on import and checked against the destination pair. |
| `text_<lang>` | One primary text per card language in the file. Both card languages are required; texts are never inferred from column order or from `italian`/`greek` position. |
| `word_type`, `notes`, `unit_*` | Common fields, with the same meaning and constraints as v1. |
| `grammar_<lang>` | One optional cell per language in the file, populated only for languages with a grammar definition (`it`, `el`, `da`). Keys are defined by `backend/app/grammar_definitions.json`; all keys, types, allowed values and length limits come from that configuration, which also drives the structured card store and rendered form. Unknown keys, wrong types and invalid values are preview row errors. Languages without a definition use common fields only and reject submitted grammar. |
| `tags` | JSON array of tag names, as in v1. |

A v2 row validates both texts, the Collection pair and the card pair before it can be previewed. Missing texts, a wrong-pair destination, grammar for a language outside the card, conflicting legacy aliases, and unknown `csv_format` values are preview row errors. Italian/Greek storage columns keep their canonical `italian`/`greek` values regardless of pair order, while grammar JSON keeps language IDs. Danish grammar is structured-only: `gender` (`common` or `neuter`), `plural`, `example` and `pronunciation` live in the card's `grammar` JSON and carry no new vocabulary columns. Spreadsheet escaping, Unicode fidelity, the 1 MiB / 2000-row limits and preview-before-confirm rules are identical to v1.

## Simple vocabulary template

`lexi-simple-v1` is the manual, language-agnostic start point. Its columns are `csv_format`, `base`, `learning`, `word_type`, `notes` and `tags`. `base` is the text in **Base language** (Γλώσσα αναφοράς) and `learning` is the text in **Learning language** (Γλώσσα εκμάθησης). It contains no language IDs: the import dialog remaps it to a scoped v2 file using the chosen destination orientation, so the same file works in either direction of a pair. Both texts and `word_type` are required. The importer also accepts a `lexi-simple-v1` row directly when the destination pair is explicit.

## Version 3: lossless exchange

`italian-notebook-v3` adds `schema_version` and `metadata` beside the scoped v2 columns. `schema_version` is the grammar definition version (`1`); `metadata` is a JSON object whose only supported key is `grammar`. The grammar map is keyed by language ID and preserves the full structured cell, including Danish fields that have no legacy column. Unknown metadata keys, an unsupported schema version, malformed JSON, invalid grammar values, grammar for a language outside the card, and a `grammar_*` cell that disagrees with the metadata are row errors rather than silently dropped or overwritten data. v3 is read-only input and output for advanced round trips; it never changes card identity, progress or permissions.

## Reviewing an import

The import dialog first asks for a destination: an existing allowed Collection or a new one. A new Collection starts empty unless a source Collection supplies its orientation; otherwise Base and Learning must be selected explicitly from the searchable registry pickers. Format detection recognises v1, v2, v3 and simple files, and the dialog shows the detected format plus the Base→Learning mapping before validation. Destination changes clear the preview; closing the dialog discards its transient file, settings and preview, so reopening starts fresh.

The inline preview shows 10 rows per page, with filters for valid rows (including updates), duplicates and errors. Pagination and filters only change what is displayed: confirmation submits the complete selected CSV and the server rechecks every row. Preview and confirmation share the same parser and validation, so an error shown in the preview cannot be bypassed. Changing the destination or file clears the preview; late validation responses cannot restore a cancelled or replaced preview.

Confirmation closes the preview and shows progress followed by a green completion banner or a red error banner. Database import uses a server transaction and has no safe cancellation endpoint. Cancellation and file/settings changes are disabled during confirmation; aborting a browser request would not undo committed writes. On a connection failure the result may be unknown; the file and preview remain available in the open dialog for an explicit retry, and the server rechecks existing pairs using the same duplicate/update rules. No partial import is reported as cancelled or complete.

Pronunciation is displayed exactly as supplied, including hyphens and stress marks. For newly authored vocabulary, prefer readable cues with hyphens and marked stress, for example `αμπ-μπι-νά-ρε` for `abbinare`. This is a content convention, never an automatic transformation; existing CSV text is not transliterated, resegmented or stripped of hyphens.

## Spreadsheet safety and text fidelity

CSV quoting alone does not prevent spreadsheet formulas. Every exported cell is prefixed with an apostrophe if it starts with an apostrophe, tab, CR or LF, or its first non-whitespace character is `=`, `+`, `-`, `@` (including their full-width forms). The prefix makes the value text in spreadsheet imports. Literal initial apostrophes are doubled so escaping is reversible. Tags are first encoded as JSON, whose initial `[` makes the whole cell text; tag names are not individually modified.

Import through the spreadsheet's text/CSV dialog and choose **Text** for all columns, particularly `unit_code`. CSV has no type information, and opening it directly may convert `007` to `7` even when quoted. Keep the original downloaded file for reuse; spreadsheet resaving may remove escaping, leading zeros or accents. Do not remove safety prefixes before opening in a spreadsheet.

Required adjective main-form gender metadata uses `italian_adjective_gender` (masculine/feminine) and `greek_adjective_gender` (masculine/feminine/neuter). These describe the singular main entry independently of noun gender. There are no defaults or inferred genders. New adjective rows require both selectors; a CSV update may omit them only if the existing card has valid stored genders. Missing legacy values require correction, and blank selectors are row errors. Forms use `italian_masculine_singular`, `italian_masculine_plural`, `italian_feminine_singular`, `italian_feminine_plural`, and the six Greek counterparts for masculine, feminine and neuter. Each form accepts up to 500 characters, including identical/invariable forms. Greek forms are nominative. No forms are generated, and combined Greek translations are never split. Card/form ordering starts with the selected gender's plural, then the other genders' singular/plural pairs; the selected singular is not repeated. Gender changes preserve stored forms under their original labels and never overwrite main text.

The original column names and aliases remain accepted. For new noun/adjective rows or legacy rows with missing gender, supply the appropriate Italian and Greek gender columns; other categories need neither. Both pronunciation fields and all additional forms are optional; missing compatible columns preserve values on update. Saving a row clears grammar incompatible with its part of speech. Generic noun plurals are never reinterpreted as adjective forms.

## Compatibility with import

Upload the original exported CSV, preview it, then explicitly confirm. The importer accepts all supported headers, restores escaped text on any row with a recognised `csv_format` marker (v1, v2, v3 or simple), and reads `tags` as a JSON array. It strips exactly one initial apostrophe only when the remainder starts with an apostrophe, tab, CR or LF, or its first non-whitespace character is one of the formula markers above. Thus `'=1+1` restores `=1+1` and `''ordinary` restores `'ordinary`. Decode happens before validation and duplicate detection. Unknown format versions and non-array/non-string JSON tags produce row errors.

Hand-written files omit `csv_format`: they keep the existing pipe-separated tags convention and literal apostrophes, with no safety decoding. Import also accepts legacy `type`, `unit`, `plural`, `example` and `gender` aliases; conflicting explicit and alias values are row errors. These aliases apply to v1 and unversioned files only; v2/v3 reject them as row errors. Export uses canonical columns: language-named fields in v1 and language-ID fields in v2/v3.

A v2/v3 file can be imported through either workspace. Its `entry_id` and language IDs are used only after the destination pair and both texts validate. Re-importing the same `entry_id` into another Collection with the same language pair adds a reference without changing identity or progress, while the same texts without an ID create a distinct card. Matching otherwise compares the card's language-ID-keyed texts after NFC normalization, case folding and whitespace trimming, so changing column order cannot silently match a different language.

For v1 and unversioned files, matching compares the Italian–Greek pair after Unicode NFC normalization, case folding and surrounding whitespace trimming; v2/v3 use the language-ID-keyed rule above. Accents and articles remain significant. Export preserves every entry, including distinct meanings with matching pairs. Import inserts new pairs, updates changed supplied fields on uniquely matching cards and skips unchanged rows. Missing optional columns preserve existing values; blank cells clear optional fields. Tags compare as sets. Existing card IDs, practice history and statistics are preserved. If multiple existing cards match the pair, the row is an error and must be edited individually. Preview simulates updates within the file; confirmation rechecks the current library. Choose a required destination Collection (or a legacy Unit ID mapped to one) before previewing or importing. Every new or updated card uses that destination; CSV `unit_*` columns are compatibility metadata and do not create or select a destination. Imports do not recreate units. Review previews before confirming; use a database backup when every identity and meaning must be restored.

Export has no entry-count limit. Import retains its 1 MiB / 2000-row limits; larger exports must be split into smaller CSV files retaining the header and format marker before import. An empty-library export contains only a header and has no rows to import.
