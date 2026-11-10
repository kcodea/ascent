/**
 * THE COMPENDIUM under the APP SHELL (party home prototype, DEV only; owner 2026-11-02: "all of these menus should get
 * revamped to work with the new setup", "take a lot of inspiration from valorant's menus"). On the menus with the switch on,
 * the Compendium is a PAGE under the top nav instead of the ornate overlay window: `MinionBook` hands its parts (subtitle,
 * search + card size, body) to `PhCompendium`, which frames them in the kit's `PhPage` (Valorant's collection screen: the
 * header with the view tabs, the filter row, the category rail on the left, the gallery). Every filter, view and state is
 * still the book's own (MinionBook.tsx); only the framing and the paint change (phCompendium.css). In a game, the book is
 * the overlay as before.
 *
 * `PhCompendium` is the page CONTENT (a `PhPage`). Loading this module registers it with the shell's Compendium route
 * (shellStore `setCompendiumPage`); PhBookNav mounts it under the top nav with the Compendium tab lit. MinionBook loads this
 * module (and renders `PhCompendiumMount`, which is nothing) when the switch is on and the player is on the menus.
 *
 * IN A GAME (owner 2026-11-04: "fix the in game compendium to match the menu compendium as well"): `PhCompendiumOverlay`, the
 * same page over the match, with Back like every in-game page and no nav. Run scoping and live text are the book's own, unchanged. The
 * shell's stylesheet keys off `html[data-ph-shell]`, which a run drops; the overlay is opaque and full screen, so it wears
 * that attribute only while it is open. Nothing about the game underneath can show, and it comes off on close.
 */
import { useEffect, useLayoutEffect, useMemo } from 'react';
import { MinionBook, type CompendiumView } from '../../MinionBook';
import { isPhone } from '../../deviceClass';
import { sfx } from '../../sfx';
import { isPreRun, useGame } from '../../store';
import { PhPage, PhTabs } from '../kit';
import { PhBackdrop } from '../shell/PhBackdrop';
import { phBack } from '../shell/phHistory';
import { PhBackContext } from '../shell/PhPageGuard';
import { setCompendiumPage } from '../shell/shellStore';
import { usePhLayer } from '../shell/usePhLayer';
import './phCompendium.css';

const VIEWS: readonly { id: CompendiumView; label: string }[] = [
  { id: 'cards', label: 'Cards' },
  { id: 'glossary', label: 'Glossary' },
  { id: 'rules', label: 'Rules' },
  { id: 'guides', label: 'Guides' },
];

/** The Compendium as a page's content: the kit page with the book's views as tabs and its Set, search and card size as actions. */
export function PhCompendium() {
  // Hover previews portal to <body> under the page's layer: they lift over it while the book is up.
  useEffect(() => {
    document.documentElement.setAttribute('data-ph-book', '');
    return () => document.documentElement.removeAttribute('data-ph-book');
  }, []);
  return (
    <MinionBook frame={({ subtitle, controls, body, view, pickView, codex }) => (
      <PhPage className="phb" wide title="Compendium"
        tabs={<>
          <PhTabs label="Compendium views" value={view} onChange={(v) => { sfx.tick(); pickView(v); }} tabs={VIEWS} />
          {/* The live count / view line sits beside the tabs, so the page keeps the one standard header. */}
          {/* No visible count line on any view (owner 2026-11-06: "remove this"); kept for screen readers only. */}
          <p className="phb-sub phb-srsub" aria-live="polite">{subtitle}</p>
        </>}
        actions={codex ? undefined : <div className="phb-actions">
          {controls}
        </div>}>
        {/* `.book` carries the surface tokens the real cards read (compendium.css); `.phb` repaints everything else. */}
        <div className={`book phb-book v-${view}`}>{body}</div>
      </PhPage>
    )} />
  );
}

/** The page over a match. Esc and Tab close it through the game's own listeners (Tab: compendiumHotkey.ts). */
export function PhCompendiumOverlay() {
  const closeBook = useGame((s) => s.closeBook);
  usePhLayer(true, closeBook);
  const back = useMemo(() => ({ label: 'Back', onClick: (): void => { if (!phBack()) closeBook(); } }), [closeBook]);
  useLayoutEffect(() => {
    const html = document.documentElement;
    html.setAttribute('data-ph-shell', '');
    const h = window.innerHeight;
    html.style.setProperty('--ph-h', `${h}px`);
    html.toggleAttribute('data-ph-compact', isPhone() || h < 700);
    html.toggleAttribute('data-ph-laptop', h <= 900);
    return () => {
      if (isPreRun(useGame.getState())) return; // back on the menus: the title owns these now
      html.removeAttribute('data-ph-shell'); html.removeAttribute('data-ph-compact'); html.removeAttribute('data-ph-laptop'); html.style.removeProperty('--ph-h');
    };
  }, []);
  return (
    <div className="ph-bookpage phb-ov" role="dialog" aria-label="Compendium. Press Esc or Tab to close.">
      <div className="ph-pagebd" aria-hidden="true"><PhBackdrop /></div>
      <PhBackContext.Provider value={back}><PhCompendium /></PhBackContext.Provider>
    </div>
  );
}

setCompendiumPage(PhCompendium);

/** What MinionBook mounts on the menus under the shell: nothing (the import above did the work). */
export function PhCompendiumMount(): null { return null; }
