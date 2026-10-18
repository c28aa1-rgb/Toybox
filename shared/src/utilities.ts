export type UtilId = 'frag' | 'flash' | 'smoke' | 'pad' | 'juice';

export interface UtilDef {
  id: UtilId;
  name: string;
  blurb: string;
  /** Seconds after landing before it goes off. */
  fuseAfterLanding: number;
  radius: number;
  damage: number;
  knockback: number;
  charges: number;
  /** Used on the spot instead of thrown: restores this much health. */
  heal?: number;
  /** Set down in front of you instead of thrown. */
  deploy?: boolean;
}

export const UTILS: Record<UtilId, UtilDef> = {
  frag: {
    id: 'frag', name: 'Fizz Bomb', blurb: 'Lob it over cover. Pops after a short fizz.',
    fuseAfterLanding: 0.6, radius: 3.2, damage: 70, knockback: 6, charges: 2,
  },
  flash: {
    id: 'flash', name: 'Flash Pop', blurb: 'Blinds everyone who can see it go off. Look away.',
    fuseAfterLanding: 0.25, radius: 10, damage: 0, knockback: 0, charges: 2,
  },
  smoke: {
    id: 'smoke', name: 'Puff Can', blurb: 'Thick smoke for 7 s. Nobody can see into, out of or through it.',
    fuseAfterLanding: 0.1, radius: 3.6, damage: 0, knockback: 0, charges: 2,
  },
  pad: {
    id: 'pad', name: 'Bounce Pad', blurb: 'Tap G to set it down in front of you, or hold G to throw it. Anyone who steps on it is launched over walls.',
    fuseAfterLanding: 0, radius: 0, damage: 0, knockback: 0, charges: 2, deploy: true,
  },
  juice: {
    id: 'juice', name: 'Juice Box', blurb: 'Press G to drink it. Heals 45 straight away.',
    fuseAfterLanding: 0, radius: 0, damage: 0, knockback: 0, charges: 2, heal: 45,
  },
};

export const UTIL_IDS = Object.keys(UTILS) as UtilId[];

export function isUtilId(v: unknown): v is UtilId {
  return typeof v === 'string' && v in UTILS;
}

export const THROW = {
  maxDistance: 13,
  minDistance: 2,
  gravity: 22,
  releaseHeight: 1.0,
  /** Throws clear anything lower than this while airborne. */
  wallHeight: 1.3,
  cooldown: 0.8,
  smokeDuration: 7,
};

/** Flash Pop blindness in seconds: `max` right next to it, `min` at the edge of its radius. The thrower gets half. */
export const FLASH = { min: 1.5, max: 5 };

/** Bounce Pad: set down in front of you, launches whoever steps on it. */
export const PAD = {
  /** Seconds a pad stays out. Each player can have this many down at once; a new one replaces the oldest. */
  duration: 25,
  maxPerPlayer: 2,
  /** Step within this distance of the centre to trigger it. */
  radius: 0.85,
  /** A tap of G sets it this far in front of you, so you can walk straight onto it. */
  placeDistance: 2.0,
  /** Seconds after landing before it can launch anyone. */
  armTime: 0.6,
  /** Bullets and blasts can break it. */
  hp: 60,
  hitRadius: 0.6,
  /** The launch: metres travelled, seconds in the air and peak height (high enough to clear walls). */
  launchDistance: 10,
  launchTime: 0.75,
  launchHeight: 3.2,
  /** After landing, a short wait before the same player can be launched again. */
  reuseDelay: 0.5,
};

/** Movement multiplier while slowed by a Stinger hit. */
export const SLOW_FACTOR = 0.5;

/** Flight time for a throw of `dist` metres; the client uses the same curve for its arc preview. */
export function throwFlightTime(dist: number): number {
  return 0.35 + dist / 22;
}
