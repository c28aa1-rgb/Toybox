import { useState } from 'react';
import { motion } from 'framer-motion';
import type { GunId, HeroId } from '@gg/shared';
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
  const invited = initialRoom() !== '';

  const play = (code: string) => {
    saveProfile({ ...loadProfile(), name: name.trim(), hero, gun });
    onPlay({ room: code, name: name.trim() || 'Player', hero, gun });
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

      <section className="lobby__section">
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
        <form
          className="join"
          onSubmit={(e) => {
            e.preventDefault();
            if (room.trim().length >= 3) play(room.trim());
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
          <motion.button
            type="submit"
            className={`btn ${invited ? 'btn--primary btn--big' : 'btn--ghost'}`}
            disabled={room.trim().length < 3}
            whileTap={{ scaleX: 1.06, scaleY: 0.92 }}
          >
            Join room
          </motion.button>
        </form>
        {!invited && (
          <motion.button
            type="button"
            className="btn btn--primary btn--big"
            onClick={() => play('')}
            whileHover={{ y: -3 }}
            whileTap={{ scaleX: 1.06, scaleY: 0.92, y: 4 }}
          >
            Create room
          </motion.button>
        )}
      </section>

      <footer className="lobby__keys">
        <span><kbd>WASD</kbd> move</span>
        <span><kbd>Mouse</kbd> aim</span>
        <span><kbd>Click</kbd> shoot</span>
        <span><kbd>Space</kbd> or <kbd>Right click</kbd> ability</span>
        <span><kbd>E</kbd> pick up gun</span>
        <span><kbd>Tab</kbd> scores</span>
      </footer>
    </main>
  );
}
