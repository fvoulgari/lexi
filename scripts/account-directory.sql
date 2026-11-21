-- Operator-run preparation for a reviewed non-production rehearsal.
-- Roles must already exist. Never run this against production before approval.
-- Run schema migrations using a separate owner connection before configuring
-- the runtime role. Credentials and role membership are provisioned separately.
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lexi_app') OR
     NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lexi_operator') THEN
    RAISE EXCEPTION 'Create distinct lexi_app and lexi_operator roles first';
  END IF;
  IF (SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls
      FROM pg_roles WHERE rolname = 'lexi_app') THEN
    RAISE EXCEPTION 'The application role must not have administrative privileges';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles r
             WHERE (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolbypassrls)
             AND pg_has_role('lexi_app', r.oid, 'MEMBER')) THEN
    RAISE EXCEPTION 'Application role belongs to a privileged role';
  END IF;
  IF has_schema_privilege('lexi_app', 'public', 'CREATE') OR
     has_database_privilege('lexi_app', current_database(), 'CREATE') OR
     EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname IN ('accounts', 'profiles')
             AND pg_has_role('lexi_app', c.relowner, 'MEMBER')) THEN
    RAISE EXCEPTION 'Application role has schema or table ownership privileges';
  END IF;
  IF pg_has_role('lexi_app', 'lexi_operator', 'MEMBER') OR
     pg_has_role('lexi_operator', 'lexi_app', 'MEMBER') THEN
    RAISE EXCEPTION 'Application and operator roles must not inherit each other';
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO lexi_app, lexi_operator;
-- Explicitly enumerate application tables; no grants on future objects or views.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.accounts, public.account_deletions, public.profiles, public.units, public.tags,
  public.vocabulary_entries, public.entry_tags, public.collections,
  public.collection_entries, public.practice_sessions, public.session_cards,
  public.review_events, public.learning_progress, public.login_throttles,
  public.security_events, public.legacy_claim_links,
  public.legacy_claim_continuations, public.legacy_progress_requests,
  public.legacy_resolution_cases, public.gate_sessions
TO lexi_app;
GRANT SELECT ON public.alembic_version TO lexi_app;
CREATE OR REPLACE VIEW public.account_directory AS
SELECT a.id AS account_id, p.display_name, p.id AS profile_id, a.role
FROM public.accounts AS a JOIN public.profiles AS p ON p.id = a.profile_id;
REVOKE ALL ON public.account_directory FROM PUBLIC, lexi_app;
GRANT SELECT ON public.account_directory TO lexi_operator;
DO $$
BEGIN
  IF has_table_privilege('lexi_app', 'public.account_directory', 'SELECT') OR
     NOT has_table_privilege('lexi_operator', 'public.account_directory', 'SELECT') THEN
    RAISE EXCEPTION 'account_directory privilege verification failed';
  END IF;
END $$;
COMMIT;
