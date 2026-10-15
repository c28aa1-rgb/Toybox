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
}

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
    this.pingTimer = window.setInterval(() => this.send({ type: 'ping', t: performance.now() }), 2000);
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
    ws.onclose = (e) => {
      if (this.disposed) return;
      // A sleeping free host can refuse the first few connections while it boots, and wifi blips drop
      // live ones; keep trying unless the server closed us on purpose.
      if (!this.stopped && !FINAL_CLOSE_CODES.has(e.code) && this.attempts < RETRIES) {
        this.attempts++;
        if (this.everOpened) this.handlers.onReconnecting();
        this.retryTimer = window.setTimeout(() => this.connect(), this.everOpened ? RECONNECT_MS : RETRY_MS);
        return;
      }
      this.handlers.onClose();
    };
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
        this.rtt = this.rtt ? this.rtt * 0.7 + (performance.now() - msg.t) * 0.3 : performance.now() - msg.t;
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
