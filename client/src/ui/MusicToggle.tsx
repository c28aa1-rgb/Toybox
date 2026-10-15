import { useState } from 'react';
import { music } from '../game/audio';

export function MusicToggle({ className = '' }: { className?: string }) {
  const [on, setOn] = useState(music.enabled);
  return (
    <button
      type="button"
      className={`btn btn--ghost btn--small btn--music ${className}`}
      aria-label={on ? 'Turn music off' : 'Turn music on'}
      aria-pressed={on}
      title={on ? 'Music on' : 'Music off'}
      onClick={() => {
        music.setEnabled(!on);
        setOn(!on);
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 10v4h4l5 4V6l-5 4H4Z" />
        {on ? <><path d="M16 9a5 5 0 0 1 0 6" /><path d="M18.5 6.5a8.5 8.5 0 0 1 0 11" /></> : <path d="m17 9 5 6m0-6-5 6" />}
      </svg>
    </button>
  );
}
