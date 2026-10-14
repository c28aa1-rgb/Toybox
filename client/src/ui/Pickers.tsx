import { motion } from 'framer-motion';
import { GUNS, GUN_IDS, HEROES, HERO_IDS, type GunId, type HeroId } from '@gg/shared';
import { isUnlocked } from '../unlocks';
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
                <span className="blister__ability">{h.ability} · {h.cooldown}s</span>
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
  value, onChange, kills, portraits, compact = false,
}: { value: GunId; onChange: (g: GunId) => void; kills: number; portraits: Portraits; compact?: boolean }) {
  return (
    <div className={`rack${compact ? ' rack--compact' : ''}`} role="radiogroup" aria-label="Starting gun">
      {GUN_IDS.map((id) => {
        const g = GUNS[id];
        const open = isUnlocked(id, kills);
        const selected = id === value;
        return (
          <motion.button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-disabled={!open}
            className={`peg${selected ? ' is-selected' : ''}${open ? '' : ' is-locked'}`}
            onClick={() => open && onChange(id)}
            whileHover={open ? { y: -4, rotate: 2 } : { x: [0, -4, 4, -2, 0] }}
            whileTap={open ? { scale: 0.95 } : undefined}
            transition={spring}
          >
            <img src={portraits.guns[id]} alt="" draggable={false} />
            <span className="peg__name">{g.name}</span>
            {!compact && (
              <span className="peg__meta">
                {open ? g.blurb : `Unlocks at ${g.unlockKills} kills (you have ${kills})`}
              </span>
            )}
            {!open && compact && <span className="peg__meta">{g.unlockKills} kills</span>}
          </motion.button>
        );
      })}
    </div>
  );
}
