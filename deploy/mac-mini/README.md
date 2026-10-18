# Hosting the game server on a Mac mini

The site (client) stays on GitHub Pages. Only the WebSocket server runs here, behind a tunnel.

1. On the dev Mac: `bash deploy/mac-mini/make-bundle.sh` creates `deploy-bundle/toybox-server.zip` (about 100 KB: server + shared only).
2. Send that zip to the mini and give the mini's Codex the prompt in `CODEX_PROMPT.md`.
3. When Codex reports the public `https://….ts.net` URL, point the site at it:
   `gh variable set VITE_SERVER_URL --body https://<url> -R c28aa1-rgb/Toybox`, then re-run the "Deploy site to GitHub Pages" workflow (or push to `main`).
4. The server only accepts sockets from the origins in `ALLOWED_ORIGINS` (set in the mini's `.env`).

Updating later: re-run `make-bundle.sh`, send the zip, unzip over `~/toybox-server` (keep `.env`), run `npm ci -w server` and `launchctl kickstart -k gui/$(id -u)/com.toybox.server`.
