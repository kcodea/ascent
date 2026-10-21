/**
 * A Versus room member as a REAL game card (owner 2026-10-16: "make the players actually show as cards"; spectators
 * too: "spectators should show as cards in hand so you can mouse over to view their cards too"). The game's own `Card`,
 * plated like a hand card, in the member's equipped CARD PLATE (`CardPlateContext`, the same context every skin scope
 * provides): their portrait as the art, their name on the name line, their title as the text, Versus wins in the Attack
 * badge and losses in the Health badge (the normal badges, milestone frames and big-number fit included). What it says
 * is built in `versusSeatCard.ts`. Static: no animation of its own, no hover popup, and it never opens Inspect (a click
 * or right-click on it does nothing). Always drawn at the seat card's size: in the room a hand card is this same card
 * scaled down by its transform (R-VERSUS-ROOM-MOUNTED-01), so a move between a seat and the hand never re-lays it out.
 */
import { memo, useMemo, type SyntheticEvent } from 'react';
import { Card, type CardView } from '../Card';
import { Icon } from '../Icon';
import { CardPlateContext, cardPlateLookOf } from '../cardPlate/cardPlateLook';
import { currentUserId } from '../identity';
import { mirrorFor, useProgression } from '../progression/progressionStore';
import { useLiveLoadout } from '../skins/skins';
import { useGame } from '../store';
import { PLAYER_CARD_ID, playerCardView, seatCardSource, type SeatServerData } from './versusSeatCard';
import type { VersusMember } from './versusRemote';

const swallow = (e: SyntheticEvent): void => { e.preventDefault(); e.stopPropagation(); };

export const VersusPlayerCard = memo(function VersusPlayerCard({ m, server, host = false }: { m: Pick<VersusMember, 'userId' | 'displayName' | 'profile'>; server: SeatServerData | undefined; host?: boolean }) {
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
    <div className={`vspcard-hold${src.record ? '' : ' vspcard-norec'}`} onClickCapture={swallow} onContextMenuCapture={swallow} data-versus-card={m.userId}
      aria-label={src.record ? `${src.name}: ${view.attack} Versus wins, ${view.health} losses` : `${src.name}: Versus record loading`} role="img">
      <CardPlateContext.Provider value={plate}>
        <Card card={view} forceFull suppressPop plated />
      </CardPlateContext.Provider>
      {/* THE HOST (owner 2026-10-21: "mark the host with a small crown ON the card's name plate"): the game's crown icon
          in the plate's top slot, instead of a Host pill under the card. */}
      {host && <span className="vshostmark" aria-label="Host"><Icon name="crown" /></span>}
    </div>
  );
});

/** The OPEN SEAT placeholder: the same plated card, on the standard plate, dimmed, with no art and no badges. */
const EMPTY_VIEW: CardView = { name: 'Open seat', cardId: PLAYER_CARD_ID, tribe: 'neutral', attack: 0, health: 0, keywords: [], text: 'Waiting for a player' };
/** `hint` replaces the text when the viewer can take the seat (owner 2026-10-21: the empty seat says how to fight). */
export const VersusEmptySeatCard = memo(function VersusEmptySeatCard({ hint, gone = false }: { hint?: string | undefined; gone?: boolean }) {
  const view = useMemo(() => (hint ? { ...EMPTY_VIEW, text: hint } : EMPTY_VIEW), [hint]);
  return (
    <div className={`vspcard-hold vspcard-empty${gone ? ' gone' : ''}`} onClickCapture={swallow} onContextMenuCapture={swallow} aria-hidden="true">
      <CardPlateContext.Provider value={null}>
        <Card card={view} forceFull suppressPop plated />
      </CardPlateContext.Provider>
    </div>
  );
});
