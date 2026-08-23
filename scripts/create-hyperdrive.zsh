#!/bin/zsh

set -euo pipefail

typeset bidstage_neon_host
typeset bidstage_neon_password

read -r "bidstage_neon_host?Direct Neon hostname for bidstage_runtime: "
if [[ -z "$bidstage_neon_host" ]]; then
  print -u2 "A Neon hostname is required."
  exit 1
fi
if [[ "$bidstage_neon_host" == *://* || "$bidstage_neon_host" == */* || "$bidstage_neon_host" == *:* ]]; then
  print -u2 "Enter only the hostname, without a protocol, port, path, or password."
  exit 1
fi
if [[ "$bidstage_neon_host" == *-pooler.* ]]; then
  print -u2 "Choose Neon's direct connection hostname. Hyperdrive must not connect to the Neon pooler."
  exit 1
fi
if [[ "$bidstage_neon_host" != ep-*.neon.tech ]]; then
  print -u2 "The hostname does not match a Neon direct endpoint."
  exit 1
fi

read -r -s "bidstage_neon_password?Password for the bidstage_runtime role: "
print
if [[ -z "$bidstage_neon_password" ]]; then
  print -u2 "A runtime-role password is required."
  exit 1
fi

trap 'unset bidstage_neon_password' EXIT INT TERM

bunx wrangler hyperdrive create bidstage-neon \
  --origin-host "$bidstage_neon_host" \
  --origin-port 5432 \
  --origin-scheme postgresql \
  --database bidstage \
  --origin-user bidstage_runtime \
  --origin-password "$bidstage_neon_password" \
  --sslmode require \
  --caching-disabled \
  --binding HYPERDRIVE \
  --update-config
