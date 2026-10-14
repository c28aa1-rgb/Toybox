import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { DEFAULT_MAP, MAPS, PUBLIC_MAP, PUBLIC_ROOM, isHeroId, isMapId, isPrimary, isSecondary, isUtilId, type ClientMsg, type Loadout } from '@gg/shared';

function loadoutFrom(msg: { hero: unknown; gun: unknown; secondary: unknown; utility: unknown }): Loadout | null {
  if (!isHeroId(msg.hero) || !isPrimary(msg.gun)) return null;
  return {
    hero: msg.hero,
    gun: msg.gun,
    secondary: isSecondary(msg.secondary) ? msg.secondary : 'pistol',
    utility: isUtilId(msg.utility) ? msg.utility : 'frag',
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

// In production the server also hosts the built client. In dev, Vite serves it and proxies /ws here.
const http = createServer((req, res) => {
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

const wss = new WebSocketServer({ server: http, path: '/ws' });

wss.on('connection', (ws: WebSocket) => {
  let room: Room | null = null;
  let playerId: string | null = null;

  ws.on('message', (data) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (msg.type === 'join') {
      if (room) return;
      const loadout = loadoutFrom(msg);
      if (!loadout) {
        ws.send(JSON.stringify({ type: 'error', message: 'Pick a hero and a gun first.' }));
        return;
      }
      let r: Room | undefined;
      if (msg.mode === 'public') {
        r = rooms.get(PUBLIC_ROOM);
      } else if (msg.mode === 'create') {
        const code = randomCode();
        const map = isMapId(msg.map) && !MAPS[msg.map].publicOnly ? msg.map : DEFAULT_MAP;
        const created = new Room(code, map);
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
      const id = r.join(ws, cleanName(msg.name), loadout);
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
          if (l) room.onLoadout(playerId, l);
        }
        break;
      case 'bots':
        room.setBots(playerId, Number(msg.count) || 0);
        break;
      case 'chat':
        room.chat(playerId, msg.text);
        break;
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', t: msg.t }));
        break;
    }
  });

  ws.on('close', () => {
    if (room && playerId) room.leave(playerId);
  });
});

http.listen(PORT, () => {
  console.log(`Toybox Brawl server on http://localhost:${PORT}`);
});
