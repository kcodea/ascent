import { memo } from 'react';
import { ANCIENTS, type AncientId } from '@game/sim';

/**
 * PLACEHOLDER Ancient face (owner ruling 4: "a simple generated emblem per Ancient, clearly placeholder"; owner
 * direction on the first playable: simple, flat, bright). A flat disc in the Ancient's colour, a thin cream ring and
 * a white glyph. Static SVG; every motion around it is a transform/opacity on a wrapper. Real art replaces this
 * component's body when it exists.
 */
export const AncientFace = memo(function AncientFace({ id, className }: { id: AncientId; className?: string }) {
  const a = ANCIENTS[id];
  return (
    <svg className={`anc-face${className ? ` ${className}` : ''}`} viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="50" fill={a.color} />
      <circle cx="50" cy="50" r="43" fill="none" stroke="#fffaf0" strokeOpacity="0.85" strokeWidth="2" />
      <text x="50" y="52" textAnchor="middle" dominantBaseline="central" fontSize="40" fill="#ffffff">{`${a.glyph}︎`}</text>
    </svg>
  );
});
