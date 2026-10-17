/**
 * THE LOBBY PICKER (owner 2026-10-16 on the old standings: "it is not obvious how to view it and is ugly. please
 * iterate on this"). The open game's lobby, as a chooser for WHOSE board the game card's big board shows. The default
 * is your own board; picking a seat swaps that seat's board in (a quick crossfade), a "Showing" line says whose it is
 * and when, and "Back to yours" returns. Two choosers were built for the owner to pick from:
 *
 *   chips   (option 1) one strip of eight seat chips (portrait + frame, place, name) above the board. Hover lifts the
 *           chip; its tip carries strength, the round they went out and health. The seat that knocked you out wears a
 *           small sword.
 *   tiles   (option 2) a 4 x 2 table of seat tiles under the card, each with a mini board (minion art only, no
 *           badges) and the round they went out.
 *
 * A pure renderer over the recorded `MatchDetails` (the same data the end screen's Match details dialog reads); it
 * never computes an outcome. Skins follow the scoreboard's rule (your seat as recorded, others through "Show opponent
 * cosmetics").
 */
import { memo, useCallback, useMemo, useState, type ReactNode } from 'react';
import type { MatchDetails, MatchSeat } from '@game/sim';
import type { RunCosmeticSnapshot } from '@game/progression';
import { RUNE_INDEX } from '@game/content';
import { Icon } from '../Icon';
import { artFor } from '../art';
import { sfx } from '../sfx';
import { useGame } from '../store';
import { StoredTeam } from '../StoredTeam';
import { RuneEmblem } from '../RuneEmblem';
import { opponentSkins } from '../skins/skins';
import { SeatPortrait } from './MatchScoreboard';
import { GAME_STRENGTH_LABEL, ordinalOf } from './matchDetailsText';

export type LobbyView = 'chips' | 'tiles';
const VIEW_KEY = 'ascent.lobbyView';
/** Which chooser shows (the owner picks; a per-browser dev switch until then). */
export function lobbyView(): LobbyView {
  try { return localStorage.getItem(VIEW_KEY) === 'tiles' ? 'tiles' : 'chips'; } catch { return 'chips'; }
}

/** The seat's place as a real place: "1st" ... "8th", or "Still in" for a seat standing when your game ended whose
 *  final place is not known. Your own seat reads your finish. */
export function seatPlace(seat: MatchSeat, d: MatchDetails): string {
  if (seat.self) return d.placement > 0 ? ordinalOf(d.placement) : 'Still in';
  return seat.placement !== undefined ? ordinalOf(seat.placement) : 'Still in';
}
const bandOfPlace = (seat: MatchSeat, d: MatchDetails): 'won' | 'top4' | 'lost' | 'in' => {
  const p = seat.self ? d.placement : seat.placement;
  if (p === undefined || !(p > 0)) return 'in';
  return p === 1 ? 'won' : p <= 4 ? 'top4' : 'lost';
};
/** "Out in round 10" / "Still in" / "Winner". */
function seatOut(seat: MatchSeat, d: MatchDetails): string {
  const p = seat.self ? d.placement : seat.placement;
  if (p === 1) return 'Winner';
  const r = seat.self ? (d.eliminated ? seat.eliminatedRound ?? d.endRound : undefined) : seat.eliminatedRound;
  return r !== undefined ? `Out in round ${r}` : 'Still in';
}
/** The chip's hover tip: short plain sentences. */
function seatTip(seat: MatchSeat, d: MatchDetails): string {
  const parts = [`${seatOut(seat, d)}.`];
  if (typeof seat.strength === 'number') parts.push(`${GAME_STRENGTH_LABEL} ${seat.strength}.`);
  if (seat.health > 0) parts.push(`${seat.health} Health${seat.armor > 0 ? `, ${seat.armor} Armor` : ''}.`);
  if (seat.id === d.knockedOutBy) parts.push('Knocked you out.');
  return parts.join(' ');
}

export function seatSkinsOf(seat: MatchSeat, own: boolean, showOpponents: boolean): RunCosmeticSnapshot | null {
  return own && seat.self ? seat.cosmetics ?? null : opponentSkins(showOpponents, seat.cosmetics);
}

/** The picked seat (null = your own board, the card's default). Reset when the game changes (the host is keyed). */
export function useLobbySeat(details: MatchDetails | null | undefined): { seat: MatchSeat | null; pick: (id: string | null) => void } {
  const [id, setId] = useState<string | null>(null);
  const seat = details && id ? details.seats.find((s) => s.id === id && !s.self) ?? null : null;
  const pick = useCallback((next: string | null) => { setId((cur) => { if (cur !== next) sfx.tick(); return next; }); }, []);
  return { seat, pick };
}

/** The picked seat's board in the card's big board slot (full cards, the badge slot rules of the board CSS). */
export function SeatBoard({ seat, own }: { seat: MatchSeat; own: boolean }) {
  const showOpp = useGame((s) => s.showOpponentSkins);
  const skins = useMemo(() => seatSkinsOf(seat, own, showOpp), [seat, own, showOpp]);
  return seat.board && seat.board.minions.length > 0
    ? <StoredTeam minions={seat.board.minions} skins={skins} label={`${seat.name}'s board`} />
    : <div className="cv2-row-none">{seat.board ? 'This board was empty.' : 'No board was recorded for this player.'}</div>;
}

/** The picked seat's runes, for the card's runes row. */
export function SeatRuneRow({ seat }: { seat: MatchSeat }) {
  const known = (seat.board?.runes ?? []).filter((id) => RUNE_INDEX[id]);
  return known.length > 0
    ? <div className="cv2-runes" aria-label={`${seat.name}'s runes`}>{known.map((id, i) => <RuneEmblem runeId={id} key={`${id}#${i}`} />)}</div>
    : <div className="cv2-row-none cv2-norunes">No runes</div>;
}

/** "Showing: Your board" / "Showing: LazerLemon's board, knocked out in round 10" + "Back to yours". */
export function ShowingLine({ seat, details, onBack }: { seat: MatchSeat | null; details: MatchDetails; onBack: () => void }) {
  let what = 'Your board';
  if (seat) {
    const out = seatOut(seat, details);
    const round = seat.board?.round ?? details.endRound;
    what = `${seat.name}'s board, ${out === 'Winner' ? `the winner, round ${round}` : out === 'Still in' ? `round ${round}` : out.replace('Out in', 'knocked out in')}`;
  }
  return (
    <div className="lp-showing" aria-live="polite">
      <span className="lp-showing-l">Showing</span>
      <span className="lp-showing-v">{what}</span>
      {seat && <button type="button" className="cv2-btn lp-back pressable" onClick={onBack}><span aria-hidden="true">‹</span>Back to yours</button>}
      {!seat && <span className="lp-hint">Pick a player to see their board</span>}
    </div>
  );
}

interface PickerProps { details: MatchDetails; selectedId: string | null; onPick: (id: string | null) => void; own: boolean }

/** OPTION 1: the strip of eight seat chips. */
export const LobbyChips = memo(function LobbyChips({ details, selectedId, onPick, own }: PickerProps) {
  const showOpp = useGame((s) => s.showOpponentSkins);
  return (
    <div className="lp-chips" role="group" aria-label="Players in this lobby. Pick one to see their board">
      {details.seats.map((seat) => {
        const on = seat.self ? selectedId === null : selectedId === seat.id;
        return (
          <button
            type="button" key={seat.id} data-seat={seat.id} aria-pressed={on}
            className={`lp-chip gtip lp-${bandOfPlace(seat, details)}${on ? ' on' : ''}${seat.self ? ' self' : ''}`}
            data-tip={seatTip(seat, details)}
            aria-label={`${seatPlace(seat, details)}, ${seat.self ? 'you' : seat.name}. ${seatTip(seat, details)}`}
            onClick={() => onPick(seat.self ? null : seat.id)}
          >
            <span className="lp-chip-portrait"><SeatPortrait heroId={seat.heroId} skins={seatSkinsOf(seat, own, showOpp)} self={!!seat.self} /></span>
            <span className="lp-chip-txt">
              <span className="lp-chip-place">{seatPlace(seat, details)}</span>
              <span className="lp-chip-name">{seat.self ? 'You' : seat.name}</span>
            </span>
            {seat.id === details.knockedOutBy && <span className="lp-ko" aria-hidden="true"><Icon name="sword" /></span>}
          </button>
        );
      })}
    </div>
  );
});

/** OPTION 2: the 4 x 2 table of seat tiles with mini boards. */
export const LobbyTiles = memo(function LobbyTiles({ details, selectedId, onPick, own }: PickerProps) {
  const showOpp = useGame((s) => s.showOpponentSkins);
  return (
    <div className="lp-tiles" role="group" aria-label="Players in this lobby. Pick one to see their board">
      {details.seats.map((seat) => {
        const on = seat.self ? selectedId === null : selectedId === seat.id;
        const minions = seat.board?.minions ?? [];
        return (
          <button
            type="button" key={seat.id} data-seat={seat.id} aria-pressed={on}
            className={`lp-tile lp-${bandOfPlace(seat, details)}${on ? ' on' : ''}${seat.self ? ' self' : ''}`}
            aria-label={`${seatPlace(seat, details)}, ${seat.self ? 'you' : seat.name}. ${seatTip(seat, details)}`}
            onClick={() => onPick(seat.self ? null : seat.id)}
          >
            <span className="lp-tile-head">
              <span className="lp-chip-portrait"><SeatPortrait heroId={seat.heroId} skins={seatSkinsOf(seat, own, showOpp)} self={!!seat.self} /></span>
              <span className="lp-chip-txt">
                <span className="lp-chip-place">{seatPlace(seat, details)}</span>
                <span className="lp-chip-name">{seat.self ? 'You' : seat.name}</span>
              </span>
              {seat.id === details.knockedOutBy && <span className="lp-ko" aria-hidden="true"><Icon name="sword" /></span>}
            </span>
            <span className="lp-mini" aria-hidden="true">
              {Array.from({ length: 7 }, (_, i) => {
                const m = minions[i];
                const art = m ? artFor(m.cardId) : undefined;
                return <span key={i} className={`lp-mini-m${m ? '' : ' empty'}${m?.golden ? ' golden' : ''}`}>{art && <img decoding="async" src={art} alt="" draggable={false} />}</span>;
              })}
            </span>
            <span className="lp-tile-out">{seatOut(seat, details)}</span>
          </button>
        );
      })}
    </div>
  );
});

/** Everything a game card host needs from the lobby: the picked seat (null = yours), the node above the board (the
 *  chips + the Showing line, or the Showing line alone with the tiles), the node under the card (the tiles), and the
 *  board key that crossfades a swap. No recorded details: `none` (when given) sits where the picker would. */
export function useLobbyParts(details: MatchDetails | null | undefined, own: boolean, none?: ReactNode): {
  seat: MatchSeat | null; lobby: ReactNode; extra: ReactNode; boardKey: string | undefined;
} {
  const { seat, pick } = useLobbySeat(details);
  const view = lobbyView();
  if (!details) return { seat: null, lobby: none ?? null, extra: null, boardKey: undefined };
  const sel = seat?.id ?? null;
  const showing = <ShowingLine seat={seat} details={details} onBack={() => pick(null)} />;
  return {
    seat,
    boardKey: seat?.id,
    lobby: view === 'chips' ? <><LobbyChips details={details} selectedId={sel} onPick={pick} own={own} />{showing}</> : showing,
    extra: view === 'tiles'
      ? <section className="lp-tilewrap" aria-label="Players in this lobby"><span className="lp-tiles-l">The lobby. Pick a player to see their board.</span><LobbyTiles details={details} selectedId={sel} onPick={pick} own={own} /></section>
      : null,
  };
}
