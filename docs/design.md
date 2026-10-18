# Italian Notebook v1 decisions

The supplied product brief defines the initial release, delivered in stages. Future features remain deferred. Frontend code uses JavaScript and JSX; the backend uses Python with PostgreSQL persistence.

## Learners and vocabulary

- Everyone admitted through the shared password gate may select any profile and edit the shared vocabulary library.
- Each entry expresses one meaning. Matching text in one language may occur in multiple entries.
- Italian and Greek grammatical gender are independent optional fields.
- Each entry has at most one optional unit and any number of tags; word type is separate.
- Units have a stable code preserving leading zeros, a display title, and an explicit sort order. Entries without a unit display as "No unit".
- Optional pronunciation information is editable text revealed after the answer; audio and text-to-speech remain deferred.
- Place all ten initial sample vocabulary entries in Unit 00, "Benvenuti". Create Unit 01, "Un nuovo inizio", initially empty.
- Filters match any selected value within a group and require every selected group to match.
- Permanent deletion is allowed only for entries with no reviews. Explain the restriction when reviews exist.
- CSV import previews new cards, field updates, unchanged duplicates, invalid rows and proposed tags before confirmation. Match existing cards by their normalized Italian–Greek pair and update only changed supplied fields, preserving practice history and statistics. Omitted optional columns preserve stored values; blank cells clear optional fields. Multiple existing matches are row errors.
- Duplicate matching normalizes surrounding whitespace, Unicode, and case, preserves accents, and compares both Italian and Greek text.
- CSV uses italian_gender and greek_gender; legacy gender is an alias for italian_gender. Conflicting values are row errors.

## Practice

- Switching direction keeps the selected queue, hides the current answer, and applies to unanswered cards. Record each rating against the direction actually tested.
- If fewer entries match than requested, use the available entries and explain the shortfall. If none match, offer changing the selection. Never repeat entries to fill a session.
- Session entries retain the wording selected at the start; reviews preserve that wording. Edits affect future sessions while progress remains attached to the same entry. A changed meaning requires a new entry.
- Review submissions are idempotent per session card. Disable repeated taps while saving and advance only after confirmation. If a response is lost, retry the same submission; keep the revealed card and selected rating on failure.
- Leaving or reloading ends practice; v1 has no resume feature. Submitted reviews remain saved, and starting again creates a fresh queue.
- A connection failure keeps the current card available for retry while the page remains open.
- Difficulty is a weighted average of Again = 1, Hard = 0.5, Easy = 0. Each older review has 80% of the weight of the next newer review. A score of at least 0.5 qualifies as difficult; unreviewed entries have no score.
- Difficulty changes when reviews arrive, not merely when time passes. Waiting does not reduce difficulty.
- Mixed review targets 40% difficult, 30% reviewed in the last seven days, and 30% random entries, all in the selected direction. Remove overlaps, fill shortages from the remaining library, and shuffle without repeating entries.
- The summary labels (Hard + Easy) / submitted reviews as "Remembered this session". It makes no mastery claim.
- Overall unique entries practised counts each entry once across both directions; direction-specific views count it separately in each direction. Unit and word-type summaries show review counts, rating distributions, and entries practised rather than completion percentages.
- "Practice Again" returns to practice setup so the learner chooses again and receives a fresh selection. Entries may recur across sessions, but never within one session. "Review Difficult Words" starts setup for difficult-entry practice with the current profile and direction.

## Settings

- Interface language is selectable between Greek, English, and Italian, defaults to Greek, and is stored per device independently of learning direction.
- Motion preference is per device and always respects the operating system's reduced-motion setting.
- Preferred direction and default session size follow the learner profile across devices. Default session size is 25.
- Seed Foteini and Spyros with Greek to Italian as their preferred direction; new profiles default to this direction and may change it.

## Deployment

- Railway runs one application Docker service serving the React build and FastAPI API on the same origin, plus a separate privately connected PostgreSQL service.
- Railway supplies HTTPS. Docker Compose remains the local development setup.
- A shared-password entry screen with a secure session cookie protects UI data and API access. Configuration supplies the password; profiles are not authenticated identities.
- Deployment instructions require opt-in daily PostgreSQL-volume backups and document manual backup and restoration.

## Status

All interview choices are resolved. Awaiting the user's confirmation of shared understanding before implementation begins. This document records refinements to the supplied product brief; the brief's other v1 requirements remain in scope.

## Localization for later screens

Every later ticket must localize its added interface text in Greek, English, and Italian. Add matching keys to `frontend/src/copy.js` and use the shell-provided `text` dictionary, including accessible labels, status messages, validation, and errors. Keep learner names and vocabulary content as entered. The shell sets the document language; interface language never changes a learner's learning direction. Use system sans-serif and Georgia/serif fallbacks that support Greek and accented Italian, flexible widths, wrapped labels, and at least 44px interaction targets. Device motion and OS reduced motion apply globally, including future transitions and animations.
