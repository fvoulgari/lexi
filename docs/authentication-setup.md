# Authentication operator setup

Prepared 4 November 2026. These are operator instructions, not evidence of provisioning or deployment. PR #63 remains a draft; readiness, merging and deployment require separate authorisation even after its release gates are resolved. See [staging checks](authentication-staging-checklist.md) and [migration/rollback](authentication-migration-runbook.md).

## Decisions and costs before provisioning

Railway account inspection confirmed Hobby on 4 November 2026. Railway blocks
outbound SMTP on Hobby; the current SMTP transport therefore cannot complete
hosted email sign-in on that plan. See the [staging preparation and cost
estimate](authentication-staging-preparation.md) before provisioning. No Pro
upgrade or alternative email transport has been approved.

SuperTokens managed Core is the implementation candidate. Its current [pricing](https://supertokens.com/pricing) advertises free service **under 5,000 monthly active users** and $0.02/MAU outside the free offer. MAUs are unique logged-in users per month, including registrations. Confirm whether billing at the threshold covers all MAUs or only excess usage, available hard spending limits, and separate staging usage with the provider; do not assume incremental billing or that alerts prevent charges. No paid plan, billable upgrade, or recurring charge is authorised. If free-only operation cannot be assured, stop for approval.

Account linking is disabled by the application; leave paid add-ons disabled. The pricing page lists account linking at $0.005/MAU with a $100 minimum. No email provider has been selected: SMTP quotas, sandbox restrictions, domain costs and recurring delivery charges remain unknown and separate. Ordinary Google OAuth client configuration is used, not Google Cloud Identity Platform; no paid Google service is required by this code. Confirm the selected projects incur no unrelated charges.

## Origins and provider resources

Choose exact origins `STAGING_ORIGIN` and `PRODUCTION_ORIGIN` (scheme and host, optional port, no path or trailing slash). The production hostname has not been confirmed; do not substitute an assumed domain. Keep separate databases, Core deployments/API keys and Google web clients for staging and production. Never populate staging with unredacted production data.

For each environment, after verifying free-only terms:

1. In the [SuperTokens dashboard](https://supertokens.com/dashboard), create/select the managed deployment. Store its HTTPS connection URI and API key directly in the backend runtime's protected variables. Do not expose Core administration to browser code. Keep automatic account linking and other paid features disabled.
2. Open that deployment's **Configuration**. In Passwordless configuration set `passwordless_code_lifetime=600000` milliseconds (10 minutes). The [official magic-link guide](https://supertokens.com/docs/authentication/passwordless/customize-the-magic-link) describes this control and automatic saving; the default is 15 minutes, so do not assume 10 without setting it.
3. In the same deployment configuration set `access_token_validity=3600` seconds and `refresh_token_validity=10080` minutes (7 days). Confirm the saved values in the selected Core deployment before testing. These names and units come from [Core's configuration reference](https://github.com/supertokens/supertokens-core/blob/master/config.yaml); its default refresh lifetime is 144000 minutes, not 7 days. If the managed console does not expose a field, resolve that with provider support before rollout rather than silently accepting a different lifetime. Test actual renewal/inactivity behavior; refresh lifetime is not a guaranteed absolute session deadline.
4. Record non-secret deployment identifier, selected region, quotas, saved lifetimes and cost controls in the private operator record. Keep API keys and credential screenshots out of GitHub/chat.

## Google web client

Repeat separately for staging and production in [Google Auth Platform](https://console.cloud.google.com/auth/overview):

1. Select the intended Cloud project. In **Branding**, set Lexi's name, support contact, authorised domain, homepage and privacy-policy URLs. Supply actual operator-controlled URLs. In **Audience**, choose External for public registration; use Testing plus explicitly listed synthetic test users for staging. Complete the production publishing/verification requirements reported by Google before public launch.
2. In **Data Access**, request only `openid`, `email`, and `profile`. In **Clients → Create client**, choose **Web application** and an environment-specific name.
3. Add the exact environment origin to **Authorised JavaScript origins**. Add exactly `${ORIGIN}/auth/callback/google` to **Authorised redirect URIs**. Here `${ORIGIN}` means the chosen literal origin, not a string pasted into Google. No wildcard, `/api` prefix or trailing slash. Store the client ID and secret directly in the backend secret store.
4. For a separate local client, use origin `http://localhost:5173` and redirect `http://localhost:5173/auth/callback/google`. Do not weaken production cookie/HTTPS settings for local development.

Google documents [client/branding setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid) and requires [exact redirect matching](https://developers.google.com/identity/protocols/oauth2/web-server). Lexi uses SuperTokens' OAuth web redirect flow, not One Tap; no extra Google browser library is needed.

## Email delivery

Select an approved SMTP service with implicit TLS on port 465, verify the sender/domain, and apply its exact SPF/DKIM records and appropriate DMARC policy. Confirm quotas, sandbox recipient restrictions, bounce handling, retention/data processing and costs before committing. Store SMTP credentials only in backend variables. Lexi explicitly configures [SMTP delivery](https://supertokens.com/docs/platform-configuration/email-delivery); the provider's default shared sender is not a fallback.

Verify delivered magic links use `${ORIGIN}/auth/verify` (SDK-generated one-time parameters must be preserved). This is an application email callback, not a Google redirect URI. Legacy claims use `${ORIGIN}/claim#token=<generated-token>`; never register that URL with Google, log its fragment, or paste generated tokens into tickets. Claims default to 48 hours; their captured continuation lasts 20 minutes and is distinct from a 10-minute authentication link.

## Backend runtime variables

Set these in the selected environment's protected runtime configuration, never frontend `VITE_*` variables or build arguments. Values below describe requirements, not credentials.

| Variable | Required setting |
| --- | --- |
| `DATABASE_URL` | Selected environment's private PostgreSQL connection; password is secret. SQLAlchemy accepts `postgresql+psycopg://`; standard PostgreSQL URLs are normalised. |
| `PUBLIC_ORIGIN` | Exact selected HTTPS origin, no trailing slash. |
| `COOKIE_SECURE` | `true` in staging/production. |
| `SUPERTOKENS_CONNECTION_URI` | Selected Core's HTTPS connection URI. |
| `SUPERTOKENS_API_KEY` | Selected Core's secret API key. |
| `GOOGLE_CLIENT_ID` | Selected environment's web client ID. |
| `GOOGLE_CLIENT_SECRET` | Corresponding secret. |
| `SMTP_HOST` | Approved SMTP host. |
| `SMTP_PORT` | `465` unless an approved implicit-TLS service explicitly requires another port. |
| `SMTP_FROM_EMAIL` | Verified sender address. Display name is Lexi. |
| `SMTP_USERNAME` | SMTP credential username required by selected provider. |
| `SMTP_PASSWORD` | SMTP credential secret required by selected provider. |
| `SMTP_SECURE` | `true` (implicit TLS). |
| `FORWARDED_ALLOW_IPS` | Verified trusted proxy IPs/CIDRs; never `*`. Default `127.0.0.1` is not proof the actual edge proxy is trusted. |
| `CLAIM_HOURS` | `48`; allowed 1–168, controls legacy claims only. |
| `LOGIN_LIMIT` | `5`; application authentication initiation limit per client-address hash in a 60-second window. |

`SESSION_HOURS` is parsed for compatibility but unused: it does **not** configure provider sessions. `SHARED_PASSWORD` and `SESSION_SECRET` do not restore old gate authentication. `POSTGRES_PASSWORD` belongs only to local database provisioning, not an extra production application setting.

Keep frontend and API same-origin; no permissive CORS. Validate proxy trust before interpreting per-client throttling. Configure edge logs to omit auth callback query strings, cookies, bodies, Authorization headers and claim secrets. The application start command disables raw access logs; check upstream logs independently. `/api/health` proves neither provider connectivity nor delivered email. `/api/auth/session` must report `auth_available=true`, followed by the complete [real-provider checklist](authentication-staging-checklist.md).
