import type { MapDef } from '@gg/shared';

/** Top-down sketch of a map's walls, for map pickers and the next-map vote. */
export function MiniMap({ map }: { map: MapDef }) {
  return (
    <svg className="minimap" viewBox={`0 0 ${map.w} ${map.h}`} aria-hidden>
      <rect width={map.w} height={map.h} rx={1.5} className="minimap__floor" />
      {map.walls.slice(4).map((w, i) => (
        <rect key={i} x={w.x} y={w.y} width={w.w} height={w.h} rx={0.3} className="minimap__wall" />
      ))}
    </svg>
  );
}
