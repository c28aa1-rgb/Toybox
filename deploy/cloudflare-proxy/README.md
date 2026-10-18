# toybox-proxy

A Cloudflare Worker on `workers.dev` that forwards the game's `/ws`, `/health`, `/api/online` and `/api/profile`
to the Mac mini's Tailscale Funnel URL. School filters block `*.ts.net` but allow `workers.dev`.

Deploy (from this folder, with wrangler logged in): `wrangler deploy`
Then point the site at it: `gh variable set VITE_SERVER_URL --body https://toybox-proxy.c28aa1-rgb.workers.dev -R c28aa1-rgb/Toybox`
If the mini's Funnel URL ever changes, edit `UPSTREAM` in `wrangler.toml` and deploy again.
