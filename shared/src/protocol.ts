import type { GunId } from './guns';
import type { HeroId } from './heroes';
import type { HatId } from './cosmetics';
import type { MapId } from './map';
import type { PowerId } from './powers';
import type { ModeId } from './modes';
import type { UtilId } from './utilities';

/** Anything that can score a kill: a gun or a thrown utility. */
export type WeaponId = GunId | UtilId;

/** One frame of player intent. Movement is applied for `dt` seconds. */
export interface InputFrame {
  seq: number;
  dt: number;
  /** Movement direction, each axis in [-1, 1]. */
  mx: number;
  my: number;
  aim: number;
  /** Distance from the player to the cursor on the ground, in meters. */
  aimDist: number;
  fire: boolean;
  /** Held: aiming down the scope. */
  scope: boolean;
  /** Edge-triggered: true only on the frame the key went down. */
  ability: boolean;
  pickup: boolean;
  reload?: boolean;
  /** 1 = switch to primary, 2 = switch to secondary, 0 = no change. */
  slot: 0 | 1 | 2;
  /** Edge-triggered: throw the utility toward the cursor. */
  throw: boolean;
  /** With `throw`: a tap of the grenade key, so deployables are set down in front instead of lobbed. */
  place?: boolean;
  /** Dead players stay down until they ask to come back (Enter or the button). */
  respawn?: boolean;
}

export interface Loadout {
  hero: HeroId;
  /** Primary gun. */
  gun: GunId;
  secondary: GunId;
  utility: UtilId;
  hat: HatId;
}

export interface PlayerProfile extends Loadout {
  name: string;
  kills: number;
  deaths: number;
  wins: number;
  unlocks: HatId[];
}

// ---- client -> server ----

export type ClientMsg =
  /** public: the always-on lobby. create: a new private room on `map`. join: a private room by code. */
  | { type: 'join'; mode: 'public' | 'create' | 'join'; room?: string; map?: MapId; gameMode?: ModeId; idToken: string; /** Move an existing player onto this (healthier) socket instead of adding a new one. */ resume?: boolean; name: string; hero: HeroId; gun: GunId; secondary: GunId; utility: UtilId; hat: HatId }
  | { type: 'chat'; text: string }
  | { type: 'input'; frames: InputFrame[] }
  | { type: 'loadout'; hero: HeroId; gun: GunId; secondary: GunId; utility: UtilId; hat: HatId }
  | { type: 'bots'; count: number }
  /** Public lobby, on the results screen: vote for the next map. */
  | { type: 'vote'; map: MapId }
  | { type: 'ping'; t: number };

// ---- server -> client ----

export interface PlayerSnap {
  id: string;
  name: string;
  hero: HeroId;
  /** The gun in hand. */
  gun: GunId;
  primary: GunId;
  secondary: GunId;
  slot: 'primary' | 'secondary';
  ammo: { primary: number; secondary: number };
  reloadIn: number;
  utility: UtilId;
  utilCharges: number;
  /** Seconds of flash blindness left. */
  blindIn: number;
  /** Seconds left on a Stinger slow. */
  slowIn: number;
  hat: HatId;
  /** 0 red, 1 blue, -1 when there are no teams. */
  team: number;
  /** What counts toward winning in this mode: kills, hill points or ladder step. */
  score: number;
  streak: number;
  bestStreak: number;
  damage: number;
  /** Weapon with the most kills this round. */
  favWeapon: WeaponId | null;
  x: number;
  y: number;
  aim: number;
  hp: number;
  alive: boolean;
  kills: number;
  deaths: number;
  bot: boolean;
  /** Spawn shield is active. */
  shield: boolean;
  scoped: boolean;
  respawnIn: number;
  abilityReadyIn: number;
  /** Charge abilities: how full, 0..1. */
  abilityCharge: number;
  /** Hide and Seek is active: enemies shouldn't draw this player. */
  hidden: boolean;
  /** Overcharged shots left (0 when none or expired). */
  overcharge: number;
  /** Seconds left on each active power-up. Missing keys are inactive. */
  powers: Partial<Record<PowerId, number>>;
  /** Height above the floor while launched by a Bounce Pad. */
  z: number;
  /** Grappling or launched: the server moves this player. `tx/ty` is where a grapple hook caught. */
  dash: { kind: 'grapple' | 'bounce'; tx: number; ty: number } | null;
}

export interface BulletSnap {
  id: number;
  gun: GunId;
  x: number;
  y: number;
  fake: boolean;
  /** An Overcharge shot: drawn bigger and brighter. */
  charged?: boolean;
}

export interface PickupSnap {
  id: number;
  kind: 'gun' | 'util' | 'heal' | 'power';
  item: WeaponId | 'heal' | PowerId;
  x: number;
  y: number;
  expiresIn: number;
  /** Power-ups only: seconds until it lands and can be taken. Absent once it is down. */
  readyIn?: number;
}

export interface ThrowableSnap {
  id: number;
  util: UtilId;
  x: number;
  y: number;
  /** Height above the floor. */
  z: number;
  owner: string;
}

export interface PadSnap {
  id: number;
  owner: string;
  x: number;
  y: number;
  endsIn: number;
  /** Health left, 0..1. */
  hp: number;
}
export interface HillSnap {
  x: number;
  y: number;
  r: number;
  /** Player scoring right now, or null when empty or contested. */
  holder: string | null;
  contested: boolean;
}

export interface SmokeSnap {
  id: number;
  x: number;
  y: number;
  r: number;
  endsIn: number;
}

export type GameEvent =
  | { t: 'shot'; id: string; gun: GunId; x: number; y: number; a: number; charged?: boolean }
  | { t: 'hit'; target: string; by: string; dmg: number; x: number; y: number }
  | { t: 'kill'; killer: string; victim: string; gun: WeaponId }
  | { t: 'blink'; id: string; x1: number; y1: number; x2: number; y2: number }
  | { t: 'overcharge'; id: string }
  | { t: 'hide'; id: string; x: number; y: number }
  /** `hits`: enemies the ping reached; the pinger's team sees them for ABILITY.sonarReveal seconds. */
  | { t: 'sonar'; id: string; x: number; y: number; r: number; hits: string[] }
  | { t: 'explode'; x: number; y: number; r: number }
  | { t: 'pickup'; id: string; item: WeaponId }
  | { t: 'throw'; id: string; util: UtilId }
  | { t: 'flash'; x: number; y: number }
  | { t: 'smoke'; x: number; y: number }
  | { t: 'weaponSwap'; id: string }
  | { t: 'heal'; id: string; x: number; y: number }
  | { t: 'streak'; id: string; n: number }
  /** `hit`: the hook caught a wall at (x2, y2) and the player is zipping there. */
  | { t: 'grapple'; id: string; x1: number; y1: number; x2: number; y2: number; hit: boolean }
  | { t: 'padSet'; id: string; x: number; y: number }
  | { t: 'padEnd'; x: number; y: number; broken: boolean }
  | { t: 'bounce'; id: string; pad: number; x: number; y: number }
  | { t: 'ladder'; id: string; gun: GunId }
  | { t: 'refill'; id: string; util: UtilId }
  | { t: 'powerDrop'; power: PowerId; x: number; y: number }
  | { t: 'power'; id: string; power: PowerId; x: number; y: number }
  | { t: 'win'; id: string };

export interface MapVote {
  options: MapId[];
  counts: number[];
}

export interface Snapshot {
  type: 'snap';
  /** The map in play; it can change between rounds in the public lobby. */
  map: MapId;
  /** Next-map vote, shown on the results screen in the public lobby. */
  vote: MapVote | null;
  /** Server sim time in seconds. */
  time: number;
  /** Last input seq processed for the receiving player. */
  ack: number;
  phase: 'playing' | 'ended';
  /** A player id, or 'team:0' / 'team:1' in Team Brawl. */
  winner: string | null;
  mode: ModeId;
  target: number;
  teamScores: [number, number];
  hill: HillSnap | null;
  endsIn: number;
  players: PlayerSnap[];
  bullets: BulletSnap[];
  pickups: PickupSnap[];
  throwables: ThrowableSnap[];
  smokes: SmokeSnap[];
  pads: PadSnap[];
  events: GameEvent[];
}

export type ServerMsg =
  | { type: 'welcome'; id: string; room: string; host: boolean; map: MapId; mode: ModeId; isPublic: boolean }
  | { type: 'chat'; id: string | null; name: string; text: string }
  | { type: 'error'; message: string }
  | { type: 'pong'; t: number }
  | { type: 'profile'; profile: PlayerProfile }
  | Snapshot;
