import { wsUrl } from './server';
import type { ClientMsg, MapId, ModeId, PlayerProfile, ServerMsg, Snapshot } from '@gg/shared';

export interface NetHandlers {
  onWelcome(id: string, room: string, host: boolean, map: MapId, mode: ModeId, isPublic: boolean): void;
  onChat(id: string | null, name: string, text: string): void;
  onProfile(profile: PlayerProfile): void;
  onSnapshot(snap: Snapshot): void;
  onError(message: string): void;
  /** The socket opened: the first time, and again after every reconnect. Send `join` here. */
  onOpen(): void;
  /** An established connection dropped; Net is trying to get it back. */
  onReconnecting(): void;
  /** Gave up: the server is unreachable or refused us. */
  onClose(): void;
  /** The `join` message that moves our existing player onto a new socket, or null if we're not in a room. */
  resumeJoin(): Promise<ClientMsg | null>;
}

/** A round trip this slow counts as a bad ping; a few in a row means the connection itself has gone bad. */
const BAD_RTT_MS = 400;
const BAD_STREAK = 3;
/** No pong for this long also counts as bad (a stalled connection never answers at all). */
const STALL_MS = 5000;
/** Don't try a fresh connection more often than this, and give a new one this long to be let in. */
const MIGRATE_COOLDOWN_MS = 20_000;
const MIGRATE_TIMEOUT_MS = 8000;

/** Close codes the server uses on purpose (auth, rate limit, joined elsewhere): reconnecting won't help. */
const FINAL_CLOSE_CODES = new Set([1008, 4000]);

const RETRIES = 12;
const RETRY_MS = 5000;
/** A live connection that drops gets retried sooner than a server that is still waking up. */
const RECONNECT_MS = 1500;

export class Net {
  private ws!: WebSocket;
  /** Estimated (serverTime - localTime) in seconds. */
  private offset: number | null = null;
  rtt = 0;
  private pingTimer: number;
  private everOpened = false;
  private attempts = 0;
  private retryTimer = 0;
  private disposed = false;
  /** Set when the server refused us; the next close is final. */
  private stopped = false;

  constructor(private handlers: NetHandlers) {
    this.connect();
    this.pingTimer = window.setInterval(() => {
      if (this.ws.readyState === WebSocket.OPEN && this.lastPongAt && performance.now() - this.lastPongAt > STALL_MS) this.noteBadPing();
      this.send({ type: 'ping', t: performance.now() });
    }, 2000);
  }

  private lastPongAt = 0;
  private badStreak = 0;
  private lastMigrateAt = 0;
  private candidate: WebSocket | null = null;

  private noteBadPing(): void {
    if (++this.badStreak >= BAD_STREAK && !this.candidate && performance.now() - this.lastMigrateAt > MIGRATE_COOLDOWN_MS) void this.migrate();
  }

  /**
   * A connection that was fine can degrade into seconds of delay (a congested path, a stuck proxy), and a
   * fresh socket usually fixes it. Open one in the background, have the server move our player onto it,
   * and only then drop the old one, so play carries on without a respawn.
   */
  private async migrate(): Promise<void> {
    this.lastMigrateAt = performance.now();
    this.badStreak = 0;
    const join = await this.handlers.resumeJoin().catch(() => null);
    if (!join || this.disposed || this.candidate) return;
    const ws = new WebSocket(wsUrl());
    this.candidate = ws;
    const abandon = () => {
      clearTimeout(timer);
      if (this.candidate === ws) this.candidate = null;
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      ws.close();
      // If the old socket already closed while we waited, fall back to the normal reconnect.
      if (this.ws.readyState === WebSocket.CLOSED) this.handleClose(this.ws, { code: 1006 });
    };
    const timer = window.setTimeout(abandon, MIGRATE_TIMEOUT_MS);
    ws.onopen = () => ws.send(JSON.stringify(join));
    ws.onclose = ws.onerror = abandon;
    ws.onmessage = (e) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type !== 'welcome') return;
      // Moved: the server has stopped sending on the old socket, so retire it quietly.
      clearTimeout(timer);
      const old = this.ws;
      old.onopen = old.onmessage = old.onclose = old.onerror = null;
      old.close();
      this.ws = ws;
      this.candidate = null;
      ws.onmessage = (ev) => this.receive(ev.data);
      ws.onclose = (ev) => this.handleClose(ws, ev);
      ws.onerror = null;
      this.rtt = 0;
      this.badStreak = 0;
      this.lastPongAt = performance.now();
      console.info('[net] swapped to a fresh connection after sustained high ping');
    };
  }

  private connect(): void {
    const ws = new WebSocket(wsUrl());
    this.ws = ws;
    ws.onopen = () => {
      this.everOpened = true;
      this.attempts = 0;
      this.offset = null;
      this.handlers.onOpen();
    };
    ws.onmessage = (e) => this.receive(e.data);
    ws.onclose = (e) => this.handleClose(ws, e);
  }

  private handleClose(ws: WebSocket, e: { code: number }): void {
    if (this.disposed || ws !== this.ws) return;
    // The server closes the old socket the moment it moves us to the new one; the swap finishes on its welcome.
    if (e.code === 4001 && this.candidate) return;
    // A sleeping free host can refuse the first few connections while it boots, and wifi blips drop
    // live ones; keep trying unless the server closed us on purpose.
    if (!this.stopped && !FINAL_CLOSE_CODES.has(e.code) && this.attempts < RETRIES) {
      this.attempts++;
      if (this.everOpened) this.handlers.onReconnecting();
      this.retryTimer = window.setTimeout(() => this.connect(), this.everOpened ? RECONNECT_MS : RETRY_MS);
      return;
    }
    this.handlers.onClose();
  }

  /** The server refused us: don't reconnect after the socket closes. */
  stop(): void {
    this.stopped = true;
  }

  send(msg: ClientMsg): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Current server time estimate in seconds. */
  serverNow(): number {
    return performance.now() / 1000 + (this.offset ?? 0);
  }

  close(): void {
    this.disposed = true;
    clearInterval(this.pingTimer);
    clearTimeout(this.retryTimer);
    this.ws.onclose = null;
    this.ws.close();
  }

  private receive(raw: string): void {
    let msg: ServerMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.type) {
      case 'welcome':
        this.handlers.onWelcome(msg.id, msg.room, msg.host, msg.map, msg.mode, msg.isPublic);
        break;
      case 'chat':
        this.handlers.onChat(msg.id, msg.name, msg.text);
        break;
      case 'profile':
        this.handlers.onProfile(msg.profile);
        break;
      case 'error':
        this.handlers.onError(msg.message);
        break;
      case 'pong':
        {
          const raw = performance.now() - msg.t;
          this.rtt = this.rtt ? this.rtt * 0.7 + raw * 0.3 : raw;
          this.lastPongAt = performance.now();
          if (raw > BAD_RTT_MS) this.noteBadPing();
          else this.badStreak = 0;
        }
        break;
      case 'snap': {
        const measured = msg.time - performance.now() / 1000;
        // A packet that arrives late gives a smaller offset; jump up quickly, drift down slowly.
        if (this.offset === null || measured > this.offset) this.offset = measured;
        else this.offset += (measured - this.offset) * 0.02;
        this.handlers.onSnapshot(msg);
        break;
      }
    }
  }
}
