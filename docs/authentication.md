# Authentication and account ownership

Lexi uses SuperTokens Core with Google and email/password sign-in. Email/password
registration requires email verification. Resend delivers verification and
password reset emails via HTTPS. An account is tied to the stable provider
subject and has one learner profile. Accounts created with different methods
can remain separate even when the email addresses match. Use the same sign-in
method to return to an existing account.

Production browser requests use the application origin through Cloudflare
Tunnel. SuperTokens cookies are Secure, HttpOnly and SameSite=Lax. The SDK
handles session refresh. Writes are checked for same-origin access and CSRF.
Logout revokes the current session. Logout-all revokes the provider user's Lexi
sessions. Application PostgreSQL stores learner accounts and data. SuperTokens
handles credentials and session tokens.

Public registration creates a fresh learner profile. Owners manage their own
cards and Collections. Public collections are visible to signed-in learners.
See the [Collections guide](shareable-collections.md) for ownership, publication
and access. Legacy claim links, claim administration and legacy progress request
flows are retired. Existing account/profile links and historical claim records
are retained according to the application retention rules.

## Configuration and operations

- Follow [provider setup](authentication-setup.md) for Google callback, Core and HTTPS email configuration. Use the exact application origin in `PUBLIC_ORIGIN`, with `COOKIE_SECURE=true` in production. The supported local origin is `http://localhost:5173`, with `COOKIE_SECURE=false`.
- Use the [release runbook](railway-release.md) for private PostgreSQL networking, schema-owner migration and restricted runtime access, backup and recovery.
- See the [historical production authentication release record](authentication-production-release-2026-11-20.md) and [post-cutover schema audit](legacy-schema-audit.md) for the release and migration observations at those points in time.
