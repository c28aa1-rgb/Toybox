#!/bin/bash
# Started by launchd. Loads .env, then runs the game server.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a
cd "$ROOT/server"
exec "$ROOT/node_modules/.bin/tsx" src/index.ts
