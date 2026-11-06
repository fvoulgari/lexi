# Authenticated origin proposal — not provisioned

Prepared 6 November 2026 after [Railway inventory and staging probes](authentication-hosted-rate-limits.md).
No tunnel, connector, DNS edit, service or paid plan has been activated.

## Why the current Railway configuration is insufficient

Railway's [specifications](https://docs.railway.com/networking/public-networking/specs-and-limits)
and [employee confirmation](https://station.railway.com/questions/need-authoritative-client-ip-proxy-tru-090eac86)
support public-edge header replacement, while private traffic bypasses it. No
published trusted-proxy range or signed ingress marker establishes provenance
inside this backend. Current operator access cannot execute the private-path test.
Do not adopt wildcard trust, guessed CIDRs, hop counts or matching Host/Origin.
A normal Cloudflare proxy with the current reachable backend would leave bypasses.

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
unchanged. Tunnel connector credentials authenticate the outbound connection;
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

For an explicitly authorised operational rollback, disable Tunnel-only IP-header
trust, restore the previous image/listener and health-check settings, restore the
Railway custom domain and original DNS target, and verify the basic auth boundary.
Then revoke/delete the unused tunnel credentials and connector. This returns to the
known unverified Railway limiter; it does not satisfy the release gate, so keep
real-user registration restricted and the PR draft. Do not mix old listener settings
with enabled Tunnel-header trust. No database migration or data rollback is needed.

Acceptance before recommending ready: two independent external connections, first
client exceeds its allowance while the other retains it; forged victim headers
cannot consume another bucket; duplicate/malformed/missing headers rejected; no
public/generated/TCP/private bypass; counter window reset; real Google, delivered
verification/reset, logout/renewal and two-user isolation tests pass on the tested
image. Record PASS/FAIL/NOT RUN individually and retain only sanitized evidence.
