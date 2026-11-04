/**
 * HERO SELECT IN THE PARTY HOME's LANGUAGE (party home prototype, DEV only; the "Party home (prototype)" switch).
 *
 * Owner 2026-11-02: every menu moves to the party-first shell, "modern, whimsical, bubbly high fantasy". Hero select is
 * the screen right after START, so it wears the shell's ONE backdrop (the same painted ground as the home, so START
 * flows straight into the pick) and its look: the hero offers are banners like the party's (the painted rod, the navy
 * cloth with gold side trim, the swallowtail foot), heavy rounded type, pill buttons.
 *
 * This module is the skin only: it mounts the backdrop and carries the stylesheet (`heroSelectPh.css`, every rule
 * scoped under `.heroselect.phhs`). HeroSelect loads it lazily, so a production build never ships either. The screen's
 * markup, behaviour and ceremony are the shipped ones; with the switch off nothing here is loaded.
 */
import { useEffect, useRef } from 'react';
import { PhBackdrop } from '../partyHome/shell/PhBackdrop';
import '../partyHome/shell/shell.css';
import '../partyHome/partyHome.css';
import './heroSelectPh.css';

/**
 * THE FIT. On a phone the stage lays the page out at its design size and the browser's viewport meta scales it down. If
 * the browser ignores that meta, the game still measures the design size (`--lvw`) while the real page stays at the
 * screen's width, so every size here came out about three times too big. The screen then scales itself by that ratio
 * (the same scale the stage asked for), measured on mount and on a resize, never per frame. Everywhere else it is 1.
 */
export function pageFitZoom(pageScaled: boolean, stageW: number, realW: number): number {
  if (!pageScaled || !(stageW > 0) || !(realW > 0)) return 1;
  const r = realW / stageW;
  return r < 0.9 ? r : 1;
}

export default function HeroSelectPhSkin() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current?.parentElement;
    if (!root) return undefined;
    const de = document.documentElement;
    const fit = (): void => {
      const stageW = parseFloat(de.style.getPropertyValue('--lvw'));
      const z = pageFitZoom(de.hasAttribute('data-page-scale'), stageW, window.innerWidth);
      if (z === 1) root.style.removeProperty('zoom'); else root.style.setProperty('zoom', String(z));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => { window.removeEventListener('resize', fit); root.style.removeProperty('zoom'); };
  }, []);
  return <div ref={ref} className="hsph-bd" aria-hidden="true"><PhBackdrop /></div>;
}
