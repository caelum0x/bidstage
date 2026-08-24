#!/bin/zsh

set -euo pipefail
umask 077

readonly script_directory="${0:A:h}"
readonly project_directory="${script_directory:h}"
readonly credential_file="${project_directory}/env.txt"

typeset github_client_id=''
typeset github_client_secret=''
typeset google_client_id=''
typeset google_client_secret=''

secret_value() {
  local key="$1"
  local value
  value="$(sed -nE "s/^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=[[:space:]]*([^[:space:]]+)[[:space:]]*$/\\2/p" "$credential_file" | tail -n 1)"
  value="${value#\"}"
  value="${value%\"}"
  value="${value#\'}"
  value="${value%\'}"
  print -rn -- "$value"
}

put_secret() {
  local name="$1"
  local value="$2"
  print -rn -- "$value" | wrangler secret put "$name" --config "${project_directory}/wrangler.jsonc" >/dev/null
  print "Configured ${name}."
}

if [[ ! -f "$credential_file" ]]; then
  print -u2 "Missing ${credential_file}."
  exit 1
fi
chmod 600 "$credential_file"

github_client_id="$(secret_value GITHUB_CLIENT_ID)"
github_client_secret="$(secret_value GITHUB_CLIENT_SECRET)"
google_client_id="$(secret_value GOOGLE_CLIENT_ID)"
google_client_secret="$(secret_value GOOGLE_CLIENT_SECRET)"
if [[ -z "$google_client_secret" ]]; then
  google_client_secret="$(secret_value GOGGLE_CLIENT_SECRET)"
fi

if [[ -z "$github_client_id" || -z "$github_client_secret" || -z "$google_client_id" || -z "$google_client_secret" ]]; then
  print -u2 'env.txt needs GitHub and Google client IDs and client secrets.'
  exit 1
fi

export WRANGLER_LOG_PATH="${project_directory}/.wrangler/wrangler.log"
export WRANGLER_LOG_SANITIZE='true'
wrangler secret list --config "${project_directory}/wrangler.jsonc" >/dev/null

put_secret GITHUB_CLIENT_ID "$github_client_id"
put_secret GITHUB_CLIENT_SECRET "$github_client_secret"
put_secret GOOGLE_CLIENT_ID "$google_client_id"
put_secret GOOGLE_CLIENT_SECRET "$google_client_secret"
put_secret FOUNDER_ACCESS_SECRET "$(openssl rand -hex 32)"
put_secret RATE_LIMIT_SALT "$(openssl rand -hex 32)"
put_secret MAINTENANCE_SECRET "$(openssl rand -hex 32)"

unset github_client_secret google_client_secret
print 'Production authentication secrets are configured.'
