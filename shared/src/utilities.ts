export type UtilId = 'frag' | 'flash' | 'smoke';

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
    id: 'smoke', name: 'Puff Can', blurb: 'A thick cloud nobody can see through for 7 s.',
    fuseAfterLanding: 0.1, radius: 3.6, damage: 0, knockback: 0, charges: 2,
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

/** Flight time for a throw of `dist` metres; the client uses the same curve for its arc preview. */
export function throwFlightTime(dist: number): number {
  return 0.35 + dist / 22;
}
