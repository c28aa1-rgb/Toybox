import { useEffect, useMemo, useRef, useState } from 'react';
import { GameClient, type JoinOptions } from '../game/GameClient';
import { renderPortraits } from '../skins/portraits';
import { Lobby } from './Lobby';
import { Hud } from './Hud';

export type Portraits = ReturnType<typeof renderPortraits>;

export function App() {
  const [join, setJoin] = useState<JoinOptions | null>(null);
  const portraits = useMemo(() => renderPortraits(), []);

  if (!join) return <Lobby portraits={portraits} onPlay={setJoin} />;
  return <Game opts={join} portraits={portraits} onLeave={() => setJoin(null)} />;
}

function Game({ opts, portraits, onLeave }: { opts: JoinOptions; portraits: Portraits; onLeave: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [client, setClient] = useState<GameClient | null>(null);

  useEffect(() => {
    const c = new GameClient(ref.current!, opts);
    setClient(c);
    return () => c.dispose();
  }, [opts]);

  return (
    <div className="game" ref={ref}>
      {client && <Hud client={client} portraits={portraits} onLeave={onLeave} />}
    </div>
  );
}
