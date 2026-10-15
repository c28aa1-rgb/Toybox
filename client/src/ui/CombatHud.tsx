import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { GUNS, MAX_HP, UTILS, type PlayerSnap } from '@gg/shared';
import type { GameClient } from '../game/GameClient';
import type { Portraits } from './App';
import '../theme/combat.css';
import { ACTIONS, bindingLabel, firstKey, useBindings, type Action } from '../game/bindings';
import { ControlsButton } from './Controls';

export function CombatHud({ me, portraits, client }: {
  me: PlayerSnap; portraits: Portraits; client: GameClient;
}) {
  useBindings();
  const [help, setHelp] = useState(false);
  const reduced = useReducedMotion();
  const gun = GUNS[me.gun];
  const otherSlot = me.slot === 'primary' ? 'secondary' : 'primary';
  const otherGun = GUNS[me[otherSlot]];
  const ammo = me.ammo[me.slot];
  const reloading = me.reloadIn > 0;
  const low = ammo <= Math.ceil(gun.magazine * 0.25);
  const progress = reloading ? 1 - me.reloadIn / gun.reloadTime : ammo / gun.magazine;

  return (
    <section className="combat" aria-label="Equipment and controls">
      <AnimatePresence>
        {help && (
          <motion.div id="combat-help" className="combat__help" initial={{ opacity: 0, y: reduced ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
            <header><b>HOW TO PLAY</b><button type="button" aria-label="Close controls" onClick={() => setHelp(false)}>×</button></header>
            <dl>{(Object.keys(ACTIONS) as Action[]).map(action => <div key={action}><dt>{ACTIONS[action]}</dt><dd>{bindingLabel(action)}</dd></div>)}</dl>
            <ControlsButton />
            <p>Unlimited reserve ammo. Switching guns cancels a reload.</p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="combat__strip">
        <div className={`combat__utility${me.utilCharges ? '' : ' is-empty'}`}
          aria-label={`${UTILS[me.utility].name}: ${me.utilCharges} remaining`} title={`${UTILS[me.utility].name} · Hold ${bindingLabel('grenade')}, release to throw · ${bindingLabel('cancelGrenade')} cancels`}>
          <kbd>{firstKey('grenade')}</kbd>
          <img src={portraits.utils[me.utility]} alt="" />
          {/* Re-keyed on the count so a charge earned from a kill pops in. */}
          <motion.b key={me.utilCharges} initial={reduced ? false : { scale: 1.7 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 14 }}>×{me.utilCharges}</motion.b>
        </div>

        <button type="button" className="combat__other"
          aria-label={`Switch to ${otherGun.name}, ${me.ammo[otherSlot]} rounds`}
          title={`${otherGun.name} · ${bindingLabel('swap')} to swap`} disabled={me.primary === me.secondary} onClick={() => client.swapWeapon()}>
          <kbd>{firstKey('swap')}</kbd>
          <motion.img key={otherGun.id} src={portraits.guns[otherGun.id]} alt=""
            initial={{ opacity: 0, x: reduced ? 0 : -5 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.12 }} />
          <span>{otherGun.name}</span>
        </button>

        <div className={`combat__weapon${reloading ? ' is-reloading' : low ? ' is-low' : ''}`}>
          <motion.div key={me.gun} className="combat__weapon-info" initial={{ opacity: 0, x: reduced ? 0 : 5 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.12 }}>
            <img src={portraits.guns[me.gun]} alt="" />
            <span>{gun.name}</span>
          </motion.div>
          <button type="button" className="combat__ammo" disabled={reloading || ammo === gun.magazine}
            aria-label={`${ammo} of ${gun.magazine} rounds. ${reloading ? `Reloading, ${me.reloadIn.toFixed(1)} seconds` : `Press ${bindingLabel('reload')} to reload`}`}
            title={`${bindingLabel('reload')} · Reload`} onClick={() => client.reload()}>
            <strong>{ammo}</strong>
            <small>{reloading ? `${me.reloadIn.toFixed(1)}s` : `/ ${gun.magazine}`}</small>
          </button>
          {reloading && <span className="combat__reload-track" role="progressbar" aria-label="Reload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <motion.i animate={{ scaleX: Math.max(0, Math.min(1, progress)) }} transition={{ duration: reduced ? 0 : 0.08, ease: 'linear' }} />
          </span>}
        </div>
      </div>

      <div className={`combat__health${me.hp <= 35 ? ' is-low' : ''}`}>
        <span aria-hidden="true">+ {me.hp}</span>
        <div className="combat__health-track" role="meter" aria-label="Health" aria-valuemin={0} aria-valuemax={MAX_HP} aria-valuenow={me.hp}>
          <motion.i animate={{ scaleX: Math.max(0, me.hp / MAX_HP) }} transition={{ duration: reduced ? 0 : 0.18 }} />
        </div>
        <button type="button" className="combat__help-toggle" aria-label="Controls and help" aria-expanded={help} aria-controls="combat-help" onClick={() => setHelp(!help)}>?</button>
      </div>
    </section>
  );
}
