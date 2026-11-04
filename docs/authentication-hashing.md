# Managed Core hashing: development and production

Investigation on 4 November 2026. No managed Core settings, paid plans, application
hashing or production resources were changed.

## Why the development dropdown is disabled

The operator reported the dashboard explanation: **“changes only available to
production cores.”** This identifies a restriction of this managed development
Core's configuration UI, rather than a missing edit-mode action. It does not
establish that Argon2 is a paid feature or that an upgrade is required.

The [general hashing documentation](https://supertokens.com/docs/authentication/email-password/password-hashing)
describes an automatically saved managed-service algorithm setting but does not
describe this development restriction. It recommends Argon2, documents bcrypt as
the default, and states that existing bcrypt hashes continue to verify using
bcrypt after an algorithm change. Do not assume changing a dropdown migrates
existing passwords. The earlier setup instruction incorrectly treated the
general managed-service guidance as proof of development-instance editability.

Do not create a production Core simply to unlock this control. Production-Core
availability, billing, limits and configurable hashing must be confirmed
separately before any activation. No provider support message was sent.

## Tests that can proceed with development bcrypt

Keep the managed development Core on its existing setting. Restricted staging
tests can use disposable synthetic identities with ASCII passwords of 15–64
characters, safely below bcrypt's 72-byte boundary. Use only synthetic data and
restrict access to the test operators; this exception is not permission to open
registration to real users on a bcrypt deployment with the current policy.

These cases can proceed after the remaining email/Google/backend setup:

- Registration and generic duplicate acknowledgement.
- Email verification and denial of application data before verification.
- Password sign-in, wrong-password rejection and recovery/reset, using short
  synthetic passwords; expiry, reuse, retries and delivery failures.
- Google sign-in, distinct matching-email identities, sessions and logout.
- Permissions, two-user isolation, learning history and legacy claims.

Record the actual development Core token/session lifetimes. Read-only values
must not be reported as the desired production values having been applied. The
dashboard screenshot labels reset validity in seconds; underlying Core config
uses milliseconds for reset/verification tokens. Always use the displayed units.

Long-password acceptance, Unicode byte boundaries and non-truncating password
verification remain separate production release gates. They must not be marked
passed based on the short-password development tests. The existing opt-in local
Core integration includes a long-Unicode assertion and is expected to fail that
assertion on bcrypt; do not silently remove it or relabel it as a bcrypt pass.

## Executed local bcrypt investigation

A separate in-memory Core ran only on `127.0.0.1:13568`, using image
`sha256:c74eef1f69b78388d6a3b5af142c8338be7824e532fe6d9e778a932227151637`
with `PASSWORD_HASHING_ALG=BCRYPT`. Direct provider signup/signin requests used
synthetic credentials; no real account, email or managed Core was contacted.

| Case | Correct password | Wrong password |
| --- | --- | --- |
| Short ASCII password, difference within first 72 bytes | Accepted | Rejected |
| ASCII passwords identical for 72 bytes, different suffixes | Accepted | Accepted |
| Unicode passwords identical for 72 UTF-8 bytes, different suffixes | Accepted | Accepted |

This confirms truncation in the tested Core, rather than merely assuming a
generic bcrypt implementation detail. It does not independently establish the
managed Core's version, work factor or configuration. The earlier local Argon2
integration demonstrated rejection of a wrong long Unicode password; that is
separate evidence, not proof of managed-development behavior.

## Production requirements

Passwords, salts, hashes and verification remain entirely inside SuperTokens.
Do not add pre-hashing, double hashing, password storage or a custom password
system to Lexi.

For the unchanged 15–128-character Unicode policy, verify provider-supported
Argon2 availability and saved configuration on the intended production Core,
including provider-calibrated work settings and approved billing. Run the
non-truncation regression there with disposable identities before accepting
real registrations. Do not count development bcrypt results as this check.

Bcrypt is not intrinsically disallowed as a production algorithm. However, using
it would require an explicitly reviewed alternative password policy that rejects
inputs beyond the provider's supported UTF-8 byte limit, communicates that limit
in the UI and verifies a suitable work factor. That would change the currently
advertised 128-character policy; no such policy change is made or approved here.
If managed Argon2 is unavailable, raise that product/security decision instead of
silently truncating passwords, weakening checks or buying an upgrade.

PR #63 remains draft. Production is unchanged.
