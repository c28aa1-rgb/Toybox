// Forwards the game's HTTP and WebSocket traffic from a workers.dev address (which school web filters
// allow) to the Mac mini behind Tailscale Funnel (which they block). Only the paths the game uses, and
// only from the game's own site, are passed through.
interface Env {
  UPSTREAM: string;
  ALLOWED_ORIGINS: string;
}

const PATHS = new Set(['/ws', '/health', '/api/online', '/api/profile']);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!PATHS.has(url.pathname)) return new Response('Not found', { status: 404 });

    const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
    const origin = request.headers.get('Origin');
    // Browsers always send Origin on WebSocket and cross-site requests; /health is also poked with no-cors.
    if (origin && !allowed.includes(origin)) return new Response('Forbidden', { status: 403 });

    const upstream = new URL(url.pathname + url.search, env.UPSTREAM);
    const headers = new Headers(request.headers);
    headers.delete('host');
    const ip = request.headers.get('CF-Connecting-IP');
    if (ip) headers.set('X-Forwarded-For', ip);
    // Passing the request through unchanged also carries a WebSocket upgrade to the upstream.
    return fetch(new Request(upstream, { method: request.method, headers, body: request.body, redirect: 'manual' }));
  },
};
