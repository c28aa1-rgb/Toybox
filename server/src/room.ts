import type { WebSocket } from 'ws';
import {
  CHAT_MAX, MAX_PLAYERS, PUBLIC_MIN_PLAYERS, TICK_DT, TICK_RATE, abilityStatus, addPlayer, applyInput, createGame, isHidden, r2,
  HAT_IDS, MAPS, MODES, POWER_IDS, PUBLIC_MAP_IDS, TURRET, removePlayer, setLoadout, tick, type GameState, type GunId, type HeroId, type InputFrame, type MapId, type ModeId, type UtilId, type Loadout,
  type MapVote, type PowerId, type ServerMsg, type Snapshot, type WeaponId,
} from '@gg/shared';
import { botHero, botInput, botName, forgetBot } from './bots';
import type { PlayerProfile } from '@gg/shared';

interface Client {
  id: string;
  uid: string;
  ws: WebSocket;
  queue: InputFrame[];
  /** Recent chat send times, for rate limiting. */
  chatTimes: number[];
}

const MAX_QUEUE = 30;
const PUBLIC_MAX_PLAYERS = 16;
/** A player who drops and comes back within this long, in the same round, keeps their score. */
const REJOIN_GRACE_MS = 5 * 60 * 1000;

/** What a player had when they disconnected, restored if they rejoin the same round. */
interface Departed {
  round: number;
  at: number;
  team: number;
  kills: number;
  deaths: number;
  score: number;
  bestStreak: number;
  damageDealt: number;
  weaponKills: Partial<Record<WeaponId, number>>;
}

export class Room {
  readonly code: string;
  readonly state: GameState;
  readonly isPublic: boolean;
  readonly mode: ModeId;
  private clients = new Map<string, Client>();
  private bots: string[] = [];
  private botCounter = 0;
  private hostId: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private nextClientId = 1;
  /** Bumps every time a new round starts, so saved scores only come back within the same round. */
  private round = 0;
  private departed = new Map<string, Departed>();
  /** Public lobby: a lone player turned bots on. */
  private publicBots = false;
  /** Results-screen vote for the next public map, keyed by client id. */
  private vote: { options: MapId[]; picks: Map<string, MapId> } | null = null;
  private lastErrorAt = 0;
  onEmpty: (() => void) | null = null;
  onStats: ((uid: string, delta: { kills?: number; deaths?: number; wins?: number }) => Promise<PlayerProfile>) | null = null;

  constructor(code: string, mapId: MapId, isPublic = false, mode: ModeId = 'ffa') {
    this.code = code;
    this.isPublic = isPublic;
    this.mode = mode;
    // The public lobby starts on a random map from its rotation; after that, players vote.
    const first = isPublic ? PUBLIC_MAP_IDS[Math.floor(Math.random() * PUBLIC_MAP_IDS.length)] : mapId;
    this.state = createGame(Date.now(), first, mode);
  }

  get mapId(): MapId {
    return this.state.map.id;
  }

  private get maxPlayers(): number {
    return this.isPublic ? PUBLIC_MAX_PLAYERS : MAX_PLAYERS;
  }

  get humanCount(): number {
    return this.clients.size;
  }

  join(ws: WebSocket, uid: string, name: string, loadout: Loadout): string | null {
    if (this.clients.size + this.bots.length >= this.maxPlayers) {
      // Make room by dropping a bot before refusing a human.
      const bot = this.bots.pop();
      if (!bot) return null;
      this.removeBot(bot);
    }
    // The same account connecting again (a dropped connection the server hasn't noticed yet,
    // or a second tab) replaces the old connection rather than adding a second player.
    for (const old of [...this.clients.values()]) {
      if (old.uid !== uid) continue;
      this.leave(old.id, true);
      old.ws.close(4000, 'Joined from somewhere else');
    }
    const id = `p${this.nextClientId++}`;
    this.clients.set(id, { id, uid, ws, queue: [], chatTimes: [] });
    const p = addPlayer(this.state, { id, name, ...loadout });
    const saved = this.departed.get(uid);
    this.departed.delete(uid);
    const back = !!saved && saved.round === this.round && Date.now() - saved.at < REJOIN_GRACE_MS && this.state.phase === 'playing';
    if (back) {
      Object.assign(p, {
        kills: saved.kills, deaths: saved.deaths, score: saved.score, bestStreak: saved.bestStreak,
        damageDealt: saved.damageDealt, weaponKills: { ...saved.weaponKills },
      });
      if (saved.team >= 0) p.team = saved.team;
    }
    if (!this.hostId && !this.isPublic) this.hostId = id;
    this.welcome(this.clients.get(id)!);
    if (!this.timer) this.timer = setInterval(() => this.step(), 1000 / TICK_RATE);
    this.system(back ? `${name} reconnected` : `${name} joined`);
    this.balancePublicBots();
    return id;
  }

  private welcome(c: Client): void {
    this.send(c.ws, { type: 'welcome', id: c.id, room: this.code, host: this.hostId === c.id, map: this.mapId, mode: this.mode, isPublic: this.isPublic });
  }

  leave(id: string, replaced = false): void {
    const c = this.clients.get(id);
    if (!c) return;
    const p = this.state.players.get(id);
    // Keep their score for a while in case the connection just dropped.
    if (p && this.state.phase === 'playing') {
      this.departed.set(c.uid, {
        round: this.round, at: Date.now(), team: p.team, kills: p.kills, deaths: p.deaths, score: p.score,
        bestStreak: p.bestStreak, damageDealt: p.damageDealt, weaponKills: { ...p.weaponKills },
      });
    }
    this.clients.delete(id);
    this.vote?.picks.delete(id);
    removePlayer(this.state, id);
    if (p && !replaced) this.system(`${p.name} left`);
    if (this.hostId === id) {
      this.hostId = this.clients.keys().next().value ?? null;
      const host = this.hostId ? this.clients.get(this.hostId) : null;
      if (host) this.welcome(host);
    }
    if (this.clients.size === 0) this.publicBots = false;
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

  /** Private rooms: only the host changes the bot count. Public lobby: a lone player can switch bots on or off. */
  setBots(id: string, count: number): void {
    if (this.isPublic) {
      if (this.clients.size !== 1 || !this.clients.has(id)) return;
      this.publicBots = count > 0;
      this.balancePublicBots();
      return;
    }
    if (id !== this.hostId) return;
    this.applyBotCount(count);
  }

  /** A lone player in the public lobby gets bots only after asking; once a second person joins they all leave. */
  private balancePublicBots(): void {
    if (!this.isPublic || this.clients.size === 0) return;
    this.applyBotCount(this.clients.size === 1 && this.publicBots ? PUBLIC_MIN_PLAYERS - 1 : 0);
  }

  /** Public lobby, results screen: record a vote for the next map. */
  castVote(id: string, map: unknown): void {
    if (!this.vote || !this.clients.has(id) || !this.vote.options.includes(map as MapId)) return;
    this.vote.picks.set(id, map as MapId);
  }

  private voteSnap(): MapVote | null {
    if (!this.vote) return null;
    const counts = this.vote.options.map((m) => [...this.vote!.picks.values()].filter((v) => v === m).length);
    return { options: this.vote.options, counts };
  }

  /** When a public round ends, offer the other maps in the rotation (up to three). */
  private openVote(): void {
    if (!this.isPublic) return;
    const others = PUBLIC_MAP_IDS.filter((m) => m !== this.state.map.id).sort(() => Math.random() - 0.5);
    this.vote = { options: others.slice(0, 3), picks: new Map() };
  }

  /** Close the vote on the last tick before the next round starts, so the reset loads the winner. */
  private closeVote(): void {
    const s = this.state;
    if (s.phase === 'ended' && this.vote && s.time + TICK_DT >= s.endsAt) {
      const tally = this.voteSnap()!;
      const top = Math.max(...tally.counts);
      const leaders = tally.options.filter((_, i) => tally.counts[i] === top);
      s.nextMap = leaders[Math.floor(Math.random() * leaders.length)] ?? null;
      const winner = s.nextMap ? MAPS[s.nextMap].name : null;
      if (winner) this.system(top > 0 ? `Next map: ${winner}` : `No votes, so the next map is ${winner}`);
      this.vote = null;
    }
  }

  private applyBotCount(count: number): void {
    const target = Math.max(0, Math.min(this.maxPlayers - this.clients.size, Math.floor(count)));
    while (this.bots.length > target) this.removeBot(this.bots[this.bots.length - 1]);
    while (this.bots.length < target) {
      const i = this.botCounter++;
      const id = `b${i}`;
      const guns: GunId[] = ['smg', 'shotgun', 'burst', 'sniper', 'smg'];
      const sides: GunId[] = ['pistol', 'minismg', 'thumper', 'bouncer', 'stinger'];
      const utils: UtilId[] = ['frag', 'flash', 'smoke', 'turret', 'juice'];
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

  // Tick health, logged to spot a starved host (free tiers throttle CPU): how late ticks arrive and how long they take.
  private lastTickAt = 0;
  private statTicks = 0;
  private statLate = 0;
  private statWorstGap = 0;
  private statWorstWork = 0;
  private statSince = 0;

  private step(): void {
    const started = performance.now();
    if (this.lastTickAt) {
      const gap = started - this.lastTickAt;
      this.statWorstGap = Math.max(this.statWorstGap, gap);
      if (gap > 2 * (1000 / TICK_RATE)) this.statLate++;
    } else {
      this.statSince = started;
    }
    this.lastTickAt = started;
    // One bad tick must not take the whole server (and every other room) down with it.
    try {
      this.stepInner();
    } catch (error) {
      if (Date.now() - this.lastErrorAt > 5000) console.error(`Room ${this.code} tick failed:`, error);
      this.lastErrorAt = Date.now();
    }
    const done = performance.now();
    this.statWorstWork = Math.max(this.statWorstWork, done - started);
    this.statTicks++;
    if (done - this.statSince >= 30_000) {
      const mb = Math.round(process.memoryUsage().rss / 1048576);
      console.log(
        `[tick] room ${this.code}: ${this.clients.size} players, ${this.statTicks} ticks/30s, ` +
        `${this.statLate} late (>2x interval), worst gap ${Math.round(this.statWorstGap)}ms, worst tick work ${this.statWorstWork.toFixed(1)}ms, rss ${mb}MB`,
      );
      this.statTicks = this.statLate = this.statWorstGap = this.statWorstWork = 0;
      this.statSince = done;
    }
  }

  private stepInner(): void {
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
    this.closeVote();
    const before = this.state.phase;
    tick(this.state, TICK_DT);
    if (before === 'playing' && this.state.phase === 'ended') this.openVote();
    if (before === 'ended' && this.state.phase === 'playing') {
      this.round++;
      this.departed.clear();
    }
    this.recordStats();
    this.broadcast();
  }

  private recordStats(): void {
    if (!this.onStats) return;
    const commit = (id: string, delta: { kills?: number; deaths?: number; wins?: number }) => {
      const client = this.clients.get(id);
      if (!client) return;
      void this.onStats!(client.uid, delta).then((profile) => this.send(client.ws, { type: 'profile', profile })).catch((error) => {
        console.error('Could not save player stats:', error);
      });
    };
    for (const event of this.state.events) {
      if (event.t === 'kill') {
        commit(event.victim, { deaths: 1 });
        if (event.killer !== event.victim) commit(event.killer, { kills: 1 });
      } else if (event.t === 'win') {
        if (event.id.startsWith('team:')) {
          const team = Number(event.id.slice(5));
          for (const player of this.state.players.values()) if (player.team === team) commit(player.id, { wins: 1 });
        } else commit(event.id, { wins: 1 });
      }
    }
  }

  private broadcast(): void {
    const s = this.state;
    const t = s.time;
    const base: Omit<Snapshot, 'ack'> = {
      type: 'snap',
      map: s.map.id,
      vote: this.voteSnap(),
      time: Math.round(t * 1000) / 1000,
      phase: s.phase,
      winner: s.winner,
      endsIn: s.phase === 'ended' ? r2(s.endsAt - t) : 0,
      mode: s.mode,
      target: MODES[s.mode].target,
      teamScores: s.teamScores,
      hill: s.hill ? { x: r2(s.hill.x), y: r2(s.hill.y), r: r2(s.hill.r), holder: s.hill.holder, contested: s.hill.contested } : null,
      players: [...s.players.values()].map((p) => {
        const ability = abilityStatus(s, p);
        return {
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
        abilityReadyIn: r2(ability.readyIn),
        abilityCharge: r2(ability.charge),
        hidden: isHidden(s, p),
        overcharge: p.alive && t < p.overchargeUntil ? p.overchargeShots : 0,
        powers: p.alive ? activePowers(p.powers, t) : {},
        };
      }),
      bullets: s.bullets.map((b) => ({ id: b.id, gun: b.gun, x: r2(b.x), y: r2(b.y), fake: b.fake, ...(b.mult ? { charged: true } : {}) })),
      pickups: s.pickups.map((k) => ({
        id: k.id, kind: k.kind, item: k.item, x: r2(k.x), y: r2(k.y), expiresIn: r2(k.expiresAt - t),
        ...(k.readyAt !== undefined && k.readyAt > t ? { readyIn: r2(k.readyAt - t) } : {}),
      })),
      throwables: s.throwables.map((g) => ({ id: g.id, util: g.util, x: r2(g.x), y: r2(g.y), z: r2(g.z), owner: g.owner })),
      turrets: s.turrets.map((tr) => ({
        id: tr.id, owner: tr.owner, team: tr.team, x: r2(tr.x), y: r2(tr.y), aim: r2(tr.aim),
        hp: Math.round((tr.hp / TURRET.hp) * 100) / 100, endsIn: r2(tr.expiresAt - t),
      })),
      smokes: s.smokes.map((sm) => ({ id: sm.id, x: r2(sm.x), y: r2(sm.y), r: sm.r, endsIn: r2(sm.expiresAt - t) })),
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
    this.lastTickAt = 0;
    for (const b of [...this.bots]) this.removeBot(b);
    this.onEmpty?.();
  }
}

function activePowers(until: Record<PowerId, number>, t: number): Partial<Record<PowerId, number>> {
  const out: Partial<Record<PowerId, number>> = {};
  for (const id of POWER_IDS) if (until[id] > t) out[id] = r2(until[id] - t);
  return out;
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
