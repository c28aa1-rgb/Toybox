import type { HillSnap, MapDef } from '@gg/shared';

const MAX_W = 190;
const MAX_H = 140;

export interface MinimapView {
  /** You, while alive. Other players are never drawn. */
  me: { x: number; y: number; aim: number } | null;
  /** Enemies a teammate's Sonar Ping revealed: the only other players ever drawn. */
  revealed: { x: number; y: number }[];
  /** Power-ups on the floor; `landing` ones are still falling. */
  powers: { x: number; y: number; color: string; landing: boolean }[];
  hill: HillSnap | null;
  time: number;
}

/**
 * Corner map of the arena: walls, you, power-ups and the hill. It never shows other players, except
 * enemies your team's Sonar Ping just revealed.
 */
export class Minimap {
  readonly el: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** The map's own walls, drawn once per map. */
  private base = document.createElement('canvas');
  private map: MapDef | null = null;
  private scale = 1;
  private dpr = 1;

  constructor(container: HTMLElement) {
    this.el = document.createElement('canvas');
    this.el.className = 'hud-minimap';
    this.el.setAttribute('aria-hidden', 'true');
    this.ctx = this.el.getContext('2d')!;
    container.appendChild(this.el);
  }

  setMap(map: MapDef): void {
    this.map = map;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.scale = Math.min(MAX_W / map.w, MAX_H / map.h);
    const w = Math.round(map.w * this.scale);
    const h = Math.round(map.h * this.scale);
    for (const c of [this.el, this.base]) {
      c.width = w * this.dpr;
      c.height = h * this.dpr;
    }
    this.el.style.width = `${w}px`;
    this.el.style.height = `${h}px`;
    const b = this.base.getContext('2d')!;
    b.setTransform(this.dpr * this.scale, 0, 0, this.dpr * this.scale, 0, 0);
    b.fillStyle = 'rgba(36, 18, 63, 0.82)';
    b.fillRect(0, 0, map.w, map.h);
    b.fillStyle = '#C9B6E8';
    for (const r of map.walls) b.fillRect(r.x, r.y, r.w, r.h);
  }

  draw(v: MinimapView): void {
    const map = this.map;
    if (!map) return;
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.el.width, this.el.height);
    c.drawImage(this.base, 0, 0);
    c.setTransform(this.dpr * this.scale, 0, 0, this.dpr * this.scale, 0, 0);
    const px = 1 / this.scale; // one CSS pixel, in metres


    if (v.hill) {
      c.strokeStyle = v.hill.contested ? '#FF5FA2' : '#FFFFFF';
      c.lineWidth = 1.5 * px;
      c.beginPath();
      c.arc(v.hill.x, v.hill.y, v.hill.r, 0, Math.PI * 2);
      c.stroke();
    }

    for (const p of v.powers) {
      // Falling drops pulse; landed ones sit solid with a dark rim.
      const r = (p.landing ? 3 + Math.sin(v.time * 12) * 1.2 : 3.5) * px;
      c.fillStyle = p.color;
      c.strokeStyle = '#1B1030';
      c.lineWidth = 1.2 * px;
      c.beginPath();
      c.arc(p.x, p.y, r, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }

    c.fillStyle = '#FF4D6A';
    for (const e of v.revealed) {
      c.beginPath();
      c.arc(e.x, e.y, 3.5 * px, 0, Math.PI * 2);
      c.fill();
    }

    if (v.me) {
      const { x, y, aim } = v.me;
      const s = 6 * px;
      c.save();
      c.translate(x, y);
      c.rotate(aim);
      c.fillStyle = '#FFE45C';
      c.strokeStyle = '#1B1030';
      c.lineWidth = 1.2 * px;
      c.beginPath();
      c.moveTo(s, 0);
      c.lineTo(-s * 0.7, s * 0.65);
      c.lineTo(-s * 0.35, 0);
      c.lineTo(-s * 0.7, -s * 0.65);
      c.closePath();
      c.fill();
      c.stroke();
      c.restore();
    }

    c.strokeStyle = '#1B1030';
    c.lineWidth = 2 * px;
    c.strokeRect(0, 0, map.w, map.h);
  }

  dispose(): void {
    this.el.remove();
  }
}
