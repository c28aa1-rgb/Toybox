import { motion } from 'framer-motion';
import { GUNS, HEROES, HERO_IDS, PRIMARY_IDS, UTILS, UTIL_IDS, abilityTag, type GunId, type HeroId, type UtilId } from '@gg/shared';
import type { Portraits } from './App';

const spring = { type: 'spring', stiffness: 520, damping: 22 } as const;

export function HeroShelf({
  value, onChange, portraits, compact = false,
}: { value: HeroId; onChange: (h: HeroId) => void; portraits: Portraits; compact?: boolean }) {
  return (
    <div className={`shelf${compact ? ' shelf--compact' : ''}`} role="radiogroup" aria-label="Hero">
      {HERO_IDS.map((id) => {
        const h = HEROES[id];
        const selected = id === value;
        return (
          <motion.button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`blister${selected ? ' is-selected' : ''}`}
            style={{ '--hero': h.color } as React.CSSProperties}
            onClick={() => onChange(id)}
            whileHover={{ y: -6, rotate: -1.5 }}
            whileTap={{ scale: 0.95 }}
            animate={{ scale: selected ? 1.04 : 1 }}
            transition={spring}
          >
            <span className="blister__hole" aria-hidden />
            <span className="blister__bubble">
              <img src={portraits.heroes[id]} alt="" draggable={false} />
            </span>
            <span className="blister__name">{h.name}</span>
            {!compact && (
              <>
                <span className="blister__ability">{abilityTag(h)}</span>
                <span className="blister__desc">{h.description}</span>
              </>
            )}
            {selected && (
              <motion.span
                className="sticker"
                initial={{ scale: 0, rotate: -30 }}
                animate={{ scale: 1, rotate: 12 }}
                transition={{ type: 'spring', stiffness: 600, damping: 14 }}
              >
                Picked
              </motion.span>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}

export function GunRack({
  value, onChange, portraits, compact = false, ids = PRIMARY_IDS, label = 'Primary gun',
}: { value: GunId; onChange: (g: GunId) => void; portraits: Portraits; compact?: boolean; ids?: GunId[]; label?: string }) {
  return (
    <div className={`rack${compact ? ' rack--compact' : ''}`} role="radiogroup" aria-label={label}>
      {ids.map((id) => {
        const g = GUNS[id];
        const selected = id === value;
        return (
          <motion.button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`peg${selected ? ' is-selected' : ''}`}
            onClick={() => onChange(id)}
            whileHover={{ y: -4, rotate: 2 }}
            whileTap={{ scale: 0.95 }}
            transition={spring}
          >
            <img src={portraits.guns[id]} alt="" draggable={false} />
            <span className="peg__name">{g.name}</span>
            {!compact && <span className="peg__meta">{g.blurb}</span>}
          </motion.button>
        );
      })}
    </div>
  );
}

export function UtilRack({
  value, onChange, portraits, compact = false,
}: { value: UtilId; onChange: (u: UtilId) => void; portraits: Portraits; compact?: boolean }) {
  return (
    <div className={`rack rack--utils${compact ? ' rack--compact' : ''}`} role="radiogroup" aria-label="Utility">
      {UTIL_IDS.map((id) => {
        const u = UTILS[id];
        const selected = id === value;
        return (
          <motion.button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`peg${selected ? ' is-selected' : ''}`}
            onClick={() => onChange(id)}
            whileHover={{ y: -4, rotate: 2 }}
            whileTap={{ scale: 0.95 }}
            transition={spring}
          >
            <img src={portraits.utils[id]} alt="" draggable={false} />
            <span className="peg__name">{u.name}</span>
            {!compact && <span className="peg__meta">{u.blurb} {u.charges} per life.</span>}
          </motion.button>
        );
      })}
    </div>
  );
}
