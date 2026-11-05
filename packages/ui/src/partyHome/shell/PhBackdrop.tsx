/**
 * THE SHELL's ONE STEADY BACKDROP (owner 2026-11-04: "it'll flash the old background and it's very jarring and gross", then
 * "i think i like the citadel backdrop more"). The title's citadel, pre-blurred and darkened at build time (no runtime
 * filter). `Game` mounts it ONCE, under everything, for as long as the menus are up: pages and the party home are transparent
 * over it and never bring their own, so moving between them cannot swap or unmount it, and a page that is still loading (or
 * never loads) shows this and nothing else. Eager and styled inline: it must paint before any lazy chunk or its stylesheet.
 * The art is in the boot gate's first lane (`backdrops/` in preloadPlan.ts), so it is decoded before the shell's first paint.
 */
import { useLayoutEffect, type CSSProperties } from 'react';
import { phonePublicUrl } from '../../phoneArt';
import { anyPageOpen, useGame } from '../../store';

const CITADEL = phonePublicUrl('backdrops/citadel-blur.webp', import.meta.env.BASE_URL);
const FILL: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%' };
const VEIL = 'linear-gradient(180deg, rgba(6, 12, 28, 0.82) 0%, rgba(6, 12, 28, 0.58) 26%, rgba(6, 12, 28, 0.42) 60%, rgba(6, 12, 28, 0.88) 100%), radial-gradient(70% 70% at 45% 50%, transparent 0%, rgba(4, 8, 20, 0.5) 100%)';

/**
 * `steady`: the one `Game` mounts. It also owns the pages' dim (a page's own layer would vanish with the page for a frame), and
 * sits under hero select (z 400) as well as the menus (z 450+), so the art stays through every move between them.
 */
export function PhBackdrop({ steady = false, over = false }: { steady?: boolean;
  /** Over a game: above the board and the in-game menu's veil, under the page. */
  over?: boolean }) {
  const paged = useGame((s) => anyPageOpen(s) || s.showBook);
  useLayoutEffect(() => {
    if (!steady) return undefined;
    document.documentElement.setAttribute('data-ph-steady', '');
    return () => document.documentElement.removeAttribute('data-ph-steady');
  }, [steady]);
  return (
    <div className="ph-steady" aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: over ? 466 : 390, background: '#0a1730', pointerEvents: 'none', overflow: 'hidden' }}>
      <img src={CITADEL} alt="" draggable={false} decoding="sync" style={{ ...FILL, objectFit: 'cover' }} />
      <div style={{ ...FILL, background: VEIL }} />
      {steady && <div style={{ ...FILL, background: 'rgba(6, 12, 28, 0.45)', opacity: paged ? 1 : 0, transition: 'opacity 0.16s ease-out' }} />}
    </div>
  );
}
