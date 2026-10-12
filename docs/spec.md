## Problem Statement

Foteini and Spyros need an enjoyable mobile vocabulary practice tool for learning Italian from Greek, with support for learners studying Greek from Italian. They need a shared, editable vocabulary library, separate learning records for each learner and learning direction, and a reliable way to revisit difficult entries. The application must work comfortably during connected commutes, preserve submitted reviews, and be straightforward to host on Railway.

## Solution

Build Italian Notebook, a polished mobile-first flashcard web application with real PostgreSQL persistence. Learners enter through a shared-password gate, select a learner profile, choose a practice session and learning direction, reveal answers, and submit Again, Hard, or Easy ratings. A shared vocabulary library supports manual editing and previewed CSV import/export. Understandable progress summaries help learners identify difficult entries without claiming mastery. Deliver the complete v1 in stages, with three interface languages, basic PWA installation, automated tests, and production deployment instructions.

## User Stories

1. As a learner, I want to enter through a shared-password screen, so that the application is restricted to our trusted group.
2. As a learner, I want to select Foteini, Spyros, or another learner profile, so that reviews contribute to the intended learner's progress.
3. As a learner, I want to create an additional learner profile, so that another person can practise independently.
4. As a learner, I want to switch profiles and have my last selection remembered on this device, so that starting practice is convenient.
5. As a learner, I want to choose Greek, English, or Italian interface language, so that navigation and instructions are understandable.
6. As a learner, I want interface language to be independent of learning direction, so that changing the translation exercise does not change navigation.
7. As a learner, I want my preferred direction and default session size to follow my profile, so that my preferences work across devices.
8. As a mobile learner, I want a calm notebook-like interface with readable Greek and Italian typography, so that practice is pleasant and legible.
9. As a mobile learner, I want large buttons, bottom navigation, and no horizontal overflow, so that I can use the application comfortably with one hand.
10. As a desktop learner, I want usable responsive navigation and keyboard controls, so that I can practise without touch gestures.
11. As a learner using assistive technology, I want meaningful labels, focus states, and accessible card controls, so that I can complete every practice action.
12. As a learner sensitive to animation, I want reduced motion respected, so that card transitions remain comfortable.
13. As a learner, I want a home page with a greeting, current profile, vocabulary count, recent summary, and practice actions, so that my next action is clear.
14. As a learner, I want Home, Practice, Vocabulary, Progress, and Settings navigation, so that I can find the main features.
15. As a learner, I want to choose profile, practice type, direction, and session size before starting, so that the exercise matches my intention.
16. As a learner, I want random practice from the shared library, so that I can encounter varied vocabulary.
17. As a learner, I want category practice combining units, word types, and tags, so that I can focus on a teaching chapter or theme.
18. As a learner, I want difficult-entry practice based on my reviews in the selected direction, so that I practise what I find hard.
19. As a learner, I want mixed review combining difficult, recent, and random entries, so that practice balances reinforcement and variety.
20. As a learner, I want session sizes of 10, 25, 50, or All, so that practice fits the available time.
21. As a learner, I want a smaller session explained when too few entries qualify, so that I understand the actual card count.
22. As a learner, I want helpful guidance when no entries match, so that I can adjust my selection.
23. As a learner, I want each entry to appear at most once within a session, so that requested session length does not conceal repetitions.
24. As a learner, I want shuffled session order, so that I do not rely on a predictable sequence.
25. As a learner, I want Italian-to-Greek and Greek-to-Italian practice from the same vocabulary entry, so that the library does not need duplicate records.
26. As a learner, I want a tap or keyboard action to reveal the translation, so that I can attempt recall before seeing the answer.
27. As a learner, I want answer-side plurals, genders, examples, notes, and pronunciation text, so that I can learn more than the translation.
28. As a learner, I want answer-giving grammatical hints hidden before reveal, so that the exercise tests recall fairly.
29. As a learner, I want to switch direction during practice without replacing the queue, so that I can change the exercise while retaining my selected vocabulary.
30. As a learner, I want a direction switch to hide the current answer again, so that the new prompt can be tested fairly.
31. As a learner, I want Again, Hard, and Easy ratings available after reveal, so that I can report how well I recalled the answer.
32. As a learner, I want flipping alone to leave progress unchanged, so that only submitted reviews affect my learning record.
33. As a learner, I want each review attributed to the profile, entry, and direction actually tested, so that progress remains accurate.
34. As a learner, I want the card to advance only after a confirmed save, so that a network problem does not silently lose my review.
35. As a learner, I want repeated taps and retries to save one review, so that statistics do not double-count my answer.
36. As a learner, I want a failed save to retain the revealed card and selected rating for retry, so that I can recover while the page remains open.
37. As a learner, I want learner name, practice type, direction, progress, card count, and an exit action visible, so that I understand my session state.
38. As a learner, I want submitted reviews preserved when I leave or reload, so that interruption does not erase completed practice.
39. As a learner, I want a fresh practice setup after interruption rather than a resume requirement, so that v1 stays simple.
40. As a learner, I want a summary of reviewed entries and rating counts, so that I can understand the session result.
41. As a learner, I want a clearly labelled Remembered this session percentage, so that I can distinguish recall in this session from mastery.
42. As a learner, I want the summary to identify entries needing more practice, so that I can choose useful follow-up work.
43. As a learner, I want Practice Again to return to setup, so that I choose the next exercise rather than replaying the same queue automatically.
44. As a learner, I want Review Difficult Words and Return Home actions, so that I can continue or finish easily.
45. As a learner, I want overall and direction-specific review statistics, so that I can see differences between recognition and recall.
46. As a learner, I want unit and word-type progress summaries without mastery percentages, so that the metrics remain understandable.
47. As a library editor, I want to browse, paginate, and search Italian and Greek text, so that I can find an entry efficiently.
48. As a library editor, I want combinable unit, word-type, and tag filters, so that I can inspect relevant vocabulary.
49. As a library editor, I want to add and edit vocabulary with clear validation, so that I can maintain accurate entries on a phone.
50. As a library editor, I want separate Italian and Greek genders and plurals, so that different grammatical systems are represented correctly.
51. As a library editor, I want one meaning per entry and repeated text allowed for different meanings, so that ambiguous expressions are teachable.
52. As a library editor, I want warnings about matching Italian-Greek pairs, so that I avoid accidental duplicates.
53. As a library editor, I want to create units and tags without redeployment, so that the library can grow.
54. As a library editor, I want unit codes to preserve leading zeros and explicit order, so that textbook chapters display consistently.
55. As a library editor, I want to permanently delete accidental entries without reviews, so that I can correct mistaken additions.
56. As a library editor, I want deletion blocked and explained for reviewed entries, so that learning history is retained.
57. As a learner, I want the wording in my current session and past reviews retained when an entry is edited, so that history reflects what I was actually tested on.
58. As a library editor, I want UTF-8 CSV import with preview, validation, duplicate detection, and confirmation, so that bulk additions are reviewable.
59. As a library editor, I want invalid rows, duplicate skips, and proposed new units and tags shown before import, so that changes are predictable.
60. As a library editor, I want an import summary of imported, skipped, duplicate, and erroneous rows, so that I can correct remaining problems.
61. As a library editor, I want CSV imports never to overwrite entries automatically, so that existing vocabulary is safe.
62. As a library editor, I want CSV export preserving Greek accents and protecting against spreadsheet formulas, so that I can safely reuse my vocabulary.
63. As a learner, I want initial profiles, named units, and ten sample entries in Unit 00, so that I can try practice immediately.
64. As a mobile learner, I want to install the application on my home screen, so that it opens conveniently in standalone mode.
65. As a mobile learner, I want essential static assets cached and connection errors clearly explained, so that network limitations are understandable.
66. As an operator, I want one Railway application container and a private PostgreSQL service, so that deployment and persistence are straightforward.
67. As an operator, I want HTTPS, protected APIs, safe configuration, and no publicly exposed database, so that shared deployment has an appropriate access boundary.
68. As an operator, I want migrations, health checks, backups, restoration instructions, and reproducible local development, so that I can maintain the application reliably.

## Implementation Decisions

- Build a simple frontend/backend repository with a React, Vite, Tailwind CSS, React Router, TanStack Query, and Lucide React frontend using JavaScript, JSX, and ES modules. Use Python, FastAPI, SQLAlchemy 2.x, Alembic, Pydantic, and PostgreSQL for the backend. Choose current stable mutually compatible dependencies at implementation time. Add PropTypes where useful. Do not introduce TypeScript application files, configuration, or explicitly selected TypeScript-only dependencies.
- Organize around vocabulary management, CSV exchange, learner profiles and preferences, practice generation/submission, progress/scoring, shared access, and the mobile interface. Keep selection and difficulty calculations in backend services so future scheduling can replace them without duplicating vocabulary.
- Use the Italian Notebook design: background #E9F0E6, cards #FFFDF8, primary text #304F3A, secondary green #63836A, accent #53745B, borders #CAD9C6. Use sage for nouns, muted terracotta for verbs, dusty blue for adjectives, lavender for expressions, and warm neutral for other categories. Adjust individual treatments when contrast requires it. Use Greek/Italian-capable serif vocabulary typography and readable sans-serif controls, generous spacing, subtle shadows, rounded corners, and restrained animation.
- Build responsive home, practice setup, active practice, summary, vocabulary, progress, and settings experiences. Provide mobile bottom navigation and desktop navigation. Keep the profile switcher accessible. Use buttons for every essential interaction; swiping is optional. Support keyboard activation, screen readers, visible focus, accessible errors, sufficient contrast, and reduced motion.
- Provide Greek, English, and Italian UI translations, defaulting to Greek. Interface language and motion preferences are device-local; operating-system reduced motion always wins. Profile direction and default session size are persisted in PostgreSQL. Remember the last selected profile locally for convenience. Default size is 25 and direction is Greek to Italian.
- Seed Foteini and Spyros, Unit 00 Benvenuti, and Unit 01 Un nuovo inizio. Put all ten sample entries in Unit 00: la casa / το σπίτι; il libro / το βιβλίο; la chiave / το κλειδί; il gatto / η γάτα; il caffè / ο καφές; la cucina / η κουζίνα; il gelato / το παγωτό; essere / είμαι; avere / έχω; mi chiamo / με λένε. Use correct word types and confidently known plurals, with seed data separate from frontend rendering.
- Persist stable identifiers, foreign keys, relevant indexes, creation/update timestamps, profiles, vocabulary entries, units, tags, entry-tag relationships, practice sessions and their ordered cards, review events, and learning progress. Each learning-progress record is unique by profile, vocabulary entry, and learning direction. Use migrations and real PostgreSQL; local arrays must not substitute for persistence.
- A vocabulary entry holds required Italian text, Greek text, and word type; optional unit, separate Italian and Greek gender, separate plurals, separate examples, notes, and pronunciation text. Word types are noun, verb, adjective, adverb, expression, and other. Each entry belongs to at most one unit and any number of tags. Units have stable codes, titles, and sort order; preserve leading zeros. Display unassigned entries as No unit.
- An entry represents one meaning. Allow shared text in one language across entries; warn on matching Italian-Greek pairs. Compare pairs after Unicode normalization, case normalization, and trimming surrounding whitespace, retaining meaningful accents. Edits retain the entry's progress; a different meaning should be a new entry.
- Filters OR values within each group and AND the groups. Support search in both languages, pagination or efficient bounded loading, and mobile-friendly forms and library rows.
- Permanently delete only entries without reviews; return an explanatory conflict for reviewed entries. Protect this rule transactionally against concurrent review submission. Session cards retain wording snapshots so edits do not alter active prompts or historical reviews; deleting an unreviewed queued entry must not cascade away a session or make it unusable. Skip such a deleted entry with an explanation, adjusting the remaining card count; never save a review against a missing entry.
- Import UTF-8 CSV through preview and explicit confirmation. Support the brief's Italian, Greek, type, unit, plural, example, notes, and tags columns, plus separate italian_gender and greek_gender. Accept legacy gender as an Italian-gender alias; conflicting alias and explicit values are row errors. Document the tags encoding and supported optional pronunciation column consistently in the downloadable example and importer.
- Preview identifies invalid rows, matching pairs in the library or upload, and proposed new units/tags. On confirmation, import valid nonduplicate rows, skip duplicates, and report errors; never overwrite existing entries silently. Revalidate against current data at confirmation so stale preview cannot overwrite or double-import entries. Document the duplicate policy. Bound upload size, validate backend input, preserve Greek accents, and neutralize formula injection on export.
- Expose REST contracts for profile list/create/read/update; vocabulary list/create/read/update/delete; unit and tag list/create; vocabulary import and export; session create/read/review submission/summary; and per-profile progress and difficult entries. Use the brief's endpoint families, consistent validated responses, suitable HTTP status codes, and FastAPI API documentation. The import contract must support preview followed by explicit commit without writing vocabulary during preview.
- Practice setup selects profile, type, direction, and 10/25/50/All cards. Random practice samples the library; category practice applies filters; difficult practice uses the profile's reviewed entries with a qualifying score in the chosen direction. Never classify unreviewed entries as difficult. Explain reduced counts and handle zero matches without starting an unusable session.
- Mixed review targets 40% difficult, 30% recently reviewed in the preceding seven days, and 30% random, scoped to the selected direction where performance is used. Allocate whole-card quotas deterministically, remove overlaps, backfill shortages from remaining entries, and shuffle the resulting queue. Never repeat an entry within a session; repeats across sessions are allowed.
- Dynamically show front/back from the selected direction. The card has brand, unit and word-type labels, prominent prompt, and reveal affordance. The answer shows source and translation plus optional grammatical information, examples, notes, and pronunciation. Hide hints that disclose the answer before revealing it.
- Direction switching keeps the queue, hides the answer, and applies to the current unanswered card and subsequent cards. Disable direction changes while a review is saving, and submit the direction actually tested rather than a mutable preference.
- Ratings are Again (not recalled), Hard (recalled with difficulty), and Easy (recalled immediately). Allow ratings only after reveal. Every accepted review has stable identity, profile, entry identity, direction, rating, timestamp, session/card identity, and wording snapshot.
- Save review events and learning-progress updates in one transaction. Enforce one accepted submission per session card. Retrying the same submitted card returns its accepted result without adding another event; a conflicting second rating must not overwrite the first. Disable repeated taps, advance only after confirmed save, and keep the revealed card and selected rating available after failure.
- Persist submitted reviews and session records, but provide no session-resume feature in v1. Leaving or reloading ends the learner's practice flow; starting again creates a fresh queue. Do not rely on page-unload delivery to preserve accepted reviews. Transient network errors keep the current card available while the page remains open.
- Retain complete review history and aggregate review/rating counts, last reviewed time, difficulty, and recent performance independently by profile, entry, and direction. Define difficulty as the normalized weighted average of rating values Again = 1, Hard = 0.5, Easy = 0, with each successively older event weighted by a further factor of 0.8. At least one review and score >= 0.5 qualify an entry as difficult. Time passing alone does not alter the score. Document calculations and deterministic ordering for equal timestamps.
- Session summaries show total submitted reviews, each rating count, Remembered this session = (Hard + Easy) / total submitted reviews, and entries needing practice. Handle zero reviews without undefined percentages. Do not claim mastery. Practice Again returns to setup for a fresh choice and queue; Review Difficult Words opens difficult practice setup for the current profile/direction; Return Home exits the flow.
- Profile progress shows total reviews, unique entries practised, rating distribution, difficult entries, and breakdowns by unit, word type, and direction. Overall unique counts deduplicate entries across directions; direction-specific counts remain separate. Unit/type summaries show counts and distributions rather than mastery/completion percentages. Use compact visuals only where useful.
- Basic PWA support includes manifest, application icons, standalone display, and essential static-asset caching. Vocabulary and practice require connectivity. Protect the access gate when caching: do not cache authenticated vocabulary/API responses or make private data available after logout through a service worker. Explain connection failures; defer offline practice and synchronization.
- Deploy one multi-stage-built application Docker image serving the React build and FastAPI API on one origin, with separate private Railway PostgreSQL. Railway supplies HTTPS. Retain frontend/backend Docker build support and Docker Compose for local development with persistent database storage and health checks. Configure through environment variables and ship example configuration without secrets.
- Protect UI data and APIs with a shared-password entry screen and secure server-validated session cookies. Treat learner profiles as display identities, not authenticated accounts. Everyone admitted is trusted to edit the library and use all profiles. Protect state-changing cookie-authenticated requests against CSRF, rate-limit password attempts, keep secrets in deployment configuration, restrict CORS, validate inputs, and use SQLAlchemy safe queries. Do not publicly expose PostgreSQL.
- Document local development, PostgreSQL startup, migrations, frontend/backend startup, vocabulary import, production builds, Railway deployment and HTTPS, access-gate configuration, opt-in daily database-volume backups, manual backups, and restoration. Enable daily backups during deployment setup; demonstrate a restore procedure against disposable data.
- Implement in stages: persistence/models/migrations; vocabulary/profiles/CSV; design system/library; flashcards/sessions; review tracking/difficulty; progress/PWA/tests/deployment. Completion requires a working frontend connected to the backend, passing relevant tests, startup and deployment instructions, limitations, and next improvements.

## Testing Decisions

- Proposed test boundaries await the user's check before publication. There is no application code or existing test suite, so no prior testing seams can be reused.
- Prefer external behavior at two necessary public boundaries: FastAPI HTTP requests backed by a real disposable PostgreSQL database, and rendered React pages exercised through user interactions. Avoid tests of ORM internals, component state, hook structure, styling class strings, or private service methods.
- Use pytest API integration tests to cover vocabulary CRUD, validation, filters/pagination, profile preferences, unit/tag creation, deletion restrictions, retained session snapshots, CSV preview/commit/export, duplicate handling, malformed Unicode/input, and export formula safety. Assert preview performs no writes and confirm handles concurrent library changes.
- At the same API boundary test session types, shortage/empty behavior, no repeats, mixed quota/backfill behavior, profile/direction isolation, direction attribution, idempotent retries including lost responses and concurrent requests, transaction rollback, summaries, progress counts, and weighted difficulty outcomes. Inject deterministic randomness and time through a small test boundary where necessary, asserting visible results rather than implementation structure.
- Use Vitest and React Testing Library to exercise rendered flashcards and pages: reveal and keyboard behavior, hint concealment, direction switches, rating availability, saving/retry/advance, returning to setup rather than resuming, library search/filtering, form errors, CSV preview/confirmation, interface-language settings, profile switching, and accessible labels/focus behavior. Mock HTTP responses at the network boundary rather than internal hooks.
- Verify one connected acceptance journey against the running production container and PostgreSQL: enter the gate, choose a profile, add/import vocabulary, practise both directions, save ratings, see summary/progress, reload into a fresh setup, and verify persistence after application restart. Confirm unauthenticated requests cannot retrieve vocabulary or mutate state. This can initially be a documented smoke check rather than a new browser-testing framework.
- Perform mobile and desktop visual/accessibility checks, reduced-motion checks, Greek/Italian typography inspection, navigation and overflow checks, PWA manifest/install/static-caching checks, container health checks, migrations against a fresh database, and a backup/restore rehearsal. Run pytest and frontend tests and fix failures before delivery.

## Out of Scope

- Individual authentication, private per-profile permissions, sensitive personal data, and public anonymous access.
- Session resume, offline vocabulary/practice, queued offline reviews, and synchronization across disconnected devices.
- FSRS, Anki scheduling, due dates, mastery labels, and scientifically validated learning scores.
- Audio pronunciation, text-to-speech, typed answers, speaking practice, additional language pairs, multiple shared collections, and advanced statistics.
- TypeScript implementation, unnecessary abstractions, gamified dashboards, swipe-only controls, and visual mockups substituting for a working application.
- Permanent deletion of reviewed entries or automatic overwriting during CSV import.

## Further Notes

This specification synthesizes the original product brief and all subsequent interview answers. Later answers take precedence: Railway production hosting, three interface languages, independent grammatical genders, no session resume, review-protected deletion, and initial vocabulary placement in Unit 00. The specification is a new application build; the repository currently contains documentation and configuration only. Publishing this issue authorizes a specification artifact, not deployment or implementation in this conversation.

The repository's domain glossary and accepted Railway architecture decision remain the sources for terminology and architectural intent. The skill-defined ready-for-agent label is applied when this specification is published, after the proposed testing boundaries are checked with the user.
