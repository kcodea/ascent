import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import gsap from 'gsap';
import { Boot, Game } from '@game/ui';

// A main-thread frame hitch (a Pixi FX burst, GC, a heavy render) makes GSAP apply the whole missed
// delta on its next tick — JUMPING an in-flight lunge past its motion, so the swing snaps home unseen
// while its contact-anchored callbacks (the beat advance + impact FX) still fire ("the lunge doesn't
// show but its effect does"). GSAP's default lagSmoothing only clamps stalls > 500ms; ours are ~50-80ms,
// so they sail through and jump. Clamp anything over ~3 frames to a single frame's worth so a spike can't
// skip the visible lunge — the advance stays welded to the contact the player actually sees. This does NOT
// touch the beat clock (real-time setTimeout) or the deterministic log; it only bounds GSAP's catch-up.
gsap.ticker.lagSmoothing(50, 33);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

// Disable the browser context menu — right-click does nothing in-game.
window.addEventListener('contextmenu', (e) => e.preventDefault());

createRoot(root).render(
  <StrictMode>
    <Boot>
      <Game />
    </Boot>
  </StrictMode>,
);
