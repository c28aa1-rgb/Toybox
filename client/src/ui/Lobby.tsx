import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { GUNS, HATS, HEROES, abilityTag, MAPS, MODES, MODE_IDS, PARTY_MAP_IDS, SECONDARY_IDS, type GunId, type HeroId, type MapId, type ModeId, type HatId, type UtilId, UTILS } from '@gg/shared';
import type { JoinOptions } from '../game/GameClient';
import { fetchProfile, loadProfile, patchProfile } from '../unlocks';
import type { Portraits } from './App';
import { GunRack, HatRack, HeroShelf, UtilRack } from './Pickers';
import { MiniMap } from './MapPreview';
import { MusicToggle } from './MusicToggle';
import { music } from '../game/audio';
import { ACTIONS, bindingLabel, useBindings } from '../game/bindings';
import { ControlsButton } from './Controls';

function initialRoom(): string {
  return new URLSearchParams(location.search).get('room')?.toUpperCase().slice(0, 6) ?? '';
}

export function Lobby({ portraits, onPlay }: { portraits: Portraits; onPlay: (o: JoinOptions) => void }) {
  useBindings();
  const [profile, setProfile] = useState(loadProfile);
  const [profileReady, setProfileReady] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [name, setName] = useState(profile.name);
  const [hero, setHero] = useState<HeroId>(profile.hero);
  const [gun, setGun] = useState<GunId>(profile.gun);
  const [secondary, setSecondary] = useState<GunId>(profile.secondary);
  const [utility, setUtility] = useState<UtilId>(profile.utility);
  const [hat, setHat] = useState<HatId>(profile.hat);
  const [gameMode, setGameMode] = useState<ModeId>('ffa');
  useEffect(() => music.play('lobby'), []);
  const [room, setRoom] = useState(initialRoom);
  const [map, setMap] = useState<MapId>('playmat');
  const invited = initialRoom() !== '';
  const [page, setPage] = useState<'home' | 'friends'>('home');

  const refreshProfile = useCallback(async () => {
    setProfileReady(false);
    setProfileError('');
    try {
      const p = await fetchProfile();
      setProfile(p);
      setName(p.name);
      setHero(p.hero);
      setGun(p.gun);
      setSecondary(p.secondary);
      setUtility(p.utility);
      setHat(p.hat);
      setProfileReady(true);
    } catch (error: unknown) {
      setProfileError(error instanceof Error ? error.message : 'Could not load your profile.');
    }
  }, []);

  useEffect(() => { void refreshProfile(); }, [refreshProfile]);

  const go = async (opts: Pick<JoinOptions, 'mode' | 'room' | 'map' | 'gameMode'>) => {
    setSavingProfile(true);
    setProfileError('');
    try {
      const saved = await patchProfile({ name: name.trim() || 'Player', hero, gun, secondary, utility, hat });
      setProfile(saved);
      onPlay({ ...opts, ...saved });
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Could not save your profile.');
      setProfileReady(false);
    } finally {
      setSavingProfile(false);
    }
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
          <MusicToggle className="lobby__music" />
        </div>
        <p className="lobby__hint">Private rooms only let in people with the code. Pick a map, create the room, then share its link.</p>
        <h3 className="friends__label">Mode</h3>
        <div className="modes" role="radiogroup" aria-label="Mode">
          {MODE_IDS.map((id) => (
            <motion.button
              key={id}
              type="button"
              role="radio"
              aria-checked={gameMode === id}
              className={`modecard modecard--${id}${gameMode === id ? ' is-selected' : ''}`}
              onClick={() => setGameMode(id)}
              whileHover={{ y: -4 }}
              whileTap={{ scale: 0.97 }}
            >
              <span className="modecard__name">{MODES[id].name}</span>
              <span className="modecard__blurb">{MODES[id].blurb}</span>
            </motion.button>
          ))}
        </div>
        <h3 className="friends__label">Map</h3>
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
          {profileError && <ServerProfileNotice error={profileError} onRetry={refreshProfile} />}
          <motion.button
            type="button"
            className="btn btn--primary"
            disabled={!profileReady || savingProfile}
            onClick={() => go({ mode: 'create', map, gameMode })}
            whileTap={{ scaleX: 1.06, scaleY: 0.92 }}
          >
            Create {MODES[gameMode].name} on {MAPS[map].name}
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
            <motion.button type="submit" className="btn btn--ghost" disabled={!profileReady || savingProfile || room.trim().length < 3} whileTap={{ scaleX: 1.06, scaleY: 0.92 }}>
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
          Toybox Takedown
        </motion.h1>
        <div className="lobby__utility">
          <dl className="lobby__stats">
            <div><dt>Kills</dt><dd>{profile.kills}</dd></div>
            <div><dt>Deaths</dt><dd>{profile.deaths}</dd></div>
          </dl>
          <MusicToggle className="lobby__music" />
        </div>
      </header>

      <section className="playbar">
        <label className="field">
          <span className="field__label">Your name</span>
          <input
            className="field__input"
            value={name}
          disabled={!profileReady || savingProfile}
            maxLength={16}
            placeholder="Player"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <motion.button
          type="button"
          className="btn btn--primary btn--play"
          disabled={!profileReady || savingProfile}
          onClick={() => (invited ? go({ mode: 'join', room }) : go({ mode: 'public' }))}
          whileHover={{ y: -3 }}
          whileTap={{ scaleX: 1.05, scaleY: 0.93, y: 4 }}
        >
          <span>{invited ? `Join ${room}` : 'Play'}</span>
          <small>{profileError ? 'Profile service unavailable' : !profileReady ? 'Connecting to game server…' : invited ? 'Your friend\'s private room' : 'Public arena · always on · map picked by vote'}</small>
        </motion.button>
      </section>
      {profileError && <ServerProfileNotice error={profileError} onRetry={refreshProfile} />}

      <section className="lobby__section">
        <h2 className="section-title">Your loadout</h2>
        <LoadoutPicker
          portraits={portraits}
          kills={profile.kills}
          hero={hero} gun={gun} secondary={secondary} utility={utility} hat={hat}
          setHero={setHero} setGun={setGun} setSecondary={setSecondary} setUtility={setUtility} setHat={setHat}
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
        {(['up', 'fire', 'reload', 'scope', 'ability', 'swap', 'grenade', 'cancelGrenade', 'pickup', 'chat'] as const).map(action =>
          <span key={action}><kbd>{bindingLabel(action)}</kbd> {ACTIONS[action]}</span>)}
        <ControlsButton />
      </footer>
    </main>
  );
}

function ServerProfileNotice({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="lobby__server-error" role="alert">
      <div>
        <strong>Play is disabled because the game server couldn’t load or create your profile.</strong>
        <small>{error}</small>
      </div>
      <button type="button" className="btn btn--ghost lobby__server-retry" onClick={onRetry}>Retry connection</button>
    </div>
  );
}

/** Top-down sketch of a map's walls, drawn from the same data the server uses. */
type SlotKey = 'hero' | 'primary' | 'secondary' | 'utility' | 'hat';

/** Four boxes showing the current pick. Clicking one opens a drawer under the row with every option for that slot. */
function LoadoutPicker(props: {
  portraits: Portraits; kills: number;
  hero: HeroId; gun: GunId; secondary: GunId; utility: UtilId; hat: HatId;
  setHero: (h: HeroId) => void; setGun: (g: GunId) => void; setSecondary: (g: GunId) => void; setUtility: (u: UtilId) => void; setHat: (h: HatId) => void;
}) {
  const { portraits, kills } = props;
  const [open, setOpen] = useState<SlotKey | null>(null);
  const slots: { key: SlotKey; label: string; name: string; detail: string; img: string; color?: string }[] = [
    { key: 'hero', label: 'Hero', name: HEROES[props.hero].name, detail: abilityTag(HEROES[props.hero]), img: portraits.heroes[props.hero], color: HEROES[props.hero].color },
    { key: 'primary', label: 'Primary', name: GUNS[props.gun].name, detail: GUNS[props.gun].blurb, img: portraits.guns[props.gun] },
    { key: 'secondary', label: 'Secondary', name: GUNS[props.secondary].name, detail: GUNS[props.secondary].blurb, img: portraits.guns[props.secondary] },
    { key: 'utility', label: 'Utility', name: UTILS[props.utility].name, detail: `${UTILS[props.utility].charges} per life`, img: portraits.utils[props.utility] },
    { key: 'hat', label: 'Hat', name: HATS[props.hat].name, detail: 'Unlock more with kills', img: portraits.hats[props.hat] },
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
              {open === 'primary' && <GunRack value={props.gun} onChange={pick(props.setGun)} portraits={portraits} />}
              {open === 'secondary' && <GunRack ids={SECONDARY_IDS} label="Secondary gun" value={props.secondary} onChange={pick(props.setSecondary)} portraits={portraits} />}
              {open === 'utility' && <UtilRack value={props.utility} onChange={pick(props.setUtility)} portraits={portraits} />}
              {open === 'hat' && <HatRack value={props.hat} onChange={pick(props.setHat)} kills={kills} portraits={portraits} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
