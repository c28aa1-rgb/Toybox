import { wsUrl } from './server';
import type { ClientMsg, MapId, ModeId, ServerMsg, Snapshot } from '@gg/shared';

export interface NetHandlers {
  onWelcome(id: string, room: string, host: boolean, map: MapId, mode: ModeId, isPublic: boolean): void;
  onChat(id: string | null, name: string, text: string): void;
  onSnapshot(snap: Snapshot): void;
  onError(message: string): void;
  onClose(): void;
}

const RETRIES = 12;
const RETRY_MS = 5000;

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
  private openWaiters: Array<() => void> = [];

  constructor(private handlers: NetHandlers) {
    this.connect();
    this.pingTimer = window.setInterval(() => this.send({ type: 'ping', t: performance.now() }), 2000);
  }

  private connect(): void {
    const ws = new WebSocket(wsUrl());
    this.ws = ws;
    ws.onopen = () => {
      this.everOpened = true;
      for (const fn of this.openWaiters.splice(0)) fn();
    };
    ws.onmessage = (e) => this.receive(e.data);
    ws.onclose = () => {
      if (this.disposed) return;
      // A sleeping free host can refuse the first few connections while it boots; keep trying.
      if (!this.everOpened && this.attempts < RETRIES) {
        this.attempts++;
        this.retryTimer = window.setTimeout(() => this.connect(), RETRY_MS);
        return;
      }
      this.handlers.onClose();
    };
    ws.onerror = () => {
      if (this.everOpened || this.attempts >= RETRIES) this.handlers.onError('Lost connection to the server.');
    };
  }

  whenOpen(fn: () => void): void {
    if (this.ws.readyState === WebSocket.OPEN) fn();
    else this.openWaiters.push(fn);
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
