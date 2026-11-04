# Authentication UI regression verification — 4 November 2026

Restored the landing hero markup and copy from pre-authentication commit
`91cddc4`, including ITALIAN NOTEBOOK, the original heading/subtitle and notebook
illustration. The header and language selector were unchanged. The original
card surface, column and primary button styles are retained; the card can grow.
Pinning the hero to the top of its grid area prevents a taller form from shifting
it. Auth-specific form, link, Google-button and visibility-button styles are
scoped under `.gate-card`.

The compact learner identity previously rendered both the styled name and a
second plain span. It now renders one name with its existing avatar and localized
label, and has no select or misleading chevron. No profile switching was added.

Authentication responses preserve provider status and field errors. Wrong
credentials share one localized banner; network/provider failures offer retry.
The email survives failures. Required/malformed fields get inline messages.
Each operation has its own localized pending label, and controls recover after
failure. Reset requests stay in recovery with a generic accepted-request notice.
Request generations discard stale form results; a stale Google initiation also
cannot redirect after switching forms. Account linking remains disabled.

## Evidence

- Before: `AuthGate.test.jsx` reproduced two failures: the new hero copy and a
  network failure incorrectly shown as a credential error.
- After: frontend **249 tests passed**, across 19 files; ESLint and Vite build
  passed. Existing Vite bundle-size warning remains.
- Backend: the initial sandboxed attempt could not connect to local PostgreSQL;
  the network-enabled rerun completed **163 passed, 1 skipped**. The opt-in real
  Core integration test was skipped; one existing Starlette/httpx deprecation
  warning remains. No backend implementation or migrations changed here.
- `node tests/auth-ui.mjs` passed English and Greek at 1280, 390 and 320 pixels:
  localized credential error, one learner name, no profile selector, and no
  horizontal overflow. Screenshots include sign-in, registration, recovery,
  error and the compact learner identity.
- Built the actual pre-authentication frontend in a disposable directory and
  compared its hero text and bounding rectangle with the restored version at
  all three widths: exact equality. Desktop and mobile screenshots inspected.

Screenshots are local synthetic fixtures under `.scratch/auth-ui/`, with Greek
variants in `greek/` and the Git-history baseline in `original/`. They contain no
real learner data, credentials, verification links or provider tokens. The
screenshot script uses intercepted API responses and is not a live provider test.

## Staging deployment follow-up

The user approved continuing staging tests. Deployment
`0a46404a-d6e2-444a-b34b-238543680168` of commit
`53d1d8bb6cbe26153a7561d3ffcde134ee61be07` reached Railway SUCCESS.
An actual headless Chromium session against `https://staging.lexi.fotiniv.com`
confirmed the new mobile screens, generic wrong-credential banner from the live
managed Core, retained email, restored controls, and registration/recovery view
navigation. No registration, reset request or email delivery was initiated.
Sanitized screenshots are in `.scratch/auth-ui/staging/`.

[CI for that deployed commit](https://github.com/fvoulgari/lexi/actions/runs/41906807759)
passed frontend, backend, image validation and aggregate checks. Release/image
promotion and production deployment jobs were skipped.

Live email delivery, Google callbacks, password reset, session renewal and legacy
claims remain pending; these UI smoke checks do not establish those behaviours. Accepted-request copy is not proof of mail
delivery: backend registration/recovery intentionally remain non-enumerating,
including delivery outages. No change to that security policy was made.
PR #63 remains draft. Production is unchanged.
