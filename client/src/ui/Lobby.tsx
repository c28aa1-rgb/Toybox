import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { GUNS, HEROES, MAPS, PARTY_MAP_IDS, PUBLIC_MAP, SECONDARY_IDS, type GunId, type HeroId, type MapDef, type MapId, type UtilId, UTILS } from '@gg/shared';
import type { JoinOptions } from '../game/GameClient';
import { isUnlocked, loadProfile, saveProfile } from '../unlocks';
import type { Portraits } from './App';
import { GunRack, HeroShelf, UtilRack } from './Pickers';

function initialRoom(): string {
  return new URLSearchParams(location.search).get('room')?.toUpperCase().slice(0, 6) ?? '';
}

export function Lobby({ portraits, onPlay }: { portraits: Portraits; onPlay: (o: JoinOptions) => void }) {
  const profile = loadProfile();
  const [name, setName] = useState(profile.name);
  const [hero, setHero] = useState<HeroId>(profile.hero);
  const [gun, setGun] = useState<GunId>(isUnlocked(profile.gun, profile.kills) ? profile.gun : 'smg');
  const [secondary, setSecondary] = useState<GunId>(profile.secondary);
  const [utility, setUtility] = useState<UtilId>(profile.utility);
  const [room, setRoom] = useState(initialRoom);
  const [map, setMap] = useState<MapId>('playmat');
  const invited = initialRoom() !== '';
  const [page, setPage] = useState<'home' | 'friends'>('home');

  const go = (opts: Pick<JoinOptions, 'mode' | 'room' | 'map'>) => {
    saveProfile({ ...loadProfile(), name: name.trim(), hero, gun, secondary, utility });
    onPlay({ ...opts, name: name.trim() || 'Player', hero, gun, secondary, utility });
  };

  if (page === 'friends') {
    return (
      <main className="lobby lobby--friends">
      <section className="lobby__go">
        <div className="friends__top">
          <motion.button type="button" className="btn btn--ghost btn--back" onClick={() => setPage('home')} whileTap={{ scale: 0.95 }}>
            Back
          </motion.button>
          <h2 className="section-title">Private lobby</h2>
        </div>
        <p className="lobby__hint">Private rooms only let in people with the code. Pick a map, create the room, then share its link.</p>
        <div className="maps" role="radiogroup" aria-label="Map">
          {PARTY_MAP_IDS.map((id) => (
            <motion.button
              key={id}
              type="button"
              role="radio"
              aria-checked={map === id}
              className={`mapcard${map === id ? ' is-selected' : ''}`}
              onClick={() => setMap(id)}
              whileHover={{ y: -4 }}
              whileTap={{ scale: 0.97 }}
            >
              <MiniMap map={MAPS[id]} />
              <span className="mapcard__name">{MAPS[id].name}</span>
              <span className="mapcard__blurb">{MAPS[id].blurb}</span>
            </motion.button>
          ))}
        </div>
        <div className="lobby__friends">
          <motion.button
            type="button"
            className="btn btn--primary"
            onClick={() => go({ mode: 'create', map })}
            whileTap={{ scaleX: 1.06, scaleY: 0.92 }}
          >
            Create room on {MAPS[map].name}
          </motion.button>
          <form
            className="join"
            onSubmit={(e) => {
              e.preventDefault();
              if (room.trim().length >= 3) go({ mode: 'join', room: room.trim() });
            }}
          >
            <label className="field field--inline">
              <span className="field__label">Room code</span>
              <input
                className="field__input field__input--code"
                value={room}
                maxLength={6}
                placeholder="ABCD"
                onChange={(e) => setRoom(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              />
            </label>
            <motion.button type="submit" className="btn btn--ghost" disabled={room.trim().length < 3} whileTap={{ scaleX: 1.06, scaleY: 0.92 }}>
              Join room
            </motion.button>
          </form>
        </div>
      </section>

      </main>
    );
  }

  return (
    <main className="lobby">
      <header className="lobby__head">
        <motion.h1
          className="wordmark"
          initial={{ y: -40, rotate: -8, opacity: 0 }}
          animate={{ y: 0, rotate: -3, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 380, damping: 16 }}
        >
          Toybox Brawl
        </motion.h1>
        <p className="lobby__pitch">
          Free-for-all arena. Every hero has one trick, every gun drops when its owner goes down.
          First to 15 takes the round.
        </p>
        <dl className="lobby__stats">
          <div><dt>Kills</dt><dd>{profile.kills}</dd></div>
          <div><dt>Deaths</dt><dd>{profile.deaths}</dd></div>
        </dl>
      </header>

      <section className="playbar">
        <label className="field">
          <span className="field__label">Your name</span>
          <input
            className="field__input"
            value={name}
            maxLength={16}
            placeholder="Player"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <motion.button
          type="button"
          className="btn btn--primary btn--play"
          onClick={() => (invited ? go({ mode: 'join', room }) : go({ mode: 'public' }))}
          whileHover={{ y: -3 }}
          whileTap={{ scaleX: 1.05, scaleY: 0.93, y: 4 }}
        >
          <span>{invited ? `Join ${room}` : 'Play'}</span>
          <small>{invited ? 'Your friend\'s private room' : `${MAPS[PUBLIC_MAP].name} · public arena, always on`}</small>
        </motion.button>
      </section>

      <section className="lobby__section">
        <h2 className="section-title">Your loadout</h2>
        <LoadoutPicker
          portraits={portraits}
          kills={profile.kills}
          hero={hero} gun={gun} secondary={secondary} utility={utility}
          setHero={setHero} setGun={setGun} setSecondary={setSecondary} setUtility={setUtility}
        />
      </section>

      <motion.button
        type="button"
        className="btn btn--ghost btn--friends"
        onClick={() => setPage('friends')}
        whileHover={{ y: -3 }}
        whileTap={{ scaleX: 1.04, scaleY: 0.94 }}
      >
        Create or join a private lobby
      </motion.button>

      <footer className="lobby__keys">
        <span><kbd>WASD</kbd> move</span>
        <span><kbd>Mouse</kbd> aim</span>
        <span><kbd>Click</kbd> shoot</span>
        <span><kbd>Left Shift</kbd> or <kbd>Right click</kbd> scope</span>
        <span><kbd>Space</kbd> or <kbd>Q</kbd> ability</span>
        <span><kbd>F</kbd>, <kbd>1</kbd> <kbd>2</kbd> or <kbd>Wheel</kbd> swap guns</span>
        <span>Hold <kbd>G</kbd> aim throw, release to throw</span>
        <span><kbd>E</kbd> pick up</span>
        <span><kbd>Tab</kbd> scores</span>
        <span><kbd>Enter</kbd> chat</span>
      </footer>
    </main>
  );
}

/** Top-down sketch of a map's walls, drawn from the same data the server uses. */
function MiniMap({ map }: { map: MapDef }) {
  return (
    <svg className="minimap" viewBox={`0 0 ${map.w} ${map.h}`} aria-hidden>
      <rect width={map.w} height={map.h} rx={1.5} className="minimap__floor" />
      {map.walls.slice(4).map((w, i) => (
        <rect key={i} x={w.x} y={w.y} width={w.w} height={w.h} rx={0.3} className="minimap__wall" />
      ))}
    </svg>
  );
}

type SlotKey = 'hero' | 'primary' | 'secondary' | 'utility';

/** Four boxes showing the current pick. Clicking one opens a drawer under the row with every option for that slot. */
function LoadoutPicker(props: {
  portraits: Portraits; kills: number;
  hero: HeroId; gun: GunId; secondary: GunId; utility: UtilId;
  setHero: (h: HeroId) => void; setGun: (g: GunId) => void; setSecondary: (g: GunId) => void; setUtility: (u: UtilId) => void;
}) {
  const { portraits, kills } = props;
  const [open, setOpen] = useState<SlotKey | null>(null);
  const slots: { key: SlotKey; label: string; name: string; detail: string; img: string; color?: string }[] = [
    { key: 'hero', label: 'Hero', name: HEROES[props.hero].name, detail: `${HEROES[props.hero].ability} · ${HEROES[props.hero].cooldown}s`, img: portraits.heroes[props.hero], color: HEROES[props.hero].color },
    { key: 'primary', label: 'Primary', name: GUNS[props.gun].name, detail: GUNS[props.gun].blurb, img: portraits.guns[props.gun] },
    { key: 'secondary', label: 'Secondary', name: GUNS[props.secondary].name, detail: GUNS[props.secondary].blurb, img: portraits.guns[props.secondary] },
    { key: 'utility', label: 'Utility', name: UTILS[props.utility].name, detail: `${UTILS[props.utility].charges} per life`, img: portraits.utils[props.utility] },
  ];
  // Picking something closes the drawer so the whole loadout is visible again.
  const pick = <T,>(set: (v: T) => void) => (v: T) => { set(v); setOpen(null); };

  return (
    <div className="loadout-picker">
      <div className="slots" role="tablist" aria-label="Loadout">
        {slots.map((s) => {
          const isOpen = open === s.key;
          return (
            <motion.button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={isOpen}
              aria-controls="slot-drawer"
              className={`slot${isOpen ? ' is-open' : ''}`}
              style={s.color ? ({ '--slot': s.color } as React.CSSProperties) : undefined}
              onClick={() => setOpen(isOpen ? null : s.key)}
              whileHover={{ y: -4 }}
              whileTap={{ scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 520, damping: 22 }}
            >
              <span className="slot__label">{s.label}</span>
              <span className="slot__art"><img src={s.img} alt="" draggable={false} /></span>
              <span className="slot__name">{s.name}</span>
              <span className="slot__detail">{s.detail}</span>
              <span className="slot__change">{isOpen ? 'Close' : 'Change'}</span>
            </motion.button>
          );
        })}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="drawer"
            id="slot-drawer"
            className="slot-drawer"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
          >
            <div className="slot-drawer__inner">
              {open === 'hero' && <HeroShelf value={props.hero} onChange={pick(props.setHero)} portraits={portraits} />}
              {open === 'primary' && <GunRack value={props.gun} onChange={pick(props.setGun)} kills={kills} portraits={portraits} />}
              {open === 'secondary' && <GunRack ids={SECONDARY_IDS} label="Secondary gun" value={props.secondary} onChange={pick(props.setSecondary)} kills={kills} portraits={portraits} />}
              {open === 'utility' && <UtilRack value={props.utility} onChange={pick(props.setUtility)} portraits={portraits} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
