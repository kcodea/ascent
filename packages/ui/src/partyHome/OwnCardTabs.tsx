/**
 * YOUR CARD'S TABS, wired (showcase player card spec "The four tabs on your card"): the kit's `PhCardTabs` fed with what you
 * wear now (avatar, frame, title, card plate) and opening the cosmetics window on the tab pressed. Used on your own card on
 * the Play lineup and in the Versus room (`under={OWN_CARD_TABS}`).
 *
 * GUESTS get no tabs (they can't change their portrait or own cosmetics; spec "Calls I made"): this renders nothing for a
 * guest, and the cosmetics window refuses a guest anyway. Pair it with `useOwnCardTabbed()` for the row's `phs-tabbed`.
 *
 * `OWN_CARD_TABS` is one hoisted element: it reads the store itself, so the card's `under` prop never changes and
 * `PhShowcaseCard`'s memo holds.
 */
import { useCallback } from 'react';
import { cardPlateOf } from '@game/progression';
import { useGame } from '../store';
import { avatarSrc } from '../art';
import { sfx } from '../sfx';
import { mirrorFor, useProgression } from '../progression/progressionStore';
import { plateLookOf } from '../progression/CollectionScreen';
import { useOwnPortraitFrameId } from '../portraitFrame/PortraitFrame';
import type { CosmeticsTab } from '../cosmetics/cosmeticsPending';
import { PhCardTabs } from './kit/PhCardTabs';

/** True when your card carries the tabs (a signed-in account), so its row reserves their height. */
export function useOwnCardTabbed(): boolean {
  return useGame((s) => !s.account.anonymous);
}

function OwnCardTabs(): JSX.Element | null {
  const tabbed = useOwnCardTabbed();
  const userId = useGame((s) => s.account.userId);
  const avatar = useGame((s) => s.playerAvatar);
  const openCosmetics = useGame((s) => s.openCosmetics);
  const frameId = useOwnPortraitFrameId();
  const titleId = useProgression((s) => mirrorFor(userId, s.mirror)?.equippedTitleId ?? null);
  const plateThumb = useProgression((s) => (s.catalogEpoch >= 0 ? plateLookOf(cardPlateOf(mirrorFor(userId, s.mirror)?.loadout))?.thumb : undefined));
  const onOpen = useCallback((tab: CosmeticsTab) => { sfx.pulse(); openCosmetics(tab); }, [openCosmetics]);
  if (!tabbed) return null;
  return <PhCardTabs avatarSrc={avatarSrc(avatar)} frameId={frameId} titleId={titleId} plateThumb={plateThumb} onOpen={onOpen} />;
}

/** The tabs as one stable element, for a memoised card's `under`. */
export const OWN_CARD_TABS = <OwnCardTabs />;
