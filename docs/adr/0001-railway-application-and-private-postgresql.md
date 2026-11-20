# One Railway application service and private PostgreSQL

Deploy the built React frontend and FastAPI API together in one application Docker service on Railway, with a separate privately connected PostgreSQL service. This follows the requested container deployment while keeping durable database storage independent of application replacement and avoiding cross-origin browser requests. Railway terminates HTTPS; Docker Compose supports local development rather than defining the production topology.


## Staging authenticated-ingress exception — 7 November 2026

The auth staging proof of concept keeps one application container and private
PostgreSQL, but terminates public HTTPS at Cloudflare. An authenticated outbound
Tunnel reaches a connector beside Lexi, and Lexi listens only on loopback.
Railway public app domains/TCP proxies are removed; private-network HTTP access
is also closed by the loopback binding. The backend uses only canonical
CF-Connecting-IP from this isolated path; missing/invalid/duplicate values fail
closed. Railway's public HTTP healthcheck cannot reach this listener. Local
app plus connector readiness and a bounded supervisor watchdog govern recovery.

This exception is staging-only. Production still requires a reviewed ingress
configuration and separate routing approval; never enable header trust on the
old listener, infer proxy CIDRs or reopen an unprotected origin as a fallback.
