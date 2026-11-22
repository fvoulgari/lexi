# Restarting the paused staging environment

On 21 November 2026, the staging application and staging PostgreSQL deployments
were stopped to avoid unnecessary compute. The services, variables, deployment
history and database volume were retained. Production is a separate environment;
check the environment ID before every action.

Project: `de2e2c78-8a6b-41aa-afeb-c6d8002ecc79`  
Staging environment: `8bb27c88-f6a8-4074-b701-bcefb982ab2d`

1. In Railway, select **staging**, then **Postgres-kSKC** (service
   `dce7d9f8-d9df-40e7-8987-6e3524f76ab2`). From its deployment history,
   redeploy the existing build for deployment
   `a7bf48a5-a23e-4738-ae0e-c2741a9c2444` and wait for it to be healthy.
   Its image was `ghcr.io/railwayapp-templates/postgres-ssl:18`; its retained
   volume is `postgres-volume-lj0z` (`0ecb918f-10db-4dea-8000-f1f4f9d3eb4d`)
   mounted at `/var/lib/postgresql/data`. Do not create a replacement database
   or delete or detach this volume.
2. For a smoke test of the retained release, select **lexi-staging** (service
   `37520d89-9bee-43e1-8955-44b0d0325495`) and redeploy its existing build for deployment
   `e564dded-0aa0-472d-999d-59f86cc88fb3`. Wait for it to be healthy, then
   verify the staging sign-in and database connection. The build's recorded
   digest was `sha256:3e162cd2ea98d35845f21b7f6fed08ae3d62f093e8e010d9257ffd2f2ab53189`.

Railway reported both stopped deployments as redeployable. The app has no
configured source and an older failed deployment appears as its latest after
stopping; do not use an unqualified latest-deployment redeploy. Select the
specific recorded deployment. A restart was not exercised during shutdown.

## Testing current `main`

Keep the staging app stopped after starting PostgreSQL. In an authenticated
operator session, verify the target is staging, read `alembic current`, and take
and verify a protected staging backup before changing the database. Compare the
recorded revision with `alembic heads` from the exact build you plan to test.

As of 22 November 2026, `main` expects `a47c39f0a019`. If the staging database
still has legacy Units awaiting migration, use the compatible pre-retirement
build and the [Collections cutover procedure](legacy-transition-audit.md) to
prepare and dry-run a staging-specific mapping, apply it, and verify there are no
leftovers before advancing to `f36b28e9f018` and `a47c39f0a019`. Those migrations
preserve Collection visibility and card provenance and remove the Unit table.
Review any pending retired recovery records before crossing those migrations.
Resolve a failed mapping or migration guard before continuing.

Apply outstanding revisions with Alembic in the staging operator session and
verify the resulting revision matches the target build. The current app checks
schema readiness at startup. Use the restricted staging runtime credential for
the app. Deploy the exact reviewed image to **lexi-staging**, then check health,
sign-in, Collections, and practice. Select a schema-compatible image or use the
verified backup if recovery is needed.

## Production recovery access

The operator's FileVault-protected checkout holds the independent recovery
archives and checksums under `.scratch/protected-recovery/`. The authorized macOS
operator account provides access. The accompanying retention notes record the
per-archive dates and verification evidence. Retain the 21 November sets through
at least 21 December 2026 and the 22 November sets through at least 22 December
2026. Review any incident hold before removing evidence. See the
[isolated restore and role recovery procedure](legacy-transition-audit.md#restoring-a-dump-that-references-cutover-roles).
