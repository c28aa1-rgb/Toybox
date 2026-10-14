import { useState } from 'react';
import { motion } from 'framer-motion';
import { MAPS, PARTY_MAP_IDS, PUBLIC_MAP, type GunId, type HeroId, type MapDef, type MapId } from '@gg/shared';
import type { JoinOptions } from '../game/GameClient';
import { isUnlocked, loadProfile, saveProfile } from '../unlocks';
import type { Portraits } from './App';
import { GunRack, HeroShelf } from './Pickers';

function initialRoom(): string {
  return new URLSearchParams(location.search).get('room')?.toUpperCase().slice(0, 6) ?? '';
}

export function Lobby({ portraits, onPlay }: { portraits: Portraits; onPlay: (o: JoinOptions) => void }) {
  const profile = loadProfile();
  const [name, setName] = useState(profile.name);
  const [hero, setHero] = useState<HeroId>(profile.hero);
  const [gun, setGun] = useState<GunId>(isUnlocked(profile.gun, profile.kills) ? profile.gun : 'pistol');
  const [room, setRoom] = useState(initialRoom);
  const [map, setMap] = useState<MapId>('playmat');
  const invited = initialRoom() !== '';

  const go = (opts: Pick<JoinOptions, 'mode' | 'room' | 'map'>) => {
    saveProfile({ ...loadProfile(), name: name.trim(), hero, gun });
    onPlay({ ...opts, name: name.trim() || 'Player', hero, gun });
  };

  return (
    <main className="lobby">
      <header className="lobby__head">
        <motion.h1
          className="wordmark"
          initial={{ y: -40, rotate: -8, opacity: 0 }}
          animate={{ y: 0, rotate: -3, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 380, damping: 16 }}
        >
          Gun Game
        </motion.h1>
        <p className="lobby__pitch">
          Free-for-all arena. Every hero has one trick, every gun drops when its owner goes down.
          First to 15 takes the round.
        </p>
        <dl className="lobby__stats">
          <div><dt>Kills</dt><dd>{profile.kills}</dd></div>
          <div><dt>Wins</dt><dd>{profile.wins}</dd></div>
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
        <h2 className="section-title">Pick a hero</h2>
        <HeroShelf value={hero} onChange={setHero} portraits={portraits} />
      </section>

      <section className="lobby__section">
        <h2 className="section-title">Pick a starting gun</h2>
        <GunRack value={gun} onChange={setGun} kills={profile.kills} portraits={portraits} />
      </section>

      <section className="lobby__go">
        <h2 className="section-title">Play with friends</h2>
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

      <footer className="lobby__keys">
        <span><kbd>WASD</kbd> move</span>
        <span><kbd>Mouse</kbd> aim</span>
        <span><kbd>Click</kbd> shoot</span>
        <span><kbd>Left Shift</kbd> or <kbd>Right click</kbd> scope</span>
        <span><kbd>Space</kbd> or <kbd>Q</kbd> ability</span>
        <span><kbd>E</kbd> pick up gun</span>
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
