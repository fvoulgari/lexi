-- Reviewed console runner for revisions f80b11e3f013 through c03e95b6c015.
-- Run with psql -X -v ON_ERROR_STOP=1 -v target_db=railway -f FILE.
-- It refuses an unexpected database, revision, role or index definition.
\if :{?target_db}
\else
  \echo 'target_db is required'
  SELECT 1 / 0;
\endif
SELECT current_database() = :'target_db' AS target_matches \gset
\if :target_matches
\else
  \echo 'unexpected database'
  SELECT 1 / 0;
\endif
BEGIN;
DO $$
DECLARE definition text;
BEGIN
  IF (SELECT count(*) FROM alembic_version WHERE version_num='f80b11e3f013') <> 1
     OR (SELECT count(*) FROM alembic_version) <> 1 THEN
    RAISE EXCEPTION 'unexpected Alembic revision';
  END IF;
  IF current_user <> 'postgres' OR EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN (
      'alembic_version','gate_sessions','legacy_claim_continuations',
      'vocabulary_entries','legacy_claim_links','legacy_progress_requests',
      'legacy_resolution_cases'
    ) AND pg_get_userbyid(c.relowner) <> 'postgres'
  ) THEN
    RAISE EXCEPTION 'unexpected migration operator or table owner';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lexi_app') THEN
    RAISE EXCEPTION 'runtime role is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='lexi_release_migrate') THEN
    RAISE EXCEPTION 'temporary migration role already exists';
  END IF;
  SELECT indexdef INTO definition FROM pg_indexes WHERE schemaname='public' AND indexname='ix_gate_sessions_expires_at';
  IF definition IS DISTINCT FROM 'CREATE INDEX ix_gate_sessions_expires_at ON public.gate_sessions USING btree (expires_at)' THEN
    RAISE EXCEPTION 'unexpected gate expiry index definition';
  END IF;
  SELECT indexdef INTO definition FROM pg_indexes WHERE schemaname='public' AND indexname='ix_legacy_claim_continuations_expires_at';
  IF definition IS DISTINCT FROM 'CREATE INDEX ix_legacy_claim_continuations_expires_at ON public.legacy_claim_continuations USING btree (expires_at)' THEN
    RAISE EXCEPTION 'unexpected continuation expiry index definition';
  END IF;
END $$;
CREATE ROLE lexi_release_migrate NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE, CREATE ON SCHEMA public TO lexi_release_migrate;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO lexi_release_migrate;
GRANT REFERENCES ON accounts, profiles TO lexi_release_migrate;
ALTER TABLE alembic_version OWNER TO lexi_release_migrate;
ALTER TABLE gate_sessions OWNER TO lexi_release_migrate;
ALTER TABLE legacy_claim_continuations OWNER TO lexi_release_migrate;
ALTER TABLE vocabulary_entries OWNER TO lexi_release_migrate;
ALTER TABLE legacy_claim_links OWNER TO lexi_release_migrate;
ALTER TABLE legacy_progress_requests OWNER TO lexi_release_migrate;
ALTER TABLE legacy_resolution_cases OWNER TO lexi_release_migrate;
SET LOCAL ROLE lexi_release_migrate;

DROP INDEX public.ix_gate_sessions_expires_at;

DROP INDEX public.ix_legacy_claim_continuations_expires_at;
UPDATE alembic_version SET version_num='a91c73f4a014' WHERE alembic_version.version_num = 'f80b11e3f013';
ALTER TABLE vocabulary_entries ALTER COLUMN unit_id DROP NOT NULL;
UPDATE alembic_version SET version_num='b92d84a5b014' WHERE alembic_version.version_num = 'a91c73f4a014';

CREATE TABLE recovery_case_guards (
	case_id UUID NOT NULL, 
	account_id UUID NOT NULL, 
	legacy_profile_id UUID NOT NULL, 
	current_profile_id UUID NOT NULL, 
	PRIMARY KEY (case_id), 
	FOREIGN KEY(account_id) REFERENCES accounts (id) ON DELETE CASCADE, 
	FOREIGN KEY(legacy_profile_id) REFERENCES profiles (id) ON DELETE RESTRICT, 
	FOREIGN KEY(current_profile_id) REFERENCES profiles (id) ON DELETE RESTRICT
);
INSERT INTO recovery_case_guards SELECT id, account_id, legacy_profile_id, current_profile_id FROM legacy_resolution_cases;
ALTER TABLE legacy_claim_links DROP CONSTRAINT legacy_claim_links_profile_id_fkey;
ALTER TABLE legacy_claim_links ALTER COLUMN profile_id DROP NOT NULL;
ALTER TABLE legacy_claim_links ADD CONSTRAINT legacy_claim_links_profile_id_fkey FOREIGN KEY(profile_id) REFERENCES profiles (id) ON DELETE SET NULL;
ALTER TABLE legacy_claim_links DROP CONSTRAINT legacy_claim_links_issued_by_fkey;
ALTER TABLE legacy_claim_links ALTER COLUMN issued_by DROP NOT NULL;
ALTER TABLE legacy_claim_links ADD CONSTRAINT legacy_claim_links_issued_by_fkey FOREIGN KEY(issued_by) REFERENCES accounts (id) ON DELETE SET NULL;
ALTER TABLE legacy_progress_requests DROP CONSTRAINT legacy_progress_requests_account_id_fkey;
ALTER TABLE legacy_progress_requests ALTER COLUMN account_id DROP NOT NULL;
ALTER TABLE legacy_progress_requests ADD CONSTRAINT legacy_progress_requests_account_id_fkey FOREIGN KEY(account_id) REFERENCES accounts (id) ON DELETE SET NULL;
ALTER TABLE legacy_progress_requests DROP CONSTRAINT legacy_progress_requests_resolved_by_fkey;
ALTER TABLE legacy_progress_requests ALTER COLUMN resolved_by DROP NOT NULL;
ALTER TABLE legacy_progress_requests ADD CONSTRAINT legacy_progress_requests_resolved_by_fkey FOREIGN KEY(resolved_by) REFERENCES accounts (id) ON DELETE SET NULL;
ALTER TABLE legacy_resolution_cases DROP CONSTRAINT legacy_resolution_cases_account_id_fkey;
ALTER TABLE legacy_resolution_cases ALTER COLUMN account_id DROP NOT NULL;
ALTER TABLE legacy_resolution_cases ADD CONSTRAINT legacy_resolution_cases_account_id_fkey FOREIGN KEY(account_id) REFERENCES accounts (id) ON DELETE SET NULL;
ALTER TABLE legacy_resolution_cases DROP CONSTRAINT legacy_resolution_cases_legacy_profile_id_fkey;
ALTER TABLE legacy_resolution_cases ALTER COLUMN legacy_profile_id DROP NOT NULL;
ALTER TABLE legacy_resolution_cases ADD CONSTRAINT legacy_resolution_cases_legacy_profile_id_fkey FOREIGN KEY(legacy_profile_id) REFERENCES profiles (id) ON DELETE SET NULL;
ALTER TABLE legacy_resolution_cases DROP CONSTRAINT legacy_resolution_cases_current_profile_id_fkey;
ALTER TABLE legacy_resolution_cases ALTER COLUMN current_profile_id DROP NOT NULL;
ALTER TABLE legacy_resolution_cases ADD CONSTRAINT legacy_resolution_cases_current_profile_id_fkey FOREIGN KEY(current_profile_id) REFERENCES profiles (id) ON DELETE SET NULL;

        CREATE FUNCTION anonymize_deleted_recovery_request() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
          IF OLD.account_id IS NOT NULL AND NEW.account_id IS NULL THEN
            NEW.profile_name := '[deleted]'; NEW.note := NULL;
          END IF;
          RETURN NEW;
        END $$;
CREATE TRIGGER anonymize_deleted_recovery_request BEFORE UPDATE ON legacy_progress_requests FOR EACH ROW EXECUTE FUNCTION anonymize_deleted_recovery_request();
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lexi_app') THEN GRANT SELECT ON recovery_case_guards TO lexi_app; END IF; END $$;
UPDATE alembic_version SET version_num='c03e95b6c015' WHERE alembic_version.version_num = 'b92d84a5b014';
RESET ROLE;
REASSIGN OWNED BY lexi_release_migrate TO postgres;
DROP OWNED BY lexi_release_migrate;
DROP ROLE lexi_release_migrate;
COMMIT;
