You are setting up a small Node.js game server on this Mac mini (Apple Silicon, always on). It must keep running across reboots and be reachable from the internet through a tunnel. The mini also runs a Minecraft server: do NOT touch it, do not change router/firewall port forwarding, and do not use sudo unless you ask me first.

## What you have
A folder `toybox-server/` (sent to me as `toybox-server.zip`). Unzip it to `~/toybox-server`. It contains the game server (`server/`), shared code (`shared/`), and `deploy/mac-mini/` with:
- `setup.sh` – installs Node 22 (Homebrew) if missing, installs dependencies, creates `.env`, installs and starts a launchd service `com.toybox.server`
- `run.sh`, `com.toybox.server.plist.template`, `env.example`

Read all of `deploy/mac-mini/` before running anything.

## Steps
1. Unzip to `~/toybox-server`. Run `bash deploy/mac-mini/setup.sh`. If Homebrew is missing, tell me and stop.
2. The script will stop and ask for a Firebase service-account key at the path in `.env` (`GOOGLE_APPLICATION_CREDENTIALS`, default `~/toybox-secrets/firebase-key.json`). Create the directory with mode 700 and tell me to put the key file there (I will copy it myself). Never ask me to paste the key's contents into chat, never print it, never commit it. Make sure the file is mode 600, then re-run `setup.sh`.
3. Verify: `curl -s http://127.0.0.1:8080/health` returns `ok`, `launchctl list | grep toybox` shows the service, and `~/Library/Logs/toybox-server.log` shows "Toybox Brawl server on ..." plus `[tick]` lines once a player is connected. Confirm the server only listens on 127.0.0.1 (`lsof -iTCP:8080 -sTCP:LISTEN`).
4. Expose it with **Tailscale Funnel** on port 8080 (free, stable `https://<machine>.<tailnet>.ts.net` URL, WebSockets supported):
   - Install Tailscale if needed and log in (that needs me; tell me exactly what to click).
   - In the Tailscale admin console, HTTPS certificates and Funnel must be enabled for this machine; tell me if that is needed.
   - Run `tailscale funnel --bg 8080` and `tailscale funnel status`.
   - If Funnel is not possible on this machine/account, stop and say so. The alternative is a Cloudflare Tunnel, which needs a domain I would have to buy; do not set that up without asking.
5. Test through the public URL: `curl -s https://<url>/health` returns `ok`. Then, with a short Node script using the `ws` package from `~/toybox-server/node_modules`, check the WebSocket endpoint `wss://<url>/ws`:
   - connecting with header `Origin: https://c28aa1-rgb.github.io` opens successfully;
   - connecting with `Origin: https://evil.example` is rejected with HTTP 403.
6. Reboot-survival: confirm the launchd service has `RunAtLoad` and `KeepAlive`, and that `pmset -g` shows the machine does not sleep (`sleep 0`; report if not). Do not reboot the machine without asking me.

## Rules
- Do not modify the server's source code. If something needs a code change, tell me what and why.
- Keep secrets out of logs, output and any git history.
- Do not touch the Minecraft server, its ports, or its files.

## Report back (this is what I need)
1. The public HTTPS URL (the `.ts.net` address).
2. The outputs of the health and WebSocket checks in step 5.
3. Anything that did not work, any sudo or manual step I still owe, and the commands to see logs (`tail -f ~/Library/Logs/toybox-server.log`), restart (`launchctl kickstart -k gui/$(id -u)/com.toybox.server`) and stop the service.
