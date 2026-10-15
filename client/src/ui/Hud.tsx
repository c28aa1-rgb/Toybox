import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CHAT_MAX, GUNS, HEROES, MAPS, MAX_PLAYERS, MODES, SECONDARY_IDS, TEAM_COLORS, TEAM_NAMES, UTILS, type Loadout, type PlayerSnap } from '@gg/shared';
import type { Banner, ChatLine, HudState, StreakCall } from '../game/store';
import { itemName, type GameClient } from '../game/GameClient';
import { useHud } from '../game/store';
import { loadProfile } from '../unlocks';
import type { Portraits } from './App';
import { GunRack, HatRack, HeroShelf, UtilRack } from './Pickers';

const pop = { type: 'spring', stiffness: 500, damping: 24 } as const;

export function Hud({ client, portraits, onLeave }: { client: GameClient; portraits: Portraits; onLeave: () => void }) {
  const s = useHud(client.hud);
  const me = s.me;

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
    return <div className="hud-center"><p className="connecting">Joining room…</p></div>;
  }

  const leader = s.players[0];
  const hero = HEROES[me.hero];

  return (
    <div className="hud">
      <HurtVignette tick={s.hurtTick} />

      <div className="hud__tl">
        {s.isPublic ? <PublicTag name={s.map ? MAPS[s.map].name : ''} count={s.players.filter((p) => !p.bot).length} /> : <RoomTag code={s.room} />}
        {s.host && <BotStepper count={s.bots} humans={s.players.length - s.bots} onChange={(n) => client.setBots(n)} />}
        <button type="button" className="btn btn--ghost btn--small" onClick={onLeave}>Leave</button>
      </div>

      <div className="hud__tc">
        {s.mode === 'teams' ? <TeamRace s={s} me={me} /> : <Race me={me} leader={leader} s={s} />}
        <ModeTag s={s} me={me} />
      </div>

      <div className="hud__tr">
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
        <span className="ping">{s.ping} ms</span>
      </div>

      {me.alive && (
        <div className="hud__bottom">
          <HealthPill hp={me.hp} />
          <AbilityButton name={hero.ability} color={hero.color} readyIn={me.abilityReadyIn} cooldown={hero.cooldown} />
          <Loadout me={me} portraits={portraits} />
        </div>
      )}

      <AnimatePresence>
        {me.alive && s.nearPickup && (
          <motion.div
            className="prompt"
            initial={{ y: 12, opacity: 0, scale: 0.9 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 8, opacity: 0 }}
            transition={pop}
          >
            <kbd>E</kbd> Swap to {itemName(s.nearPickup)}
          </motion.div>
        )}
      </AnimatePresence>

      <Toast toast={s.toast} />
      <StreakCallout call={s.streak} />
      {me.alive && s.slowed && <div className="slow-tag">Slowed</div>}
      <EliminationBanner banner={s.banner} />
      <div className={`scope-vignette${me.alive && s.scoped ? ' is-on' : ''}`} aria-hidden />
      <div className={`smoke-overlay${me.alive && s.smoked ? ' is-on' : ''}`} aria-hidden>
        <span>In smoke</span>
      </div>
      <FlashOverlay blind={s.blind} />
      <Chat lines={s.chat} open={s.chatOpen} client={client} />
      {me.alive && s.scoped && <div className="scope-tag">SCOPED · SLOWER, STEADIER AIM</div>}

      <AnimatePresence>
        {!me.alive && s.phase === 'playing' && (
          <DeathPanel
            key="death"
            killer={s.killedBy ? s.players.find((p) => p.id === s.killedBy)?.name ?? null : null}
            respawnIn={me.respawnIn}
            client={client}
            portraits={portraits}
            loadout={s.loadout}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {s.phase === 'ended' && <EndPanel key="end" s={s} />}
      </AnimatePresence>

      {s.scoreboard && s.phase === 'playing' && <Scoreboard players={s.players} myId={s.myId} s={s} />}
    </div>
  );
}

function PublicTag({ name, count }: { name: string; count: number }) {
  return (
    <div className="roomtag roomtag--public">
      <span className="roomtag__hole" aria-hidden />
      <span className="roomtag__label">Public</span>
      <span className="roomtag__code">{name}</span>
      <span className="roomtag__hint">{count} {count === 1 ? 'player' : 'players'} online here</span>
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

function Chat({ lines, open, client }: { lines: ChatLine[]; open: boolean; client: GameClient }) {
  const [draft, setDraft] = useState('');
  const [, force] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Enter opens chat from the game; Escape closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.tagName === 'INPUT';
      if (e.key === 'Enter' && !open && !typing) {
        e.preventDefault();
        client.setChatOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, client]);

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
        <span className="chat__hint">Enter to chat</span>
      )}
    </div>
  );
}

function RoomTag({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const url = new URL(location.href);
    url.searchParams.set('room', code);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button type="button" className="roomtag" onClick={copy} title="Copy invite link">
      <span className="roomtag__hole" aria-hidden />
      <span className="roomtag__label">Room</span>
      <span className="roomtag__code">{code}</span>
      <span className="roomtag__hint">{copied ? 'Link copied' : 'Copy invite link'}</span>
    </button>
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
          initial={{ scale: 0.4, rotate: -12, opacity: 0, x: '-50%' }}
          animate={{ scale: 1, rotate: -4, opacity: 1, x: '-50%' }}
          exit={{ scale: 0.8, opacity: 0, x: '-50%' }}
          transition={{ type: 'spring', stiffness: 600, damping: 14 }}
        >
          <b>{words[shown.n] ?? 'Streak'}</b>
          <small>{shown.mine ? `${shown.n} kills without dying` : `${shown.name} has ${shown.n} in a row`}</small>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function HealthPill({ hp }: { hp: number }) {
  return (
    <div className={`health${hp <= 35 ? ' is-low' : ''}`}>
      <motion.span className="health__fill" animate={{ width: `${hp}%` }} transition={{ type: 'spring', stiffness: 300, damping: 30 }} />
      <span className="health__num">{hp}</span>
    </div>
  );
}

function AbilityButton({ name, color, readyIn, cooldown }: { name: string; color: string; readyIn: number; cooldown: number }) {
  const ready = readyIn <= 0.05;
  const pct = ready ? 1 : 1 - readyIn / cooldown;
  return (
    <motion.div
      className={`ability${ready ? ' is-ready' : ''}`}
      style={{ '--hero': color, '--pct': pct } as React.CSSProperties}
      animate={ready ? { scale: [1, 1.12, 1] } : { scale: 1 }}
      transition={{ duration: 0.3, ease: [0.34, 1.56, 0.64, 1] }}
    >
      <span className="ability__ring" aria-hidden />
      <span className="ability__name">{name}</span>
      <span className="ability__key">{ready ? 'Space' : readyIn.toFixed(1)}</span>
    </motion.div>
  );
}

/** Primary and secondary with the one in hand raised, plus the utility and its charges. */
function Loadout({ me, portraits }: { me: PlayerSnap; portraits: Portraits }) {
  const slots: { key: string; slot: 'primary' | 'secondary'; gun: keyof typeof GUNS }[] = [
    { key: '1', slot: 'primary', gun: me.primary },
    { key: '2', slot: 'secondary', gun: me.secondary },
  ];
  return (
    <div className="loadout">
      {slots.map((s) => (
        <motion.div
          key={s.slot}
          className={`loadout__gun${me.slot === s.slot ? ' is-active' : ''}`}
          animate={{ y: me.slot === s.slot ? -8 : 0, scale: me.slot === s.slot ? 1 : 0.88 }}
          transition={pop}
        >
          <kbd>{s.key}</kbd>
          <img src={portraits.guns[s.gun]} alt="" />
          <span>{GUNS[s.gun].name}</span>
        </motion.div>
      ))}
      <div className={`loadout__util${me.utilCharges ? '' : ' is-empty'}`}>
        <kbd>G</kbd>
        <img src={portraits.utils[me.utility]} alt="" />
        <span>{UTILS[me.utility].name}</span>
        <b>×{me.utilCharges}</b>
      </div>
    </div>
  );
}

function FlashOverlay({ blind }: { blind: number }) {
  // Full white while more than a second is left, then fades out.
  const opacity = Math.min(1, blind / 1.0);
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

function DeathPanel({
  killer, respawnIn, client, portraits, loadout,
}: {
  killer: string | null;
  respawnIn: number;
  client: GameClient;
  portraits: Portraits;
  loadout: Loadout;
}) {
  const kills = loadProfile().kills;
  return (
    <motion.div
      className="death"
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 20, opacity: 0 }}
      transition={pop}
    >
      <h2 className="death__title">{killer ? `${killer} got you` : 'You went down'}</h2>
      <p className="death__timer">Back in {Math.ceil(respawnIn)}</p>
      <p className="death__hint">Change your loadout for the next life:</p>
      <HeroShelf compact value={loadout.hero} portraits={portraits} onChange={(hero) => client.setLoadout({ ...loadout, hero })} />
      <GunRack compact value={loadout.gun} portraits={portraits} onChange={(gun) => client.setLoadout({ ...loadout, gun })} />
      <GunRack compact ids={SECONDARY_IDS} label="Secondary gun" value={loadout.secondary} portraits={portraits} onChange={(secondary) => client.setLoadout({ ...loadout, secondary })} />
      <UtilRack compact value={loadout.utility} portraits={portraits} onChange={(utility) => client.setLoadout({ ...loadout, utility })} />
      <HatRack compact value={loadout.hat} kills={kills} portraits={portraits} onChange={(hat) => client.setLoadout({ ...loadout, hat })} />
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

function EndPanel({ s }: { s: HudState }) {
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
        <Scoreboard players={s.players} myId={s.myId} s={s} inline />
      </motion.div>
    </motion.div>
  );
}

function Scoreboard({ players, myId, s, inline = false }: { players: PlayerSnap[]; myId: string | null; s: HudState; inline?: boolean }) {
  const scoreLabel = s.mode === 'hill' ? 'Points' : s.mode === 'ladder' ? 'Gun' : null;
  return (
    <div className={inline ? 'scores scores--inline' : 'scores'}>
      <table>
        <thead>
          <tr>
            <th>Player</th><th>Hero</th>
            {scoreLabel && <th>{scoreLabel}</th>}
            <th>Kills</th><th>Deaths</th><th>Damage</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr key={p.id} className={p.id === myId ? 'is-me' : ''} style={p.team >= 0 ? ({ '--team': TEAM_COLORS[p.team] } as React.CSSProperties) : undefined}>
              <td className={p.team >= 0 ? 'has-team' : ''}>{p.id === myId ? `${p.name} (you)` : p.name}</td>
              <td style={{ color: HEROES[p.hero].color }}>{HEROES[p.hero].name}</td>
              {scoreLabel && <td>{p.score}</td>}
              <td>{p.kills}</td>
              <td>{p.deaths}</td>
              <td>{p.damage}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
