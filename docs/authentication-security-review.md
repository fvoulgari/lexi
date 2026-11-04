# Authentication and account-isolation review

Independent source review of the integrated authentication release, 4 November 2026. This is an application review, not a penetration test or certification of a configured production deployment.

Final source pass found no remaining identified application security blockers within the reviewed scope. External configuration checks below remain release gates.

## Boundaries inspected

- Verified provider sessions, cookie-only transport, CSRF checks, callback allowlists, session revocation, and fail-closed configuration.
- Account ownership, scoped ORM entity/projection reads, private vocabulary and metadata, collections, CSV workflows, bulk actions, practice, and progress.
- Administrator role changes and first-administrator bootstrap; editor authority does not expose other accounts' private resources.
- Legacy claim issuance, hash-only secrets, continuation cookies, authenticated preview, explicit redemption, expiry/revocation, locking, conflict reports, and private recovery requests.
- Archival and history preservation, including audience changes and redaction of inaccessible card snapshots and unit metadata.
- Browser authentication callbacks, return navigation, private query caches, identity changes, and claim continuation.

## Findings addressed during review

1. A practice write authenticated before legacy redemption could wait on the former profile lock and then write into an orphaned profile. Personal writes now lock the current account before the profile and validate live ownership. A deterministic blocked-write regression covers this case.
2. Bulk card locking included the nullable joined unit relation, which PostgreSQL rejects. Locks now explicitly target the vocabulary row.
3. Successful collection operations returning 204 were parsed as JSON and reported as failures. Empty responses are handled explicitly.
4. Query caches could survive an externally observed account change. Private queries now use a separate client recreated for the authenticated identity and permissions; cross-tab changes trigger session refresh.
5. Progress breakdowns exposed snapshot unit metadata after shared content became inaccessible. Unit breakdowns now check current card access while preserving personal aggregate history.
6. Nested private query clients initially invalidated an inner session key after a claim. Claim and administrator mutations now refresh the outer session, and profile identity participates in the private-cache boundary.
7. A delayed account-preference response could overwrite a newly authenticated account in the outer session cache. Updates now verify the submitting and returned account identities and change only interface language, never profile or permissions.

The installed provider SDK was also inspected: passwordless email/phone existence APIs are disabled with its explicit disable flags, including legacy route aliases. A configured-SDK route regression confirms those aliases return 404 without contacting a provider. Automatic linking is disabled by the configured callback; explicit client linking is rejected. The account-linking recipe exposes no public API and initialization does not provision billing.

Claim eligibility also prevents an already associated legacy profile from being exchanged for another, even when empty, and consumed claims permanently prevent target reissue. A publication metadata uniqueness conflict now returns an explicit 409 rather than a misleading service failure.

## Verification and limits

The integrator reports 146 passing backend tests against disposable PostgreSQL 18.6 and 221 passing frontend tests, with frontend lint/build, production dependency audit, and mobile/PWA checks passing. Migration/restore evidence covers PostgreSQL 17 and 18; see the migration verification document. This reviewer inspected final source and did not independently rerun those suites, access live users, provider accounts, credentials, or billing, or mutate the test database during independent review.

Production remains gated on approved provider/SMTP setup, real Google and magic-link browser flows, delivery and single-use/expiry behavior, cookie refresh/revocation checks, and the operator-controlled backup/migration procedure. Source review cannot establish those external configuration properties. No deployment or production-readiness claim follows from this review.
