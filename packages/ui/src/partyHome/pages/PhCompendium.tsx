/**
 * THE COMPENDIUM under the APP SHELL (party home prototype, DEV only; owner 2026-11-02: "all of these menus should get
 * revamped to work with the new setup", "take a lot of inspiration from valorant's menus"). On the menus with the switch on,
 * the Compendium is a PAGE under the top nav instead of the ornate overlay window: `MinionBook` hands its parts (subtitle,
 * search + card size, body) to `PhCompendium`, which frames them in the kit's `PhPage` (Valorant's collection screen: the
 * header with the view tabs, the filter row, the category rail on the left, the gallery). Every filter, view and state is
 * still the book's own (MinionBook.tsx); only the framing and the paint change (phCompendium.css). In a game, the book is
 * the overlay as before.
 *
 * `PhCompendium` is the page CONTENT (a `PhPage`). The shell mounts it in its Compendium route: MinionBook renders it in
 * `.book-ov`, which shell.css places under the top nav (PhBookNav lights the Compendium tab and closes the book on a hop).
 */
import { MinionBook, type CompendiumView } from '../../MinionBook';
import { sfx } from '../../sfx';
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
