import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CHAT_MAX, GUNS, HEROES, MAPS, MAX_PLAYERS, MODES, SECONDARY_IDS, TEAM_COLORS, TEAM_NAMES, type Loadout, type PlayerSnap } from '@gg/shared';
import type { Banner, ChatLine, HudState, StreakCall } from '../game/store';
import { itemName, type GameClient } from '../game/GameClient';
import { useHud } from '../game/store';
import { isRemoteServer } from '../game/server';
import { loadProfile } from '../unlocks';
import type { Portraits } from './App';
import { GunRack, HatRack, HeroShelf, UtilRack } from './Pickers';
import { MusicToggle } from './MusicToggle';
import { CombatHud } from './CombatHud';
import { PowerChips } from './PowerChips';
import { SpectateBar } from './SpectateBar';
import { SmokeOverlay } from './SmokeOverlay';
import { MiniMap } from './MapPreview';
import { bindingLabel, listenActions, matches, useBindings } from '../game/bindings';

const pop = { type: 'spring', stiffness: 500, damping: 24 } as const;

export function Hud({ client, portraits, onLeave }: { client: GameClient; portraits: Portraits; onLeave: () => void }) {
  useBindings();
  const s = useHud(client.hud);
  const me = s.me;
  const [leaveOpen, setLeaveOpen] = useState(false);

  useEffect(() => listenActions((code, e) => {
      if (matches('leave', code)) {
        e.preventDefault();
        client.setMenuOpen(true);
        setLeaveOpen(true);
      }
  }), [client]);
  useEffect(() => {
    client.setMenuOpen(leaveOpen);
    return () => client.setMenuOpen(false);
  }, [client, leaveOpen]);

  if (s.error && !s.connected) {
    return (
      <div className="hud-center">
        <div className="panel panel--error">
          <h2>Can't play right now</h2>
          <p>{s.error}</p>
          <button type="button" className="btn btn--primary" onClick={onLeave}>Back to lobby</button>
        </div>
      </div>
    );
  }
  if (!me) {
    return <div className="hud-center"><Connecting /></div>;
  }
  const reconnecting = s.reconnecting && (
    <div className="reconnecting" role="status">Connection lost. Reconnecting… your score is kept.</div>
  );

  const leader = s.players[0];

  return (
    <div className="hud">
      {reconnecting}
      <SmokeOverlay clouds={me.alive ? s.smoke : []} />
      <HurtVignette tick={s.hurtTick} />

      <div className="hud__tl">
        <Leaderboard players={s.players} myId={s.myId} s={s} host={s.host} bots={s.bots} onBots={(n) => client.setBots(n)} />
      </div>

      <div className="hud__tc">
        {s.mode === 'teams' ? <TeamRace s={s} me={me} /> : <Race me={me} leader={leader} s={s} />}
        <ModeTag s={s} me={me} />
      </div>

      <div className="hud__tr">
        <MusicToggle />
        <ul className="feed">
          <AnimatePresence initial={false}>
            {s.feed.map((f) => (
              <motion.li
                key={f.key}
                layout
                className={`feed__row${f.mine ? ' is-mine' : ''}`}
                initial={{ x: 60, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ opacity: 0, x: 30 }}
                transition={pop}
              >
                <b>{f.killer}</b>
                <span className="feed__gun">{itemName(f.gun)}</span>
                <b>{f.victim}</b>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
        <span className="ping">{s.ping} ms · {s.fps} fps</span>
      </div>

      {me.alive && (
        <CombatHud me={me} portraits={portraits} client={client} />
      )}
      {me.alive && <PowerChips powers={me.powers ?? {}} />}

      <AnimatePresence>
        {me.alive && s.nearPickup && (
          <motion.div
            className="prompt"
            initial={{ y: 12, opacity: 0, scale: 0.9 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 8, opacity: 0 }}
            transition={pop}
          >
            <kbd>{bindingLabel('pickup')}</kbd> Swap to {itemName(s.nearPickup)}
          </motion.div>
        )}
      </AnimatePresence>

      <Toast toast={s.toast} />
      <StreakCallout call={s.streak} />
      {me.alive && s.slowed && <div className="slow-tag">Slowed</div>}
      <EliminationBanner banner={s.banner} />
      <div className={`scope-vignette${me.alive && s.scoped ? ' is-on' : ''}`} aria-hidden />
      <FlashOverlay blind={s.blind} />
      <Chat
        lines={s.chat}
        open={s.chatOpen}
        client={client}
        blocked={leaveOpen}
        onEnter={() => {
          if (me.alive || s.phase !== 'playing' || me.respawnIn > 0.05) return false;
          client.respawn();
          return true;
        }}
      />
      {me.alive && s.scoped && <div className="scope-tag">SCOPED · SLOWER, STEADIER AIM</div>}

      <AnimatePresence>
        {!me.alive && s.phase === 'playing' && <SpectateBar key="spectate" target={s.spectating} client={client} />}
      </AnimatePresence>

      <AnimatePresence>
        {!me.alive && s.phase === 'playing' && (
          <DeathPanel
            key="death"
            killer={s.killedBy ? s.players.find((p) => p.id === s.killedBy)?.name ?? null : null}
            respawnIn={me.respawnIn}
            client={client}
            portraits={portraits}
            loadout={s.loadout}
            onLeave={onLeave}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {s.phase === 'ended' && <EndPanel key="end" s={s} client={client} />}
      </AnimatePresence>

      <AnimatePresence>
        {leaveOpen && <LeaveConfirm key="leave" onCancel={() => setLeaveOpen(false)} onLeave={onLeave} />}
      </AnimatePresence>
    </div>
  );
}

function EliminationBanner({ banner }: { banner: Banner | null }) {
  const [shown, setShown] = useState<Banner | null>(null);
  useEffect(() => {
    if (!banner) return;
    setShown(banner);
    const t = setTimeout(() => setShown(null), 2200);
    return () => clearTimeout(t);
  }, [banner]);
  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          key={shown.key}
          className={`banner banner--${shown.kind}`}
          initial={{ y: -30, scale: 0.6, opacity: 0, x: '-50%' }}
          animate={{ y: 0, scale: 1, opacity: 1, x: '-50%' }}
          exit={{ y: -16, opacity: 0, x: '-50%' }}
          transition={{ type: 'spring', stiffness: 520, damping: 16 }}
        >
          <small>{shown.kind === 'eliminated' ? 'You eliminated' : 'You were eliminated by'}</small>
          {shown.name}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const CHAT_VISIBLE_MS = 9000;

function Chat({ lines, open, client, onEnter, blocked }: { lines: ChatLine[]; open: boolean; client: GameClient; onEnter: () => boolean; blocked: boolean }) {
  useBindings();
  const [draft, setDraft] = useState('');
  const [, force] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => listenActions((code, e) => {
      if (!blocked && !open && (matches('chat', code) || matches('respawn', code))) {
        e.preventDefault();
        if (matches('respawn', code) && onEnter()) return;
        if (matches('chat', code)) client.setChatOpen(true);
      }
  }), [open, client, onEnter, blocked]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Re-render once a second so old lines fade out of view.
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const now = performance.now();
  const visible = open ? lines : lines.filter((l) => now - l.at < CHAT_VISIBLE_MS);
  return (
    <div className="chat">
      <AnimatePresence initial={false}>
        {visible.map((l) => (
          <motion.div
            key={l.key}
            className={`chat__line${l.name === null ? ' is-system' : ''}${l.mine ? ' is-mine' : ''}`}
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            {l.name !== null && <b>{l.name}</b>}
            {l.text}
          </motion.div>
        ))}
      </AnimatePresence>
      {open ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            client.sendChat(draft);
            setDraft('');
            client.setChatOpen(false);
          }}
        >
          <input
            ref={inputRef}
            className="chat__input"
            value={draft}
            maxLength={CHAT_MAX}
            placeholder="Say something, Enter to send"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setDraft('');
                client.setChatOpen(false);
              }
            }}
            onBlur={() => client.setChatOpen(false)}
          />
        </form>
      ) : (
        <span className="chat__hint">{bindingLabel('chat')} to chat</span>
      )}
    </div>
  );
}

function Leaderboard({ players, myId, s, host, bots, onBots }: { players: PlayerSnap[]; myId: string | null; s: HudState; host: boolean; bots: number; onBots: (n: number) => void }) {
  const label = s.mode === 'hill' ? 'Points' : s.mode === 'ladder' ? 'Guns' : 'Kills';
  const myPlace = players.findIndex((p) => p.id === myId);
  const rows = [...players.slice(0, 5), ...(myPlace >= 5 ? [players[myPlace]] : [])];
  const scoreOf = (p: PlayerSnap) => s.mode === 'hill' || s.mode === 'ladder' ? p.score : p.kills;
  return (
    <aside className="leaderboard" aria-label="Match standings">
      <div className="leaderboard__head"><b>Standings</b><span>{label}</span></div>
      <ol className="leaderboard__rows">
        {rows.map((p, i) => {
          const place = players.indexOf(p) + 1;
          return <li key={p.id} className={`${p.id === myId ? 'is-me' : ''}${place > 5 && i > 0 ? ' is-separated' : ''}`}>
            <span className="leaderboard__place">{place}</span>
            <span className="leaderboard__name">{p.id === myId ? 'You' : p.name}</span>
            <b>{scoreOf(p)}</b>
          </li>;
        })}
      </ol>
      {host && <BotStepper count={bots} humans={players.length - bots} onChange={onBots} />}
      {s.isPublic && players.length - bots === 1 && <PublicBots on={bots > 0} onChange={onBots} />}
    </aside>
  );
}

function LeaveConfirm({ onCancel, onLeave }: { onCancel: () => void; onLeave: () => void }) {
  const [seconds, setSeconds] = useState(4);
  useEffect(() => {
    if (!seconds) return;
    const timer = window.setTimeout(() => setSeconds((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [seconds]);
  return (
    <motion.div className="leave-confirm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="leave-confirm__card" initial={{ y: 16, scale: 0.96 }} animate={{ y: 0, scale: 1 }} exit={{ y: 8, scale: 0.98 }} transition={pop}>
        <h2>Leave this match?</h2>
        <p>Your place in the round will be lost.</p>
        <div>
          <button type="button" className="btn btn--ghost" onClick={onCancel}>Stay</button>
          <button type="button" className="btn btn--primary" onClick={onLeave} disabled={seconds > 0}>{seconds > 0 ? `Leave in ${seconds}` : 'Leave match'}</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/** Alone in the public lobby: bots stay off until you ask for them, and leave when someone else joins. */
function PublicBots({ on, onChange }: { on: boolean; onChange: (n: number) => void }) {
  return (
    <div className={`public-bots${on ? ' is-on' : ''}`}>
      <span>{on ? 'Bots are keeping you company' : 'Nobody else is here yet'}</span>
      <button type="button" className="btn btn--primary" onClick={() => onChange(on ? 0 : 5)}>
        {on ? 'Turn off bots' : 'Turn on bots'}
      </button>
    </div>
  );
}

function BotStepper({ count, humans, onChange }: { count: number; humans: number; onChange: (n: number) => void }) {
  const max = MAX_PLAYERS - humans;
  return (
    <div className="stepper" aria-label="Bots">
      <button type="button" onClick={() => onChange(Math.max(0, count - 1))} disabled={count <= 0} aria-label="Remove a bot">−</button>
      <span>{count} {count === 1 ? 'bot' : 'bots'}</span>
      <button type="button" onClick={() => onChange(Math.min(max, count + 1))} disabled={count >= max} aria-label="Add a bot">+</button>
    </div>
  );
}

/** Score bar toward the round target: kills, hill points or ladder steps depending on mode. */
function Race({ me, leader, s }: { me: PlayerSnap; leader?: PlayerSnap; s: HudState }) {
  const leaderIsMe = !leader || leader.id === me.id;
  const unit = s.mode === 'hill' ? 'points' : s.mode === 'ladder' ? 'guns' : 'kills';
  const target = s.target;
  return (
    <div className="race">
      <div className="race__track">
        <motion.span className="race__fill race__fill--me" animate={{ width: `${(me.score / target) * 100}%` }} transition={pop} />
        {!leaderIsMe && leader && (
          <motion.span className="race__marker" animate={{ left: `${(leader.score / target) * 100}%` }} transition={pop} />
        )}
      </div>
      <span className="race__text">
        <b>{me.score}</b> / {target} {unit}
        {!leaderIsMe && leader && <> · {leader.name} has {leader.score}</>}
        {leaderIsMe && me.score > 0 && <> · you're leading</>}
      </span>
    </div>
  );
}

function TeamRace({ s, me }: { s: HudState; me: PlayerSnap }) {
  return (
    <div className="teamrace">
      {[0, 1].map((t) => (
        <div key={t} className={`teamrace__side${me.team === t ? ' is-mine' : ''}`} style={{ '--team': TEAM_COLORS[t] } as React.CSSProperties}>
          <span className="teamrace__name">{TEAM_NAMES[t]}{me.team === t ? ' (you)' : ''}</span>
          <div className="teamrace__track">
            <motion.span className="teamrace__fill" animate={{ width: `${(s.teamScores[t] / s.target) * 100}%` }} transition={pop} />
          </div>
          <b className="teamrace__score">{s.teamScores[t]}</b>
        </div>
      ))}
    </div>
  );
}

/** One line under the score bar saying what this mode wants from you right now. */
function ModeTag({ s, me }: { s: HudState; me: PlayerSnap }) {
  if (s.mode === 'hill') {
    const hill = s.hill;
    const text = !hill?.holder
      ? hill?.contested ? 'Ring contested: clear it out' : 'Ring empty: get in it'
      : hill.holder === me.id ? 'You hold the ring' : `${s.players.find((p) => p.id === hill.holder)?.name ?? 'Someone'} holds the ring`;
    return <span className={`modetag${hill?.holder === me.id ? ' is-good' : ''}`}>{text}</span>;
  }
  if (s.mode === 'ladder') {
    return <span className="modetag">Gun {Math.min(me.score + 1, s.target)} of {s.target}: {GUNS[me.primary].name}</span>;
  }
  return null;
}

function StreakCallout({ call }: { call: StreakCall | null }) {
  const [shown, setShown] = useState<StreakCall | null>(null);
  useEffect(() => {
    if (!call) return;
    setShown(call);
    const t = setTimeout(() => setShown(null), 2400);
    return () => clearTimeout(t);
  }, [call]);
  const words: Record<number, string> = { 3: 'On a roll', 5: 'Rampage', 8: 'Unstoppable', 12: 'Toy box legend' };
  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          key={shown.key}
          className={`streak${shown.mine ? ' is-mine' : ''}`}
          initial={{ x: 60, scale: 0.6, rotate: 8, opacity: 0 }}
          animate={{ x: 0, scale: 1, rotate: 2, opacity: 1 }}
          exit={{ x: 30, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 14 }}
        >
          <b>{words[shown.n] ?? 'Streak'}</b>
          <small>{shown.mine ? `${shown.n} kills without dying` : `${shown.name} has ${shown.n} in a row`}</small>
        </motion.div>
      )}
    </AnimatePresence>
  );
}


function FlashOverlay({ blind }: { blind: number }) {
  // Full white while plenty is left, then a slow fade over the last two seconds.
  const opacity = Math.min(1, blind / 2);
  return <div className="flash-overlay" style={{ opacity }} aria-hidden />;
}

function Toast({ toast }: { toast: { key: number; text: string } | null }) {
  const [visible, setVisible] = useState<typeof toast>(null);
  useEffect(() => {
    if (!toast) return;
    setVisible(toast);
    const t = setTimeout(() => setVisible(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key={visible.key}
          className="toast"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 10, opacity: 0 }}
          transition={pop}
        >
          {visible.text}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function HurtVignette({ tick }: { tick: number }) {
  return (
    <AnimatePresence>
      {tick > 0 && (
        <motion.div
          key={tick}
          className="vignette"
          initial={{ opacity: 0.85 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
        />
      )}
    </AnimatePresence>
  );
}

function RespawnButton({ respawnIn, client }: { respawnIn: number; client: GameClient }) {
  useBindings();
  const ready = respawnIn <= 0.05;
  const [asked, setAsked] = useState(false);
  return (
    <motion.button
      type="button"
      className={`btn btn--primary respawn${ready ? ' is-ready' : ''}`}
      disabled={!ready || asked}
      onClick={() => {
        client.respawn();
        setAsked(true);
      }}
      animate={ready && !asked ? { scale: [1, 1.06, 1] } : { scale: 1 }}
      transition={ready ? { duration: 0.9, repeat: Infinity, ease: 'easeInOut' } : pop}
      whileTap={ready ? { scaleX: 1.06, scaleY: 0.92 } : undefined}
    >
      {asked ? 'Respawning…' : ready ? <>Respawn <kbd>{bindingLabel('respawn')}</kbd></> : `Respawn in ${Math.ceil(respawnIn)}`}
    </motion.button>
  );
}

/** The death panel starts collapsed so the spectate view stays clear; this remembers if you open it. */
const LOADOUT_PANEL_KEY = 'gg.deathLoadout';

function DeathPanel({
  killer, respawnIn, client, portraits, loadout, onLeave,
}: {
  killer: string | null;
  respawnIn: number;
  client: GameClient;
  portraits: Portraits;
  loadout: Loadout;
  onLeave: () => void;
}) {
  const kills = loadProfile().kills;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(LOADOUT_PANEL_KEY) === 'open';
    } catch {
      return false;
    }
  });
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(LOADOUT_PANEL_KEY, open ? 'closed' : 'open');
    } catch { /* The panel still toggles without storage. */ }
  };
  return (
    <motion.div
      className={`death${open ? '' : ' is-collapsed'}`}
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 20, opacity: 0 }}
      transition={pop}
    >
      <div className="death__head">
        <h2 className="death__title" title={killer ? `${killer} got you` : undefined}>
          {killer ? <><span className="death__killer">{killer}</span> got you</> : 'You went down'}
        </h2>
        <div className="death__actions">
          <button type="button" className="btn btn--ghost" onClick={onLeave}>Leave match</button>
          <button type="button" className="btn btn--ghost death__toggle" aria-expanded={open} aria-controls="death-loadout" onClick={toggle}>
            {open ? 'Hide loadout' : 'Change loadout'}
          </button>
          <RespawnButton respawnIn={respawnIn} client={client} />
        </div>
      </div>
      {open && <div className="death__body" id="death-loadout">
      <p className="death__hint">Change your loadout for the next life:</p>
      <HeroShelf compact value={loadout.hero} portraits={portraits} onChange={(hero) => client.setLoadout({ ...loadout, hero })} />
      <GunRack compact value={loadout.gun} portraits={portraits} onChange={(gun) => client.setLoadout({ ...loadout, gun })} />
      <GunRack compact ids={SECONDARY_IDS} label="Secondary gun" value={loadout.secondary} portraits={portraits} onChange={(secondary) => client.setLoadout({ ...loadout, secondary })} />
      <UtilRack compact value={loadout.utility} portraits={portraits} onChange={(utility) => client.setLoadout({ ...loadout, utility })} />
      <HatRack compact value={loadout.hat} kills={kills} portraits={portraits} onChange={(hat) => client.setLoadout({ ...loadout, hat })} />
      </div>}
    </motion.div>
  );
}

interface Award {
  title: string;
  who: PlayerSnap;
  stat: string;
}

/** Round awards picked from the final scoreboard. Each player gets at most one card. */
function awards(players: PlayerSnap[]): Award[] {
  const out: Award[] = [];
  const used = new Set<string>();
  const pick = (title: string, value: (p: PlayerSnap) => number, stat: (p: PlayerSnap) => string) => {
    const best = [...players].filter((p) => !used.has(p.id)).sort((a, b) => value(b) - value(a))[0];
    if (best && value(best) > 0) {
      used.add(best.id);
      out.push({ title, who: best, stat: stat(best) });
    }
  };
  pick('Most damage', (p) => p.damage, (p) => `${p.damage} damage`);
  pick('Longest streak', (p) => p.bestStreak, (p) => `${p.bestStreak} kills in a row`);
  pick('Hardest to kill', (p) => (p.kills + 1) / (p.deaths + 1), (p) => `${p.kills} kills, ${p.deaths} deaths`);
  return out;
}

/** Public lobby results screen: pick the next map. Ties are broken at random; no votes picks one at random. */
function MapVote({ vote, mine, client }: { vote: NonNullable<HudState['vote']>; mine: HudState['myVote']; client: GameClient }) {
  const total = vote.counts.reduce((a, b) => a + b, 0);
  return (
    <section className="vote" aria-label="Vote for the next map">
      <h3 className="vote__title">Vote for the next map</h3>
      <div className="vote__options" role="radiogroup">
        {vote.options.map((id, i) => (
          <motion.button
            key={id}
            type="button"
            role="radio"
            aria-checked={mine === id}
            className={`mapcard vote__card${mine === id ? ' is-selected' : ''}`}
            onClick={() => client.voteMap(id)}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.97 }}
          >
            <MiniMap map={MAPS[id]} />
            <span className="mapcard__name">{MAPS[id].name}</span>
            <span className="vote__count">
              <i style={{ transform: `scaleX(${total ? vote.counts[i] / total : 0})` }} />
              <b>{vote.counts[i]} {vote.counts[i] === 1 ? 'vote' : 'votes'}</b>
            </span>
          </motion.button>
        ))}
      </div>
    </section>
  );
}

function EndPanel({ s, client }: { s: HudState; client: GameClient }) {
  const teamWin = s.winner?.startsWith('team:') ? Number(s.winner.slice(5)) : null;
  const winner = s.players.find((p) => p.id === s.winner);
  const me = s.me;
  const iWon = s.winner === s.myId || (teamWin !== null && me?.team === teamWin);
  const title = teamWin !== null
    ? `${TEAM_NAMES[teamWin]} team wins`
    : iWon ? 'You win!' : `${winner?.name ?? 'Someone'} wins`;
  const list = awards(s.players);
  return (
    <motion.div
      className="hud-center end"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="panel panel--end"
        initial={{ scale: 0.6, rotate: -6 }}
        animate={{ scale: 1, rotate: -2 }}
        transition={{ type: 'spring', stiffness: 420, damping: 14 }}
      >
        <h2 className="end__title" style={teamWin !== null ? { color: TEAM_COLORS[teamWin] } : undefined}>{title}</h2>
        <p className="end__sub">{MODES[s.mode].name} · next round in {Math.ceil(s.endsIn)}</p>
        {list.length > 0 && (
          <div className="awards">
            {list.map((a, i) => (
              <motion.div
                key={a.title}
                className={`award${a.who.id === s.myId ? ' is-me' : ''}`}
                style={{ '--hero': HEROES[a.who.hero].color } as React.CSSProperties}
                initial={{ y: 30, opacity: 0, rotate: 0 }}
                animate={{ y: 0, opacity: 1, rotate: i % 2 ? 2 : -2 }}
                transition={{ type: 'spring', stiffness: 500, damping: 18, delay: 0.25 + i * 0.12 }}
              >
                <span className="award__title">{a.title}</span>
                <b className="award__who">{a.who.id === s.myId ? 'You' : a.who.name}</b>
                <span className="award__stat">{a.stat}</span>
                {a.who.favWeapon && <span className="award__weapon">Top weapon: {itemName(a.who.favWeapon)}</span>}
              </motion.div>
            ))}
          </div>
        )}
        {s.vote && <MapVote vote={s.vote} mine={s.myVote} client={client} />}
        <Scoreboard players={s.players} myId={s.myId} s={s} inline />
      </motion.div>
    </motion.div>
  );
}

function Scoreboard({ players, myId, s, inline = false }: { players: PlayerSnap[]; myId: string | null; s: HudState; inline?: boolean }) {
  const scoreLabel = s.mode === 'hill' ? 'Points' : s.mode === 'ladder' ? 'Guns' : 'Kills';
  const visiblePlayers = inline ? players : [
    ...players.slice(0, 5),
    ...(players.findIndex((p) => p.id === myId) >= 5 ? [players.find((p) => p.id === myId)!] : []),
  ];
  return (
    <div className={inline ? 'scores scores--inline' : 'scores'}>
      {!inline && <h2 className="scores__title">Match standings</h2>}
      <table>
        <thead>
          <tr>
            {!inline && <th>Place</th>}
            <th>Player</th><th>Hero</th><th>{scoreLabel}</th>
            {s.mode !== 'ffa' && s.mode !== 'teams' && <th>Kills</th>}
            <th>Deaths</th><th>Damage</th>
          </tr>
        </thead>
        <tbody>
          {visiblePlayers.map((p) => {
            const place = players.indexOf(p) + 1;
            return <tr key={p.id} className={`${p.id === myId ? 'is-me' : ''}${!inline && place > 5 ? ' is-separated' : ''}`} style={p.team >= 0 ? ({ '--team': TEAM_COLORS[p.team] } as React.CSSProperties) : undefined}>
              {!inline && <td className="scores__place">{place}</td>}
              <td className={p.team >= 0 ? 'has-team' : ''}>{p.id === myId ? `${p.name} (you)` : p.name}</td>
              <td style={{ color: HEROES[p.hero].color }}>{HEROES[p.hero].name}</td>
              <td>{s.mode === 'ffa' || s.mode === 'teams' ? p.kills : p.score}</td>
              {s.mode !== 'ffa' && s.mode !== 'teams' && <td>{p.kills}</td>}
              <td>{p.deaths}</td>
              <td>{p.damage}</td>
            </tr>;
          })}
        </tbody>
      </table>
      {!inline && players.length > 5 && players.findIndex((p) => p.id === myId) >= 5 && <p className="scores__hint">Top five, then your place</p>}
    </div>
  );
}

/** Free hosting puts the server to sleep when idle, so the first join can take up to a minute. */
function Connecting() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="connecting-wrap">
      <p className="connecting">{slow && isRemoteServer ? 'Waking up the server…' : 'Joining room…'}</p>
      {slow && isRemoteServer && (
        <p className="connecting__sub">The game server naps when nobody is playing. This can take up to a minute the first time, then it's instant.</p>
      )}
    </div>
  );
}
