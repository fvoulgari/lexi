# Release verification — issue #16

Verified on 13 October 2026 against `origin/main` at `583209c`, in an isolated worktree and disposable PostgreSQL 17 environment. Production deployment was not performed. Operational procedures are in [the Railway runbook](railway-release.md).

## Executed checks

| Check | Result |
| --- | --- |
| API/PostgreSQL suite | 66 passed, real PostgreSQL 17; separate `lexi_release_test` database |
| Rendered frontend and PWA suite | 63 passed across 9 files |
| Python validation | Ruff app/tests/Alembic/smoke checks and compileall passed |
| JavaScript validation | ESLint and Vite production build passed; no TypeScript configuration |
| Root production image | Built with Node 24/Python 3.14; non-root application serving React + API |
| Local Compose | Configuration validated with disposable environment values; development service files retained |
| Connected HTTP journey | Health/shell → gate/CSRF → import preview/confirm/repeat → unit-filtered practice in both directions → reveal/review/retry → summaries/progress → export → logout |
| Restart/replacement | Imported meanings, both direction totals, full progress and summaries compared exactly through HTTP after app restart and final-image replacement |
| Backup/restore rehearsal | PostgreSQL 17 custom-format dump restored with `pg_restore --exit-on-error` into new `lexi_restore`; a second production-image instance returned the same saved vocabulary, progress and summaries |
| Container health | `/api/health` returned 200; Docker reported healthy |

The API suite emits one existing Starlette/httpx deprecation warning. This does not fail the checks; migrating the test transport is deferred.

The disposable smoke created two vocabulary entries in one uniquely named unit/tag, one learner profile and two review events (Again in Greek to Italian, Easy in Italian to Greek). Replaying either submission did not inflate counts. Preview left the library unchanged; repeat confirmation imported zero entries. The evidence JSON and database dump stayed outside Git.

## Screen and interaction audit

In the real browser, checked Gate, Home, Vocabulary, Practice setup, Progress and Learners & settings in **Greek, English and Italian**, at **390 × 844 mobile** and **1280 × 900 desktop** (the gate mobile check used 390 × 900). All 36 main-screen/language/size combinations had no horizontal document overflow. An additional 18 combinations checked practice prompts, revealed answers and zero-review summaries at 390 × 900 and 1280 × 900, also without horizontal overflow. Every input/select/textarea had a label; document language and screen headings followed the selected interface language. Screenshots inspected the mobile home/settings/progress and desktop settings/gate layouts. This is a responsive browser audit, not a physical-phone or screen-reader certification.

Rendered acceptance tests additionally traverse the five authenticated screens in each language with an empty library/profile list, open vocabulary/unit/tag/learner forms, verify focus and required labels, and recover from a service error back to the gate. Existing rendered suites cover populated entries, import preview/confirmation/retry, add/edit/delete, practice reveal/direction switching/retry/summary, progress breakdowns, revoked sessions, missing profiles, storage failures and offline status.

The audit exposed route changes leaving keyboard focus in navigation. A test failed in all three languages before the fix and passed afterward; the application now focuses the main region after path changes, and the skip-link target is programmatically focusable. Confirmed in the final production build with keyboard Enter on a navigation link.

Selecting reduced motion in the browser produced `data-motion=reduce` and zero-duration button transitions. The existing device-settings tests verify system reduced motion overrides full motion and responds to runtime changes; CSS also covers the operating-system media query. Native form controls support keyboard activation; answer reveal/retry and disabled pending saves are covered by rendered practice tests.

PWA privacy review: the worker caches only an explicit build-time list of public shell/assets, excludes every `/api` request and all non-GET requests, and uses credential-free installation fetches. API responses are `no-store`, including denied responses and exports. Existing worker tests execute these boundaries and cache-version replacement. There is no offline private vocabulary or practice store. A service-worker update waits until all application tabs close; reopening the app activated the final build during verification. Keep a failed practice page open for retry before closing to update.

## Remaining operator checks and known limits

- Deploy only after separate authorization. On Railway, confirm the resolved private database hostname, migration logs, HTTPS cookies, exact `PUBLIC_ORIGIN`, proxy trust and health-check settings. No live Railway credentials were used here.
- Enable opt-in daily PostgreSQL volume backups and observe the first successful backup. The local logical restore rehearsal proves `pg_dump`/`pg_restore` recovery, not Railway's platform snapshot restoration.
- Verify installation and standalone behavior on real iOS Safari and Android Chrome; check browser/OS reduced motion and keyboard or screen-reader behavior on target devices.
- Without a verified trusted Railway proxy, failed-login throttling groups clients by proxy IP. This is documented rather than trusting arbitrary forwarded headers.
- CSV row diagnostics preserve backend validation details and may be English; workflow labels support all three languages. Translation of detailed server diagnostics is deferred.
- Profiles are shared display identities; authorized visitors may select every learner and edit the shared library. No per-person privacy boundary is implied.
- Pending queues are not durable across reload, and private practice requires connectivity. PWA updates may need all app tabs closed.
- One application replica is the release topology; concurrent migration coordination, continuous uptime monitoring, point-in-time recovery and automated offsite dumps remain deferred. Backups and monitoring need an operator owner.

## Implementation review

Parallel Standards and Spec reviews of the committed diff against `583209c` returned no actionable findings on either axis. Standards checked the repository instructions, glossary, ADR, design and testing conventions; Spec checked issue #16’s acceptance criteria.
