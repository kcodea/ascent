/**
 * A Versus room seat as a REAL game card (owner 2026-10-16: "make the players actually show as cards"). The game's own
 * `Card`, plated like a hand card, in the seat holder's equipped CARD PLATE (`CardPlateContext`, the same context every
 * skin scope provides): their portrait as the art, their name on the name line, their title as the text, Versus wins in
 * the Attack badge and losses in the Health badge (the normal badges, milestone frames and big-number fit included).
 * What it says is built in `versusSeatCard.ts`. Static: no animation of its own, no hover popup, and it never opens
 * Inspect (a click or right-click on it does nothing).
 */
import { memo, useMemo, type SyntheticEvent } from 'react';
import { Card } from '../Card';
import { CardPlateContext, cardPlateLookOf } from '../cardPlate/cardPlateLook';
import { currentUserId } from '../identity';
import { mirrorFor, useProgression } from '../progression/progressionStore';
import { useLiveLoadout } from '../skins/skins';
import { useGame } from '../store';
import { playerCardView, seatCardSource, type SeatServerData } from './versusSeatCard';
import type { VersusMember } from './versusRemote';

const swallow = (e: SyntheticEvent): void => { e.preventDefault(); e.stopPropagation(); };

export const VersusPlayerCard = memo(function VersusPlayerCard({ m, server }: { m: VersusMember; server: SeatServerData | undefined }) {
  const own = m.userId === currentUserId();
  const showOpp = useGame((s) => s.showOpponentSkins);
  const myAvatar = useGame((s) => s.playerAvatar);
  const myTitle = useProgression((s) => mirrorFor(currentUserId(), s.mirror)?.equippedTitleId ?? null);
  const myLoadout = useLiveLoadout();
  const src = useMemo(
    () => seatCardSource({ member: m, own, showOpp, server, ...(own ? { self: { avatar: myAvatar ?? null, titleId: myTitle, cosmetics: myLoadout } } : {}) }),
    [m, own, showOpp, server, myAvatar, myTitle, myLoadout],
  );
  // Stable per content, so the memoised Card skips re-rendering on unrelated room updates.
  const view = useMemo(() => playerCardView(src), [src]);
  const plate = cardPlateLookOf(src.cosmetics);
  return (
    <div className="vspcard-hold" onClickCapture={swallow} onContextMenuCapture={swallow} data-versus-card={m.userId}
      aria-label={`${src.name}: ${view.attack} Versus wins, ${view.health} losses`} role="img">
      <CardPlateContext.Provider value={plate}>
        <Card card={view} forceFull suppressPop plated />
      </CardPlateContext.Provider>
    </div>
  );
});
