# Authenticated origin proposal — not provisioned

Prepared 6 November 2026 after [Railway inventory and staging probes](authentication-hosted-rate-limits.md).
No tunnel, connector, DNS edit, service or paid plan has been activated.

## Why the current Railway configuration is insufficient

Railway's [specifications](https://docs.railway.com/networking/public-networking/specs-and-limits)
and [employee confirmation](https://station.railway.com/questions/need-authoritative-client-ip-proxy-tru-090eac86)
support public-edge header replacement, while private traffic bypasses it. No
published trusted-proxy range or signed ingress marker establishes provenance
inside this backend. The [approved runtime trace](authentication-rate-limit-runtime-trace.md)
now confirms private IPv4 reaches the app, public/private traffic shares its local
destination, and seven public requests fragment into six transport-peer buckets.
Do not adopt wildcard trust, guessed CIDRs, hop counts or matching Host/Origin.
A normal Cloudflare proxy with the current reachable backend would leave bypasses.

## Existing ingress cannot currently meet acceptance

Rechecked 6 November 2026:

- Railway [edge-rule actions](https://docs.railway.com/networking/edge-rules) are
  block/allow/challenge/redirect/cache override. Their documented schema has no
  configurable per-client counter, time window or limit action. Returning a static
  429 is not equivalent to counting requests while preserving client B's allowance.
- [WAF](https://docs.railway.com/networking/waf) provides incident-oriented Under
  Attack Mode, a browser challenge rather than the required five-request counter.
  Read-only staging status reports it available but disabled; it was not enabled.
- The [platform-wide rate limits](https://docs.railway.com/networking/public-networking/specs-and-limits)
  protect domain/connection capacity, not Lexi's route-specific per-IP limits.
- Edge-only protection still leaves the observed private HTTP route. No documented
  mechanism found in the current setup supplies positive public-only provenance.

This is a conclusion about the verified current capabilities/configuration, not a
claim that Railway can never add a suitable feature. Public signup is blocked from
release until the complete acceptance test passes. Other staging checks continue.

## Proposed minimal topology

```text
Browser → Cloudflare edge → authenticated outbound Tunnel
                              ↓
                 cloudflared in Lexi container
                              ↓ loopback only
                   Uvicorn 127.0.0.1:8000
                              ↓ outbound private connection
                         existing PostgreSQL
```

Use a named Cloudflare Tunnel and run its pinned connector inside the existing
application container, under a small process supervisor. Do not add a separately
billable Railway service. SuperTokens sessions and all user authorization remain
unchanged. Enforce request counts in the existing PostgreSQL-backed application
limiter, after resolving the authenticated Tunnel's canonical client IP. A paid
Cloudflare WAF rate-limit product is not required for this proposal. Keep the
identifier-based failed-password backoff as a separate, unchanged layer. Tunnel connector credentials authenticate the outbound connection;
Cloudflare Access login/paid seats are unnecessary for public Lexi sign-in.

Required implementation before cutover:

- Bind the actual application only to `127.0.0.1:8000`, not 0.0.0.0 or `::`.
  This prevents the private network reaching its HTTP listener. The connector is
  in the same container and forwards only to this loopback socket, not private DNS.
- Run Uvicorn with forwarded-header rewriting disabled. A narrowly enabled Tunnel
  middleware accepts exactly one valid, canonical CF-Connecting-IP only on the
  loopback connector path. It rejects missing, duplicate, malformed or list-valued
  client IPs on auth/application routes. It ignores X-Forwarded-For and X-Real-IP.
  Same-container processes are trusted; other containers have no loopback access.
- In Tunnel mode, reject non-loopback transport on all auth/protected routes
  before reading any forwarded client header. Unknown ingress must not fall back
  to a trusted header. Verify the startup command actually binds only loopback;
  an environment flag alone is not proof of provenance.
- Enforce HTTPS at the public edge and retain Secure cookies and the same public
  origin/Google callback. Resolve any scheme information only after verified
  connector provenance, never from arbitrary X-Forwarded-Proto.
- Confirm no same-zone Worker can alter identity, no visitor-IP-removal transform
  is enabled, and Pseudo IPv4 is not set to overwrite real addresses. Review IPv6
  and Worker-subrequest behavior explicitly; do not claim IPs are permanent people.
- Keep local container-only health checks independent of the client-IP requirement.
  Railway's existing public-ingress HTTP deployment health check cannot reach a
  loopback application. Remove that HTTP health-check setting for this mode and
  supervise app/connector readiness locally before operator acceptance; do not
  reopen the app listener to make the previous health check pass.
- Stop/restart both supervised processes together when either fails. Redact connector
  credentials, auth queries and request bodies; do not put tokens on logged commands.

Bypass closure at cutover:

1. Remove the staging custom domain from Railway public ingress and switch its
   Cloudflare DNS record to the named Tunnel. Preserve the frontend origin and
   Google callback URL; no new OAuth origin is required.
2. Confirm no Railway-generated domain exists; remove any found during final
   inventory. Confirm no public TCP proxy exists. Keep these absent afterward.
3. Retain private PostgreSQL access but prove app HTTP port is unreachable from the
   existing database container over both private IPv4 and IPv6. Forging public
   Host/Origin or visitor headers must not establish a connection.
4. Test the old public/CNAME-target paths and direct private paths after cutover.
   A healthy custom-domain page alone is not sufficient evidence.

The exact app middleware, image changes and process supervision must be implemented,
tested and reviewed before enabling Tunnel mode. This document does not activate
an untested header-trust feature.

## Cost and approval

Cloudflare advertises [free Tunnel availability](https://blog.cloudflare.com/tunnel-for-everyone/)
and [current free-plan entry](https://www.cloudflare.com/plans/zero-trust-services/).
Expected Tunnel service fee is $0 on the verified Free plan. Confirm the actual
account's plan, card requirement, quotas and automatic-upgrade behavior before
creating/activating anything; the public pages do not prove that account's billing.
Use no paid Access, Workers, Argo routing, load balancing or add-ons.

The connector consumes additional Railway CPU/memory even in the existing container.
[Published Railway rates](https://docs.railway.com/pricing/plans) are $10/GB-month
RAM, $20/vCPU-month and $0.05/GB egress. As an explicit estimate, not a measurement:
50–100 MB average additional RAM plus 0.01–0.05 average vCPU is approximately
$0.70–$2/month, or $0.05–$0.14 for 48 hours, plus traffic. Actual connector usage
must be measured; the current 0.5 GB container may need attention, and no resource
increase is authorised. Unused Hobby credit can cover usage but is shared with
production and cannot be assumed available. Do not change workspace spending limits.
The earlier 48-hour staging budget is not an open-ended extension.

Before provisioning, obtain explicit approval for this topology, a bounded staging
budget/window and confirmed free-only Cloudflare activation. No approval to change
production follows from a staging approval.

## Rollback and verification

Record the old staging CNAME, Railway domain/target port, deployment image and health
configuration before changes. A failed cutover should leave auth unavailable rather
than trusting unauthenticated headers.

For rollback, restore a previously verified **Tunnel-capable** image while keeping
the loopback binding and closed alternate routes. Keep the database and histories
intact. If this is the first Tunnel rollout and no such image exists, use a
maintenance/503 Tunnel route or stop the connector while retaining the private-only
app listener. Revoke temporary/unused connector credentials after recovery.

Do not automatically restore the old publicly reachable Railway image/domain:
that would restore the known-broken limiter and violate the public-signup gate.
Returning to the old topology for further restricted diagnostics needs a separate
access-control plan and approval. Rollback can mean temporary staging unavailability;
this is preferable to silently reopening unprotected login/signup/recovery.
There is no database/schema migration in this topology change.

Acceptance before recommending ready: two independent external connections, first
client exceeds its allowance while the other retains it; forged victim headers
cannot consume another bucket; duplicate/malformed/missing headers rejected; no
public/generated/TCP/private bypass; counter window reset; real Google, delivered
verification/reset, logout/renewal and two-user isolation tests pass on the tested
image. Record PASS/FAIL/NOT RUN individually and retain only sanitized evidence.


## Exact staging acceptance sequence

Keep the current shared limit **5 requests per canonical client IP per fixed
60-second window**. Do not loosen it to make the failing repro appear successful.
Use synthetic accounts and coordinate requests so unrelated tests do not spend
these buckets. Record tested commit, image, timestamps, route/method and statuses;
never retain raw IPs, email addresses, tokens or cookies.

1. After a quiet window, client A sends five inert requests: all reach normal
   validation; requests six and seven return 429 with Retry-After.
2. Before A's window resets, client B on another network sends one request and
   reaches normal validation, not 429. Repeat A: still 429. Verify A/B have distinct
   network egress addresses; separate browser tabs alone are not independent clients.
3. A varies X-Real-IP, X-Forwarded-For, Forwarded and CF-Connecting-IP, including
   B's real address handled only in test memory. A remains throttled; B retains its
   remaining allowance. Include duplicate/list-valued headers and IPv6.
4. From the database container, private IPv4/IPv6 connections to the app HTTP port
   fail. Old Railway domains/CNAME-target routes and any TCP proxy cannot reach
   the API. Re-inventory networking; an absent DNS record alone is not a firewall.
5. After the window, A regains allowance. Test POST login/signup/reset separately
   using deliberate validation failures so no email is sent; cover `/public/`
   aliases and existing Google/verification/reset-completion endpoints as well.
6. Repeat real Google/email/session and two-user private-data tests on this image.
   A passing inert rate test is not proof of successful provider authentication.

Missing any check keeps public signup blocked and #63 draft. Until provisioned,
these are proposed tests, not PASS evidence.

## Separate proposed production thresholds

These are starting recommendations for later review and observation, **not current
settings or permission to open registration**. Implement route-specific windows
only after accepting that policy and verifying the ingress fix.

| Action | Initial per-IP proposal | Notes |
| --- | --- | --- |
| Password login | 20 per 60 seconds | Keep tenant/identifier failure backoff independent; never permanently lock an account because others submitted failures. |
| Signup | 5 per 10 minutes | Count duplicate/unknown requests identically; monitor shared-network/NAT impact. |
| Request password-reset email | 5 per 15 minutes | Preserve conditional acknowledgement; use a separately reviewed per-recipient mail-send budget to limit inbox abuse without disclosing account existence. |
| Other currently limited auth actions | Retain protection; size each route separately | Do not accidentally remove Google, verification or completion-route/alias coverage when splitting the policy. |

Return 429 plus Retry-After for IP exhaustion, monitor false positives and provider
quotas, and adjust from evidence. IPs identify network exits, not people; shared
networks and distributed attackers make the separate identifier/delivery controls
necessary. Staging remains at 5/60, unchanged.

### Staging implementation checkpoint — 6 November 2026

The staging-only runtime pins `cloudflare/cloudflared:2026.10.7` by multi-platform
image digest. `AUTH_INGRESS_MODE=cloudflare_tunnel` starts Uvicorn on
`127.0.0.1:$PORT` with proxy-header middleware disabled. The connector's metrics
listener also binds loopback. A supervisor stops both processes if either exits.
The sealed `CLOUDFLARE_TUNNEL_TOKEN` is copied to a mode-0600 temporary file;
neither child receives the credential in its environment or command line. Only
the existing staging environment ID is permitted to use this proof-of-concept runtime.

The HTTP boundary requires a loopback transport peer and one valid
`CF-Connecting-IP`; missing/duplicate/invalid identity is rejected without a
fallback. `X-Real-IP` and `X-Forwarded-For` do not select the bucket. The local
health probe is exempt from the identity requirement. This is safe only together
with the loopback binding and absence of other untrusted local proxy processes.
Cloudflare Workers/header transforms must not be introduced on the staging route
without reviewing their effect on client identity.

Local verification: 28 tests passed across Tunnel identity/runtime, existing proxy
throttling, and identifier-based password backoff. These tests do not establish
Cloudflare's browser-side header replacement or hosted route closure. Hosted
A/B, spoofing, public/private bypass and incremental-usage results remain NOT RUN
until the token is applied, the connector is deployed, and the hostname is routed.

Before-runtime billing baseline: Railway reports staging app cumulative
$0.1141827189 and isolated staging database $0.0351939502 for the billing period
18 October–18 November 2026. These are existing cumulative charges, not Tunnel
cost. A later difference includes ordinary app/database operation and must not be
attributed entirely to the connector. Measure connector CPU/RSS separately and
report the observation interval.

Additional local checks: full backend suite 207 passed, 1 skipped (managed Core
integration not enabled); the subsequently added supervisor cleanup test also
passed. Ruff and `git diff --check` passed. The Docker image built successfully
and its installed binary reports cloudflared 2026.10.7. No staging deployment or
hostname cutover has occurred at this checkpoint: the applied staging variable
list does not yet contain `CLOUDFLARE_TUNNEL_TOKEN`.
