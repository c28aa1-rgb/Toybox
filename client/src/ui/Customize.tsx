import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  COSMETICS, KILL_FX_IDS, PAINTS, PAINT_IDS, TRAIL_IDS,
  type CosmeticKind, type HeroId, type KillFxId, type PaintId, type TrailId,
} from '@gg/shared';
import { renderPaintPortraits } from '../skins/portraits';

export interface CosmeticPicks {
  paint: PaintId;
  trail: TrailId;
  killFx: KillFxId;
}

const TABS: { kind: CosmeticKind; label: string; hint: string }[] = [
  { kind: 'paint', label: 'Paint', hint: 'Recolours your hero. The belly, eyes and gear stay the same.' },
  { kind: 'trail', label: 'Trail', hint: 'What you leave behind while you run.' },
  { kind: 'killFx', label: 'Kill effect', hint: 'How the players you knock out pop.' },
];

const IDS: Record<CosmeticKind, string[]> = { paint: PAINT_IDS, trail: TRAIL_IDS, killFx: KILL_FX_IDS };

/** Colours for the little trail and kill-effect previews. */
const PREVIEW_COLORS: Record<string, string[]> = {
  'trail:none': [],
  'trail:sparkle': ['#FFFFFF', '#FFE45C', '#FFFFFF'],
  'trail:bubbles': ['#BFE6FF', '#E8F6FF', '#BFE6FF'],
  'trail:confetti': ['#FF5FA2', '#FFE45C', '#3DDBB4', '#4FB3FF', '#FF8A1F'],
  'trail:rainbow': ['#FF5F6D', '#FF8A1F', '#FFE45C', '#3DDBB4', '#4FB3FF', '#B48CFF'],
  'killFx:shatter': ['#B48CFF', '#FFFFFF', '#1B1030'],
  'killFx:confetti': ['#FF5FA2', '#FFE45C', '#3DDBB4', '#4FB3FF', '#FF8A1F'],
  'killFx:squeak': ['#FFE45C', '#FFFFFF'],
  'killFx:balloons': ['#FF5FA2', '#4FB3FF', '#FFE45C', '#3DDBB4'],
  'killFx:fireworks': ['#FFE45C', '#FF5FA2', '#FFFFFF'],
};

/**
 * Small looping preview of a cosmetic: a colour swatch for paints, a drifting row of dots for trails,
 * a burst of dots for kill effects. Used on the cards and in the unlock notice.
 */
export function CosmeticPreview({ kind, id, image }: { kind: CosmeticKind; id: string; image?: string }) {
  if (kind === 'paint') {
    const color = PAINTS[id as PaintId]?.color;
    return (
      <span className={`cpreview cpreview--paint cpreview--${id}`} style={{ '--swatch': color ?? '#B48CFF' } as React.CSSProperties}>
        {image ? <img src={image} alt="" draggable={false} /> : <i />}
      </span>
    );
  }
  const colors = PREVIEW_COLORS[`${kind}:${id}`] ?? [];
  if (!colors.length) return <span className="cpreview cpreview--empty">—</span>;
  return (
    <span className={`cpreview cpreview--${kind} cpreview--${kind}-${id}`}>
      {Array.from({ length: kind === 'trail' ? 7 : 10 }, (_, i) => (
        <i key={i} style={{ '--c': colors[i % colors.length], '--i': i } as React.CSSProperties} />
      ))}
    </span>
  );
}

/** Full-screen panel with a tab per cosmetic slot. Locked items show how many kills they need. */
export function CustomizePanel({
  hero, kills, picks, onChange, onClose,
}: { hero: HeroId; kills: number; picks: CosmeticPicks; onChange: (p: CosmeticPicks) => void; onClose: () => void }) {
  const [tab, setTab] = useState<CosmeticKind>('paint');
  // Paint previews are this hero in each colour; render them once per hero.
  const paintShots = useMemo(() => renderPaintPortraits(hero), [hero]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const current = TABS.find((t) => t.kind === tab)!;
  return (
    <motion.div className="customize" role="dialog" aria-modal="true" aria-label="Customize" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div className="customize__panel" initial={{ y: 30, scale: 0.96 }} animate={{ y: 0, scale: 1 }} exit={{ y: 20, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 30 }}>
        <header className="customize__head">
          <h2 className="section-title">Customize</h2>
          <span className="customize__kills">{kills} lifetime kills</span>
          <button type="button" className="btn btn--ghost btn--small" onClick={onClose}>Done</button>
        </header>
        <div className="customize__tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.kind} type="button" role="tab" aria-selected={tab === t.kind} className={`customize__tab${tab === t.kind ? ' is-on' : ''}`} onClick={() => setTab(t.kind)}>
              {t.label}
            </button>
          ))}
        </div>
        <p className="customize__hint">{current.hint}</p>
        <AnimatePresence mode="wait">
          <motion.div key={tab} className="customize__grid" role="radiogroup" aria-label={current.label}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            {IDS[tab].map((id) => {
              const def = COSMETICS[tab][id];
              const open = def.unlockKills <= kills;
              const selected = picks[tab] === id;
              return (
                <motion.button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-disabled={!open}
                  className={`ccard${selected ? ' is-selected' : ''}${open ? '' : ' is-locked'}`}
                  onClick={() => open && onChange({ ...picks, [tab]: id })}
                  whileHover={open ? { y: -4 } : { x: [0, -4, 4, -2, 0] }}
                  whileTap={open ? { scale: 0.96 } : undefined}
                >
                  <CosmeticPreview kind={tab} id={id} image={tab === 'paint' ? paintShots[id as PaintId] : undefined} />
                  <span className="ccard__name">{def.name}</span>
                  <span className="ccard__blurb">{open ? def.blurb : `Unlocks at ${def.unlockKills} kills`}</span>
                  {!open && <span className="ccard__lock" aria-hidden>{def.unlockKills - kills} to go</span>}
                </motion.button>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
