/**
 * HERO SELECT, WATCHED (owner 2026-10-26: "I want spectating to show up when a player goes into hero select. this should
 * work in all modes. hero select should be spectatable."; R-SPECTATE-HEROSELECT-01).
 *
 * The layer over the game that draws ANOTHER player's Hero Select with the real screen (`HeroSelect` in watch mode: their
 * three heroes, their re-roll, their pick and its ceremony, the Versus clock), read only. It shows:
 *  - for the STANDS (a Versus 1v1, Group or Duos spectator, or a Live Games watcher of a ranked lobby game): the watched
 *    player's Hero Select, from the moment they reach it until their first shop frame takes over (`spectate.ts`), with
 *    the spectator's own chrome over it (the Versus switcher and Leave; a live game's `LiveWatchBar` is already mounted);
 *  - for a seated VERSUS DUOS player (owner 2026-10-26: "in duos, the teammate's hero options should be visible as well.
 *    there should be teammate portrait in the bottom right, like it is in game, but have the player's portrait to be
 *    clickable and view the hero options so they can work together on who to pick"; R-DUOS-HEROSELECT-01): the
 *    teammate's portrait bottom right on their own Hero Select (the in-game `DuosMateDock`); clicking it shows the
 *    teammate's choices over theirs (the same cross-fade as the shop's teammate view), and their own portrait there brings
 *    them back. Their own Hero Select stays mounted, untouched, underneath.
 *
 * REUSE: anything that can hand `spectate.ts` a teammate's Hero Select frames gets this view as is (Ranked Duos' lobby
 * Hero Select: a `trackDuosMatch`-style feed of the teammate's seat and `enterTeammateHeroView`).
 */
import { HeroSelect } from '../HeroSelect';
import { useGame } from '../store';
import { DuosMateDock } from '../versus/DuosMateDock';
import { SpectatorBar } from '../versus/SpectatorBar';
import { useSpectate } from '../versus/spectate';
import { useTeammateViewKeys } from '../versus/teammateView';
import { mySeat, useVersus } from '../versus/versusStore';
import '../versus/versus.css';

export function HeroSelectWatch(): JSX.Element | null {
  const frame = useSpectate((s) => s.hero ?? null);
  const seat = useSpectate((s) => s.seat);
  const teammate = useSpectate((s) => s.teammateHero === true);
  const active = useSpectate((s) => s.active);
  // My own Hero Select is open under this one (a Duos player): it drives the clock and owns the ceremony's Pixi layer.
  const ownOpen = useGame((s) => s.heroChoices !== null);
  const ownVersus = useGame((s) => s.pendingMode === 'versus');
  // Primitives only (this layer is mounted in every mode; a match row update must not re-render it for nothing).
  const inMatch = useVersus((s) => !!s.match && s.match.phase !== 'complete');
  const seated = useVersus((s) => !!s.match && !!mySeat(s.match));
  const duosMatch = useVersus((s) => !!s.match?.group?.duos);
  // A seated Duos player on their own Hero Select: the teammate's portrait bottom right, and Tab / Esc for the view.
  // (Not the server's phase: the last pick in ends it while my screen still plays that pick's ceremony.)
  const duosHere = seated && duosMatch && inMatch && ownOpen && ownVersus;
  useTeammateViewKeys(duosHere);
  const shown = !!frame && (teammate || active);
  return (
    <>
      {shown && (
        <HeroSelect
          key={seat}
          watch={{ frame: frame!, fx: !ownOpen, clock: frame!.mode === 'versus' ? (ownOpen ? 'show' : 'drive') : 'none' }}
        />
      )}
      {/* The teammate's screen wears the team frame, as in the shop (R-DUOS-VIEW-01). */}
      {shown && teammate && <div className="duosview-vignette hsvignette" aria-hidden="true" />}
      {/* The Versus stands' own chrome (me top left with Leave, the players bottom right). A live game's is LiveWatchBar. */}
      {shown && !teammate && inMatch && !seated && <SpectatorBar />}
      {duosHere && <DuosMateDock watching={teammate} heroSelect />}
    </>
  );
}
