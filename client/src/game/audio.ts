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
      case 'minismg': this.tone(1400, 400, 0.04, 'square', 0.06 * v); this.noise(0.035, 0.12 * v, 3400); break;
      case 'thumper': this.tone(300, 70, 0.22, 'sawtooth', 0.18 * v); this.noise(0.18, 0.4 * v, 700, 0.7); break;
      case 'bouncer': this.tone(500, 900, 0.08, 'triangle', 0.14 * v); this.noise(0.05, 0.16 * v, 1600); break;
      case 'stinger': this.tone(2200, 1500, 0.05, 'square', 0.06 * v); this.noise(0.03, 0.1 * v, 5200, 2); break;
      case 'burst': this.tone(1000, 260, 0.07, 'square', 0.09 * v); this.noise(0.05, 0.18 * v, 2600); break;
      case 'smg': this.tone(1200, 300, 0.05, 'square', 0.07 * v); this.noise(0.04, 0.14 * v, 3000); break;
      case 'shotgun': this.noise(0.22, 0.45 * v, 900, 0.7); this.tone(220, 60, 0.18, 'sawtooth', 0.15 * v); break;
      case 'sniper': this.tone(1600, 90, 0.35, 'sawtooth', 0.14 * v); this.noise(0.25, 0.3 * v, 1800); break;
      case 'rocket': this.tone(160, 380, 0.3, 'triangle', 0.18 * v); this.noise(0.3, 0.2 * v, 600); break;
    }
  }

  /** Hit marker: a bright tick on top of a short body thud so every hit lands. */
  hit(): void {
    this.tone(1900, 2400, 0.04, 'square', 0.07);
    this.tone(220, 90, 0.07, 'sine', 0.22);
    this.noise(0.03, 0.18, 3800, 1.5);
  }
  hurt(): void {
    this.tone(300, 120, 0.15, 'square', 0.12);
    this.tone(90, 50, 0.18, 'sine', 0.3);
  }
  kill(): void {
    this.tone(120, 40, 0.3, 'sine', 0.4);
    this.noise(0.12, 0.3, 1200, 0.8);
    [660, 880, 1320].forEach((f, i) => this.tone(f, f, 0.12, 'triangle', 0.16, 0.05 + i * 0.06));
  }
  refill(): void { this.tone(880, 1320, 0.08, 'triangle', 0.1); this.tone(1320, 1760, 0.08, 'triangle', 0.08, 0.07); }
  heal(): void { [523, 784, 1046].forEach((f, i) => this.tone(f, f * 1.02, 0.12, 'sine', 0.14, i * 0.05)); }
  streak(n: number): void {
    const base = n >= 8 ? 523 : n >= 5 ? 440 : 392;
    [0, 4, 7, 12].forEach((st, i) => {
      const f = base * 2 ** (st / 12);
      this.tone(f, f, 0.16, 'square', 0.1, i * 0.07);
    });
  }
  /** Grapple: a launch twang, then a clank if it caught or a limp slap if it missed. */
  grapple(hit: boolean, near: number): void {
    this.tone(900, 300, 0.12, 'square', 0.08 * near);
    this.noise(0.08, 0.15 * near, 3000, 2);
    if (hit) this.tone(1800, 1500, 0.08, 'triangle', 0.12 * near, 0.1);
    else this.tone(250, 150, 0.12, 'sine', 0.08 * near, 0.18);
  }
  /** Bounce Pad set down: a plasticky thunk. */
  padSet(near: number): void {
    this.tone(320, 140, 0.12, 'triangle', 0.14 * near);
    this.noise(0.06, 0.12 * near, 1200, 1);
  }
  /** Bounce Pad goes live: a short rising click. */
  padArm(): void { this.tone(700, 1400, 0.08, 'square', 0.06); this.tone(1400, 1400, 0.05, 'triangle', 0.05, 0.08); }
  /** Bounce Pad shot apart: a crunch and a sprung spring. */
  padBreak(near: number): void {
    this.noise(0.25, 0.35 * near, 900, 1);
    this.tone(500, 90, 0.35, 'triangle', 0.14 * near);
  }
  /** Bounce Pad launch: a big cartoon boing. */
  boing(near: number): void {
    this.tone(180, 720, 0.35, 'sine', 0.22 * near);
    this.tone(360, 1100, 0.25, 'triangle', 0.08 * near, 0.03);
  }
  death(): void { this.tone(400, 60, 0.6, 'sawtooth', 0.15); }
  explode(near: number): void { this.noise(0.6, 0.6 * (0.2 + near * 0.8), 300, 0.5); this.tone(110, 35, 0.5, 'sine', 0.35 * near); }
  blink(): void { this.tone(400, 1600, 0.16, 'sine', 0.16); }
  /** Overcharge: a rising electric whine. */
  overcharge(): void { this.tone(220, 1320, 0.35, 'sawtooth', 0.08); this.tone(1320, 1760, 0.12, 'square', 0.05, 0.3); }
  /** Hide and Seek: a soft whoosh as you fade out. */
  hide(): void { this.noise(0.3, 0.08, 2400, 1); this.tone(900, 300, 0.3, 'sine', 0.06); }
  /** Sonar Ping: a classic submarine ping, plus a blip per enemy found. */
  sonar(found: number): void {
    this.tone(1200, 1180, 0.6, 'sine', 0.12);
    for (let i = 0; i < Math.min(found, 5); i++) this.tone(1800, 1800, 0.05, 'square', 0.05, 0.35 + i * 0.08);
  }
  /** Someone else's sonar found you. */
  pinged(): void { this.tone(1200, 1180, 0.4, 'sine', 0.07); this.tone(500, 400, 0.2, 'triangle', 0.08, 0.15); }
  pop(): void { this.tone(800, 200, 0.12, 'triangle', 0.14); }
  throwWhoosh(): void { this.noise(0.18, 0.12, 1800, 2); this.tone(500, 260, 0.16, 'sine', 0.06); }
  flashBang(near: number): void { this.tone(3200, 2400, 0.6, 'sine', 0.2 * near); this.noise(0.25, 0.4 * near, 4000); }
  smokeHiss(near: number): void { this.noise(0.9, 0.25 * (0.3 + near), 5000, 0.5); }
  weaponSwap(): void { this.tone(600, 900, 0.05, 'square', 0.06); this.tone(900, 700, 0.05, 'square', 0.05, 0.06); }
  pickup(): void { this.tone(700, 1400, 0.1, 'square', 0.1); }
  /** A falling whistle while a power-up drops in. */
  powerDrop(near: number): void { this.tone(1800, 500, 1.4, 'sine', 0.05 + 0.08 * near); }
  powerLand(near: number): void {
    this.tone(220, 90, 0.18, 'triangle', 0.18 * near);
    [988, 1319, 1568].forEach((f, i) => this.tone(f, f * 1.01, 0.1, 'sine', 0.08 * near, 0.05 + i * 0.04));
  }
  powerUp(): void { [523, 659, 784, 1046, 1319].forEach((f, i) => this.tone(f, f * 1.03, 0.12, 'square', 0.07, i * 0.045)); }
  win(): void {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, f, 0.18, 'triangle', 0.18, i * 0.12));
  }
}

type Track = 'lobby' | 'game';

/** Chord roots (MIDI) per bar and whether the chord is minor. */
const TRACKS: Record<Track, { bpm: number; chords: [number, boolean][]; lead: boolean; gain: number }> = {
  lobby: { bpm: 112, chords: [[48, false], [45, true], [41, false], [43, false]], lead: true, gain: 0.32 },
  game: { bpm: 128, chords: [[45, true], [41, false], [48, false], [43, false]], lead: false, gain: 0.2 },
};

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);
const MUSIC_KEY = 'gg.music';

/**
 * Tiny step sequencer for the background loop: bass, drums and an arpeggio, all synthesized.
 * Browsers only allow audio after a click or key press, so `play` waits for one.
 */
class Music {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private track: Track | null = null;
  private step = 0;
  private nextAt = 0;
  private timer = 0;
  private wanted: Track | null = null;
  enabled = true;

  constructor() {
    try {
      this.enabled = localStorage.getItem(MUSIC_KEY) !== 'off';
    } catch {
      this.enabled = true;
    }
    const unlock = () => {
      if (this.wanted && !this.track) this.start(this.wanted);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  play(track: Track): void {
    this.wanted = track;
    if (!this.enabled) return;
    if (this.track === track) return;
    this.stop();
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    this.start(track);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    try {
      localStorage.setItem(MUSIC_KEY, on ? 'on' : 'off');
    } catch {
      // Preference just won't stick.
    }
    if (on && this.wanted) this.start(this.wanted);
    else this.stop();
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
    this.track = null;
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
  }

  private start(track: Track): void {
    if (!this.enabled) return;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      const len = this.ctx.sampleRate * 0.3;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    const ctx = this.ctx;
    if (ctx.state === 'suspended') void ctx.resume();
    window.clearInterval(this.timer);
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.gain.setTargetAtTime(TRACKS[track].gain, ctx.currentTime, 0.4);
    this.out.connect(ctx.destination);
    this.track = track;
    this.step = 0;
    this.nextAt = ctx.currentTime + 0.1;
    // Schedule a little ahead on a timer; the audio clock keeps the beat steady.
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || !this.track || !this.out) return;
    const t = TRACKS[this.track];
    const sixteenth = 60 / t.bpm / 4;
    while (this.nextAt < ctx.currentTime + 0.12) {
      const s = this.step % 16;
      const [root, minor] = t.chords[Math.floor(this.step / 16) % t.chords.length];
      const third = minor ? 3 : 4;
      if (s % 4 === 0) this.kick(this.nextAt);
      if (s === 4 || s === 12) this.snare(this.nextAt);
      if (s % 2 === 0) this.hat(this.nextAt, s % 4 === 2 ? 0.05 : 0.025);
      // Bass bounces root, root, octave, fifth.
      if (s % 4 === 0 || s % 4 === 3) {
        const n = [root, root, root + 12, root + 7][Math.floor(s / 4)];
        this.note(midi(n - 12), this.nextAt, sixteenth * (s % 4 === 3 ? 0.9 : 1.8), 'triangle', 0.5);
      }
      if (t.lead && s % 2 === 0) {
        const arp = [0, third, 7, 12, 7, third, 12, 7][(s / 2) % 8];
        this.note(midi(root + 24 + arp), this.nextAt, sixteenth * 0.9, 'square', 0.07);
      } else if (!t.lead && (s === 6 || s === 14)) {
        this.note(midi(root + 24 + 7), this.nextAt, sixteenth * 1.6, 'square', 0.05);
      }
      this.nextAt += sixteenth;
      this.step++;
    }
  }

  private note(freq: number, at: number, dur: number, type: OscillatorType, gain: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(this.out!);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  private kick(at: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(150, at);
    o.frequency.exponentialRampToValueAtTime(45, at + 0.12);
    g.gain.setValueAtTime(0.9, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.16);
    o.connect(g).connect(this.out!);
    o.start(at);
    o.stop(at + 0.18);
  }

  private snare(at: number): void {
    this.burst(at, 0.14, 0.35, 1800, 'bandpass');
  }

  private hat(at: number, gain: number): void {
    this.burst(at, 0.03, gain, 7000, 'highpass');
  }

  private burst(at: number, dur: number, gain: number, freq: number, type: BiquadFilterType): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    src.connect(f).connect(g).connect(this.out!);
    src.start(at);
    src.stop(at + dur);
  }
}

export const music = new Music();
