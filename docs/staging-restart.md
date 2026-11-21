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
2. Select **lexi-staging** (service `37520d89-9bee-43e1-8955-44b0d0325495`)
   and redeploy its existing build for deployment
   `e564dded-0aa0-472d-999d-59f86cc88fb3`. Wait for it to be healthy, then
   verify the staging sign-in and database connection. The build's recorded
   digest was `sha256:3e162cd2ea98d35845f21b7f6fed08ae3d62f093e8e010d9257ffd2f2ab53189`.

Railway reported both stopped deployments as redeployable. The app has no
configured source and an older failed deployment appears as its latest after
stopping; do not use an unqualified latest-deployment redeploy. Select the
specific recorded deployment. A restart was not exercised during shutdown.
