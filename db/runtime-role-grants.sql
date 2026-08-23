\set ON_ERROR_STOP on

SELECT current_database() = 'bidstage' AS is_bidstage_database \gset
\if :is_bidstage_database
\else
  \echo 'Refusing runtime grants outside the bidstage database.'
  \quit 1
\endif

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bidstage_runtime') THEN
    RAISE EXCEPTION 'Create the bidstage_runtime login role before applying grants';
  END IF;
  IF pg_has_role('bidstage_runtime', 'neon_superuser', 'member') THEN
    RAISE EXCEPTION 'bidstage_runtime must not inherit neon_superuser';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'bidstage_runtime'
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'bidstage_runtime has elevated PostgreSQL privileges';
  END IF;
END
$$;

REVOKE CREATE ON DATABASE bidstage FROM bidstage_runtime;
REVOKE CREATE ON SCHEMA public FROM bidstage_runtime;
GRANT CONNECT ON DATABASE bidstage TO bidstage_runtime;
GRANT USAGE ON SCHEMA public TO bidstage_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bidstage_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bidstage_runtime;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bidstage_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO bidstage_runtime;
