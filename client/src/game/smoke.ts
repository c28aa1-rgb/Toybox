import type { SmokeSnap } from '@gg/shared';

export interface SmokeFog {
  id: number;
  opacity: number;
  near: number;
  far: number;
  angle: number;
}

/** Optical depth to the near/far edges; projected direction keeps it aligned with the camera. */
export function smokeFog(sm: SmokeSnap, x: number, y: number, screenDX: number, screenDY: number): SmokeFog | null {
  const distance = Math.hypot(x - sm.x, y - sm.y);
  if (sm.r <= 0 || distance >= sm.r || sm.endsIn <= 0) return null;
  const offset = distance / sm.r;
  const entry = Math.min(1, (sm.r - distance) / (sm.r * 0.08));
  return {
    id: sm.id,
    opacity: entry * entry * (3 - 2 * entry) * Math.min(1, sm.endsIn / 1.2),
    near: 1 - Math.exp(-2 * (1 - offset)),
    far: 1 - Math.exp(-2 * (1 + offset)),
    angle: Math.atan2(screenDX, -screenDY) * 180 / Math.PI,
  };
}
