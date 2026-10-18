import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  COSMETIC_DEFAULTS, RETIRED_HEROES, cosmeticUnlocked, isHeroId, isKillFxId, isPaintId, isTrailId, isUtilId, unlockedCosmetics,
  type CosmeticKind, type Loadout, type PlayerProfile,
} from '@gg/shared';

const projectId = process.env.FIREBASE_PROJECT_ID ?? 'toybox-takedown';
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const app = getApps()[0] ?? initializeApp({
  credential: serviceAccount ? cert(JSON.parse(serviceAccount)) : applicationDefault(),
  projectId,
});
const auth = getAuth(app);
const db = getFirestore(app);
const localFallback = process.env.GG_LOCAL_PROFILE_FALLBACK === '1' && process.env.GG_PORT === '3001' && process.env.NODE_ENV !== 'production';
// shortcut: local profiles reset when this dev server restarts; use Firebase credentials to test persistent saves.
const localProfiles = new Map<string, PlayerProfile>();
const defaultProfile: PlayerProfile = {
  name: 'Player', hero: 'blink', gun: 'smg', secondary: 'pistol', utility: 'frag',
  ...COSMETIC_DEFAULTS,
  kills: 0, deaths: 0, wins: 0, unlocks: unlockedCosmetics(0),
};

/** Keep only known cosmetics the player has unlocked (old profiles still carry a `hat`; it is dropped). */
function settleCosmetics(p: PlayerProfile & { hat?: unknown }, kills: number): PlayerProfile {
  delete p.hat;
  if (!isPaintId(p.paint) || !cosmeticUnlocked('paint', p.paint, kills)) p.paint = COSMETIC_DEFAULTS.paint;
  if (!isTrailId(p.trail) || !cosmeticUnlocked('trail', p.trail, kills)) p.trail = COSMETIC_DEFAULTS.trail;
  if (!isKillFxId(p.killFx) || !cosmeticUnlocked('killFx', p.killFx, kills)) p.killFx = COSMETIC_DEFAULTS.killFx;
  p.unlocks = unlockedCosmetics(kills);
  return p;
}

/** Refuse a loadout that wears something still locked. */
function checkCosmetics(loadout: Loadout, kills: number): void {
  for (const kind of ['paint', 'trail', 'killFx'] as CosmeticKind[]) {
    if (!cosmeticUnlocked(kind, loadout[kind], kills)) throw new Error('That item is still locked.');
  }
}
const profileRef = (uid: string) => db.collection('players').doc(uid);

export async function verifyPlayerToken(token: unknown): Promise<string> {
  if (localFallback && typeof token === 'string' && /^local:[0-9a-f-]{36}$/.test(token)) return token;
  if (typeof token !== 'string' || token.length > 8192) throw new Error('Sign in to save your profile.');
  return (await auth.verifyIdToken(token, true)).uid;
}

export async function getPlayerProfile(uid: string): Promise<PlayerProfile> {
  if (localFallback) {
    if (!localProfiles.has(uid)) localProfiles.set(uid, { ...defaultProfile });
    return { ...localProfiles.get(uid)! };
  }
  const ref = profileRef(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      tx.create(ref, { ...defaultProfile, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      return defaultProfile;
    }
    const stored = settleCosmetics({ ...defaultProfile, ...snap.data() } as PlayerProfile, Number(snap.get('kills')) || 0);
    // Utilities get retired (the Wind-Up Turret became the Bounce Pad); carry them over or fall back.
    if ((stored.utility as string) === 'turret') stored.utility = 'pad';
    if (!isUtilId(stored.utility)) stored.utility = defaultProfile.utility;
    // Retired heroes (Switch, Tock, Brick, Mirage) carry over to their replacements (Volt, Chameleon, Echo, Snag).
    if (!isHeroId(stored.hero)) stored.hero = RETIRED_HEROES[stored.hero as string] ?? defaultProfile.hero;
    return stored;
  });
}

export async function updatePlayerProfile(uid: string, patch: { name?: string; loadout?: Loadout }): Promise<PlayerProfile> {
  if (localFallback) {
    const current = localProfiles.get(uid) ?? { ...defaultProfile };
    if (patch.loadout) checkCosmetics(patch.loadout, current.kills);
    const next = settleCosmetics({ ...current, ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.loadout ?? {}) }, current.kills);
    localProfiles.set(uid, next);
    return { ...next };
  }
  const ref = profileRef(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = { ...defaultProfile, ...(snap.data() ?? {}) } as PlayerProfile;
    const next = { ...current };
    if (patch.name !== undefined) next.name = patch.name;
    if (patch.loadout) {
      checkCosmetics(patch.loadout, current.kills);
      Object.assign(next, patch.loadout);
    }
    settleCosmetics(next, current.kills);
    tx.set(ref, { ...next, hat: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return next;
  });
}

export async function recordPlayerStats(uid: string, delta: { kills?: number; deaths?: number; wins?: number }): Promise<PlayerProfile> {
  if (localFallback) {
    const current = localProfiles.get(uid) ?? { ...defaultProfile };
    const next = { ...current, kills: current.kills + (delta.kills ?? 0), deaths: current.deaths + (delta.deaths ?? 0), wins: current.wins + (delta.wins ?? 0) };
    settleCosmetics(next, next.kills);
    localProfiles.set(uid, next);
    return { ...next };
  }
  const ref = profileRef(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = { ...defaultProfile, ...(snap.data() ?? {}) } as PlayerProfile;
    const next = {
      ...current,
      kills: current.kills + (delta.kills ?? 0),
      deaths: current.deaths + (delta.deaths ?? 0),
      wins: current.wins + (delta.wins ?? 0),
    };
    settleCosmetics(next, next.kills);
    tx.set(ref, { ...next, hat: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return next;
  });
}
