import type { WebSocket } from 'ws';
import {
  ABILITY, CHAT_MAX, MAX_PLAYERS, PUBLIC_MIN_PLAYERS, TICK_DT, TICK_RATE, addPlayer, applyInput, createGame, r2,
  HAT_IDS, MODES, removePlayer, setLoadout, tick, type GameState, type GunId, type HeroId, type InputFrame, type MapId, type ModeId, type UtilId, type Loadout,
  type ServerMsg, type Snapshot, type WeaponId,
} from '@gg/shared';
import { botHero, botInput, botName, forgetBot } from './bots';

interface Client {
  id: string;
  ws: WebSocket;
  queue: InputFrame[];
  /** Recent chat send times, for rate limiting. */
  chatTimes: number[];
}

const MAX_QUEUE = 30;
const PUBLIC_MAX_PLAYERS = 16;

export class Room {
  readonly code: string;
  readonly state: GameState;
  readonly mapId: MapId;
  readonly isPublic: boolean;
  readonly mode: ModeId;
  private clients = new Map<string, Client>();
  private bots: string[] = [];
  private botCounter = 0;
  private hostId: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private nextClientId = 1;
  onEmpty: (() => void) | null = null;

  constructor(code: string, mapId: MapId, isPublic = false, mode: ModeId = 'ffa') {
    this.code = code;
    this.mapId = mapId;
    this.isPublic = isPublic;
    this.mode = mode;
    this.state = createGame(Date.now(), mapId, mode);
  }

  private get maxPlayers(): number {
    return this.isPublic ? PUBLIC_MAX_PLAYERS : MAX_PLAYERS;
  }

  get humanCount(): number {
    return this.clients.size;
  }

  join(ws: WebSocket, name: string, loadout: Loadout): string | null {
    if (this.clients.size + this.bots.length >= this.maxPlayers) {
      // Make room by dropping a bot before refusing a human.
      const bot = this.bots.pop();
      if (!bot) return null;
      this.removeBot(bot);
    }
    const id = `p${this.nextClientId++}`;
    this.clients.set(id, { id, ws, queue: [], chatTimes: [] });
    addPlayer(this.state, { id, name, ...loadout });
    if (!this.hostId && !this.isPublic) this.hostId = id;
    this.welcome(this.clients.get(id)!);
    if (!this.timer) this.timer = setInterval(() => this.step(), 1000 / TICK_RATE);
    this.system(`${name} joined`);
    this.balancePublicBots();
    return id;
  }

  private welcome(c: Client): void {
    this.send(c.ws, { type: 'welcome', id: c.id, room: this.code, host: this.hostId === c.id, map: this.mapId, mode: this.mode, isPublic: this.isPublic });
  }

  leave(id: string): void {
    const name = this.state.players.get(id)?.name;
    this.clients.delete(id);
    removePlayer(this.state, id);
    if (name) this.system(`${name} left`);
    if (this.hostId === id) {
      this.hostId = this.clients.keys().next().value ?? null;
      const host = this.hostId ? this.clients.get(this.hostId) : null;
      if (host) this.welcome(host);
    }
    this.balancePublicBots();
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

  onLoadout(id: string, loadout: Loadout): void {
    const p = this.state.players.get(id);
    if (p) setLoadout(this.state, p, loadout);
  }

  /** Only the host can change the bot count. */
  setBots(id: string, count: number): void {
    if (this.isPublic || id !== this.hostId) return;
    this.applyBotCount(count);
  }

  /** The public lobby tops itself up with bots so a lone player always has a fight. */
  private balancePublicBots(): void {
    if (!this.isPublic || this.clients.size === 0) return;
    // Bots only keep a lone player company; once a second person joins they all leave.
    this.applyBotCount(this.clients.size > 1 ? 0 : PUBLIC_MIN_PLAYERS - 1);
  }

  private applyBotCount(count: number): void {
    const target = Math.max(0, Math.min(this.maxPlayers - this.clients.size, Math.floor(count)));
    while (this.bots.length > target) this.removeBot(this.bots[this.bots.length - 1]);
    while (this.bots.length < target) {
      const i = this.botCounter++;
      const id = `b${i}`;
      const guns: GunId[] = ['smg', 'shotgun', 'burst', 'sniper', 'smg'];
      const sides: GunId[] = ['pistol', 'minismg', 'thumper', 'bouncer', 'stinger'];
      const utils: UtilId[] = ['frag', 'flash', 'smoke', 'goo', 'juice'];
      addPlayer(this.state, {
        id, name: botName(i), hero: botHero(i), gun: guns[i % guns.length],
        secondary: sides[(i * 2) % sides.length], utility: utils[(i * 3) % utils.length], hat: HAT_IDS[i % HAT_IDS.length], bot: true,
      });
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
      mode: s.mode,
      target: MODES[s.mode].target,
      teamScores: s.teamScores,
      hill: s.hill ? { x: r2(s.hill.x), y: r2(s.hill.y), r: r2(s.hill.r), holder: s.hill.holder, contested: s.hill.contested } : null,
      players: [...s.players.values()].map((p) => ({
        id: p.id, name: p.name, hero: p.hero, gun: p.gun,
        primary: p.primary, secondary: p.secondary, slot: p.slot, utility: p.utility, utilCharges: p.utilCharges,
        ammo: p.ammo, reloadIn: r2(Math.max(0, p.reloadAt - t)),
        blindIn: r2(Math.max(0, p.blindUntil - t)),
        slowIn: r2(Math.max(0, p.slowUntil - t)),
        hat: p.loadout.hat,
        team: p.team,
        score: p.score,
        streak: p.streak,
        bestStreak: p.bestStreak,
        damage: Math.round(p.damageDealt),
        favWeapon: favWeapon(p.weaponKills),
        x: r2(p.x), y: r2(p.y), aim: r2(p.aim), hp: Math.max(0, Math.round(p.hp)),
        alive: p.alive, kills: p.kills, deaths: p.deaths, bot: p.bot,
        shield: p.alive && t < p.shieldUntil,
        scoped: p.alive && p.scoped,
        respawnIn: p.alive ? 0 : r2(Math.max(0, p.respawnAt - t)),
        abilityReadyIn: r2(Math.max(0, p.abilityReadyAt - t)),
      })),
      bullets: s.bullets.map((b) => ({ id: b.id, gun: b.gun, x: r2(b.x), y: r2(b.y), fake: b.fake })),
      pickups: s.pickups.map((k) => ({ id: k.id, kind: k.kind, item: k.item, x: r2(k.x), y: r2(k.y), expiresIn: r2(k.expiresAt - t) })),
      throwables: s.throwables.map((g) => ({ id: g.id, util: g.util, x: r2(g.x), y: r2(g.y), z: r2(g.z), owner: g.owner })),
      goos: s.goos.map((g) => ({ id: g.id, x: r2(g.x), y: r2(g.y), r: g.r, owner: g.owner, team: g.team, endsIn: r2(g.expiresAt - t) })),
      smokes: s.smokes.map((sm) => ({ id: sm.id, x: r2(sm.x), y: r2(sm.y), r: sm.r, endsIn: r2(sm.expiresAt - t) })),
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

  /** Relay a chat line. Max 120 chars, no control characters, 3 lines per 4 s per player. */
  chat(id: string, raw: unknown): void {
    const c = this.clients.get(id);
    const p = this.state.players.get(id);
    if (!c || !p || typeof raw !== 'string') return;
    const text = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, CHAT_MAX);
    if (!text) return;
    const now = Date.now();
    c.chatTimes = c.chatTimes.filter((t) => now - t < 4000);
    if (c.chatTimes.length >= 3) return;
    c.chatTimes.push(now);
    this.broadcastMsg({ type: 'chat', id, name: p.name, text });
  }

  private system(text: string): void {
    this.broadcastMsg({ type: 'chat', id: null, name: '', text });
  }

  private broadcastMsg(msg: ServerMsg): void {
    const body = JSON.stringify(msg);
    for (const c of this.clients.values()) if (c.ws.readyState === c.ws.OPEN) c.ws.send(body);
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

function favWeapon(kills: Partial<Record<WeaponId, number>>): WeaponId | null {
  let best: WeaponId | null = null;
  let n = 0;
  for (const [w, k] of Object.entries(kills) as [WeaponId, number][]) {
    if (k > n) {
      n = k;
      best = w;
    }
  }
  return best;
}
