/**
 * THE TABS UNDER YOUR CARD (kit; showcase player card spec "The four tabs on your card"): Avatar · Frame · Title · Card
 * plate, hanging centred below your own card like folder tabs. Each shows a tiny version of what you wear: your avatar
 * (round), your frame (the ring on its own, no avatar inside), your card plate. The Title tab wears the painted Titles
 * medallion, the Collection's own (owner 2026-11-24: "replace the red dot with the title medallion").
 * Pressing one opens the cosmetics window on that tab (`onOpen`).
 *
 *   <PhShowcaseCard ... under={<PhCardTabs ... />} />   inside a `.phs-lineup.phs-tabbed` row, which reserves their height
 *
 * A pointerdown on the tabs stops here, so in the Versus room (the card sits inside the seat's drag handle) a tab press never
 * starts a drag. Static paint; the hover lift is a one-shot transform. No native tooltip, no own cursor.
 */
import { memo, type PointerEvent as ReactPointerEvent } from 'react';
import { frameSrc } from '../../portraitFrame/portraitFrameConfig';
import type { CosmeticsTab } from '../../cosmetics/cosmeticsPending';
import { sfx } from '../../sfx';
import { MenuMedal } from '../../menuIcons';
import './phShowcase.css';

const TABS: readonly { id: CosmeticsTab; name: string }[] = [
  { id: 'avatar', name: 'Avatar' }, { id: 'frame', name: 'Frame' }, { id: 'title', name: 'Title' }, { id: 'plate', name: 'Card plate' },
];

/** A press on a tab stops here, so the Versus room never starts a drag or opens the seat menu from one. That also hides the
 *  press from the app-wide click sound (Game.tsx listens on `window`), so the tab plays the same "thock" itself, on the same
 *  terms: a click, not a tap (R-SFX-STOPPED-PRESS-01). */
const press = (e: ReactPointerEvent): void => {
  e.stopPropagation();
  if (e.pointerType !== 'touch' && (e.target as Element).closest('.phs-tab')) sfx.clickThock();
};

export interface PhCardTabsProps {
  avatarSrc?: string; frameId: string | null; plateThumb?: string;
  onOpen: (tab: CosmeticsTab) => void;
}

export const PhCardTabs = memo(function PhCardTabs({ avatarSrc, frameId, plateThumb, onOpen }: PhCardTabsProps): JSX.Element {
  const ring = frameSrc(frameId ?? 'default');
  const thumb = (id: CosmeticsTab): JSX.Element => {
    if (id === 'avatar') return <span className="phs-tthumb phs-tavatar">{avatarSrc && <img src={avatarSrc} alt="" draggable={false} decoding="sync" />}</span>;
    if (id === 'frame') return <span className="phs-tthumb phs-tframe">{ring && <img src={ring} alt="" draggable={false} decoding="sync" />}</span>;
    if (id === 'title') return <span className="phs-tthumb phs-ttitle"><MenuMedal name="titles" className="phs-tmedal" /></span>;
    return <span className="phs-tthumb phs-tplate">{plateThumb ? <img src={plateThumb} alt="" draggable={false} decoding="sync" /> : <i className="phs-tplain" />}</span>;
  };
  return (
    <div className="phs-tabs" role="group" aria-label="Customize your card" onPointerDown={press}>
      {TABS.map((t) => (
        <button key={t.id} type="button" className={`phs-tab phs-tab-${t.id}`} aria-label={`${t.name}. Change it`} onClick={() => onOpen(t.id)}>
          <span aria-hidden="true">{thumb(t.id)}</span>
          <span className="phs-tablbl" aria-hidden="true">{t.name}</span>
        </button>
      ))}
    </div>
  );
});
