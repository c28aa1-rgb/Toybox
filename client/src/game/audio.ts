import type { GunId } from '@gg/shared';

/** Small synth sound kit. No audio files needed. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  volume = 0.5;

  private ensure(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate * 0.5;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private tone(freq: number, endFreq: number, dur: number, type: OscillatorType, gain: number, when = 0): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, gain: number, filterFreq: number, q = 1): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.noiseBuf) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = filterFreq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur);
  }

  /** `near` is 0..1, how close the shot was to the listener. */
  shot(gun: GunId, near: number): void {
    const v = 0.15 + near * 0.85;
    switch (gun) {
      case 'pistol': this.tone(900, 180, 0.09, 'square', 0.12 * v); this.noise(0.06, 0.2 * v, 2400); break;
      case 'smg': this.tone(1200, 300, 0.05, 'square', 0.07 * v); this.noise(0.04, 0.14 * v, 3000); break;
      case 'shotgun': this.noise(0.22, 0.45 * v, 900, 0.7); this.tone(220, 60, 0.18, 'sawtooth', 0.15 * v); break;
      case 'sniper': this.tone(1600, 90, 0.35, 'sawtooth', 0.14 * v); this.noise(0.25, 0.3 * v, 1800); break;
      case 'rocket': this.tone(160, 380, 0.3, 'triangle', 0.18 * v); this.noise(0.3, 0.2 * v, 600); break;
    }
  }

  hit(): void { this.tone(1400, 1800, 0.05, 'triangle', 0.12); }
  hurt(): void { this.tone(300, 120, 0.15, 'square', 0.12); }
  kill(): void {
    this.tone(660, 660, 0.09, 'triangle', 0.18);
    this.tone(990, 990, 0.14, 'triangle', 0.18, 0.08);
  }
  death(): void { this.tone(400, 60, 0.6, 'sawtooth', 0.15); }
  explode(near: number): void { this.noise(0.6, 0.6 * (0.2 + near * 0.8), 300, 0.5); this.tone(110, 35, 0.5, 'sine', 0.35 * near); }
  blink(): void { this.tone(400, 1600, 0.16, 'sine', 0.16); }
  swap(): void { this.tone(500, 1000, 0.1, 'triangle', 0.15); this.tone(1000, 500, 0.12, 'triangle', 0.15, 0.1); }
  fail(): void { this.tone(200, 150, 0.15, 'square', 0.1); }
  bubble(): void { this.tone(300, 900, 0.4, 'sine', 0.15); }
  wall(): void { this.noise(0.15, 0.3, 400); this.tone(140, 90, 0.15, 'square', 0.12); }
  pop(): void { this.tone(800, 200, 0.12, 'triangle', 0.14); }
  pickup(): void { this.tone(700, 1400, 0.1, 'square', 0.1); }
  win(): void {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, f, 0.18, 'triangle', 0.18, i * 0.12));
  }
}
