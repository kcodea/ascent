/**
 * ONE MATCH-HISTORY LOOK (owner 2026-11-03: "i like the style of the recent games way more than the recent career games.
 * please make them match and use the recent games look"). The list and the open game shared by Recent Games
 * (RecentGamesPh.tsx) and the Career's Match History and Practice tabs (career/PhCareer.tsx). Each page turns its own rows
 * into these plain props; nothing here reads a feed. Styles: gamesPages.css, under an `.rgp` ancestor.
 *
 *   <GameList>     one rail slice per game: the band edge, the placement as bold coloured text (a crown on a win), a title
 *                  + sub line, the hero art fading in, and the rank, rating change and date at the right.
 *   <GameDetail>   the open game: a banner (placement, player, hero, record, rank, Replay, Career), the facts as tiles, the
 *                  board as the real cards with whose board it is, the runes, and the lobby grid (pick one to show it above).
 *
 *   useHeldKey + useNearPrefetch   THE OPEN GAME ARRIVES WHOLE (see below): any page with a lobby read to wait for uses them.
 *
 * PERFORMANCE: static paint; only the open game's board mounts; its card FX stay still until pointed at.
 */
import { memo, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { BoardSnapshot, MatchDetails, RuneLiveState } from '@game/sim';
import type { RunCosmeticSnapshot } from '@game/progression';
import { GildedCrown, ReplayEye } from '../../menuIcons';
import { GameRank } from '../../gameRank';
import { StoredTeam } from '../../StoredTeam';
import { LbRunes } from '../../LadderBits';
import { bandOf, placeText, type GameBand } from '../../GameCard';
import { LobbyTiles, MiniBoard, SeatBoard, SeatRuneRow, ShowingLine, useLobbySeat } from '../../matchDetails/LobbyPicker';
import { PhButton, PhFact, PhSelectList } from '../kit';
import './gamesPages.css';

/** The words for a placement: "Victory", "4th place", "No placement". */
export function placeWords(place: number | null): string {
  if (place === null || !(place > 0)) return 'No placement';
  return place === 1 ? 'Victory' : `${placeText(place)} place`;
}

/** THE PLACEMENT (owner ruling 2026-11-03: "for the ui overhaul i prefer this style placement", the production Recent
 *  Games list's): the ordinal as plain bold text in its band's colour (gold a win, green the top 4, rose after), a small
 *  gilded crown before a 1st, and the same colour as the row's left edge bar. No crest. The band, not the number, picks
 *  the colour, so a Duos team's 2nd of 2 reads as the loss it is. */
export function Place({ place, band, big }: { place: number | null; band: GameBand; big?: boolean }) {
  return (
    <span className={`rgp-ord b-${band}${big ? ' big' : ''}`} aria-label={placeWords(place)}>
      {band === 'won' && <span className="rgp-crown" aria-hidden="true"><GildedCrown /></span>}
      {placeText(place)}
    </span>
  );
}

/** The longest an open game waits for its lobby before it opens anyway (with ghost tiles). A cold read takes 0.4 to 0.9 s. */
export const HOLD_MS = 500;

/**
 * THE OPEN GAME ARRIVES WHOLE (round 11 critic: "board and lobby should arrive together with the banner"). The list moves
 * at once; the detail keeps showing the OLD game until the new one's data is in hand, then swaps in one frame. `null` = the
 * very first game, nothing to keep: the host shows an empty plate (`<GameDetailHold />`). After `holdMs` it opens anyway.
 *   wanted   the picked key
 *   ready    is this key's data in hand, synchronously?
 *   load     read it (cached and safe to call again)
 */
export function useHeldKey(wanted: string, ready: (key: string) => boolean, load: (key: string) => Promise<unknown>, holdMs = HOLD_MS): string | null {
  const [shown, setShown] = useState<string | null>(() => (ready(wanted) ? wanted : null));
  const fns = useRef({ ready, load });
  fns.current = { ready, load };
  useEffect(() => {
    if (fns.current.ready(wanted)) { setShown(wanted); return undefined; }
    let live = true;
    const open = (): void => { if (live) setShown(wanted); };
    const timer = window.setTimeout(open, holdMs);
    void fns.current.load(wanted).finally(open);
    return () => { live = false; window.clearTimeout(timer); };
  }, [wanted, holdMs]);
  return ready(wanted) ? wanted : shown;
}

/** Read the games around the selection ahead of the click, so a step to a neighbour opens at once. `load` must be cached. */
export function useNearPrefetch(keys: readonly string[], selected: string, load: (key: string) => unknown, radius = 2): void {
  const fn = useRef(load);
  fn.current = load;
  useEffect(() => {
    const at = keys.indexOf(selected);
    if (at < 0) return;
    for (let i = Math.max(0, at - radius); i <= Math.min(keys.length - 1, at + radius); i++) if (i !== at) fn.current(keys[i]!);
  }, [keys, selected, radius]);
}

/** The first game's place while it is held: the plate alone, so the banner, board and lobby then land together. */
export function GameDetailHold() {
  return <article className="rgp-detail rgp-hold" aria-busy="true" aria-label="Opening the game" />;
}

export interface ListItem {
  key: string; place: number | null; band: GameBand; title: string; sub?: string; when?: string;
  rank?: number | null; delta?: number | null; art?: string; label: string;
}

/** The history: one rail slice per game, in the kit's keyboard list (Up / Down / Home / End). */
export const GameList = memo(function GameList({ items, selected, onPick, label, onNear }: {
  items: readonly ListItem[]; selected: string; onPick: (key: string) => void; label: string;
  /** The pointer came to rest on a row: read it ahead of the click. */
  onNear?: (key: string) => void;
}) {
  // Keep the picked row in view when the pick comes from OUTSIDE the list (a filter change). Never on mount (the first row
  // is in view, and a layout read in the commit cost 48 ms on open) and never for a press in the list (it is in view too;
  // the kit list scrolls its own keyboard moves). Scrolls only the list, never the phone's page.
  const ref = useRef<HTMLDivElement | null>(null);
  const prev = useRef(selected);
  const local = useRef(false);
  useEffect(() => {
    if (prev.current === selected) return;
    prev.current = selected;
    if (local.current) { local.current = false; return; }
    const box = ref.current;
    if (box && items[0]?.key === selected) { box.scrollTop = 0; return; } // a new feed or filter opens on its first game: no read
    const on = box?.querySelector<HTMLElement>('.rgp-item.sel')?.parentElement;
    if (!box || !on) return;
    const top = on.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (top + on.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + on.offsetHeight - box.clientHeight;
  }, [selected, items]);
  return (
    <div className="rgp-listwrap" ref={ref}>
      <PhSelectList
        className="rgp-list" label={label} items={items} keyOf={(it) => it.key} selected={selected}
        onSelect={(it) => { if (it.key !== selected) { local.current = true; onPick(it.key); } }}
        render={(it, on) => (
          <div className={`phk-row rgp-item b-${it.band}${on ? ' sel' : ''}`} aria-label={it.label} onPointerEnter={onNear ? () => onNear(it.key) : undefined}>
            {it.art && <img className="phk-rowart rgp-itemart" src={it.art} alt="" draggable={false} decoding="sync" loading="lazy" />}
            <Place place={it.place} band={it.band} />
            <span className="phk-rowwho">
              <span className="phk-rowtitle">{it.title}</span>
              {it.sub && <span className="phk-rowsub">{it.sub}</span>}
            </span>
            <span className="rgp-itemend">
              {it.rank != null && <GameRank divisionIndex={it.rank} compact />}
              {it.delta != null && it.delta !== 0 && <span className={`rgp-delta ${it.delta > 0 ? 'up' : 'down'}`}>{it.delta > 0 ? `+${it.delta}` : it.delta}</span>}
              {it.when && <span className="rgp-when">{it.when}</span>}
            </span>
          </div>
        )}
      />
    </div>
  );
});

export interface GameFact { label: string; value: ReactNode; tip?: string }

export interface GameDetailProps {
  place: number | null;
  /** The band, when the placement's own split does not fit. Absent = `bandOf(place)`. */
  band?: GameBand;
  who: string; heroName: string; art?: string;
  record: string; recordTone: 'up' | 'down' | '';
  rank: number | null;
  facts: readonly GameFact[];
  /** A note beside the facts (a partial recording). */
  notice?: ReactNode;
  /** The lobby; absent until it lands, or when none was recorded (no lobby section). */
  match: MatchDetails | null | undefined;
  /** The lobby is still being read: its space is held by quiet ghost tiles, and it fades in when it lands. */
  matchPending?: boolean;
  /** Is this the viewer's own game ("Your board", "You" in the lobby)? */
  own: boolean;
  minions?: BoardSnapshot['minions']; skins: RunCosmeticSnapshot | null;
  runes: readonly string[]; runeLive?: RuneLiveState;
  /** Null hides the button. */
  replay: { watchable: boolean; busy: boolean; unplayable: boolean; onWatch: (e: MouseEvent) => void; label: string } | null;
  /** Null hides the button (the Career page is already that player's). */
  career?: { disabled: boolean; onOpen: () => void; label: string } | null;
}

/** One fact tile (the kit's), with the game's hover tip when it has one. */
function Fact({ label, children, tip }: { label: string; children: ReactNode; tip?: string }) {
  const tile = <PhFact label={label} value={children} />;
  return tip ? <span className="gtip rgp-tip" data-tip={tip}>{tile}</span> : tile;
}

const NO_MINIONS: never[] = [];
const GHOST_SEATS = [0, 1, 2, 3, 4, 5, 6, 7];

/** The lobby's place while it is read: the real grid and tile shape with nothing in it, so nothing moves when it lands. */
function LobbyGhost() {
  return (
    <div className="lp-tiles" aria-hidden="true">
      {GHOST_SEATS.map((i) => (
        <div key={i} className="lp-tile rgp-ghost">
          <span className="lp-tile-head">
            <span className="lp-chip-portrait"><i className="rgp-ghostface" /></span>
            <span className="lp-chip-txt"><span className="lp-chip-place">&nbsp;<span className="lp-tile-out">&nbsp;</span></span><span className="lp-chip-name">&nbsp;</span></span>
          </span>
          <MiniBoard minions={NO_MINIONS} />
        </div>
      ))}
    </div>
  );
}

export const GameDetail = memo(function GameDetail(p: GameDetailProps) {
  const band = p.band ?? bandOf(p.place);
  // Fades only when it was waited for: a revisit (the answer already in hand) paints as it always did.
  const waited = useRef(!!p.matchPending);
  const { seat, pick } = useLobbySeat(p.match);
  // A pick in the lobby (below the board) brings the board back into view; nothing moves when it is already on screen.
  const boardRef = useRef<HTMLElement | null>(null);
  // Only on a real change of seat (StrictMode runs effects twice), and it scrolls only the detail column, never the page.
  const shownSeat = useRef<string | null>(null);
  useEffect(() => {
    const id = seat?.id ?? null;
    if (id === shownSeat.current) return;
    shownSeat.current = id;
    const el = boardRef.current;
    const col = el?.closest<HTMLElement>('.rgp-detailcol');
    if (!el || !col || typeof col.scrollTo !== 'function') return;
    const top = el.getBoundingClientRect().top - col.getBoundingClientRect().top;
    if (top < 0) col.scrollTo({ top: col.scrollTop + top, behavior: 'smooth' });
  }, [seat?.id]);
  const rp = p.replay;
  const replayText = rp && (rp.busy ? 'Loading' : rp.unplayable || !rp.watchable ? 'No replay' : 'Replay');

  return (
    <article className={`rgp-detail b-${band}`} aria-label={`${p.who}, ${p.heroName}: ${placeWords(p.place)}`}>
      <header className="rgp-banner">
        {p.art && <img className="rgp-bannerart" src={p.art} alt="" draggable={false} decoding="sync" />}
        <Place place={p.place} band={band} big />
        <div className="rgp-bannerwho">
          {(band === 'won' || band === 'none') && <span className={`rgp-verdict b-${band}`}>{placeWords(p.place)}</span>}
          <h2 className="rgp-name">{p.who}</h2>
          <span className="rgp-line">
            <span>{p.heroName}</span>
            {p.record && <span className={`rgp-record ${p.recordTone}`}>{p.record}</span>}
            {p.rank != null && <GameRank divisionIndex={p.rank} />}
          </span>
        </div>
        <div className="rgp-bannerbtns">
          {rp && (
            <PhButton variant="primary" onClick={rp.onWatch} disabled={!rp.watchable || rp.busy || rp.unplayable} aria-label={rp.label}>
              <ReplayEye />{replayText}
            </PhButton>
          )}
          {p.career && (
            <PhButton onClick={p.career.onOpen} disabled={p.career.disabled} aria-label={p.career.label}>
              Career<span className="rgp-go" aria-hidden="true">›</span>
            </PhButton>
          )}
        </div>
      </header>

      <div className="rgp-facts">
        {p.facts.map((f) => <Fact key={f.label} label={f.label} tip={f.tip}>{f.value}</Fact>)}
        {p.notice}
      </div>

      <section className="rgp-boardsec" aria-label="Final board" ref={boardRef}>
        {p.match
          ? <ShowingLine seat={seat} details={p.match} onBack={() => pick(null)} own={p.own} />
          : (
            // The same line the lobby's arrival keeps, so the words do not change when it lands.
            <div className="lp-showing">
              <span className="lp-showing-l">Showing</span>
              <span className="lp-showing-v">{p.own ? 'Your board' : `${p.who}'s board`}</span>
              {p.matchPending && <span className="lp-hint">Pick a player in the lobby below to see their board</span>}
            </div>
          )}
        <div className="rgp-board"><div className={`rgp-boardin${seat ? ' swap' : ''}`} key={seat?.id ?? 'own'}>
          {seat ? <SeatBoard seat={seat} own={p.own} /> : p.minions && p.minions.length > 0
            ? <StoredTeam minions={p.minions} skins={p.skins} />
            : <div className="rgp-none">No board recorded for this game</div>}
        </div></div>
        <div className="rgp-runes">
          {seat ? <SeatRuneRow seat={seat} /> : <LbRunes runes={p.runes} live={p.runeLive} empty="No runes taken" />}
        </div>
      </section>

      {(p.match || p.matchPending) && (
        <section className={`rgp-lobby${p.match && waited.current ? ' fadein' : ''}`} aria-label="Players in this lobby" aria-busy={!p.match}>
          <header className="rgp-lobbyhead"><h3>Lobby</h3></header>
          {p.match ? <LobbyTiles details={p.match} selectedId={seat?.id ?? null} onPick={pick} own={p.own} /> : <LobbyGhost />}
        </section>
      )}
    </article>
  );
});

/** A page's games as one list + detail: the two columns of `.rgp-split`. */
export interface GameSplitView { items: readonly ListItem[]; selected: string; onPick: (key: string) => void; label: string; detail: GameDetailProps }

export function GameSplitPh({ view }: { view: GameSplitView }) {
  return (
    <div className="rgp-split">
      <GameList items={view.items} selected={view.selected} onPick={view.onPick} label={view.label} />
      <div className="rgp-detailcol"><GameDetail key={view.selected} {...view.detail} /></div>
    </div>
  );
}
