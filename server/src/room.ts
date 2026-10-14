import type { WebSocket } from 'ws';
import {
  ABILITY, MAX_PLAYERS, TICK_DT, TICK_RATE, addPlayer, applyInput, createGame, r2, removePlayer,
  setLoadout, tick, type GameState, type GunId, type HeroId, type InputFrame, type ServerMsg,
  type Snapshot,
} from '@gg/shared';
import { botHero, botInput, botName, forgetBot } from './bots';

interface Client {
  id: string;
  ws: WebSocket;
  queue: InputFrame[];
}

const MAX_QUEUE = 30;

export class Room {
  readonly code: string;
  readonly state: GameState;
  private clients = new Map<string, Client>();
  private bots: string[] = [];
  private botCounter = 0;
  private hostId: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private nextClientId = 1;
  onEmpty: (() => void) | null = null;

  constructor(code: string) {
    this.code = code;
    this.state = createGame();
  }

  get humanCount(): number {
    return this.clients.size;
  }

  join(ws: WebSocket, name: string, hero: HeroId, gun: GunId): string | null {
    if (this.clients.size + this.bots.length >= MAX_PLAYERS) {
      // Make room by dropping a bot before refusing a human.
      const bot = this.bots.pop();
      if (!bot) return null;
      this.removeBot(bot);
    }
    const id = `p${this.nextClientId++}`;
    this.clients.set(id, { id, ws, queue: [] });
    addPlayer(this.state, { id, name, hero, gun });
    if (!this.hostId) this.hostId = id;
    this.send(ws, { type: 'welcome', id, room: this.code, host: this.hostId === id });
    if (!this.timer) this.timer = setInterval(() => this.step(), 1000 / TICK_RATE);
    return id;
  }

  leave(id: string): void {
    this.clients.delete(id);
    removePlayer(this.state, id);
    if (this.hostId === id) {
      this.hostId = this.clients.keys().next().value ?? null;
      const host = this.hostId ? this.clients.get(this.hostId) : null;
      if (host) this.send(host.ws, { type: 'welcome', id: host.id, room: this.code, host: true });
    }
    if (this.clients.size === 0) this.stop();
  }

  onInput(id: string, frames: InputFrame[]): void {
    const c = this.clients.get(id);
    if (!c || !Array.isArray(frames)) return;
    for (const f of frames) {
      if (c.queue.length >= MAX_QUEUE) c.queue.shift();
      c.queue.push(f);
    }
  }

  onLoadout(id: string, hero: HeroId, gun: GunId): void {
    const p = this.state.players.get(id);
    if (p) setLoadout(this.state, p, { hero, gun });
  }

  /** Only the host can change the bot count. */
  setBots(id: string, count: number): void {
    if (id !== this.hostId) return;
    const target = Math.max(0, Math.min(MAX_PLAYERS - this.clients.size, Math.floor(count)));
    while (this.bots.length > target) this.removeBot(this.bots[this.bots.length - 1]);
    while (this.bots.length < target) {
      const i = this.botCounter++;
      const id = `b${i}`;
      const guns: GunId[] = ['pistol', 'smg', 'shotgun'];
      addPlayer(this.state, { id, name: botName(i), hero: botHero(i), gun: guns[i % guns.length], bot: true });
      this.bots.push(id);
    }
  }

  private removeBot(id: string): void {
    this.bots = this.bots.filter((b) => b !== id);
    removePlayer(this.state, id);
    forgetBot(id);
  }

  private step(): void {
    for (const c of this.clients.values()) {
      const p = this.state.players.get(c.id);
      if (!p) continue;
      c.queue.sort((a, b) => a.seq - b.seq);
      for (const f of c.queue) applyInput(this.state, p, f);
      c.queue.length = 0;
    }
    for (const id of this.bots) {
      const p = this.state.players.get(id);
      if (p) applyInput(this.state, p, botInput(this.state, p));
    }
    tick(this.state, TICK_DT);
    this.broadcast();
  }

  private broadcast(): void {
    const s = this.state;
    const t = s.time;
    const base: Omit<Snapshot, 'ack'> = {
      type: 'snap',
      time: Math.round(t * 1000) / 1000,
      phase: s.phase,
      winner: s.winner,
      endsIn: s.phase === 'ended' ? r2(s.endsAt - t) : 0,
      players: [...s.players.values()].map((p) => ({
        id: p.id, name: p.name, hero: p.hero, gun: p.gun,
        x: r2(p.x), y: r2(p.y), aim: r2(p.aim), hp: Math.max(0, Math.round(p.hp)),
        alive: p.alive, kills: p.kills, deaths: p.deaths, bot: p.bot,
        shield: p.alive && t < p.shieldUntil,
        respawnIn: p.alive ? 0 : r2(Math.max(0, p.respawnAt - t)),
        abilityReadyIn: r2(Math.max(0, p.abilityReadyAt - t)),
      })),
      bullets: s.bullets.map((b) => ({ id: b.id, gun: b.gun, x: r2(b.x), y: r2(b.y), fake: b.fake })),
      pickups: s.pickups.map((k) => ({ id: k.id, gun: k.gun, x: r2(k.x), y: r2(k.y) })),
      walls: s.walls.map((w) => ({
        id: w.id, x: r2(w.x), y: r2(w.y), w: w.w, h: w.h, owner: w.owner,
        hp: Math.round((w.hp / ABILITY.wallHp) * 100) / 100,
      })),
      bubbles: s.bubbles.map((b) => ({ id: b.id, x: r2(b.x), y: r2(b.y), r: b.r, owner: b.owner, endsIn: r2(b.expiresAt - t) })),
      decoys: s.decoys.map((d) => ({ id: d.id, owner: d.owner, x: r2(d.x), y: r2(d.y), aim: r2(d.aim) })),
      events: s.events,
    };
    // Everything except `ack` is shared, so serialize once and splice the ack in per client.
    const body = JSON.stringify(base);
    for (const c of this.clients.values()) {
      const ack = s.players.get(c.id)?.lastSeq ?? 0;
      if (c.ws.readyState === c.ws.OPEN) c.ws.send(`{"ack":${ack},${body.slice(1)}`);
    }
  }

  send(ws: WebSocket, msg: ServerMsg): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  isHost(id: string): boolean {
    return this.hostId === id;
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const b of [...this.bots]) this.removeBot(b);
    this.onEmpty?.();
  }
}
