import { GUNS, type GunId, type HeroId } from '@gg/shared';

export interface Profile {
  name: string;
  hero: HeroId;
  gun: GunId;
  kills: number;
  wins: number;
}

const KEY = 'gg.profile.v1';

const DEFAULT: Profile = { name: '', hero: 'blink', gun: 'pistol', kills: 0, wins: 0 };

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT, ...JSON.parse(raw) };
  } catch {
    // Storage can be blocked in private windows; fall back to defaults.
  }
  return { ...DEFAULT };
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Not fatal: unlocks just won't persist.
  }
}

export function isUnlocked(gun: GunId, kills: number): boolean {
  return kills >= GUNS[gun].unlockKills;
}

export function addKill(): Profile {
  const p = loadProfile();
  p.kills++;
  saveProfile(p);
  return p;
}

export function addWin(): Profile {
  const p = loadProfile();
  p.wins++;
  saveProfile(p);
  return p;
}
