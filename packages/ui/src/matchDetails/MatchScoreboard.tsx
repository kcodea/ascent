import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { getHero, type MatchDetails, type MatchSeat } from '@game/sim';
import type { RunCosmeticSnapshot } from '@game/progression';
import { Icon } from '../Icon';
import { PortraitFrame, frameIdOf, pfClass, usePortraitFrame } from '../portraitFrame/PortraitFrame';
import { StoredTeam } from '../StoredTeam';
import { RuneEmblem } from '../RuneEmblem';
import { RUNE_INDEX } from '@game/content';
import { heroPortrait, internSnapshot, opponentSkins, useSkinEpoch } from '../skins/skins';
import { useGame } from '../store';
import { sfx } from '../sfx';
import { stageHost } from '../stage';
import { TitleBadge } from '../titles/TitleBadge';
import { useHallKeys } from './hallKeys';
import { boardCaption, defaultSeatId, placeLabel, statusText, strengthLabel, summaryText, GAME_STRENGTH_TIP } from './matchDetailsText';
import './matchDetails.css';

/**
 * MATCH DETAILS SCOREBOARD (owner ask 2026-09-28): every seat of a finished lobby in placement order, and the board
 * the selected seat had at the moment YOUR game ended. ONE component, used in two places: the end screen's
 * "Match details" dialog and the Career match card's inline expand.
 *
 * A pure renderer over a recorded `MatchDetails` (see `buildMatchDetails`): it never computes an outcome, never
 * touches a driver, and never re-simulates. Rows are memoised with stable props, and only ONE board (7 cards) is
 * mounted at a time.
 *
 * SKINS: `own` = the record belongs to the viewer (the end screen, your own Career). Your own seat then wears your
 * recorded skins as-is; every other seat goes through "Show opponent skins". On someone else's Career every seat
 * is an opponent, their own included.
 *
 * TITLES (owner 2026-09-28: "i think it should show in like leaderboard/match details views"): every row shows the
 * title its player wore in that run, from the seat's recorded cosmetic snapshot, under the SAME rule as skins (your
 * own seat as recorded; every other seat through "Show opponent cosmetics"). Bots and older records carry none, and
 * `TitleBadge` renders nothing for an unknown or retired title. Rule: R-PROG-TITLE-03.
 */

function seatSkins(seat: MatchSeat, own: boolean, showOpponents: boolean): RunCosmeticSnapshot | null {
  return internSnapshot(own && seat.self ? seat.cosmetics ?? null : opponentSkins(showOpponents, seat.cosmetics));
}

/** The title a seat's row shows (a snapshot for `TitleBadge`), or null. The seat's recorded cosmetics carry it; a
 *  record from before titles rode the snapshot may still carry your own seat's `titleId`. Same gate as skins. Bots
 *  never show one. Exported for the tests. */
export function seatTitle(seat: MatchSeat, own: boolean, showOpponents: boolean): RunCosmeticSnapshot | null {
  if (seat.bot && !seat.self) return null;
  const id = seat.cosmetics?.title ?? seat.titleId;
  if (!id) return null;
  const snap: RunCosmeticSnapshot = seat.cosmetics?.title ? seat.cosmetics : { title: id };
  return own && seat.self ? snap : opponentSkins(showOpponents, snap);
}

/** The hero portrait in the game's gold ring (the Career's `.cv2-heroframe` markup, row-sized). */
function SeatPortrait({ heroId, skins, self }: { heroId: string; skins: RunCosmeticSnapshot | null; self: boolean }) {
  const art = heroPortrait(heroId, skins);
  // The portrait frame RECORDED on the seat (owner 2026-10-01; `skins` already applies "Show opponent cosmetics" to
  // the other seats), else the portrait-frames tuner's ring: your seat wears yours, the other seven the opponents'.
  const frame = usePortraitFrame(self ? 'self' : 'opp', frameIdOf(skins));
  return (
    <div className={`cv2-heroframe mds-portrait${pfClass(frame)}`} style={frame?.hostStyle}>
      <div className="hero">
        <div className="f">
          {art ? <img decoding="sync" className="heroimg" src={art} alt="" draggable={false} /> : <Icon name="anvil" />}
        </div>
        <PortraitFrame frame={frame} />
      </div>
    </div>
  );
}

interface SeatRowProps {
  seat: MatchSeat;
  place: string;
  status: string;
  selected: boolean;
  killer: boolean;
  /** This seat's run is currently on the Hall of Champions. */
  hall: boolean;
  skins: RunCosmeticSnapshot | null;
  /** The title to show (already through the opponent cosmetics gate), or null. */
  title: RunCosmeticSnapshot | null;
  onSelect: (id: string) => void;
  onKey: (e: KeyboardEvent<HTMLButtonElement>, id: string) => void;
}

/** One seat. Memoised: its props are primitives plus the seat (a stable reference into the recorded details). */
const SeatRow = memo(function SeatRow({ seat, place, status, selected, killer, hall, skins, title, onSelect, onKey }: SeatRowProps) {
  const heroName = seat.heroId ? getHero(seat.heroId).name : '';
  const standing = seat.eliminatedRound === undefined && !(seat.self && status.startsWith('Out'));
  const winner = status === 'Winner';
  const strength = strengthLabel(seat);
  const label = `${place ? `${place}. ` : ''}${seat.name}${seat.self ? ' (you)' : ''}, ${heroName}. ${status}.${killer ? ' Knocked you out.' : ''}${hall ? ' On the Hall of Champions.' : ''}${strength ? ` ${strength}.` : ''}`;
  return (
    <button
      type="button"
      className={`mds-row${selected ? ' on' : ''}${seat.self ? ' self' : ''}${standing ? '' : ' out'}${winner ? ' winner' : ''}`}
      aria-pressed={selected}
      aria-label={label}
      data-seat={seat.id}
      onClick={() => onSelect(seat.id)}
      onKeyDown={(e) => onKey(e, seat.id)}
    >
      <span className={`mds-place${place.startsWith('Top') ? ' top' : ''}`}>{place}</span>
      <SeatPortrait heroId={seat.heroId} skins={skins} self={!!seat.self} />
      <span className="mds-who">
        <span className="mds-name">
          <span className="mds-name-text">{seat.name}</span>
          {hall && <HallCrown />}
          {seat.self && <span className="mds-tag you">You</span>}
          {seat.bot && !seat.self && <span className="mds-tag bot">Bot</span>}
        </span>
        <span className="mds-heroline">
          <span className="mds-hero">{heroName}</span>
          {title && <TitleBadge snapshot={title} className="mds-row-title" />}
        </span>
        {strength && <span className="mds-strength gtip" data-tip={GAME_STRENGTH_TIP}>{strength}</span>}
        <span className={`mds-status${winner ? ' winner' : standing ? ' in' : ' out'}`}>
          {winner && <Icon name="crown" />}{status}
          {killer && <span className="mds-killer"><Icon name="sword" />Knocked you out</span>}
        </span>
      </span>
      {standing && (seat.health > 0 || seat.armor > 0) && (
        <span className="mds-hp" aria-hidden="true">
          <span className="mds-hp-v"><Icon name="heart" />{seat.health}</span>
          {seat.armor > 0 && <span className="mds-hp-v armor"><Icon name="shield" />{seat.armor}</span>}
        </span>
      )}
    </button>
  );
});

/** The selected seat's rune choices at that moment (owner 2026-09-28: "runes are added to the view so you can see
 *  their rune choices"), in the Career banner's emblem + name style (hover = the rune's text). Unknown ids (a rune
 *  this build does not ship) are skipped; none (or an older record) reads "No runes". */
function SeatRunes({ runes }: { runes: readonly string[] | undefined }) {
  const known = (runes ?? []).filter((id) => RUNE_INDEX[id]);
  return (
    <div className="mds-runes">
      <span className="cv2-row-label">Runes</span>
      {known.length > 0
        ? <div className="cv2-runes" aria-label="Runes this player owned">{known.map((id, i) => <RuneEmblem runeId={id} key={`${id}#${i}`} />)}</div>
        : <span className="mds-norunes">No runes</span>}
    </div>
  );
}

/** BOARD STRENGTH (R-LOBBY-09): the selected seat's run strength, and for your own seat each round's board. Renders
 *  nothing for a seat that was not scored (no placeholder). */
function SeatStrength({ seat }: { seat: MatchSeat }) {
  const label = strengthLabel(seat);
  const rounds = seat.self ? seat.roundStrength ?? [] : [];
  if (!label && rounds.length === 0) return null;
  return (
    <div className="mds-strength-panel">
      {label && <span className="cv2-row-label gtip" data-tip={GAME_STRENGTH_TIP}>{label}</span>}
      {rounds.length > 0 && (
        <div className="mds-strength-rounds" aria-label="Your board strength by round">
          {rounds.map((r) => <span className="mds-strength-round" key={r.round}><span className="mds-strength-r">R{r.round}</span>{r.value}</span>)}
        </div>
      )}
    </div>
  );
}

/** The small gold crown for a run currently on the Hall of Champions (the game's `.gtip` hover bubble, never a
 *  native tooltip). */
function HallCrown() {
  return (
    <span className="mds-hall gtip" role="img" aria-label="On the Hall of Champions" data-tip="On the Hall of Champions">
      <Icon name="crown" />
    </span>
  );
}

/** The scoreboard itself: rows + the selected seat's board. `own` decides the skin rule (see above). */
export function MatchScoreboard({ details, own }: { details: MatchDetails; own: boolean }) {
  useSkinEpoch();
  const showOpponents = useGame((s) => s.showOpponentSkins);
  const [selectedId, setSelected] = useState(() => defaultSeatId(details));
  const listRef = useRef<HTMLDivElement>(null);
  const seats = details.seats;
  const selected = seats.find((s) => s.id === selectedId) ?? seats[0];
  // Per-seat derived strings + skins, once per record (never per render of a row).
  const rows = useMemo(() => seats.map((seat) => ({
    seat, place: placeLabel(seat, details), status: statusText(seat, details), skins: seatSkins(seat, own, showOpponents),
    title: seatTitle(seat, own, showOpponents),
  })), [seats, details, own, showOpponents]);

  // The Hall crown: one cached read per panel open (never per render), asked only when a seat is a real run.
  const wantsHall = useMemo(() => seats.some((s) => !!s.runKey), [seats]);
  const hallKeys = useHallKeys(wantsHall);
  const onSelect = useCallback((id: string) => {
    setSelected((cur) => { if (cur !== id) sfx.tick(); return id; });
  }, []);
  // Up / Down walk the table (and move focus with the selection), Home / End jump.
  const onKey = useCallback((e: KeyboardEvent<HTMLButtonElement>, id: string) => {
    const i = seats.findIndex((s) => s.id === id);
    let j = -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') j = Math.min(seats.length - 1, i + 1);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') j = Math.max(0, i - 1);
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = seats.length - 1;
    if (j < 0 || j === i) return;
    e.preventDefault();
    const next = seats[j]!.id;
    onSelect(next);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-seat="${next}"]`)?.focus();
  }, [seats, onSelect]);

  const selSkins = selected ? rows.find((r) => r.seat === selected)?.skins ?? null : null;
  const heroName = selected?.heroId ? getHero(selected.heroId).name : '';
  return (
    <div className="mds">
      <div className="mds-list" ref={listRef} role="group" aria-label="Players in this lobby">
        {rows.map((r) => (
          <SeatRow
            key={r.seat.id}
            seat={r.seat}
            place={r.place}
            status={r.status}
            selected={r.seat === selected}
            killer={r.seat.id === details.knockedOutBy}
            hall={!!r.seat.runKey && hallKeys.has(r.seat.runKey)}
            skins={r.skins}
            title={r.title}
            onSelect={onSelect}
            onKey={onKey}
          />
        ))}
      </div>
      {selected && (
        <section className="mds-board" aria-live="polite" aria-label={`${selected.name}'s board`}>
          <header className="mds-board-head">
            <span className="mds-board-name">
              {selected.self ? 'Your board' : selected.name}<span className="mds-board-hero">{heroName}</span>
              {!!selected.runKey && hallKeys.has(selected.runKey) && <HallCrown />}
            </span>
            {selected.board && <span className="mds-board-tier">Tier {selected.board.tier}</span>}
          </header>
          <div className="mds-board-caption">{boardCaption(selected, details)}</div>
          <div className="mds-team">
            {selected.board && selected.board.minions.length > 0
              ? <StoredTeam minions={selected.board.minions} skins={selSkins} label={`${selected.name}'s board`} compact />
              : <div className="mds-empty">{selected.board ? 'This board was empty.' : 'No board was recorded for this player.'}</div>}
          </div>
          <SeatRunes runes={selected.board?.runes} />
          <SeatStrength seat={selected} />
        </section>
      )}
    </div>
  );
}

/**
 * The END SCREEN dialog: the scoreboard in the house gold/navy panel, portalled into the stage (so it scales with
 * the game). Esc or the close button closes it; focus moves into it on open and back to the opener on close.
 */
export function MatchDetailsDialog({ details, onClose }: { details: MatchDetails; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKeyDown = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    // Capture phase: the end screen's own Esc handling must not also fire.
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      opener?.focus?.();
    };
  }, [onClose]);
  return createPortal(
    <div className="mdd-scrim" onPointerDown={() => { sfx.tick(); onClose(); }}>
      <div className="mdd-panel" role="dialog" aria-modal="true" aria-labelledby="mdd-title" onPointerDown={(e) => e.stopPropagation()}>
        <header className="mdd-head">
          <span className="mdd-titles">
            <span className="mdd-title" id="mdd-title"><Icon name="board" />Match details</span>
            <span className="mdd-sub">{summaryText(details)} Pick a player to see their board.</span>
          </span>
          <button ref={closeRef} type="button" className="mdd-close pressable" aria-label="Close match details" onClick={() => { sfx.tick(); onClose(); }}>
            <span aria-hidden="true">✕</span>
          </button>
        </header>
        <MatchScoreboard details={details} own />
      </div>
    </div>,
    stageHost(),
  );
}
