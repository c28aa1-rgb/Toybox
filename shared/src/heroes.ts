export type HeroId = 'blink' | 'swap' | 'chrono' | 'decoy' | 'builder';

export interface HeroDef {
  id: HeroId;
  name: string;
  ability: string;
  description: string;
  cooldown: number;
  /** Default body color for the placeholder model and name tag. */
  color: string;
}

export const HEROES: Record<HeroId, HeroDef> = {
  blink: {
    id: 'blink', name: 'Flicker', ability: 'Blink', cooldown: 5, color: '#4FB3FF',
    description: 'Teleport up to 6.5 m toward your cursor. Stops at walls.',
  },
  swap: {
    id: 'swap', name: 'Switch', ability: 'Swap', cooldown: 9, color: '#FF5FA2',
    description: 'Trade places with the enemy closest to your cursor. They must be within 12 m of you.',
  },
  chrono: {
    id: 'chrono', name: 'Tock', ability: 'Time Bubble', cooldown: 12, color: '#3DDBB4',
    description: 'Drop a bubble that slows enemies and bullets inside it for 4.5 s. Blocks Swap.',
  },
  decoy: {
    id: 'decoy', name: 'Mirage', ability: 'Decoy', cooldown: 10, color: '#B48CFF',
    description: 'Send out a fake copy of yourself that runs and shoots blanks for 5 s.',
  },
  builder: {
    id: 'builder', name: 'Brick', ability: 'Wall', cooldown: 7, color: '#FF8A1F',
    description: 'Drop a wall in front of you. It takes 150 damage before breaking.',
  },
};

export const HERO_IDS = Object.keys(HEROES) as HeroId[];

export function isHeroId(v: unknown): v is HeroId {
  return typeof v === 'string' && v in HEROES;
}

export const ABILITY = {
  blinkDistance: 6.5,
  swapRange: 12,
  bubbleRadius: 3.6,
  bubbleDuration: 4.5,
  bubbleMaxDistance: 8,
  bubbleBulletFactor: 0.25,
  bubbleMoveFactor: 0.4,
  decoyDuration: 5,
  decoyHp: 40,
  decoyFireCooldown: 0.4,
  wallLength: 3.4,
  wallThickness: 0.7,
  wallHp: 150,
  wallDuration: 9,
  wallDistance: 2.2,
  wallsPerPlayer: 2,
} as const;
