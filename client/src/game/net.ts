import type { ClientMsg, MapId, ModeId, ServerMsg, Snapshot } from '@gg/shared';

export interface NetHandlers {
  onWelcome(id: string, room: string, host: boolean, map: MapId, mode: ModeId, isPublic: boolean): void;
  onChat(id: string | null, name: string, text: string): void;
  onSnapshot(snap: Snapshot): void;
  onError(message: string): void;
  onClose(): void;
}

export class Net {
  private ws: WebSocket;
  /** Estimated (serverTime - localTime) in seconds. */
  private offset: number | null = null;
  rtt = 0;
  private pingTimer: number;

  constructor(private handlers: NetHandlers) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onmessage = (e) => this.receive(e.data);
    this.ws.onclose = () => handlers.onClose();
    this.ws.onerror = () => handlers.onError('Lost connection to the server.');
    this.pingTimer = window.setInterval(() => this.send({ type: 'ping', t: performance.now() }), 2000);
  }

  whenOpen(fn: () => void): void {
    if (this.ws.readyState === WebSocket.OPEN) fn();
    else this.ws.addEventListener('open', fn, { once: true });
  }

  send(msg: ClientMsg): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Current server time estimate in seconds. */
  serverNow(): number {
    return performance.now() / 1000 + (this.offset ?? 0);
  }

  close(): void {
    clearInterval(this.pingTimer);
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
