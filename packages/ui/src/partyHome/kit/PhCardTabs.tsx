/**
 * THE TABS UNDER YOUR CARD (kit; showcase player card spec "The four tabs on your card"): Avatar · Frame · Title · Card
 * plate, hanging centred below your own card like folder tabs. Each shows a tiny version of what you wear: your avatar
 * (round), your frame (the ring on its own, no avatar inside), a dot in your title's rarity colour, your card plate.
 * Pressing one opens the cosmetics window on that tab (`onOpen`).
 *
 *   <PhShowcaseCard ... under={<PhCardTabs ... />} />   inside a `.phs-lineup.phs-tabbed` row, which reserves their height
 *
 * A pointerdown on the tabs stops here, so in the Versus room (the card sits inside the seat's drag handle) a tab press never
 * starts a drag. Static paint; the hover lift is a one-shot transform. No native tooltip, no own cursor.
 */
import { memo, type PointerEvent as ReactPointerEvent } from 'react';
import { cosmeticOf } from '@game/progression';
import { frameSrc } from '../../portraitFrame/portraitFrameConfig';
import type { CosmeticsTab } from '../../cosmetics/cosmeticsPending';
import './phShowcase.css';

const TABS: readonly { id: CosmeticsTab; name: string }[] = [
  { id: 'avatar', name: 'Avatar' }, { id: 'frame', name: 'Frame' }, { id: 'title', name: 'Title' }, { id: 'plate', name: 'Card plate' },
];

const stop = (e: ReactPointerEvent): void => e.stopPropagation();

export interface PhCardTabsProps {
  avatarSrc?: string; frameId: string | null; titleId: string | null; plateThumb?: string;
  onOpen: (tab: CosmeticsTab) => void;
}

export const PhCardTabs = memo(function PhCardTabs({ avatarSrc, frameId, titleId, plateThumb, onOpen }: PhCardTabsProps): JSX.Element {
  const ring = frameSrc(frameId ?? 'default');
  const rarity = titleId ? cosmeticOf(titleId)?.rarity : undefined;
  const thumb = (id: CosmeticsTab): JSX.Element => {
    if (id === 'avatar') return <span className="phs-tthumb phs-tavatar">{avatarSrc && <img src={avatarSrc} alt="" draggable={false} decoding="sync" />}</span>;
    if (id === 'frame') return <span className="phs-tthumb phs-tframe">{ring && <img src={ring} alt="" draggable={false} decoding="sync" />}</span>;
    if (id === 'title') return <span className="phs-tthumb phs-ttitle"><i className={`phs-tdot${rarity ? ` r-${rarity}` : ''}`} /></span>;
    return <span className="phs-tthumb phs-tplate">{plateThumb ? <img src={plateThumb} alt="" draggable={false} decoding="sync" /> : <i className="phs-tplain" />}</span>;
  };
  return (
    <div className="phs-tabs" role="group" aria-label="Customize your card" onPointerDown={stop}>
      {TABS.map((t) => (
        <button key={t.id} type="button" className={`phs-tab phs-tab-${t.id}`} aria-label={`${t.name}. Change it`} onClick={() => onOpen(t.id)}>
          <span aria-hidden="true">{thumb(t.id)}</span>
          <span className="phs-tablbl" aria-hidden="true">{t.name}</span>
        </button>
      ))}
    </div>
  );
});
