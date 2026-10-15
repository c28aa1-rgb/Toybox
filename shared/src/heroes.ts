export type HeroId = 'blink' | 'volt' | 'chameleon' | 'decoy' | 'echo';

/**
 * cooldown: press to use, then wait `cooldown` seconds.
 * charge: fills by dealing `charge` damage; press to use once full.
 * passive: always on, nothing to press (`cooldown` is its timer, if it has one).
 */
export type AbilityKind = 'cooldown' | 'charge' | 'passive';

export interface HeroDef {
  id: HeroId;
  name: string;
  ability: string;
  kind: AbilityKind;
  description: string;
  cooldown: number;
  /** Charge abilities: damage you must deal to fill it. */
  charge?: number;
  /** Default body color for the placeholder model and name tag. */
  color: string;
}

export const HEROES: Record<HeroId, HeroDef> = {
  blink: {
    id: 'blink', name: 'Flicker', ability: 'Blink', kind: 'cooldown', cooldown: 12, color: '#4FB3FF',
    description: 'Teleport up to 6.5 m toward your cursor. Stops at walls.',
  },
  volt: {
    id: 'volt', name: 'Volt', ability: 'Overcharge', kind: 'charge', charge: 150, cooldown: 0, color: '#FFE45C',
    description: 'Charges as you deal damage. When full, your next 3 shots hit twice as hard. Fire them within 8 s.',
  },
  chameleon: {
    id: 'chameleon', name: 'Chameleon', ability: 'Hide and Seek', kind: 'passive', cooldown: 0, color: '#3DDBB4',
    description: 'Passive. Stand still for 1.5 s to turn invisible. Moving, shooting, throwing or getting hit gives you away.',
  },
  decoy: {
    id: 'decoy', name: 'Mirage', ability: 'Decoy', kind: 'charge', charge: 120, cooldown: 0, color: '#B48CFF',
    description: 'Charges as you deal damage. When full, send out a fake copy of yourself that runs and shoots blanks for 5 s.',
  },
  echo: {
    id: 'echo', name: 'Echo', ability: 'Sonar Ping', kind: 'cooldown', cooldown: 12, color: '#FF8A1F',
    description: 'Ping every enemy within 22 m. You and your team see them through walls for 3 s.',
  },
};

export const HERO_IDS = Object.keys(HEROES) as HeroId[];

/** Short line for hero cards: how the ability recharges. */
export function abilityTag(h: HeroDef): string {
  if (h.kind === 'passive') return `${h.ability} · passive`;
  if (h.kind === 'charge') return `${h.ability} · charged by damage`;
  return `${h.ability} · ${h.cooldown}s`;
}

/** Heroes that were replaced, mapped to their successors so saved loadouts keep working. */
export const RETIRED_HEROES: Record<string, HeroId> = { swap: 'volt', chrono: 'chameleon', builder: 'echo' };

export function isHeroId(v: unknown): v is HeroId {
  return typeof v === 'string' && v in HEROES;
}

export const ABILITY = {
  blinkDistance: 6.5,
  decoyDuration: 5,
  decoyHp: 40,
  decoyFireCooldown: 0.4,
  /** Hide and Seek: seconds standing still before you vanish. */
  hideDelay: 1.5,
  /** Bots and turrets notice a hidden player this close. Players see a faint shimmer at the same range. */
  hiddenSpotRange: 3,
  /** Sonar Ping. */
  sonarRadius: 22,
  sonarReveal: 3,
  /** Overcharge. */
  overchargeShots: 3,
  overchargeWindow: 8,
  overchargeMult: 2,
} as const;
