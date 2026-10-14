import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { isGunId, isHeroId, type ClientMsg } from '@gg/shared';
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
    res.end('Gun Game server is running. Open the Vite dev server for the client.');
    return;
  }
  const url = new URL(req.url ?? '/', 'http://x');
  let file = normalize(join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

const rooms = new Map<string, Room>();

function cleanCode(raw: unknown): string {
  const code = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  return code.length >= 3 ? code : randomCode();
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
      if (!isHeroId(msg.hero) || !isGunId(msg.gun)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Pick a hero and a gun first.' }));
        return;
      }
      const code = cleanCode(msg.room);
      let r = rooms.get(code);
      if (!r) {
        r = new Room(code);
        r.onEmpty = () => rooms.delete(code);
        rooms.set(code, r);
      }
      const id = r.join(ws, cleanName(msg.name), msg.hero, msg.gun);
      if (!id) {
        ws.send(JSON.stringify({ type: 'error', message: `Room ${code} is full (8 players).` }));
        if (r.humanCount === 0) rooms.delete(code);
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
        if (isHeroId(msg.hero) && isGunId(msg.gun)) room.onLoadout(playerId, msg.hero, msg.gun);
        break;
      case 'bots':
        room.setBots(playerId, Number(msg.count) || 0);
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
  console.log(`Gun Game server on http://localhost:${PORT}`);
});
