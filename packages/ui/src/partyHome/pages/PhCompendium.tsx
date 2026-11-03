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
 */
import { MinionBook, type CompendiumView } from '../../MinionBook';
import { sfx } from '../../sfx';
import { PhPage, PhTabs } from '../kit';
import { setCompendiumPage } from '../shell/shellStore';
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
      <PhPage className="phc" wide title="Compendium"
        tabs={<PhTabs label="Compendium views" value={view} onChange={(v) => { sfx.tick(); pickView(v); }} tabs={VIEWS} />}
        actions={codex ? undefined : <div className="phc-actions">{controls}</div>}>
        {/* `.book` carries the surface tokens the real cards read (compendium.css); `.phc` repaints everything else. */}
        {/* The live count / view line sits at the top of the body, so the header keeps the one standard height. */}
        <p className="phc-sub" aria-live="polite">{subtitle}</p>
        <div className={`book phc-book v-${view}`}>{body}</div>
      </PhPage>
    )} />
  );
}

setCompendiumPage(PhCompendium);

/** What MinionBook mounts on the menus under the shell: nothing (the import above did the work). */
export function PhCompendiumMount(): null { return null; }
