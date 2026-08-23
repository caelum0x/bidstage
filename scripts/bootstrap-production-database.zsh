#!/bin/zsh

set -euo pipefail
umask 077

readonly script_directory="${0:A:h}"
readonly project_directory="${script_directory:h}"
readonly credential_file="${project_directory}/env.txt"
readonly neon_direct_host="${BIDSTAGE_NEON_DIRECT_HOST:-ep-long-base-axpirpa0.c-4.us-east-2.aws.neon.tech}"
readonly bootstrap_database="neondb"
readonly application_database="bidstage"
readonly runtime_role="bidstage_runtime"
readonly postgres_root_certificate="${BIDSTAGE_PGSSLROOTCERT:-/etc/ssl/cert.pem}"

typeset owner_user=''
typeset owner_password=''
typeset runtime_password=''
typeset database_url=''

cleanup() {
  unset owner_password runtime_password database_url PGPASSWORD DATABASE_URL
}
trap cleanup EXIT INT TERM

if [[ ! -f "$credential_file" ]]; then
  print -u2 "Missing ${credential_file}."
  exit 1
fi

if grep -Eq '"binding"[[:space:]]*:[[:space:]]*"HYPERDRIVE"' "${project_directory}/wrangler.jsonc" \
  && grep -Eq '"id"[[:space:]]*:[[:space:]]*"[0-9a-f]{32}"' "${project_directory}/wrangler.jsonc"; then
  print 'Hyperdrive is already configured; no database credentials were changed.'
  exit 0
fi

if [[ "$(stat -f '%OLp' "$credential_file")" != '600' ]]; then
  chmod 600 "$credential_file"
fi

owner_user="$(sed -nE 's/^[[:space:]]*(export[[:space:]]+)?PGUSER[[:space:]]*=[[:space:]]*([^[:space:]]+)[[:space:]]*$/\2/p' "$credential_file" | tail -n 1)"
owner_password="$(sed -nE 's/^[[:space:]]*(export[[:space:]]+)?PGPASSWORD[[:space:]]*=[[:space:]]*([^[:space:]]+)[[:space:]]*$/\2/p' "$credential_file" | tail -n 1)"
owner_user="${owner_user#\"}"
owner_user="${owner_user%\"}"
owner_user="${owner_user#\'}"
owner_user="${owner_user%\'}"
owner_password="${owner_password#\"}"
owner_password="${owner_password%\"}"
owner_password="${owner_password#\'}"
owner_password="${owner_password%\'}"

if [[ "$owner_user" != 'neondb_owner' || -z "$owner_password" ]]; then
  print -u2 'env.txt must contain PGUSER and PGPASSWORD for the Neon owner bootstrap account.'
  exit 1
fi

if [[ "$neon_direct_host" != ep-*.neon.tech || "$neon_direct_host" == *-pooler.* ]]; then
  print -u2 'BIDSTAGE_NEON_DIRECT_HOST must be a direct ep-*.neon.tech hostname without -pooler.'
  exit 1
fi
if [[ ! -r "$postgres_root_certificate" || ! -s "$postgres_root_certificate" ]]; then
  print -u2 "A readable PostgreSQL CA bundle is required at ${postgres_root_certificate}."
  print -u2 'Set BIDSTAGE_PGSSLROOTCERT to a trusted PEM CA bundle and retry.'
  exit 1
fi

for command_name in psql createdb openssl bun; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    print -u2 "Required command is unavailable: ${command_name}"
    exit 1
  fi
done

runtime_password="$(openssl rand -hex 32)"
if [[ ${#runtime_password} -ne 64 || "$runtime_password" == *[^0-9a-f]* ]]; then
  print -u2 'Failed to generate a safe runtime password.'
  exit 1
fi

export PGHOST="$neon_direct_host"
export PGPORT='5432'
export PGUSER="$owner_user"
export PGPASSWORD="$owner_password"
export PGSSLMODE='verify-full'
export PGSSLROOTCERT="$postgres_root_certificate"
export PGCONNECT_TIMEOUT='15'

print 'Checking the Neon owner connection...'
psql --no-psqlrc -X --dbname "$bootstrap_database" --quiet --tuples-only \
  --command "SELECT 1" >/dev/null

if [[ -z "$(psql --no-psqlrc -X --dbname "$bootstrap_database" --quiet --tuples-only --no-align \
  --command "SELECT 1 FROM pg_database WHERE datname = '${application_database}'")" ]]; then
  print 'Creating the bidstage database...'
  createdb --maintenance-db "$bootstrap_database" "$application_database"
else
  print 'The bidstage database already exists.'
fi

database_url="$(
  BIDSTAGE_URL_USER="$owner_user" \
  BIDSTAGE_URL_PASSWORD="$owner_password" \
  BIDSTAGE_URL_HOST="$neon_direct_host" \
  bun -e '
    const url = new URL("postgresql://localhost/bidstage");
    url.hostname = process.env.BIDSTAGE_URL_HOST;
    url.port = "5432";
    url.username = process.env.BIDSTAGE_URL_USER;
    url.password = process.env.BIDSTAGE_URL_PASSWORD;
    url.searchParams.set("sslmode", "verify-full");
    process.stdout.write(url.toString());
  '
)"

print 'Applying Bidstage migrations...'
(cd "$project_directory" && DATABASE_URL="$database_url" bun run migrate)

export PGDATABASE="$application_database"

print 'Creating or rotating the restricted bidstage_runtime role...'
psql --no-psqlrc -X <<SQL
\set ON_ERROR_STOP on

SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bidstage_runtime') AS runtime_role_exists \gset
\if :runtime_role_exists
  ALTER ROLE bidstage_runtime
    WITH LOGIN PASSWORD '${runtime_password}';
\else
  CREATE ROLE bidstage_runtime
    WITH LOGIN PASSWORD '${runtime_password}'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
\endif
SQL

psql --no-psqlrc -X --file "${project_directory}/db/runtime-role-grants.sql"

unset owner_password PGPASSWORD database_url DATABASE_URL
mkdir -p "${project_directory}/.wrangler"
export WRANGLER_LOG_PATH="${project_directory}/.wrangler/wrangler.log"

print 'Creating the Cloudflare Hyperdrive binding...'
(cd "$project_directory" && bunx wrangler hyperdrive create bidstage-neon \
  --origin-host "$neon_direct_host" \
  --origin-port 5432 \
  --origin-scheme postgresql \
  --database "$application_database" \
  --origin-user "$runtime_role" \
  --origin-password "$runtime_password" \
  --sslmode require \
  --caching-disabled \
  --binding HYPERDRIVE \
  --update-config)

print 'Database migrations, runtime access, and Hyperdrive are configured.'
print 'Next security action: reset the exposed neondb_owner password in the Neon dashboard.'
