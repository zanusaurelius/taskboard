#!/bin/sh
set -e

SECRETS_FILE="/app/db/.secrets"

# Generate and persist AUTH_SECRET on first run
if [ ! -f "$SECRETS_FILE" ]; then
  SECRET=$(head -c 48 /dev/urandom | base64 | tr -d '\n/')
  printf 'AUTH_SECRET=%s\n' "$SECRET" > "$SECRETS_FILE"
  chmod 600 "$SECRETS_FILE"
fi

# shellcheck disable=SC1090
. "$SECRETS_FILE"
export AUTH_SECRET

# Trust the Host header from Start9's reverse proxy for auth redirects
export AUTH_TRUST_HOST=1

# Start9 exposes TOR_ADDRESS — use it to set AUTH_URL if available
if [ -n "$TOR_ADDRESS" ]; then
  export AUTH_URL="http://${TOR_ADDRESS}"
fi

# Database lives in the persistent volume, not the image's /app/prisma
export DATABASE_URL="file:/app/db/dev.db"

# Migrations run at unlock time via lib/migrations.ts — no migrate deploy needed here.
# better-sqlite3/lib/index.js is patched at Docker build time to auto-apply
# globalThis.__dbKey on every new Database() — covers both CJS require() and ESM import.
exec node server.js
