import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { DEFAULT_MAP, MAPS, PUBLIC_MAP, PUBLIC_ROOM, isHatId, isHeroId, isMapId, isModeId, isPrimary, isSecondary, isUtilId, type ClientMsg, type Loadout } from '@gg/shared';
import { getPlayerProfile, recordPlayerStats, updatePlayerProfile, verifyPlayerToken } from './profile';

function loadoutFrom(msg: { hero: unknown; gun: unknown; secondary: unknown; utility: unknown; hat?: unknown }): Loadout | null {
  if (!isHeroId(msg.hero) || !isPrimary(msg.gun)) return null;
  return {
    hero: msg.hero,
    gun: msg.gun,
    secondary: isSecondary(msg.secondary) ? msg.secondary : 'pistol',
    utility: isUtilId(msg.utility) ? msg.utility : 'frag',
    hat: isHatId(msg.hat) ? msg.hat : 'none',
  };
}
import { Room } from './room';

// GG_PORT wins in dev, where tools may set PORT for the Vite client.
const PORT = Number(process.env.GG_PORT ?? process.env.PORT ?? 3001);
const DIST = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../client/dist');

const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2',
};

// Browsers allowed to open a socket (the GitHub Pages site). Comma-separated; empty allows any origin.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);
const MAX_CONNECTIONS_PER_IP = 8;
// Token bucket per socket. Clients send at most ~60 messages/s, but a lag spike can deliver a
// backlog all at once, so bursts are absorbed and excess messages are dropped rather than kicked.
// Only a sustained flood (the bucket far in debt) closes the socket.
const MSG_RATE = 150;
const MSG_BURST = 600;
const connectionsByIp = new Map<string, number>();

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
}

// In production the server also hosts the built client. In dev, Vite serves it and proxies /ws here.
const http = createServer(async (req, res) => {
  const origin = req.headers.origin ?? '';
  if (req.url?.startsWith('/api/')) {
    if (ALLOWED_ORIGINS.length && origin && !ALLOWED_ORIGINS.includes(origin.replace(/\/+$/, ''))) {
      res.writeHead(403).end();
      return;
    }
    res.setHeader('access-control-allow-origin', ALLOWED_ORIGINS.length ? origin : '*');
    res.setHeader('access-control-allow-headers', 'authorization, content-type');
    res.setHeader('access-control-allow-methods', 'GET, PATCH, OPTIONS');
    res.setHeader('vary', 'origin');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    if (req.url?.split('?')[0] !== '/api/profile' || !['GET', 'PATCH'].includes(req.method ?? '')) {
      res.writeHead(404).end();
      return;
    }
    try {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      const uid = await verifyPlayerToken(token);
      if (req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(await getPlayerProfile(uid)));
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 4096) throw new Error('Profile request is too large.');
        chunks.push(Buffer.from(chunk));
      }
      const patch = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { name?: unknown; hero?: unknown; gun?: unknown; secondary?: unknown; utility?: unknown; hat?: unknown };
      const update: { name?: string; loadout?: Loadout } = {};
      if ('name' in patch && typeof patch.name !== 'string') throw new Error('Invalid name.');
      if (typeof patch.name === 'string') update.name = cleanName(patch.name);
      if (['hero', 'gun', 'secondary', 'utility', 'hat'].some((key) => key in patch)) {
        const loadout = loadoutFrom({ hero: patch.hero, gun: patch.gun, secondary: patch.secondary, utility: patch.utility, hat: patch.hat });
        if (!loadout) throw new Error('Invalid loadout.');
        update.loadout = loadout;
      }
      if (!Object.keys(update).length) throw new Error('No profile changes were supplied.');
      const profile = await updatePlayerProfile(uid, update);
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(profile));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load the player profile.';
      const badRequest = error instanceof SyntaxError || ['locked', 'Invalid', 'supplied', 'too large'].some((part) => message.includes(part));
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
      const unauthorized = message.startsWith('Sign in') || code.startsWith('auth/');
      const status = badRequest ? 400 : unauthorized ? 401 : 503;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: status === 503 ? 'Firebase profile service is unavailable. Try again shortly.' : message }));
    }
    return;
  }
  if (req.url === '/health') {
    // Render's health check, and the page's wake-up poke (no-cors, so no CORS headers are needed).
    res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
    res.end('ok');
    return;
  }
  if (!existsSync(DIST)) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('Toybox Brawl server is running. Open the Vite dev server for the client.');
    return;
  }
  const url = new URL(req.url ?? '/', 'http://x');
  let file = normalize(join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

const rooms = new Map<string, Room>();
// The public lobby always exists; it just idles when nobody is in it.
rooms.set(PUBLIC_ROOM, new Room(PUBLIC_ROOM, PUBLIC_MAP, true));

// Log instead of crashing: one bad request shouldn't disconnect every player.
process.on('unhandledRejection', (error) => console.error('Unhandled rejection:', error));

function cleanCode(raw: unknown): string {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function randomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function cleanName(raw: unknown): string {
  const name = String(raw ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16);
  return name || 'Player';
}

const wss = new WebSocketServer({
  server: http,
  path: '/ws',
  maxPayload: 16 * 1024,
  verifyClient: ({ origin, req }, done) => {
    if (ALLOWED_ORIGINS.length && origin && !ALLOWED_ORIGINS.includes(origin.replace(/\/+$/, ''))) {
      done(false, 403, 'Origin not allowed');
    } else if ((connectionsByIp.get(clientIp(req)) ?? 0) >= MAX_CONNECTIONS_PER_IP) {
      done(false, 429, 'Too many connections');
    } else {
      done(true);
    }
  },
});

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  let room: Room | null = null;
  let playerId: string | null = null;
  let uid: string | null = null;
  let authenticating = false;

  const ip = clientIp(req);
  connectionsByIp.set(ip, (connectionsByIp.get(ip) ?? 0) + 1);
  let tokens = MSG_BURST;
  let refilledAt = Date.now();

  ws.on('message', (data) => {
    // The handler is async; a thrown error would otherwise be an unhandled rejection that kills the process.
    handle(data).catch((error) => console.error('Message handler failed:', error));
  });

  const handle = async (data: unknown): Promise<void> => {
    const now = Date.now();
    tokens = Math.min(MSG_BURST, tokens + ((now - refilledAt) / 1000) * MSG_RATE);
    refilledAt = now;
    tokens -= 1;
    if (tokens < -MSG_BURST * 4) {
      ws.close(1008, 'Rate limit');
      return;
    }
    if (tokens < 0) return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (msg.type === 'join') {
      if (room || authenticating) return;
      authenticating = true;
      let profile;
      try {
        uid = await verifyPlayerToken(msg.idToken);
        profile = await getPlayerProfile(uid);
      } catch (error) {
        ws.send(JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : 'Could not sign in.' }));
        ws.close(1008, 'Authentication required');
        return;
      }
      const loadout: Loadout = { hero: profile.hero, gun: profile.gun, secondary: profile.secondary, utility: profile.utility, hat: profile.hat };
      let r: Room | undefined;
      if (msg.mode === 'public') {
        r = rooms.get(PUBLIC_ROOM);
      } else if (msg.mode === 'create') {
        const code = randomCode();
        const map = isMapId(msg.map) && !MAPS[msg.map].publicOnly ? msg.map : DEFAULT_MAP;
        // The public lobby stays free-for-all; private rooms pick their mode.
        const created = new Room(code, map, false, isModeId(msg.gameMode) ? msg.gameMode : 'ffa');
        created.onEmpty = () => rooms.delete(code);
        rooms.set(code, created);
        r = created;
      } else {
        const code = cleanCode(msg.room);
        r = code === PUBLIC_ROOM ? undefined : rooms.get(code);
        if (!r) {
          ws.send(JSON.stringify({ type: 'error', message: `No room called ${code || 'that'}. Check the code, or create a new room.` }));
          return;
        }
      }
      if (!r) return;
      const code = r.code;
      r.onStats = recordPlayerStats;
      const id = r.join(ws, uid, profile.name, loadout);
      if (!id) {
        ws.send(JSON.stringify({ type: 'error', message: `Room ${code} is full.` }));
        if (r.humanCount === 0 && !r.isPublic) rooms.delete(code);
        return;
      }
      room = r;
      playerId = id;
      return;
    }
    if (!room || !playerId) return;
    switch (msg.type) {
      case 'input':
        room.onInput(playerId, msg.frames);
        break;
      case 'loadout':
        {
          const l = loadoutFrom(msg);
          if (l && uid) {
            try {
              const profile = await updatePlayerProfile(uid, { loadout: l });
              room.onLoadout(playerId, { hero: profile.hero, gun: profile.gun, secondary: profile.secondary, utility: profile.utility, hat: profile.hat });
              ws.send(JSON.stringify({ type: 'profile', profile }));
            } catch (error) {
              ws.send(JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : 'Could not save loadout.' }));
            }
          }
        }
        break;
      case 'bots':
        room.setBots(playerId, Number(msg.count) || 0);
        break;
      case 'vote':
        room.castVote(playerId, msg.map);
        break;
      case 'chat':
        room.chat(playerId, msg.text);
        break;
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', t: msg.t }));
        break;
    }
  };

  ws.on('close', () => {
    const left = (connectionsByIp.get(ip) ?? 1) - 1;
    if (left <= 0) connectionsByIp.delete(ip);
    else connectionsByIp.set(ip, left);
    if (room && playerId) room.leave(playerId);
  });
});

http.listen(PORT, process.env.GG_LOCAL_PROFILE_FALLBACK === '1' && process.env.GG_PORT === '3001' ? '127.0.0.1' : undefined, () => {
  console.log(`Toybox Brawl server on http://localhost:${PORT}`);
});
