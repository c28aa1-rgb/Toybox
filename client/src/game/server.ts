// Where the game server lives. In dev the Vite proxy serves /ws on the same origin; in the hosted
// build (GitHub Pages) VITE_SERVER_URL points at the Render service, e.g. https://toybox.onrender.com.
const REMOTE = (import.meta.env.VITE_SERVER_URL as string | undefined)?.replace(/\/+$/, '') || null;

export const isRemoteServer = REMOTE !== null;

export function wsUrl(): string {
  if (REMOTE) return `${REMOTE.replace(/^http/, 'ws')}/ws`;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

/** Free hosts sleep when idle. Poke the server as soon as the page loads so it is awake by the time someone hits Play. */
export function wakeServer(): void {
  if (!REMOTE) return;
  fetch(`${REMOTE}/health`, { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
}
