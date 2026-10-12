# Proposed Italian Notebook tickets

Source: the Italian Notebook v1 specification. Publication awaits approval of granularity and blocking edges. No application code exists, so no prefactoring ticket is needed.

Every ticket includes migrations/persistence, public API behavior, usable UI, and relevant external-behavior tests for its feature. Apply the JavaScript/Python stack, notebook design, access gate, localization support, and accessibility throughout. Use pytest with disposable PostgreSQL and Vitest/React Testing Library; test public behavior, not private structure. Source stories 1–68 are collectively covered by these slices.

## 1. Run a protected, seeded vocabulary library

**What to build:** Open the real application, enter the shared-password gate, and browse the initial library backed by PostgreSQL.

**Blocked by:** None (can start immediately).

**Publication label:** ready-for-agent

- [ ] Provide the JavaScript React/Vite and Python FastAPI application, migrations, local Docker Compose, and production application-image build.
- [ ] Seed Foteini and Spyros, both named units, and the ten entries in Unit 00, without hardcoded frontend vocabulary.
- [ ] Show a responsive Italian Notebook shell and real paginated vocabulary data.
- [ ] Protect API data with a server-validated cookie gate, logout, CSRF protection, login throttling, and environment-managed secrets; never expose PostgreSQL.
- [ ] Include API/PostgreSQL and rendered-page tests, startup instructions, and a connected gated-library smoke check.

## 2. Select learners and persist practice preferences

**What to build:** Choose or create a learner profile and edit its default learning direction and session size.

**Blocked by:** 1. Run a protected, seeded vocabulary library.

**Publication label:** ready-for-agent

- [ ] Support profile list/create/read/update through UI and API with validated names.
- [ ] Seed/default direction to Greek to Italian and size to 25; persist profile preferences across devices.
- [ ] Switch profiles from navigation/settings and remember the last selection on the device.
- [ ] Explain that profiles are not authenticated identities; everyone inside the gate can select any profile.
- [ ] Test persisted preferences, profile switching, validation, and missing locally remembered profiles.

## 3. Add and edit vocabulary meanings

**What to build:** Maintain entries through a mobile form with complete bilingual grammatical information.

**Blocked by:** 1. Run a protected, seeded vocabulary library.

**Publication label:** ready-for-agent

- [ ] Require Italian, Greek, and one of the six word types; support independent genders, plurals, examples, notes, and pronunciation text.
- [ ] Represent one meaning per entry; allow text reused for different meanings and warn on normalized matching Italian-Greek pairs.
- [ ] Retain accents and leading language articles; validate backend input and show actionable form errors.
- [ ] Save through the real API/PostgreSQL and reflect additions/edits in the library.
- [ ] Test API validation, duplicate warnings, multilingual text, and rendered form interactions.

## 4. Organize and find vocabulary by units and tags

**What to build:** Create units/tags and search/filter the library using combinable criteria.

**Blocked by:** 3. Add and edit vocabulary meanings.

**Publication label:** ready-for-agent

- [ ] Give units stable codes preserving leading zeros, titles, and explicit ordering; allow No unit.
- [ ] Assign at most one unit and multiple tags independently of word type.
- [ ] Search Italian and Greek; paginate efficiently; OR selected values within groups and AND groups.
- [ ] Create units/tags without redeployment and use mobile-friendly controls and rows.
- [ ] Test persistence, ordering, pagination, and combined filter behavior through API and UI.

## 5. Complete random practice with persisted reviews

**What to build:** Select a learner, direction, and size, reveal flashcards, rate answers, and reach a session summary.

**Blocked by:** 2. Select learners and persist practice preferences.

**Publication label:** ready-for-agent

- [ ] Generate shuffled random queues with no duplicate entries; support 10/25/50/All and explain shortages/zero matches.
- [ ] Show notebook cards with tap/keyboard reveal, answer-side grammar and pronunciation, and no answer-giving front hints.
- [ ] Persist sessions, ordered card snapshots, immutable review events, and independent aggregate records by profile/entry/direction.
- [ ] Require reveal before rating; save review and progress transactionally and advance only after confirmed save.
- [ ] Show rating counts and Remembered this session, handling zero reviews; Practice Again returns to setup and Return Home works.
- [ ] Leaving/reloading starts fresh while preserving accepted reviews; test API persistence/isolation and rendered practice flow.

## 6. Switch direction and recover review saves safely

**What to build:** Keep practice correct through direction changes, edited entries, double taps, and unreliable connections.

**Blocked by:** 5. Complete random practice with persisted reviews; 3. Add and edit vocabulary meanings.

**Publication label:** ready-for-agent

- [ ] Direction switching retains the queue, hides the current answer, and changes only unanswered cards; disable switching while saving.
- [ ] Record the tested direction and selected wording snapshot; library edits affect future sessions without rewriting past reviews.
- [ ] Enforce idempotent submission per session card, replay the accepted result on retry, and reject conflicting second ratings.
- [ ] Disable repeated taps and retain the revealed card/selected rating after failure; lost responses cannot duplicate reviews.
- [ ] Test concurrent requests, transactional rollback, edited vocabulary, direction attribution, response-loss retries, and UI recovery.

## 7. Delete accidental unreviewed vocabulary safely

**What to build:** Remove mistaken entries while protecting existing reviews and active sessions.

**Blocked by:** 6. Switch direction and recover review saves safely.

**Publication label:** ready-for-agent

- [ ] Permanently delete only entries with no reviews, with a clear conflict explanation otherwise.
- [ ] Coordinate deletion and review writes transactionally so a race cannot orphan or erase a review.
- [ ] Skip a deleted unreviewed queued entry with an explanation and adjust the session count; preserve the rest of the session.
- [ ] Provide a mobile delete action and verify deleted entries disappear from search and future selections.
- [ ] Test reviewed-entry protection, active-queue deletion, concurrent review/deletion, and rendered error handling.

## 8. Practise categories from combined filters

**What to build:** Choose units, word types, and tags before practice and receive matching flashcards.

**Blocked by:** 4. Organize and find vocabulary by units and tags; 5. Complete random practice with persisted reviews.

**Publication label:** ready-for-agent

- [ ] Expose category setup using the same filter semantics as the library.
- [ ] Generate and persist a filtered, shuffled, nonrepeating queue respecting size and direction.
- [ ] Explain fewer matches than requested and provide corrective actions for empty selections.
- [ ] Continue through the existing review and summary flow with correct profile/direction records.
- [ ] Test combined filtering, No unit, shortages, and a rendered category-practice journey.

## 9. Find and practise difficult entries

**What to build:** See personal difficult entries and launch practice based on their direction-specific history.

**Blocked by:** 6. Switch direction and recover review saves safely.

**Publication label:** ready-for-agent

- [ ] Calculate the documented normalized weighted score with Again=1, Hard=0.5, Easy=0 and successive older weights multiplied by 0.8.
- [ ] Require at least one review and score >=0.5; inactivity alone never changes difficulty.
- [ ] Expose per-profile difficult entries and a direction-aware difficult-practice setup/action.
- [ ] Exclude unreviewed entries, explain shortages/empty sets, and use the existing review flow.
- [ ] Show entries needing practice on summaries; test score sequences, profile/direction isolation, and rendered selection.

## 10. Combine difficult, recent, and random practice

**What to build:** Start mixed review that balances reinforcement and variety without repeating entries.

**Blocked by:** 9. Find and practise difficult entries.

**Publication label:** ready-for-agent

- [ ] Target 40% difficult, 30% reviewed within seven days, and 30% random; document deterministic whole-card rounding.
- [ ] Use selected profile/direction for historical pools, remove overlaps, and fill shortages from remaining library entries.
- [ ] Persist and shuffle a unique queue, with 10/25/50/All and correct small-library behavior.
- [ ] Provide mixed setup and run through the existing flashcard/review/summary journey.
- [ ] Test pool overlap, quota rounding, direction isolation, time boundaries, shortage backfill, and UI behavior.

## 11. Preview and confirm CSV vocabulary imports

**What to build:** Upload vocabulary, inspect proposed changes, and explicitly import valid nonduplicate rows.

**Blocked by:** 4. Organize and find vocabulary by units and tags.

**Publication label:** ready-for-agent

- [ ] Validate UTF-8 CSV with Greek accents, supported columns, file size limits, documented tags encoding, and pronunciation text.
- [ ] Accept separate genders and legacy gender as Italian alias; conflicting values are row-level errors.
- [ ] Preview invalid rows, normalized duplicates within upload/library, and proposed units/tags without writing library data.
- [ ] Explicit confirmation revalidates against current data, imports valid rows, skips duplicates, and never silently overwrites.
- [ ] Show imported/skipped/duplicate/error counts and useful row-level errors; test preview purity, stale previews, repeat confirmations, and rendered workflow.

## 12. Export vocabulary safely as CSV

**What to build:** Download a reusable CSV of the shared library from Vocabulary or Settings.

**Blocked by:** 4. Organize and find vocabulary by units and tags.

**Publication label:** ready-for-agent

- [ ] Export documented compatible fields including separate genders, units with leading zeros, tags, and optional metadata.
- [ ] Preserve Unicode/Greek accents and protect exported fields against spreadsheet formula injection.
- [ ] Support a full-library export and clear success/error handling through the protected API and UI.
- [ ] Document format and duplicate-policy compatibility with import.
- [ ] Test export content, access protection, quoting/formula cases, and the rendered download action.

## 13. Show learner progress and a useful home page

**What to build:** Understand practice history and start the next useful exercise from Home and Progress.

**Blocked by:** 9. Find and practise difficult entries.

**Publication label:** ready-for-agent

- [ ] Show greeting/current profile, vocabulary count, recent summary, Start Practice, and difficult-entry action.
- [ ] Show total reviews, rating distribution, difficult entries, and unit/type/direction breakdowns.
- [ ] Deduplicate overall entries practised across directions while counting direction-specific views separately.
- [ ] Use counts/distributions and Remembered this session without mastery/completion claims; handle empty profiles clearly.
- [ ] Test aggregates against real review history, profile switching, and accessible responsive rendered views.

## 14. Choose Greek, English, or Italian interface settings

**What to build:** Change device-local interface language and motion settings independently of practice direction.

**Blocked by:** 2. Select learners and persist practice preferences.

**Publication label:** ready-for-agent

- [ ] Translate shared shell/settings and provide reusable localization for all screens; Greek is default.
- [ ] Keep language device-local and profile learning direction independent.
- [ ] Keep motion preference device-local and always respect operating-system reduced motion.
- [ ] Use fonts supporting Greek/Italian text, accessible labels, and layouts that tolerate translated text.
- [ ] Test persisted settings, language/direction independence, and reduced motion; every later ticket must localize its added UI.

## 15. Install the PWA with safe static caching

**What to build:** Install Italian Notebook on a phone and receive clear feedback when network-dependent features are unavailable.

**Blocked by:** 6. Switch direction and recover review saves safely.

**Publication label:** ready-for-agent

- [ ] Provide manifest/icons, standalone launch, and cache essential static assets.
- [ ] Never cache private vocabulary/API responses or expose private data after logout through the service worker.
- [ ] Keep vocabulary/practice online-only; preserve current-card retry behavior while the page is open.
- [ ] Verify mobile overflow, touch/keyboard interactions, accessibility, and reduced motion for the practice journey.
- [ ] Test/verify installability, cache update behavior, gated offline state, and connection-error UX.

## 16. Verify and document the complete Railway release

**What to build:** Run the finished app as one Railway application service with private PostgreSQL and reproducible maintenance procedures.

**Blocked by:** 7. Delete accidental unreviewed vocabulary safely; 8. Practise categories from combined filters; 10. Combine difficult, recent, and random practice; 11. Preview and confirm CSV vocabulary imports; 12. Export vocabulary safely as CSV; 13. Show learner progress and a useful home page; 14. Choose Greek, English, or Italian interface settings; 15. Install the PWA with safe static caching.

**Publication label:** ready-for-agent

- [ ] Package the React build and FastAPI API in one production application image; retain local Compose and frontend/backend build support.
- [ ] Document private PostgreSQL connectivity, environment secrets, HTTPS/cookie/proxy behavior, migrations, health checks, and restart persistence.
- [ ] Document opt-in daily PostgreSQL-volume backups plus manual backup/restore, and rehearse restore against disposable data.
- [ ] Run the API/PostgreSQL and frontend suites; fix failures and complete the connected gate-to-import-to-bidirectional-practice-to-progress smoke journey.
- [ ] Audit all screens in all three interface languages, mobile/desktop layouts, focus/labels, reduced motion, PWA privacy, and empty/error cases.
- [ ] Provide startup/deployment instructions, known limitations, and deferred improvements; actual production deployment requires separate authorization.
