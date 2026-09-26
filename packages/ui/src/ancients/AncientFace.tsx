import { memo } from 'react';
import { ANCIENTS, type AncientId } from '@game/sim';
import { ancientArt, ancientPowerArt } from '../art';
import { ancientColor } from './ancientsConfig';

/**
 * An Ancient's face. `variant`:
 *  · `full`  — the full Ancient art (the offer and preview cards), `art/ancients/<id>.webp`;
 *  · `power` — the hero-power-button art (revealed through the crack), `art/ancients/<id>_power.webp`.
 * An Ancient with no art yet (War, Genesis, Time as of 2026-09-25) falls back to the PLACEHOLDER emblem: a flat disc
 * in the Ancient's colour, a thin cream ring and a white glyph (owner ruling 4: "clearly placeholder").
 */
export const AncientFace = memo(function AncientFace({ id, className, variant = 'full' }: { id: AncientId; className?: string; variant?: 'full' | 'power' }) {
  const src = variant === 'power' ? ancientPowerArt(id) : ancientArt(id);
  const cls = `anc-face${className ? ` ${className}` : ''}`;
  if (src) return <img decoding="sync" className={`${cls} anc-face-img`} src={src} alt="" aria-hidden="true" draggable={false} />;
  const a = ANCIENTS[id];
  return (
    <svg className={`${cls} anc-face-emblem`} viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="50" fill={ancientColor(id)} />
      <circle cx="50" cy="50" r="43" fill="none" stroke="#fffaf0" strokeOpacity="0.85" strokeWidth="2" />
      <text x="50" y="52" textAnchor="middle" dominantBaseline="central" fontSize="40" fill="#ffffff">{`${a.glyph}︎`}</text>
    </svg>
  );
});

/** Does this Ancient have real art (so its card drops the "placeholder art" caption)? */
export const hasAncientArt = (id: AncientId): boolean => !!ancientArt(id);
