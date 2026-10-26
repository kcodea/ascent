/**
 * THE MENU BACKDROP (UI refinement WS-1, 2026-10-16) — one shared painted layer behind every menu screen that wears
 * the menu sidebar: the mode picker (and its Learn / Gauntlet / Versus views), Career, Leaderboard, Hall of
 * Champions, Recent Games, Live Games and Collection. `MenuSidebar` mounts it, so every host gets it for free.
 *
 * EACH SCREEN PICKS ITS OWN PLATE from `MENU_BACKDROPS`. Today they all show the great hall (owner art 2026-10-16):
 * slightly softened on the mode picker (`hall-soft.webp`), the pre-blurred + pre-darkened copy on the data screens, so panels and rows sit on a
 * calm ground. When a screen's own painting lands, run `node scripts/build-menu-backdrop.mjs <art> <name>` and point
 * that screen's entry at `<name>.webp` (a scene) or `<name>-dim.webp` (a data screen). Nothing else changes.
 *
 * PERF: nothing here runs per frame. The blur and the darkening are baked into the files (no runtime `filter` or
 * `backdrop-filter`); the vignette is a static gradient; the only motion is a one-shot opacity crossfade when the
 * plate CHANGES between two screens (the old plate stays underneath while the new one fades in). Nothing loops, so
 * there is nothing to pause when the window loses focus. Reduced motion drops the crossfade (styles.css).
 */
import { useEffect, useState } from 'react';
import { FadeImg } from './FadeImg';
import { phonePublicUrl } from './phoneArt';
import { PHONE_DIAG } from './phoneDiag';
import { crumb } from './crashLog';

export type MenuScreen = 'modes' | 'career' | 'rankings' | 'hall' | 'recent' | 'live' | 'collection' | 'friends';

/** `scene`: the painting is the point (a light vignette). `data`: the screen is rows and panels (a deeper veil). */
export type BackdropVeil = 'scene' | 'data';
export interface BackdropPlate { src: string; veil: BackdropVeil }

// Public art carries BASE_URL (itch serves the game from a CDN sub-path; see publicAssetPaths.test.ts).
const BASE = import.meta.env.BASE_URL;
// A phone loads the 1280-wide copy of a plate (phoneArt.ts `phonePublicCap`); desktop gets `${BASE}backdrops/...`.
const plateSrc = (file: string): string => phonePublicUrl(`backdrops/${file}`, BASE);
// The Mode screen's hall carries a SLIGHT pre-baked blur so its tiles pop (owner 2026-10-16: "add a slight blur to the
// background play image"); `hall.webp` (crisp) stays built for a screen that wants the painting sharp.
const HALL_SOFT: BackdropPlate = { src: plateSrc('hall-soft.webp'), veil: 'scene' };
const HALL_DIM: BackdropPlate = { src: plateSrc('hall-dim.webp'), veil: 'data' };

/** Which plate each screen paints. Swap an entry when that screen's own art arrives. */
export const MENU_BACKDROPS: Record<MenuScreen, BackdropPlate> = {
  modes: HALL_SOFT,
  career: HALL_DIM,
  rankings: HALL_DIM,
  hall: HALL_DIM,
  recent: HALL_DIM,
  live: HALL_DIM,
  collection: HALL_DIM,
  friends: HALL_DIM,
};

// The plate the last mounted backdrop painted. A sidebar hop unmounts one host and mounts the next in the same
// store write, so this is how the new layer knows what was on screen a moment ago (and whether to crossfade).
let lastSrc: string | null = null;

export function MenuBackdrop({ screen }: { screen: MenuScreen }) {
  const plate = MENU_BACKDROPS[screen];
  // Frozen at mount: the plate that was showing before this one, when it differs. Only a SCENE -> DATA change
  // crossfades (the sharp hall blurs away under a page, the old plate opaque underneath the whole time). Coming BACK to
  // the sharp hall cuts straight to it: fading the sharp plate in over the blurred one read as a dark, blurry flash
  // on Career -> Play (owner 2026-10-16), and the sharp plate is already decoded behind the boot gate.
  const [prev] = useState(() => (lastSrc && lastSrc !== plate.src && plate.veil === 'data' ? lastSrc : null));
  useEffect(() => { lastSrc = plate.src; }, [plate.src]);
  // The phone diagnostics `litebd` switch (phoneDiag.ts): no painted plate, only the veil over a flat ground.
  if (PHONE_DIAG.litebd) return <div className="mbd mbd-lite" data-screen={screen} aria-hidden="true"><div className="mbd-veil" data-veil={plate.veil} /></div>;
  return (
    <div className="mbd" data-screen={screen} aria-hidden="true">
      {prev && <img className="mbd-img" src={prev} alt="" decoding="sync" draggable={false} />}
      <FadeImg className={`mbd-img${prev ? ' mbd-in' : ''}`} src={plate.src} alt="" draggable={false} onLoad={() => crumb(`backdrop loaded ${screen}`)} />
      <div className="mbd-veil" data-veil={plate.veil} />
    </div>
  );
}
