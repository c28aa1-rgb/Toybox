import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { POWERS, POWER_IDS, type PowerId } from '@gg/shared';
import { POWER_ICONS } from '../game/powerFx';
import '../theme/powers.css';

export function PowerIcon({ power }: { power: PowerId }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={POWER_ICONS[power]} /></svg>;
}

/** Active power-ups with a draining timer, top center under the score race. */
export function PowerChips({ powers }: { powers: Partial<Record<PowerId, number>> }) {
  const reduced = useReducedMotion();
  const active = POWER_IDS.filter((p) => (powers[p] ?? 0) > 0);
  return (
    <div className="power-chips" aria-live="polite">
      <AnimatePresence>
        {active.map((p) => {
          const left = powers[p] ?? 0;
          const def = POWERS[p];
          return (
            <motion.div
              key={p}
              className={`power-chip${left < 2 ? ' is-ending' : ''}`}
              style={{ '--power': def.color } as React.CSSProperties}
              initial={reduced ? { opacity: 0 } : { y: 24, scale: 0.4, rotate: -8, opacity: 0 }}
              animate={{ y: 0, scale: 1, rotate: 0, opacity: 1 }}
              exit={{ y: 10, scale: 0.8, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 560, damping: 15 }}
              aria-label={`${def.name}: ${def.blurb}, ${Math.ceil(left)} seconds left`}
            >
              <PowerIcon power={p} />
              <span className="power-chip__text">
                <b>{def.name}</b>
                <small>{def.blurb}</small>
              </span>
              <span className="power-chip__time">{Math.ceil(left)}</span>
              <i className="power-chip__bar" style={{ transform: `scaleX(${Math.min(1, left / def.duration)})` }} />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
