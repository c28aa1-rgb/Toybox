#!/bin/bash
# Run on the Mac mini from the unpacked toybox-server folder:  bash deploy/mac-mini/setup.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  command -v brew >/dev/null || { echo "Install Homebrew first: https://brew.sh"; exit 1; }
  brew install node@22
  brew link --overwrite --force node@22
fi
echo "node $(node -v)"

# Only the server and shared packages; the client is built and hosted by GitHub Pages.
npm ci -w server

if [ ! -f .env ]; then
  cp deploy/mac-mini/env.example .env
  sed -i '' "s#/Users/CHANGE_ME#$HOME#" .env
  chmod 600 .env
  echo "Created .env. Put your Firebase key at the GOOGLE_APPLICATION_CREDENTIALS path, then re-run this script."
fi
chmod 600 .env
KEY="$(grep '^GOOGLE_APPLICATION_CREDENTIALS=' .env | cut -d= -f2-)"
if [ ! -f "$KEY" ]; then
  echo "Missing Firebase key at: $KEY"
  echo "Create it (mkdir -p \"$(dirname "$KEY")\"; chmod 700 \"$(dirname "$KEY")\"), put the key file there, chmod 600, then re-run."
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
PLIST="$HOME/Library/LaunchAgents/com.toybox.server.plist"
sed -e "s#__ROOT__#$ROOT#g" -e "s#__HOME__#$HOME#g" deploy/mac-mini/com.toybox.server.plist.template > "$PLIST"
launchctl bootout "gui/$(id -u)/com.toybox.server" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/com.toybox.server"

PORT="$(grep '^GG_PORT=' .env | cut -d= -f2)"
for i in $(seq 1 30); do
  if curl -fs "http://127.0.0.1:$PORT/health" >/dev/null; then echo "Server is up on 127.0.0.1:$PORT (log: ~/Library/Logs/toybox-server.log)"; exit 0; fi
  sleep 1
done
echo "Server did not come up. Last log lines:"; tail -30 "$HOME/Library/Logs/toybox-server.log"; exit 1
