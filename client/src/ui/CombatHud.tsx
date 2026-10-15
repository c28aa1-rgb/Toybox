import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ABILITY, GUNS, HEROES, MAX_HP, UTILS, type PlayerSnap, type UtilId } from '@gg/shared';
import type { GameClient } from '../game/GameClient';
import type { Portraits } from './App';
import '../theme/combat.css';
import { ACTIONS, bindingLabel, firstKey, useBindings, type Action } from '../game/bindings';
import { ControlsButton } from './Controls';

/**
 * Hero ability ring. Cooldown abilities fill as the timer runs down, charge abilities fill as you deal
 * damage, and passives show their own state (time until Chameleon vanishes, time to Echo's next ping).
 */
function AbilityGauge({ me, portraits }: { me: PlayerSnap; portraits: Portraits }) {
  const reduced = useReducedMotion();
  const hero = HEROES[me.hero];
  const left = me.abilityReadyIn;
  let fill: number;
  let ready: boolean;
  let label: string;
  let count: string | null = null;
  if (hero.kind === 'charge') {
    fill = me.abilityCharge;
    ready = fill >= 1;
    label = me.overcharge > 0 ? `${me.overcharge} charged` : ready ? 'Ready' : `${Math.round(fill * 100)}%`;
  } else if (me.hero === 'chameleon') {
    fill = me.hidden ? 1 : Math.max(0, 1 - left / ABILITY.hideDelay);
    ready = me.hidden;
    label = me.hidden ? 'Hidden' : 'Stand still';
  } else if (hero.kind === 'passive') {
    fill = Math.max(0, Math.min(1, 1 - left / hero.cooldown));
    ready = left <= 0.05;
    label = 'Passive';
    count = ready ? null : String(Math.ceil(left));
  } else {
    ready = left <= 0.05;
    fill = ready ? 1 : Math.max(0, Math.min(1, 1 - left / hero.cooldown));
    label = ready ? 'Ready' : hero.ability;
    count = ready ? null : String(Math.ceil(left));
  }
  const pressable = hero.kind !== 'passive';
  return (
    <motion.div
      key={ready ? 'ready' : 'cooling'}
      className={`combat__ability${ready ? ' is-ready' : ''}`}
      style={{ '--fill': fill, '--hero': hero.color } as React.CSSProperties}
      initial={ready && !reduced ? { scale: 1.25 } : false}
      animate={{ scale: 1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 12 }}
      role="meter"
      aria-label={`${hero.ability}: ${label}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fill * 100)}
      title={`${hero.ability} · ${hero.description}`}
    >
      <span className="combat__ability-face">
        <img src={portraits.heroes[me.hero]} alt="" />
        {count && <b>{count}</b>}
      </span>
      {pressable && <kbd>{firstKey('ability')}</kbd>}
      <small>{label}</small>
    </motion.div>
  );
}

/** How the equipped utility is used: drunk or set down on a press, or aimed and thrown on release. */
function useHint(util: UtilId): string {
  const def = UTILS[util];
  if (def.heal) return `Press ${bindingLabel('grenade')} to drink`;
  if (def.deploy) return `Press ${bindingLabel('grenade')} to set it down`;
  return `Hold ${bindingLabel('grenade')}, release to throw · ${bindingLabel('cancelGrenade')} cancels`;
}

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

      <AbilityGauge me={me} portraits={portraits} />

      <div className="combat__strip">
        <div className={`combat__utility${me.utilCharges ? '' : ' is-empty'}`}
          aria-label={`${UTILS[me.utility].name}: ${me.utilCharges} remaining`} title={`${UTILS[me.utility].name} · ${useHint(me.utility)}`}>
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
