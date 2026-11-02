/**
 * THE COMPENDIUM under the APP SHELL (party home prototype, DEV only; owner 2026-11-02: "all of these menus should get
 * revamped to work with the new setup", "take a lot of inspiration from valorant's menus"). On the menus with the switch on,
 * the Compendium is a PAGE under the top nav instead of the ornate overlay window: `MinionBook` hands its parts (subtitle,
 * search + card size, body) to `PhCompendium`, which frames them in the kit's `PhPage` (Valorant's collection screen: the
 * header with the view tabs, the filter row, the category rail on the left, the gallery). Every filter, view and state is
 * still the book's own (MinionBook.tsx); only the framing and the paint change (phCompendium.css). In a game, the book is
 * the overlay as before.
 *
 * `PhCompendium` is the page CONTENT (a `PhPage`), so the shell's router can mount it in its own host. `PhCompendiumHost`
 * is a stand-in host until that route lands: the lbpage + top nav, where a press on any other nav entry goes there and
 * closes the book (the Compendium tab itself stays put).
 */
import type { MouseEvent } from 'react';
import { MinionBook, type CompendiumView } from '../../MinionBook';
import { MenuBackdrop } from '../../MenuBackdrop';
import { MenuSidebar, SidebarHost } from '../../MenuSidebar';
import { sfx } from '../../sfx';
import { useGame } from '../../store';
import { PhPage, PhTabs } from '../kit';
import './phCompendium.css';

const VIEWS: readonly { id: CompendiumView; label: string }[] = [
  { id: 'cards', label: 'Cards' },
  { id: 'glossary', label: 'Glossary' },
  { id: 'rules', label: 'Rules' },
  { id: 'guides', label: 'Guides' },
];

/** The Compendium as a page's content: the kit page with the book's views as tabs and its search + card size as actions. */
export function PhCompendium() {
  return (
    <MinionBook frame={({ subtitle, controls, body, view, pickView, codex }) => (
      <PhPage className="phc" wide title="Compendium" eyebrow={subtitle}
        tabs={<PhTabs label="Compendium views" value={view} onChange={(v) => { sfx.tick(); pickView(v); }} tabs={VIEWS} />}
        actions={codex ? undefined : <div className="phc-actions">{controls}</div>}>
        {/* `.book` carries the surface tokens the real cards read (compendium.css); `.phc` repaints everything else. */}
        <div className={`book phc-book v-${view}`}>{body}</div>
      </PhPage>
    )} />
  );
}

/** The stand-in host (see the header): the top nav over the page; any other nav entry goes there and closes the book. */
export function PhCompendiumHost() {
  const closeBook = useGame((s) => s.closeBook);
  const navButton = (e: MouseEvent<HTMLDivElement>): HTMLButtonElement | null => {
    const btn = (e.target as HTMLElement).closest('button');
    return btn && btn.closest('.ph-top') ? btn : null;
  };
  // The Compendium tab is this page: pressing it does nothing (its own handler would toggle the book shut). Capture
  // phase, and no state change here: a state change in capture would re-render before the button's own handler runs.
  const onNavCapture = (e: MouseEvent<HTMLDivElement>): void => {
    const btn = navButton(e);
    if (btn?.classList.contains('ph-navtab') && btn.textContent?.trim() === 'Compendium') { e.stopPropagation(); e.preventDefault(); }
  };
  // Any other nav entry: its own handler has run (bubble phase), then the book closes.
  const onNav = (e: MouseEvent<HTMLDivElement>): void => { if (navButton(e)) closeBook(); };
  return (
    <SidebarHost className="lbpage ph-shellpage phc-host" onClickCapture={onNavCapture} onClick={onNav}>
      <MenuBackdrop screen="collection" />
      <MenuSidebar current={null} />
      <PhCompendium />
    </SidebarHost>
  );
}
