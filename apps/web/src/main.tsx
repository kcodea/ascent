import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import gsap from 'gsap';
import { Boot, Game } from '@game/ui';
// SELF-HOSTED FONTS (2026-09-03). They came from Google Fonts with `display=swap` — text painted in the
// fallback and re-flowed as each face arrived (a first-use hitch on every screen that used a new weight),
// and the desktop exe ran on fallback fonts whenever it had no internet. Vite bundles the woff2 files; the
// boot loader (`preloadFonts`) then loads every face below before the menu opens. Keep this list in step with
// `FONT_FACES` in packages/ui/src/fontsPreload.ts — fontsPreload.test.ts pins the two together.
import '@fontsource/outfit/400.css';
import '@fontsource/outfit/500.css';
import '@fontsource/outfit/600.css';
import '@fontsource/outfit/700.css';
import '@fontsource/outfit/800.css';
import '@fontsource/outfit/900.css';
import '@fontsource/nunito-sans/400.css';
import '@fontsource/nunito-sans/600.css';
import '@fontsource/nunito-sans/700.css';
import '@fontsource/cinzel-decorative/400.css';
import '@fontsource/cinzel-decorative/700.css';
import '@fontsource/cinzel-decorative/900.css';

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
