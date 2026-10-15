import { signInAnonymously } from 'firebase/auth';
import type { Loadout, PlayerProfile } from '@gg/shared';
import { firebaseAuth } from './firebase';
import { apiUrl } from './game/server';

const DEFAULT: PlayerProfile = {
  name: '', hero: 'blink', gun: 'smg', secondary: 'pistol', utility: 'frag', hat: 'none',
  kills: 0, deaths: 0, wins: 0, unlocks: ['none'],
};
let profile: PlayerProfile = { ...DEFAULT };

export function loadProfile(): PlayerProfile {
  return profile;
}

export function setProfile(p: PlayerProfile): void {
  profile = p;
}

export async function playerToken(): Promise<string> {
  if (import.meta.env.DEV) {
    let id = localStorage.getItem('gg.local-dev-id');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('gg.local-dev-id', id);
    }
    return `local:${id}`;
  }
  await firebaseAuth.authStateReady();
  const user = firebaseAuth.currentUser ?? (await signInAnonymously(firebaseAuth)).user;
  return user.getIdToken();
}

async function requestProfile(method: 'GET' | 'PATCH', body?: { name?: string } & Partial<Loadout>): Promise<PlayerProfile> {
  const token = await playerToken();
  const response = await fetch(apiUrl('/api/profile'), {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Could not load your player profile.');
  profile = result as PlayerProfile;
  return profile;
}

export function fetchProfile(): Promise<PlayerProfile> {
  return requestProfile('GET');
}

export function patchProfile(patch: { name?: string } & Partial<Loadout>): Promise<PlayerProfile> {
  return requestProfile('PATCH', patch);
}
