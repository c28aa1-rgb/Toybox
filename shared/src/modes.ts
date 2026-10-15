import type { GunId } from './guns';

export type ModeId = 'ffa' | 'teams' | 'hill' | 'ladder';

export interface ModeDef {
  id: ModeId;
  name: string;
  blurb: string;
  /** Score that ends the round: kills, team kills, hill points or ladder steps. */
  target: number;
  teams: boolean;
}

export const MODES: Record<ModeId, ModeDef> = {
  ffa: { id: 'ffa', name: 'Free for all', blurb: 'Everyone for themselves. First to 15 kills.', target: 15, teams: false },
  teams: { id: 'teams', name: 'Team Brawl', blurb: 'Red against blue. First team to 25 kills. No friendly fire.', target: 25, teams: true },
  hill: { id: 'hill', name: 'King of the Toybox', blurb: 'Stand in the ring alone to score a point a second. First to 60.', target: 60, teams: false },
  ladder: { id: 'ladder', name: 'Gun Ladder', blurb: 'Every kill swaps you to the next gun. Win with the last one.', target: 10, teams: false },
};

export const MODE_IDS = Object.keys(MODES) as ModeId[];

export function isModeId(v: unknown): v is ModeId {
  return typeof v === 'string' && v in MODES;
}

/** Gun Ladder order: one gun per kill, ending on the humble Pea Shooter. */
export const GUN_LADDER: GunId[] = ['smg', 'burst', 'shotgun', 'minismg', 'sniper', 'thumper', 'stinger', 'rocket', 'bouncer', 'pistol'];

export const TEAM_NAMES = ['Red', 'Blue'] as const;
export const TEAM_COLORS = ['#FF5F6D', '#4FB3FF'] as const;
