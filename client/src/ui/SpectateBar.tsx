import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { GUNS, HEROES, MAX_HP, POWER_IDS, type PlayerSnap } from '@gg/shared';
import type { GameClient } from '../game/GameClient';
import { firstKey, listenActions, matches, useBindings } from '../game/bindings';
import { PowerIcon } from './PowerChips';
import '../theme/powers.css';

/** While dead: who the camera is following, with buttons and keys to switch. */
export function SpectateBar({ target, client }: { target: PlayerSnap | null; client: GameClient }) {
  useBindings();
  useEffect(() => listenActions((code, e) => {
    if (matches('left', code)) {
      e.preventDefault();
      client.spectate(-1);
    } else if (matches('right', code)) {
      e.preventDefault();
      client.spectate(1);
    }
  }), [client]);

  return (
    <motion.div
      className="spectate"
      initial={{ y: -16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -10, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 500, damping: 26 }}
    >
      <button type="button" className="spectate__step" onClick={() => client.spectate(-1)} aria-label="Watch the previous player">
        <kbd>{firstKey('left')}</kbd>◀
      </button>
      <div className="spectate__who" aria-live="polite">
        <small>Spectating</small>
        {target ? (
          <>
            <b style={{ '--hero': HEROES[target.hero].color } as React.CSSProperties}>{target.name}</b>
            <span className="spectate__meta">
              <span className="spectate__hp"><i style={{ transform: `scaleX(${Math.max(0, target.hp / MAX_HP)})` }} /></span>
              {GUNS[target.gun].name} · {target.kills} kills
              {POWER_IDS.filter((p) => target.powers?.[p]).map((p) => <PowerIcon key={p} power={p} />)}
            </span>
          </>
        ) : (
          <b>Waiting for someone to watch…</b>
        )}
      </div>
      <button type="button" className="spectate__step" onClick={() => client.spectate(1)} aria-label="Watch the next player">
        ▶<kbd>{firstKey('right')}</kbd>
      </button>
    </motion.div>
  );
}
