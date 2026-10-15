import type { CSSProperties } from 'react';
import type { SmokeFog } from '../game/smoke';

export function SmokeOverlay({ clouds }: { clouds: SmokeFog[] }) {
  return <div className="smoke-overlay" aria-hidden="true">
    {clouds.map((cloud) => <div key={cloud.id} className="smoke-overlay__cloud" style={{
      opacity: cloud.opacity,
      maskImage: `linear-gradient(${cloud.angle}deg, rgba(0,0,0,${cloud.far}) 5%, rgba(0,0,0,${cloud.near}) 95%)`,
      WebkitMaskImage: `linear-gradient(${cloud.angle}deg, rgba(0,0,0,${cloud.far}) 5%, rgba(0,0,0,${cloud.near}) 95%)`,
      '--smoke-delay': `-${cloud.id % 17}s`,
    } as CSSProperties}><div className="smoke-overlay__wisps" /><div className="smoke-overlay__wisps smoke-overlay__wisps--front" /></div>)}
  </div>;
}
