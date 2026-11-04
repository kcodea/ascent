/**
 * THE SHELL's ONE STEADY BACKDROP (owner 2026-11-04: "it'll flash the old background and it's very jarring and gross", then
 * "i think i like the citadel backdrop more"). The title's citadel, pre-blurred and darkened at build time (no runtime
 * filter). `Game` mounts it ONCE, under everything, for as long as the menus are up: pages and the party home are transparent
 * over it and never bring their own, so moving between them cannot swap or unmount it, and a page that is still loading (or
 * never loads) shows this and nothing else. Eager and styled inline: it must paint before any lazy chunk or its stylesheet.
 * The art is in the boot gate's first lane (`backdrops/` in preloadPlan.ts), so it is decoded before the shell's first paint.
 */
import type { CSSProperties } from 'react';
import { phonePublicUrl } from '../../phoneArt';

const CITADEL = phonePublicUrl('backdrops/citadel-blur.webp', import.meta.env.BASE_URL);
const FILL: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%' };
const VEIL = 'linear-gradient(180deg, rgba(6, 12, 28, 0.82) 0%, rgba(6, 12, 28, 0.58) 26%, rgba(6, 12, 28, 0.42) 60%, rgba(6, 12, 28, 0.88) 100%), radial-gradient(70% 70% at 45% 50%, transparent 0%, rgba(4, 8, 20, 0.5) 100%)';

export function PhBackdrop() {
  return (
    <div className="ph-steady" aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: 440, background: '#0a1730', pointerEvents: 'none', overflow: 'hidden' }}>
      <img src={CITADEL} alt="" draggable={false} decoding="sync" style={{ ...FILL, objectFit: 'cover' }} />
      <div style={{ ...FILL, background: VEIL }} />
    </div>
  );
}
