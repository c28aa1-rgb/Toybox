export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;

export const PLAYER_RADIUS = 0.6;
export const PLAYER_SPEED = 6.2;
export const MAX_HP = 100;
export const RESPAWN_TIME = 3;
export const SPAWN_SHIELD = 1.5;

export const KILLS_TO_WIN = 15;
export const MATCH_END_TIME = 6;
export const MAX_PLAYERS = 8;

export const PICKUP_RADIUS = 1.4;

/** Holding scope: slower movement, tighter spread. */
export const SCOPE_SPEED = 0.55;
export const SCOPE_SPREAD = 0.3;

export const CHAT_MAX = 120;
export const PUBLIC_ROOM = 'PUBLIC';
/** The public lobby keeps at least this many players by topping up with bots. */
export const PUBLIC_MIN_PLAYERS = 6;
export const DROP_LIFETIME = 8;
/** Every kill drops a heal where the victim fell. */
export const HEAL_AMOUNT = 40;
export const HEAL_LIFETIME = 12;
/** Streak lengths that get a call-out. */
export const STREAK_CALLS = [3, 5, 8, 12];

/** Seconds other entities are rendered behind the newest snapshot. */
export const INTERP_DELAY = 0.1;
/** Largest dt the server accepts for one input message. */
export const MAX_INPUT_DT = 0.05;
