import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  boardIntel, getHero, lastRoundDamage, lobbyRailView, playerOpponent, railSeatIntel, roundLossCap, seatResults, snapshotBoard,
  type LobbySeatState, type RunLobby, type SeatIntel,
  seatStartingArmor,
  VERSUS_COPY_SEAT_ID,
} from '@game/sim';
import { QUEST_INDEX, RUNE_INDEX } from '@game/content';
import { floatLobbyDamageOnSeats, roundDamageFloats, whenCurtainDown } from './lobbyDamageFx';
import { LOBBY_KO_MS, aliveSet, newlyKnockedOut, playLobbyKnockoutOnSeats } from './lobbyKnockoutFx';
import { heroThumb, questArt, runeArt } from './art';
import { warmSharpArt } from './fullResArt';
import { railSliceFace } from './railFaceArt';
import { heroPortrait, opponentSkins, useRunSkins } from './skins/skins';
import { PortraitFrame, frameIdOf, usePortraitFrame } from './portraitFrame/PortraitFrame';
import { resolvePortraitFrame } from './portraitFrame/portraitFrameConfig';
import { useDockCfg, useSliceLabel } from './lobbyRailVariant';
import { useDockedRail } from './useDockedRail';
import type { DockPanel, Pt } from './lobbyRailDockedLayout';
import { liveRuneText } from './runeText';
import { mdBold } from './Card';
import { Icon } from './Icon';
import { FadeImg } from './FadeImg';
import { useGame } from './store';
import { useScreenSwapped, useSwapRef } from './screenSwap';
import { stageHost, stageViewport, toStage } from './stage';
import { useSpectate } from './versus/spectate';
import { mySeat, useVersus } from './versus/versusStore';
import { parseRailStatusKey, railStatusKey, versusRailStatuses } from './versus/versusRailStatus';
import { groupDuosRailRows } from './versus/versusGroupView';
import { duosRailTeamOf, duosRailTeams, duosTeamHealthRow } from './versus/duosRailTeams';
import { isRankedDuosRaw, rankedTeamLabels } from './versus/rankedDuosView';
import { enterTeammateView } from './versus/teammateView';
import { LobbyGuides } from './guides/LobbyGuides';
import { canEditGuide, guidesFor, type Guide, type GuidesMode } from './guides/guides';
import { ownsMine, useGuides } from './guides/guidesStore';
import './lobbyRail.css'; // the Gem / Classic rail looks (switch: `data-lobby-rail`, 🎨 Lobby Rail Look tuner)
import { railKey } from './pings/pingKeys';
import './lobbyRailDocked.css'; // the Docked rail (owner 2026-10-31): slices set into the board's right side
// Lobby Rail Tuner 2 (DEV only): applies its saved values before the panel is ever opened. Production never loads it and
// renders the shipped defaults (the sheet's fallbacks + DOCK_DEFAULTS).
if (import.meta.env.DEV) void import('./lobbyRailTuner2Config');

/** DOCKED (owner review 2026-10-31): a slice's outline as a `clip-path`. */
function outlineClip(pts: readonly Pt[]): string {
  return `polygon(${pts.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(', ')})`;
}

/** DOCKED: a player name clamped to the rail's line count WITH an ellipsis (owner 2026-10-31: names past 2 lines end in
 *  "…", never a silent cut). CSS `line-clamp` sets the lines; if the browser clamps without drawing the ellipsis (current
 *  Chrome's flow-root clamp), this trims the text to fit and adds it. Measured when the name changes or its box does, never per frame. */
function ClampedName({ text }: { text: string }): JSX.Element {
  // The text is written by the effect alone (React renders no children here), so the measuring writes never fight React.
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let unfit = false; // the last fit found no box
    const fit = (): void => {
      el.textContent = text;
      unfit = el.clientHeight === 0;
      // Not laid out yet (the rail mounted hidden, e.g. under the game-start curtain): leave the whole name and fit it
      // once it has a box (below). Trimming against a zero box cut every name down to a bare "…" (a 1v1 found it).
      // (+2: scrollHeight rounds up and clientHeight down, so two 14.55px lines read 30 over 29; a cut line is ~15px.)
      if (el.clientHeight === 0 || el.scrollHeight <= el.clientHeight + 2) return;
      let lo = 0, hi = text.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        el.textContent = `${text.slice(0, mid).trimEnd()}…`;
        if (el.scrollHeight <= el.clientHeight + 2) lo = mid; else hi = mid - 1;
      }
      el.textContent = `${text.slice(0, lo).trimEnd()}…`;
    };
    fit();
    // Re-fit only when the name gets its first box or its WIDTH changes (the slice resized): a layout event, never a
    // frame. Its height follows its own line count, so a height change alone is not a trigger (no fit -> resize loop).
    if (typeof ResizeObserver === 'undefined') return;
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => { if (unfit || el.clientWidth !== w) { w = el.clientWidth; fit(); } });
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);
  return <span ref={ref} className="lrv-name-t" aria-label={text} />;
}

/** DOCKED: a slice's outline with its cut edge moved IN by `d` px (the left contour's cut points; the straight edges stay),
 *  so a child clipped by it keeps an even gap from the cut. */
function insetOutline(pts: readonly Pt[], d: number, w: number): Pt[] {
  return pts.map(([x, y]) => [x > 0.5 && x < w * 0.8 ? x + d : x, y] as Pt);
}

/** DOCKED: the gold edge drawn along a slice's outline (or, `ring`, the next foe's breathing red ring). */
function SliceEdge({ p, ring }: { p: DockPanel; ring?: boolean }): JSX.Element {
  return (
    <svg className={`lrv-edge${ring ? ' lrv-foering' : ''}`} aria-hidden="true" width={p.w} height={p.h} viewBox={`0 0 ${p.w.toFixed(1)} ${p.h.toFixed(1)}`}>
      <polygon points={p.outline.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} />
    </svg>
  );
}

/** The max-damage readout on the rail's top edge: "Max dmg 5", or "No cap" once the round is uncapped. It is this
 *  round's LOSS CAP (`roundLossCap`): the most Health a loss can cost. Labelled since 2026-10-09 (owner: "a bit clearer
 *  on what it's saying"); it used to be a bare "−5". */
export function maxDamageLabel(cap: number): string {
  return Number.isFinite(cap) ? `Max dmg ${cap}` : 'No cap';
}

/** VERSUS: is this a real 1v1 (two seats and not a group match; R-VERSUS-RAIL-LAYOUT-01: a Ranked Duos table before its
 *  recorded teams are seated has two)? It used to pick the 1v1 opponent block over the rail; every Versus mode is the rail
 *  now (R-RAIL-DOCKED-ALLMODES-01), and the clients' parity checks still classify a match by it. */
export function versusDuelLayout(versus: boolean, seats: number, groupMatch: boolean): boolean {
  return versus && seats <= 2 && !groupMatch;
}

/**
 * Where the Guides panel's foot goes (stage px from the bottom): just above the Duos teammate portrait when one is on
 * screen (its top + 10), else null (the CSS default: just above the Guides button). One layout read, on the press that
 * opens the panel.
 */
export function guidesFloor(): number | null {
  if (typeof document === 'undefined') return null;
  const mate = document.querySelector<HTMLElement>('.duosdock:not(.self)');
  const r = mate?.getBoundingClientRect();
  if (!r || !(r.width > 0)) return null;
  const host = stageHost().getBoundingClientRect();
  const bottom = host.height > 0 ? host.top + host.height : window.innerHeight;
  return toStage(bottom - r.top) + 10;
}

/** The hover tip on the max-damage readout, with the live number (owner ask 2026-10-02). */
export function maxDamageTip(cap: number): { title: string; rule: string } {
  return Number.isFinite(cap)
    ? { title: 'Max damage this round', rule: `A loss this round costs at most ${cap} Health.` }
    : { title: 'No max damage this round', rule: 'A loss deals full damage.' };
}

/** Which face the rail shows. Kept per run for the session, so a remount keeps it; a new game starts on Opponents
 *  (owner ruling 2026-10-09: "it stays until toggled, but every new game starts on the opponent view"). */
type RailView = 'opponents' | 'guides';
const NO_GUIDES: readonly Guide[] = [];
/** The rail's view of the guides store, for the account signed in right now. The player's own guides and their
 *  bookmarks are taken only when the store holds them for THAT account: guides it still holds for another account are
 *  never taken. */
const snapGuides = (): { list: readonly Guide[]; mine: readonly Guide[]; bookmarked: readonly Guide[]; uid: string | null } => {
  const s = useGuides.getState();
  const uid = useGame.getState().account.userId;
  const theirs = ownsMine(s, uid);
  return { list: s.list, mine: theirs ? s.mine : NO_GUIDES, bookmarked: theirs ? s.bookmarked : NO_GUIDES, uid };
};
let railViewMemo: { run: string; view: RailView } = { run: '', view: 'opponents' };

/** The Guides view's display mode (owner ask 2026-10-09): SIMPLE keeps the rail at its normal width and shows only the
 *  Core / Enablers portraits; FULL widens the rail to the left and adds the write-up. Remembered across games in
 *  localStorage (a per-viewer convenience: it falls back to the default whenever storage is unavailable). Default
 *  SIMPLE, because the wide rail covers End Turn and part of Refresh. */
const GUIDES_MODE_KEY = 'ascent.guidesMode';
/** How long the bottom-right Guides panel takes to sink back into its button (guidesdockout, lobbyGuides.css). */
const GUIDES_CLOSE_MS = 160;
function readGuidesMode(): GuidesMode {
  try { return localStorage.getItem(GUIDES_MODE_KEY) === 'full' ? 'full' : 'simple'; } catch { return 'simple'; }
}

/**
 * The 8-seat table, shown in a LOBBY run.
 *
 * A lobby has no course clock and no Oath — what matters is who is still standing, how much health each of them
 * has, and who you're about to fight.
 *
 * EVERY SEAT IS THE SAME SIZE (owner ask 2026-07-31). The next opponent used to get a large card above the
 * table; it made the rail two different things stacked, and the one seat you most want to compare against the
 * others was the one you couldn't. The next foe is now marked in place — a NEXT chip and an accent ring — so
 * the table reads as one scannable column.
 *
 * SCOUTING lives on hover instead. Each enemy seat opens a card with what they are playing (dominant tribe,
 * tier, triples) and their last three fights. That is the read the big card was standing in for, and it works
 * for all seven opponents rather than just the imminent one.
 */
export const LobbyPanel = memo(function LobbyPanel({ lobby }: { lobby: RunLobby }): JSX.Element | null {
  // Hooks must run unconditionally — the early return for a missing lobby lives after them.
  // SKINS: your seat wears your run's recorded skin; every other seat its owner's (default art when "Show
  // opponent skins" is off).
  const runSkins = useRunSkins();
  const showOppSkins = useGame((st) => st.showOpponentSkins);
  // THE DOCKED RAIL (owner 2026-10-31): its dials (Lobby Rail Tuner 2 in DEV; DOCK_DEFAULTS in production).
  const dockCfg = useDockCfg();
  // What each docked slice's label says (Tuner 2 "Slice label"; production: the player's name).
  const sliceLabel = useSliceLabel();
  const railRef = useRef<HTMLDivElement>(null);
  // The portrait-frames tuner's rings for the seat faces (null = today's plain round face).
  const selfFrame = usePortraitFrame('self', frameIdOf(runSkins)); // your seat: the frame recorded on this run
  const oppFrame = usePortraitFrame('opp');
  // THE RUN ON SCREEN (R-DUOS-VIEW-NOREMOUNT-01): a Duos teammate swap re-renders this rail in place (it is no longer
  // remounted), so the "first sight of a table" diffs below start over on it, exactly as a remount made them.
  const swapped = useScreenSwapped(useGame((st) => `${st.run.runId ?? ''}:${st.run.seed}:${st.run.heroId}`));
  const seenRound = useSwapRef<number | null>(null, swapped); // the round whose damage floats already played (null = first sight)
  const pendingFloatRef = useRef<(() => void) | null>(null);
  // The hovered seat AND where it sits on screen. The anchor is measured because the card is `position: fixed`
  // — see `ScoutCard`. One measurement per hover, not per frame, so this does not violate the layout-read rule.
  const [hovered, setHovered] = useState<{ id: string; top: number; right: number } | null>(null);
  // RIGHT-CLICK INSPECT (owner ask 2026-08-03). The hover card vanishes the moment the pointer leaves the
  // seat, so its rune/quest badges are unreachable — you cannot travel to them without crossing the gap and
  // dismissing the thing you were aiming at. A PINNED copy solves exactly that: right-click to pin, and the
  // card stays until you dismiss it, so the badges can be hovered for their own tooltips. Mirrors the
  // right-click card inspect players already know (`Inspect.tsx`).
  const [pinned, setPinned] = useState<{ id: string; top: number; right: number } | null>(null);
  // THE RAIL IS INERT WHILE IT IS SLID AWAY (owner bug 2026-10-06: "the lobby rail shouldnt be able to be moused
  // over here"). `combatStaged` is the same window that puts `.app.staged` on the app (the rail's slide-away, see
  // Recruit.tsx). The CSS makes every rail descendant pointer-inert then; this is the state half: the scout card is
  // portaled to <body>, OUTSIDE `.app`, so a card already open when the fight starts would otherwise stay up over
  // the duel. Staging closes both the hover and the pinned card, and no new one can open until the rail is back.
  const staged = useGame((st) => st.combatStaged);
  useEffect(() => {
    if (!staged) return;
    setHovered(null);
    setPinned(null);
  }, [staged]);
  // THE GUIDES VIEW (owner ask 2026-10-09; moved 2026-10-31, R-GUIDES-CORNER-01: "the guides button likely needs a new
  // home entirely, like in the bottom right and have it expand upwards"): the build guides for this game's set + tribes
  // (guides/guides.ts) open from a Guides square in the bottom-right cluster, as a panel growing UP out of it; the rail
  // itself always shows the table. Gone in combat, back on the view it left. Off in the Tutorial, whose coach marks point
  // at the seats. The Versus 1v1 keeps its own drawer (the rail's Guides face, opened from the opponent block's plate).
  const runKey = useGame((st) => `${st.run.runId ?? ''}:${st.run.seed}`);
  const setId = useGame((st) => st.run.setId);
  const runTribes = useGame((st) => st.run.tribes);
  const guidesOn = useGame((st) => st.run.mode !== 'tutorial');
  // EVERY MODE ON THE RAIL (owner 2026-10-31: "I think we should move all modes to this rail type. 1v1, even 3 and 4 player
  // group games"; R-RAIL-DOCKED-ALLMODES-01): a Versus 1v1 is the rail like every other mode (you and the opponent as two
  // slices). The 1v1 opponent block, its middle-right placement and its Guides drawer are retired; the Guides tab flips
  // the rail as in a lobby game.
  // The guide list is a SNAPSHOT of the guides store, retaken each time the Guides view opens (below), never a
  // subscription: a refresh that lands while the player is reading must not move a card under them. It is retaken
  // in a LAYOUT effect, before paint, so a refresh that landed while the view was closed never shows as a
  // one-frame jump on open. The player's own guides and their bookmarks are part of the same snapshot.
  // The snapshot also records WHICH ACCOUNT it was taken for: the player's own guides and bookmarks are private, so
  // they are shown only while that account is still the signed-in one (an account switch with the view open must not
  // show them), and they are only ever taken from a store that holds them for that same account (`snapGuides`). A
  // bookmark made while the view is open joins the next snapshot, never the open one.
  const [guideSnap, setGuideSnap] = useState(snapGuides);
  const guides = useMemo(() => guidesFor(setId, runTribes, guideSnap.list), [setId, runTribes, guideSnap.list]);
  const myGuidesAll = useMemo(() => guidesFor(setId, runTribes, guideSnap.mine), [setId, runTribes, guideSnap.mine]);
  // A bookmark already drawn as a Team Ascent guide or as the player's own is not drawn twice.
  const bookmarkedAll = useMemo(() => {
    const drawn = new Set([...guides, ...myGuidesAll].map((g) => g.id));
    return guidesFor(setId, runTribes, guideSnap.bookmarked).filter((g) => !drawn.has(g.id));
  }, [setId, runTribes, guideSnap.bookmarked, guides, myGuidesAll]);
  // Who may edit: a boolean and an id, both cheap to subscribe to. The guide LISTS are still only a snapshot.
  // Editing needs the server, so no Edit button unless the guides capability is on.
  // The team flag belongs to the account the store read it for (`mineOwner`), like the player's own guides: it counts
  // only while that account is the signed-in one, never for the next account at the same screen (as the Compendium).
  const guideTeamOwner = useGuides((s) => (s.team ? s.mineOwner : null));
  const guidesLive = useGuides((s) => s.capability === 'on');
  const guideUserId = useGame((st) => st.account.userId);
  const guideTeam = ownsMine({ mineOwner: guideTeamOwner }, guideUserId);
  const myGuides = guideUserId === guideSnap.uid ? myGuidesAll : NO_GUIDES;
  const bookmarkedGuides = guideUserId === guideSnap.uid ? bookmarkedAll : NO_GUIDES;
  const guideCount = guides.length + myGuides.length + bookmarkedGuides.length;
  // A SPECTATOR reads their own guides on the watch screen (owner 2026-10-16: "as a spectator, can you make it so they can
  // view their guides that they have / interact/flip the lobby rail"; R-SPECTATE-LOCAL-01), read only: no Edit (it
  // would leave the watch screen for the Compendium). Every rail interaction is this component's own state, so nothing
  // a spectator does here reaches the watched game, and nothing the player broadcasts moves it.
  const spectating = useSpectate((s) => s.active);
  const canEditInRail = useCallback((g: Guide) => !spectating && guidesLive && canEditGuide(g, guideUserId, guideTeam), [spectating, guidesLive, guideUserId, guideTeam]);
  const [view, setView] = useState<RailView>(() => (railViewMemo.run === runKey ? railViewMemo.view : 'opponents'));
  const [mode, setModeState] = useState<GuidesMode>(readGuidesMode);
  // The swap animation, set only by a toggle (never on mount): the rail widens into the FULL Guides view and narrows
  // back out of it; any other flip just fades the new face in.
  const [swap, setSwap] = useState<'wide' | 'narrow' | 'fade' | null>(null);
  useEffect(() => { if (railViewMemo.run !== runKey) { setView('opponents'); setSwap(null); } }, [runKey]);
  useEffect(() => { railViewMemo = { run: runKey, view }; }, [runKey, view]);
  const showGuides = guidesOn && view === 'guides';
  // Only the Versus 1v1 drawer still turns the RAIL to its Guides face; everywhere else the guides are the corner panel.
  // R-RAIL-DOCKED-ALLMODES-01: no mode shows the guides on the rail any more (the 1v1 drawer went with the opponent block);
  // every mode opens them from the Guides corner.
  const versusDuelView = false as boolean;
  const railGuides = showGuides && versusDuelView;
  // The corner panel sinks back into its button before it unmounts (`gdClosing` holds it on screen for that).
  const [gdClosing, setGdClosing] = useState(false);
  const gdTimer = useRef(0);
  // DUOS: the panel's foot sits above the teammate portrait (owner 2026-10-31: the panel must not cover it), read ONCE as
  // it opens (a layout read on a press, never per frame). Null = just above the Guides button (the CSS default).
  const [gdFloor, setGdFloor] = useState<number | null>(null);
  useEffect(() => () => window.clearTimeout(gdTimer.current), []);
  useLayoutEffect(() => {
    if (!showGuides) return;
    const next = snapGuides();
    // Same three arrays and account as last time = the same snapshot object, so nothing re-renders.
    setGuideSnap((cur) => (cur.list === next.list && cur.mine === next.mine && cur.bookmarked === next.bookmarked && cur.uid === next.uid ? cur : next));
  }, [showGuides]);
  // THE CORNER BUTTON: open grows the panel out of it; close sinks it back in (then it unmounts).
  const toggleView = (): void => {
    setHovered(null);
    setPinned(null);
    window.clearTimeout(gdTimer.current);
    if (view === 'guides') {
      setGdClosing(true);
      gdTimer.current = window.setTimeout(() => setGdClosing(false), GUIDES_CLOSE_MS);
      setView('opponents');
    } else {
      setGdClosing(false);
      setGdFloor(guidesFloor());
      setView('guides');
    }
  };
  // Escape closes the corner panel (capture: the Esc menu does not open under it).
  const closeOnEsc = showGuides && !versusDuelView;
  useEffect(() => {
    if (!closeOnEsc) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      window.clearTimeout(gdTimer.current);
      setGdClosing(true);
      gdTimer.current = window.setTimeout(() => setGdClosing(false), GUIDES_CLOSE_MS);
      setView('opponents');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [closeOnEsc]);
  const setMode = (m: GuidesMode): void => {
    if (m === mode) return;
    if (railGuides) setSwap(m === 'full' ? 'wide' : 'narrow');
    setModeState(m);
    try { localStorage.setItem(GUIDES_MODE_KEY, m); } catch { /* storage unavailable: the choice lasts this session */ }
  };
  // DETAILED folds back to SIMPLE on a press anywhere outside the rail (owner 2026-10-12: "clicking outside of the
  // guide area should automatically collapse back to the simple view"). The rail, its view tab and its header are
  // "inside". Listening only while Detailed is showing, so the Opponents view and Simple cost nothing and a press
  // elsewhere never rewrites the saved choice behind the player's back. Capture phase + `pointerdown`: it also folds
  // when a drag starts on the board, and nothing can swallow the press first. The press itself is left alone.
  useEffect(() => {
    if (!showGuides || mode !== 'full') return;
    const onDown = (e: Event): void => {
      const t = e.target;
      if (t instanceof Element && t.closest('.lobbyrail, .lobbyrailhead, .vsfoe-guides, .guidesdock, .guidesbtn')) return;
      if (railGuides) setSwap('narrow');
      setModeState('simple');
      try { localStorage.setItem(GUIDES_MODE_KEY, 'simple'); } catch { /* storage unavailable: the choice lasts this session */ }
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [showGuides, mode, railGuides]);
  const railMods = `${railGuides ? ` guidesview guides-${mode}` : ''}${swap ? ` swap-${swap}` : ''}`;
  const openScout = (e: React.MouseEvent<HTMLDivElement>, id: string): void => {
    if (staged) return;
    const b = e.currentTarget.getBoundingClientRect();
    setHovered({ id, top: toStage(b.top + b.height / 2), right: toStage(b.left) }); // screen -> stage (stage.ts): `at` is CSS px
  };
  const pinScout = (e: React.MouseEvent<HTMLDivElement>, id: string): void => {
    e.preventDefault(); // no browser context menu over the rail
    if (staged) return;
    const b = e.currentTarget.getBoundingClientRect();
    setPinned((p) => (p?.id === id ? null : { id, top: toStage(b.top + b.height / 2), right: toStage(b.left) })); // toggle; stage px
  };
  // Escape closes it, like every other dismissible overlay in the app.
  useEffect(() => {
    if (!pinned) return;
    const onKey = (ev: KeyboardEvent): void => { if (ev.key === 'Escape') setPinned(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pinned]);
  // CLICK-OUTSIDE CLOSES (owner ask 2026-08-31, replacing the corner ×). A click inside the card keeps it; a
  // click on a seat is left to the seat's own handler (it switches/toggles the pin); anything else dismisses it.
  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: MouseEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('.lobbyscout') || t.closest('.lobbyseat'))) return;
      setPinned(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pinned]);

  // THE ROUND'S DAMAGE, ANNOUNCED ONCE (owner ask 2026-10-03: "remove the -x number here. when the player gets back to
  // lobby, they can have the damage dealt to players show and float/fade, but dont leave it on the rail"). The rail
  // used to print every seat's last-round loss as a static number that sat there all shop phase; now each seat that
  // took damage gets a one-shot "-N" that pops on its row, rises a little and fades (`floatLobbyDamageOnSeats`), and
  // the hover card carries the lasting record (its last-fights list). This absorbed the older "damage you dealt"
  // float: your foe's loss is one of the seats announced.
  //
  // Keyed on the ROUND, not on a render: the panel re-renders constantly during a shop phase and the rows re-sort by
  // health the instant a round settles, so anything tied to an element's lifetime would fire repeatedly or not at all.
  // The FIRST sight of a table (mount, reload, a new run) only records its round, like the knockout below, so a
  // reload never replays a fight that already happened. Held until the combat -> shop curtain is down (the round
  // settles under full blue; see whenCurtainDown), then a rAF lets the re-sorted rows lay out before one is measured.
  // Not cancelled by a re-render (the lobby object changes under the hold; the round guard would then never re-arm
  // it): only a newer round's floats or unmounting drop a pending one.
  useEffect(() => {
    if (!lobby) return;
    const prev = seenRound.current;
    seenRound.current = lobby.round;
    if (prev === null || prev === lobby.round) return;
    const floats = roundDamageFloats(lobby.seats, lastRoundDamage(lobby));
    if (floats.length === 0) return;
    pendingFloatRef.current?.();
    pendingFloatRef.current = whenCurtainDown(() => {
      requestAnimationFrame(() => { floatLobbyDamageOnSeats(floats); }); // every row measured, then every float added
    });
  }, [lobby?.round, lobby]);
  useEffect(() => () => pendingFloatRef.current?.(), [runKey]);

  // THE KNOCKOUT (owner ask 2026-10-02): a seat that falls plays a one-shot smoke burst on its row as the row fades
  // into its dead look (lobbyKnockoutFx.ts). Diffed against the alive set this panel last saw, so it fires once per
  // elimination; the first sight of a table (mount / reload / new run) only records it, so an already-dead seat stays
  // static. Held for the curtain like the damage float, so it plays over the revealed rail.
  const aliveRef = useSwapRef<Set<string> | null>(null, swapped);
  const koTimers = useRef<(() => void)[]>([]);
  const [koIds, setKoIds] = useState<readonly string[]>([]);
  useEffect(() => {
    if (!lobby) return;
    const fresh = newlyKnockedOut(aliveRef.current, lobby.seats);
    aliveRef.current = aliveSet(lobby.seats);
    if (fresh.length === 0) return;
    let clear = 0;
    const cancelHold = whenCurtainDown(() => {
      requestAnimationFrame(() => {
        playLobbyKnockoutOnSeats(fresh); // every row measured, then every effect played
        setKoIds((k) => [...k, ...fresh]);
        clear = window.setTimeout(() => setKoIds((k) => k.filter((id) => !fresh.includes(id))), LOBBY_KO_MS + 100);
      });
    });
    koTimers.current.push(() => { cancelHold(); window.clearTimeout(clear); });
  }, [lobby]);
  useEffect(() => () => { for (const stop of koTimers.current.splice(0)) stop(); }, [runKey]);

  // THE MAX-DAMAGE PUNCH (owner ask 2026-10-09: "add a small animation to the max dmg thing in the rail when it
  // updates to the next threshold. it should be an obvious animation that draws attention"). Diffed against the cap
  // this panel last saw FOR THIS RUN, so it fires once per real change (into "No cap" too), never on mount, a reload,
  // a new game or a re-render. Held for the combat -> shop curtain like the damage float, so it plays where the
  // player can see it. `capPop` keys the pill: each bump remounts it, which restarts the one-shot CSS animation.
  const capNow = lobby ? roundLossCap(lobby.rules, lobby.round) : null;
  const seenCap = useRef<{ run: string; cap: number } | null>(null);
  const [capPop, setCapPop] = useState(0);
  useEffect(() => {
    if (capNow === null) return;
    const prev = seenCap.current;
    seenCap.current = { run: runKey, cap: capNow };
    if (!prev || prev.run !== runKey || prev.cap === capNow) return;
    let raf = 0;
    const cancel = whenCurtainDown(() => { raf = requestAnimationFrame(() => setCapPop((n) => n + 1)); });
    return () => { cancel(); cancelAnimationFrame(raf); };
  }, [capNow, runKey]);

  if (!lobby) return null;
  // A full bar is the seat's OWN start: Resolve + its hero's Armor (R-LOBBY-SEAT-ARMOR-01, owner 2026-10-17).
  // VERSUS seats carry their own start Armor (`startArmor`: a Summit room's +10, a Duos team's pool).
  const maxHpOf = (seat: { kind: string; heroId: string; startArmor?: number }): number => lobby.rules.startingResolve + seatStartingArmor(seat, lobby.rules);
  // YOUR OWN row reads the RUN's health, not the seat's. The seat is only re-synced when the table settles (at
  // `resolveCombat`), while the run takes your hit the moment combat ends — so between those two the seat is
  // stale and the rail would disagree with the HUD for the whole post-combat screen (owner report 2026-08-25).
  // The run IS the player's authority and the seat is synced from it every settle, so this is the same number
  // everywhere, just never stale. Opponent seats keep reading their own seat, which is their only source.
  const myResolve = useGame((st) => st.run.resolve);
  const myArmor = useGame((st) => st.run.armor);
  // VERSUS (owner 2026-10-26, R-VERSUS-HEALTH-01: "the experience is the same"): every seat plays on Health + Armor like
  // a lobby seat. The other seats read the server's record off the display lobby (`versusLobby` / `versusGroupLobby`);
  // your own row reads the RUN, exactly as in a lobby game (the run lands the resolver's pools when the fight settles).
  const versus = useGame((st) => st.run.mode === 'versus');
  // EVERY NUMBER THE RAIL PRINTS comes from ONE pure read, `lobbyRailView` (R-LOBBY-RAIL-01): the round, the max
  // damage, "N left", the row order (living by Resolve + Armor, ties in seat order; the fallen by placement), each
  // row's health and placement, and the next-opponent / ghost marks. `railAccuracy.test.ts` plays real lobbies and
  // checks every field against what each round actually did. Your own row reads the RUN, which takes your hit the
  // moment the fight settles (owner report 2026-08-25), in VERSUS too. Every Versus mode (1v1, Group, Duos, Ranked Duos)
  // is the rail with every player (you included) on their Health + Armor, the Copy in the last slot while one is in play
  // (R-VERSUS-GROUP-03, R-RAIL-DOCKED-ALLMODES-01).
  // VERSUS DUOS (R-DUOS-01): the teammate's row (always s1), kept next to yours. A click opens their live screen
  // (R-DUOS-VIEW-01), a second way in beside the bottom-right teammate portrait (the pass target, DuosMateDock).
  const duosMate = useVersus((st) => (versus && st.match?.group?.duos?.mate && st.match.group.me ? 's1' : null));
  // RANKED DUOS (owner 2026-10-26: team names "shown on the rail"): each team's name on its first row.
  const rankedRaw = useVersus((st) => (versus && st.match?.group && isRankedDuosRaw(st.match.group.raw) ? st.match.group.raw : null));
  const rankedMe = useVersus((st) => st.match?.group?.me ?? null);
  const teamLabels = useMemo(() => (rankedRaw && rankedMe ? rankedTeamLabels(rankedRaw, rankedMe, rankedRaw.servedTeamNames ?? {}) : null), [rankedRaw, rankedMe]);
  // EVERY DUOS VIEW (a spectator too, who has no teammate of their own): the table is in teams, so the docked slices are
  // grouped per team. `mateId`: the viewed player's teammate's slice (s1), drawn distinct.
  const duosTeams = useVersus((st) => versus && !!st.match?.group?.duos);
  const mateId = duosMate ?? (duosTeams ? 's1' : null);
  // What each Versus player is doing (Locked in / Ready / Away / Disconnected), on their own docked slice
  // (versusRailStatus.ts). One string per change, so the rail re-renders only when a state flips.
  const statusKey = useVersus((st) => {
    if (!versus) return '';
    const sp = useSpectate.getState();
    const viewer = st.match?.group ? st.match.group.me ?? (sp.active ? sp.seat : null) : mySeat(st.match) ?? (sp.active ? sp.seat : null);
    return railStatusKey(versusRailStatuses(st.match, viewer));
  });
  const statuses = useMemo(() => parseRailStatusKey(statusKey), [statusKey]);
  const rail = lobbyRailView(lobby, { opponent: playerOpponent(lobby), self: { resolve: myResolve, armor: myArmor } });
  const next = rail.opponent;
  const foe = next?.seat ?? null;
  // The foe's board is already prepared by `playerOpponent`, so reading it is free, and the imminent opponent has
  // CURRENT intel even on round 1. Every card reads the round you are IN, by one rule (`railSeatIntel`).
  const foeIntel: SeatIntel | undefined = foe ? railSeatIntel(lobby, foe, next) : undefined;
  // VERSUS DUOS: team rows grouped (you next to your teammate), never split by Health.
  const rows = duosMate || duosTeams ? groupDuosRailRows(rail.rows) : rail.rows;
  // THE DOCKED RAIL (owner 2026-10-31): the seats laid out on the board's right side, measured off the board's own Refresh
  // / gem / Gold (useDockedRail). It needs that HUD on screen and room beside it; anywhere it cannot (the Guides view, a Duos
  // team rail, the Versus 1v1 block, a board without its HUD) the rail is the Gem rail (lobbyRail.css), as before.
  const liveIds = useMemo(() => rows.filter((r) => r.alive).map((r) => r.id), [rows]);
  const deadIds = useMemo(() => rows.filter((r) => !r.alive).map((r) => r.id), [rows]);
  // R-RAIL-DOCKED-ALLMODES-01: Duos and Ranked Duos dock too, laid out in teams (`teamOf`: each slice's team, the pairs
  // side by side; Ranked Duos keeps a gap above every team for its name). With no room to dock, a Duos table keeps its
  // team slots on the Gem rail.
  const dockWanted = !railGuides;
  const teamOf = useMemo(() => (duosTeams ? [...liveIds, ...deadIds].map(duosRailTeamOf) : undefined), [duosTeams, liveIds, deadIds]);
  const dock = useDockedRail(dockWanted, railRef, liveIds, deadIds, dockCfg, staged, teamOf, !!teamLabels);
  // A team's ONE Health pool shows once (R-DUOS-RAIL-TEAM-01, docked too): on its last slice, the pair's foot.
  const teamBarIds = useMemo(() => (dock?.teams ? new Set(dock.teams.map((t) => t.ids[t.ids.length - 1]!)) : null), [dock]);
  const rv = !!dock;
  // Docked's class on the rail, its header and its tab (lobbyRailDocked.css keys off it).
  const vMod = rv ? ' lrv-docked' : '';
  // The board pieces beside the rail take the pointer only through their own shapes while it is docked (R-RAIL-DOCKED-
  // CLICKTHROUGH-01, lobbyRailDocked.css `html.rail-docked`).
  useEffect(() => {
    if (!rv) return;
    document.documentElement.classList.add('rail-docked');
    return () => { document.documentElement.classList.remove('rail-docked'); };
  }, [rv]);
  const dockById = useMemo(() => new Map<string, DockPanel>((dock?.panels ?? []).map((p) => [p.id, p])), [dock]);
  // The fallen's skulls line up in ONE column (owner 2026-10-31: "have the skull on the left over the hero all aligned"),
  // clear of the deepest cut any FALLEN slice has, so a cut never pushes one skull out of line.
  const skullX = useMemo(() => Math.max(0, ...(dock?.panels ?? []).filter((p) => p.dead).map((p) => p.midX)), [dock]);
  // THE REFLOW (owner 2026-10-31: the fallen consolidate and the living grow): when the table's order or its living /
  // fallen split changes, each seat glides from where it stood to its new place ONCE (a FLIP: transform only, short).
  // Rects are read only on that change, never per frame.
  const flipPrev = useRef(new Map<string, DOMRect>());
  const flipKey = useRef('');
  const rowsKey = rows.map((r) => `${r.id}${r.alive ? '' : 'x'}`).join(',');
  useLayoutEffect(() => {
    const layer = railRef.current;
    if (!rv || railGuides || !layer) { flipPrev.current = new Map(); flipKey.current = ''; return; }
    const key = rowsKey;
    const animate = flipKey.current !== '' && flipKey.current !== key && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const next = new Map<string, DOMRect>();
    layer.querySelectorAll<HTMLElement>('.lobbyseat[data-seat]').forEach((el) => {
      const id = el.dataset.seat!;
      const r = el.getBoundingClientRect();
      next.set(id, r);
      const p = flipPrev.current.get(id);
      if (!animate || !p || r.width <= 0 || r.height <= 0) return;
      if (Math.abs(p.left - r.left) < 1 && Math.abs(p.top - r.top) < 1 && Math.abs(p.width - r.width) < 1) return;
      const k = el.offsetWidth ? r.width / el.offsetWidth : 1;
      el.animate([
        { transformOrigin: '0 0', transform: `translate(${(p.left - r.left) / k}px, ${(p.top - r.top) / k}px) scale(${p.width / r.width}, ${p.height / r.height})` },
        { transformOrigin: '0 0', transform: 'none' },
      ], { duration: 340, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    });
    flipPrev.current = next;
    flipKey.current = key;
  }, [rv, railGuides, rowsKey, dock]);
  // The rail's height in seat rows (`--lby-n`).
  const railRows = rows.length;

  // The round's loss cap (the run's own table: the Gauntlet has its own, see `roundLossCap`). Infinity = uncapped.
  const cap = rail.lossCap;
  const capTip = maxDamageTip(cap);
  const guideCountLabel = `${guideCount} guide${guideCount === 1 ? '' : 's'}`;
  const leftLabel = railGuides ? guideCountLabel : `${versus ? rail.left - (lobby.seats.some((x) => x.id === VERSUS_COPY_SEAT_ID) ? 1 : 0) : rail.left} left`;

  return (
    <>
    {/* THE ROUND HEADER sits just ABOVE the rail's top edge, outside it (owner ask 2026-10-02: "move the Round
        text to be above the lobby rail ... move the max dmg next to the new round location ... make both larger
        ... dont let these elements move anything else in the game"). A SIBLING of the rail, not a child: the rail
        is a scroll container and would clip anything placed outside its box. `.lobbyrailhead` is absolutely
        positioned off the rail's own `right` / `top` / `width` (styles.css), so it takes no layout space and
        moves nothing. */}
    <div className={`lobbyrailhead${railMods}${vMod}${dock?.wrap ? ' lrv-wrap' : ''}`} style={{
      ...(dock ? {
        left: dock.head.x, top: dock.head.y, width: dock.head.w, height: dock.head.h, '--dk-s': dock.s, '--mx': `${dock.head.midX}px`,
        ...(dock.wrap ? { '--tah': `${dock.wrap.topH}px`, '--bx': `${dock.wrap.bandX}px` } : {}),
      } : {}),
    } as React.CSSProperties}>
      {/* DOCKED: the round slice's plate (clipped to its outline) and its gold edge along that outline, cut round the
          Refresh pill. The edge is a sibling of the clipped plate, so the stroke is never clipped in half. */}
      {dock && <span className="lrv-headbg" aria-hidden="true" style={dock.head.cut ? { clipPath: outlineClip(dock.head.outline) } : undefined} />}
      {dock && <SliceEdge p={dock.head} />}
      {/* The candidate rails split the word from the number (the wrapped round slice can set them apart); the text reads
          the same. */}
      <span className="lobbyround">{railGuides ? 'Guides' : rv ? <><span className="lr-word">Round</span> <span className="lr-num">{rail.round}</span></> : `Round ${rail.round}`}</span>
      {/* Docked: the seats-left count joins the round slice (shown in its Slight eclipse / Level layouts). */}
      {rv && !railGuides && leftLabel && <span className="lrv-left">{leftLabel}</span>}
      {/* VERSUS reads the lobby's own cap (R-VERSUS-HEALTH-01). */}
      {/* Max loss: the most Health a loss this round can cost. Hover explains it with the live number, in the
          game's standard HUD tip panel (`.herotip`, the hero-power / Equipment hover), not the small `.gtip`
          bubble: owner 2026-10-02, "fix this tooltip, it's unreadable". */}
      <span key={capPop} className={`lobbymax${capPop ? ' lobbymax-pop' : ''}`} aria-label={`${capTip.title}. ${capTip.rule}`}>
        <Icon name="heart" />{maxDamageLabel(cap)}
      </span>
      {/* The chip's SIBLING (opened by `.lobbymax:hover + .lobbymax-tip`, the opponent-power tip's pattern), so the
          chip's own text stays just the number. */}
      <span className="herotip lobbymax-tip" role="tooltip" aria-hidden="true">
        <b>{capTip.title}</b>
        <span className="herotip-rule">{capTip.rule}</span>
      </span>
    </div>
    {/* THE GUIDES CORNER (owner 2026-10-31, R-GUIDES-CORNER-01): the Guides square in the bottom-right cluster (above the
        Settings gear) and the panel that grows UP out of it. The rail's old Guides / Opponents tab is gone. Not in the
        Tutorial. Every Versus mode has it too since the 1v1 opponent block was retired (R-RAIL-DOCKED-ALLMODES-01). */}
    {guidesOn && (
      <button type="button" className={`guidesbtn gtip${showGuides ? ' on' : ''}`} data-tip={showGuides ? undefined : 'Guides'}
        aria-label={showGuides ? 'Close build guides' : 'Open build guides'} aria-pressed={showGuides} aria-expanded={showGuides} onClick={toggleView}>
        <Icon name={showGuides ? 'chevron' : 'book'} />
      </button>
    )}
    {guidesOn && !staged && (showGuides || gdClosing) && (
      <div className={`guidesdock guides-${mode}${showGuides ? '' : ' closing'}`} role="region" aria-label="Build guides"
        style={gdFloor !== null ? ({ '--gd-bottom': `${gdFloor}px` } as React.CSSProperties) : undefined}>
        <div className="guidesdock-head">
          <span className="guidesdock-title">Guides</span>
          <span className="guidesdock-count">{guideCountLabel}</span>
        </div>
        <div className="lobbyview">
          <LobbyGuides guides={guides} mine={myGuides} bookmarked={bookmarkedGuides} canEdit={canEditInRail} tribes={runTribes} runKey={runKey} mode={mode} onMode={setMode} />
        </div>
      </div>
    )}
    {/* `--lby-n`: the seat count, so the Gem rail can hold exactly the height Classic sizes to (lobbyRail.css). */}
    <div ref={railRef} className={`lobbyrail${railMods}${vMod}`} style={{
      '--lby-n': railRows,
    } as React.CSSProperties}>
      <div className="lobbyhead">
        <span className="lobbyalive">{leftLabel}</span>
      </div>

      {railGuides ? (
        <div className={`lobbyview${swap ? ' lobbyview-in' : ''}`} key="guides">
          <LobbyGuides guides={guides} mine={myGuides} bookmarked={bookmarkedGuides} canEdit={canEditInRail} tribes={runTribes} runKey={runKey} mode={mode} onMode={setMode} />
        </div>
      ) : (
      <div className={`lobbyseats${swap ? ' lobbyview-in' : ''}`} key="seats">
        {(() => {
        // One seat's row. In a Duos TEAM SLOT (`inTeam`) the row is just the face and the name: the team's name and its
        // one Health pool sit on the slot (R-DUOS-RAIL-TEAM-01).
        const seatRow = (row: (typeof rows)[number], inTeam = false): JSX.Element => {
          const seat = lobby.seats.find((s) => s.id === row.id)!;
          const isYou = row.you;
          const isFoe = row.next;
          // A GHOST pairing: this round's foe is a fallen seat's board (`playerOpponent`'s `ghost`), marked in teal.
          const isGhost = row.ghost;
          const live = row;
          const hp = live.resolve + live.armor;
          const maxHp = Math.max(1, maxHpOf(seat));
          // The scout card reads the seat's board for the round you are IN (`seatScoutIntel`, R-LOBBY-SCOUT-01), the
          // same round the foe's card reads, never the settle-recorded `seat.intel` (a round behind, and never written
          // for the seat you fought). Read only for a hovered / pinned card, so the rail pays nothing otherwise.
          const scoutOpen = !staged && !isYou && (hovered?.id === seat.id || pinned?.id === seat.id);
          const intel = !scoutOpen ? undefined : isFoe ? foeIntel : railSeatIntel(lobby, seat, next);
          // `dp`: this seat's docked slice (its box, outline and where its foot and top run clear of a cut).
          const dp = dock ? dockById.get(seat.id) : undefined;
          // THE HEALTH BAR (owner 2026-10-31: "make the health bars chunkier ... A grey overlay of a portion of the right side
          // of the health bar should represent armor, based on the number of armor compared to the 30 hp"): red = Health
          // over the seat's max Health (30 in a lobby), grey = Armor over the same max, sitting just right of the red; when
          // the two together pass the max, the grey sits over the right end of the bar (on top of the red).
          const hpFrac = Math.max(0, Math.min(1, live.resolve / maxHp));
          const armFrac = Math.max(0, Math.min(1, live.armor / maxHp));
          const armEnd = Math.min(1, hpFrac + armFrac);
          return (
            <div
              key={seat.id}
              data-seat={seat.id}
              // LIVE PINGS (R-PING-08): a teammate or mentor pings a seat; the player's own right-click stays the scout pin.
              data-ping={railKey(seat.id)} data-ping-own="" data-ping-at="left"
              className={`lobbyseat${inTeam ? ' inteam' : ''}${isYou ? ' you' : ''}${isFoe ? ' foe' : ''}${isGhost ? ' ghost' : ''}${seat.alive ? '' : ' dead'}${koIds.includes(seat.id) ? ' ko' : ''}${seat.id === mateId ? ' mate' : ''}`}
              {...(seat.id === duosMate ? { 'aria-label': `${seat.label}, your teammate. Click to watch their board.` } : {})}
              // Hover scouting works on EVERY seat, yours included (owner ask 2026-09-24: "add the same mouseover
              // for self as we have for enemies"). Pinning stays opponent-only; the owner asked for the hover.
              onMouseEnter={(e) => openScout(e, seat.id)}
              onMouseLeave={() => setHovered((h) => (h?.id === seat.id ? null : h))}
              // Left OR right click pins the card (and clicking a different seat switches to it) — owner ask 2026-08-31.
              onClick={isYou ? undefined : seat.id === duosMate ? () => enterTeammateView() : (e) => pinScout(e, seat.id)}
              onContextMenu={isYou ? undefined : (e) => pinScout(e, seat.id)}
              style={dp ? {
                left: dp.x, top: dp.y, width: dp.w, height: dp.h,
                '--pw': `${dp.w}px`, '--ph': `${dp.h}px`, '--dk-s': dock!.s, '--fx': `${dp.footX}px`, '--mx': `${dp.midX}px`, '--hx': `${dock!.numX}px`, '--bx': `${dp.topX}px`, '--skx': `${skullX}px`,
              } as React.CSSProperties : undefined}
            >
              {dp && !inTeam ? (
                // DOCKED / TILES (owner 2026-10-31: "large icons and an eclipsed health bar on the portrait"): the
                // portrait fills the panel; the standing on the ladder's medallion at its top-left (the leader also wears
                // the crown); a chunky Health bar eclipsing the portrait's foot, Armor a grey chunk at its right end (the
                // numbers are on the hover card); the fallen grey with a skull, in the compact strip.
                // Docked slices beside the Refresh pill, the gem or the Gold coin are cut round it (owner 2026-10-31: "i
                // loved the cutout slices"): the portrait takes the slice's outline as its clip, and the gold edge (and
                // the next foe's red ring) is drawn along the same outline, so every cut reads as finished.
                <>
                  <span className="lrv-tileart" aria-hidden="true" style={dp?.cut ? { clipPath: outlineClip(dp.outline) } : undefined}>
                    <FadeImg className="lobbyface" src={railSliceFace(heroPortrait(seat.heroId, isYou ? runSkins : opponentSkins(showOppSkins, seat.cosmetics)), dp)} alt="" />
                  </span>
                  {dp && <SliceEdge p={dp} />}
                  {dp && !dp.dead && isFoe && <SliceEdge p={dp} ring />}
                  {/* The target (owner 2026-10-31: "the current target needs to be way more obvious"): the crossed swords
                      the rail has always used for the next foe, on the slice's top-right corner. */}
                  {isFoe && row.alive && <span className={`lrv-vs${isGhost ? ' ghost' : ''}`} aria-label="Your next opponent"><Icon name="sword" /><Icon name="sword" /></span>}
                  {/* No standing medal or crown (owner 2026-10-31: the order says it); the player's NAME sits over the faded
                      side of the art instead. */}
                  {/* The slice's label (Tuner 2 "Slice label"): the player's name (default), the hero's name, or none. Same
                      font, alignment and 2-line ellipsis either way; the fallen follow it too. */}
                  {sliceLabel !== 'none' && <span className="lrv-name"><ClampedName text={sliceLabel === 'hero' ? getHero(seat.heroId)?.name ?? seat.label : seat.label} /></span>}
                  {/* VERSUS: what this player is doing, when it matters (versusRailStatus.ts). Keyed by the label, so each
                      change pops in once. Your own is on your End Turn gem. */}
                  {!isYou && row.alive && statuses[seat.id] && (
                    <span key={statuses[seat.id]!.label} className={`lrv-status ${statuses[seat.id]!.tone}`}>{statuses[seat.id]!.label}</span>
                  )}
                  {/* A DUOS team's shared pool is drawn once, on the pair's last slice; the other slice carries no bar. */}
                  {row.alive && teamBarIds && !teamBarIds.has(seat.id) ? null : row.alive ? (<>
                    {/* HEALTH NUMBERS (owner 2026-10-31: "can we make that a number?"): Health, Armor under it, on the navy
                        side. Tuner 2 "Show Health as" picks these (default), the bar below, or both. */}
                    <span className="lrv-hpnum" role="img" aria-label={`Health ${live.resolve}${live.armor > 0 ? `, Armor ${live.armor}` : ''}`}>
                      <span className="lrv-hpn-hp"><Icon name="heartPill" />{live.resolve}</span>
                      {live.armor > 0 && <span className="lrv-hpn-arm"><Icon name="shield" />{live.armor}</span>}
                    </span>
                    <span className="lrv-barclip" style={dp?.cut ? { clipPath: outlineClip(insetOutline(dp.outline, 4 * dock!.s, dp.w)) } : undefined}>
                    <span className="lrv-bar" role="img" aria-label={`Health ${live.resolve}${live.armor > 0 ? `, Armor ${live.armor}` : ''}`}>
                      <span className="lrv-bar-hp" style={{ transform: `scaleX(${hpFrac})` }} />
                      {armFrac > 0 && <span className="lrv-bar-arm" style={{ transform: `translateX(${((armEnd - armFrac) * 100).toFixed(2)}%) scaleX(${armFrac})` }} />}
                      {/* The hairline between red and grey: its own full-width layer moved to the seam (translate only). */}
                      {armFrac > 0 && <span className="lrv-bar-seam" style={{ transform: `translateX(${((armEnd - armFrac) * 100).toFixed(2)}%)` }} />}
                      {/* The Health fill's leading edge: a soft glow at the end of the red (its own layer, translate only). */}
                      {hpFrac > 0 && <span className="lrv-bar-lead" style={{ transform: `translateX(${(hpFrac * 100).toFixed(2)}%)` }} />}
                    </span>
                  </span></>) : <span className="lrv-skull" aria-label="Knocked out"><Icon name="skull" /></span>}
                </>
              ) : (<>
              {(() => {
                const full = heroPortrait(seat.heroId, isYou ? runSkins : opponentSkins(showOppSkins, seat.cosmetics));
                // R-PHONE-HERO-SHARP-01: on a phone the rail's face is ~60 device px, so it loads the 160 px thumbnail
                // (desktop: unchanged), and the seat's 512 px master is fetched (not decoded) ahead of the fight, where
                // it becomes the combat foe's portrait.
                const src = heroThumb(full);
                warmSharpArt([full]);
                // An opponent seat wears its recorded portrait frame (through "Show opponent cosmetics", owner
                // 2026-10-01), else the tuner's opponent ring. `oppFrame` keeps the rail subscribed to tuner writes.
                const seatFrameId = isYou ? null : frameIdOf(opponentSkins(showOppSkins, seat.cosmetics));
                const frame = isYou ? selfFrame : seatFrameId ? resolvePortraitFrame('opp', seatFrameId) : oppFrame;
                // With a tuner frame on, the face moves into a `.lobbyface` host (it keeps the grid seat + size)
                // that carries the ring; without one the markup is exactly what it always was.
                return frame ? (
                  <span className="lobbyface lobbyface-host pf-on" style={frame.hostStyle}>
                    <FadeImg className="lobbyface-img" src={src} alt="" />
                    <PortraitFrame frame={frame} />
                  </span>
                ) : <FadeImg className="lobbyface" src={src} alt="" />;
              })()}
              {/* The opponent name owns its own full-width row (styles.css `.lobbynameline`). The next foe is
                  marked by the seat's own bright pulsing glow (the `foe` class → `.lobbyseat.foe`), not a pill. */}
              <span className={`lobbynameline${!inTeam && teamLabels?.[seat.id] ? ' hasteam' : ''}`}>
                {/* RANKED DUOS: the team's name heads its first row on a line of its own, above the player's name (owner
                    live test 2026-10-26: laid over the row it collided with the name). */}
                {!inTeam && teamLabels?.[seat.id] && <span className="lobbyteam" aria-label={`Team ${teamLabels[seat.id]}`}>{teamLabels[seat.id]}</span>}
                <span className="lobbyname">{seat.label}</span>
              </span>
              {inTeam ? null : row.alive ? (
                <span className="lobbyhp">
                  {/* The health pill heart: its facet + gloss show in the Gem rail and hide in Classic (lobbyRail.css). */}
                  <Icon name="heartPill" />{live.resolve}
                  {live.armor > 0 && <span className="lobbyarmor"><Icon name="shield" />{live.armor}</span>}
                </span>
              ) : (
                <span className="lobbyplace">{row.placement ? `#${row.placement}` : 'out'}</span>
              )}
              {!inTeam && row.alive && (
                <span className="lobbybar">
                  <span style={{ width: `${Math.max(0, Math.min(100, (hp / maxHp) * 100))}%` }} />
                </span>
              )}
              </>)}
              {!staged && hovered?.id === seat.id && pinned?.id !== seat.id && (isYou
                ? <SelfScoutCard lobby={lobby} seat={seat} at={hovered} hp={live} compact={rv} />
                : <ScoutCard lobby={lobby} seat={seat} intel={intel} at={hovered} hp={live} compact={rv} />)}
              {!staged && pinned?.id === seat.id && (
                <ScoutCard lobby={lobby} seat={seat} intel={intel} at={pinned} pinned hp={live} compact={rv} />
              )}
            </div>
          );
        };
        // DOCKED: every slice placed by the layout; a Duos table also gets one plate per team round its pair, under the
        // slices, and (Ranked Duos) each team's name in the gap above it.
        if (dock) {
          const membersOf = (ids: readonly string[]): typeof rows => rows.filter((r) => ids.includes(r.id));
          return (
            <>
              {dock.teams?.map((t) => {
                const members = membersOf(t.ids);
                const mod = `${members.some((m) => m.you) ? ' you' : ''}${members.some((m) => m.next) ? ' foe' : ''}${members.some((m) => m.alive) ? '' : ' dead'}`;
                return (
                  <div key={`team${t.team}`} className={`lrv-team${mod}`} data-team={t.team} aria-hidden="true"
                    style={{ left: t.x, top: t.y, width: t.w, height: t.h, '--dk-s': dock.s } as React.CSSProperties} />
                );
              })}
              {dock.teams?.map((t) => {
                const members = membersOf(t.ids);
                const label = members.map((m) => teamLabels?.[m.id]).find(Boolean) ?? null;
                if (!label) return null;
                const mod = `${members.some((m) => m.you) ? ' you' : ''}${members.some((m) => m.alive) ? '' : ' dead'}`;
                return (
                  <span key={`tname${t.team}`} className={`lrv-teamname${mod}`} aria-label={`Team ${label}`}
                    style={{ left: t.x + (dockById.get(t.ids[0]!)?.topX ?? 0), top: t.labelY, maxWidth: t.w * 0.9, '--dk-s': dock.s } as React.CSSProperties}>{label}</span>
                );
              })}
              {rows.map((row) => seatRow(row))}
            </>
          );
        }
        if (!duosMate) return rows.map((row) => seatRow(row));
        // VERSUS DUOS / RANKED DUOS (owner 2026-10-27: "tie the teammates together better by putting them into chunkier
        // rail slots as a team"; R-DUOS-RAIL-TEAM-01): one slot per team, both members inside it, the team's name over
        // them (Ranked Duos), and the team's one Health pool once, at the slot's foot. The slot carries the team's marks
        // (yours, the next foe, out), so the rows inside it stay plain.
        return duosRailTeams(rows).map(({ team, rows: members }) => {
          const hpRow = duosTeamHealthRow(members)!;
          const hpSeat = lobby.seats.find((s) => s.id === hpRow.id)!;
          const label = members.map((m) => teamLabels?.[m.id]).find(Boolean) ?? null;
          const alive = members.some((m) => m.alive);
          const teamHp = hpRow.resolve + hpRow.armor;
          const teamMax = Math.max(1, maxHpOf(hpSeat));
          const mod = `${members.some((m) => m.you) ? ' you' : ''}${members.some((m) => m.next) ? ' foe' : ''}${members.some((m) => m.ghost) ? ' ghost' : ''}${alive ? '' : ' dead'}${label ? ' named' : ''}`;
          return (
            <div key={`team${team}`} className={`lobbyteamslot${mod}`} data-team={team}
              aria-label={label ? `Team ${label}` : members.some((m) => m.you) ? 'Your team' : 'Opposing team'}>
              {label && <span className="lobbyteamslot-name">{label}</span>}
              {members.map((m) => seatRow(m, true))}
              {alive ? (
                <span className="lobbyhp lobbyteamslot-hp">
                  <Icon name="heartPill" />{hpRow.resolve}
                  {hpRow.armor > 0 && <span className="lobbyarmor"><Icon name="shield" />{hpRow.armor}</span>}
                </span>
              ) : (
                <span className="lobbyplace lobbyteamslot-hp">{hpRow.placement ? `#${hpRow.placement}` : 'out'}</span>
              )}
              {alive && (
                <span className="lobbybar lobbyteamslot-bar">
                  <span style={{ width: `${Math.max(0, Math.min(100, (teamHp / teamMax) * 100))}%` }} />
                </span>
              )}
            </div>
          );
        });
        })()}
      </div>
      )}
    </div>
    </>
  );
});

/**
 * YOUR OWN seat's hover card: the SAME ScoutCard the opponents get, fed intel read live off your run (the table
 * only records intel for seats it prepares, and your board is the run itself). Subscribes to the run only while
 * mounted, i.e. only while your seat is hovered, so the rail pays nothing for it otherwise.
 */
function SelfScoutCard({ lobby, seat, at, hp, compact }: { lobby: RunLobby; seat: LobbySeatState; at: { top: number; right: number }; hp?: { alive: boolean; resolve: number; armor: number }; compact?: boolean }): JSX.Element {
  const run = useGame((st) => st.run);
  const intel = useMemo(() => {
    const snap = snapshotBoard(run);
    return boardIntel({ minions: snap.minions, tier: snap.tier, snapshot: snap }, lobby.round);
  }, [run, lobby.round]);
  return <ScoutCard lobby={lobby} seat={seat} intel={intel} at={at} hp={hp} compact={compact} />;
}

const TRIBE_LABEL: Record<string, string> = {
  beast: 'Beasts', dragon: 'Dragons', undead: 'Undead', mech: 'Mechs',
  demon: 'Demons', kobold: 'Kobolds', dwarf: 'Dwarves', neutral: 'Neutral',
  celestial: 'Celestials', spirit: 'Spirits',
};

// DEV-only scout-card layout A/B/C compare (owner is choosing a formatting direction). The chosen variant
// persists in localStorage so every hover card renders the same one; the on-card chip (dev builds only) cycles
// it. Stripped from production — `import.meta.env.DEV` gates both the read default and the chip.
const SCOUT_VARIANT_KEY = 'ascent.scoutVariant';
const SCOUT_VARIANTS = 3;
function readScoutVariant(): number {
  if (!import.meta.env.DEV) return 1;
  try { const v = Number(localStorage.getItem(SCOUT_VARIANT_KEY)); return v >= 1 && v <= SCOUT_VARIANTS ? v : 1; }
  catch { return 1; }
}
const OUTCOME_LABEL: Record<string, string> = { win: 'WON', lose: 'LOST', draw: 'DREW' };

/**
 * The hover read on one opponent: what they are playing, and how their last three fights went.
 *
 * Rendered ONLY while hovered rather than always-mounted-and-hidden — eight of these permanently in the tree,
 * each mapping the encounter log, is work the shop phase does not need to do every frame.
 */
function ScoutCard({ lobby, seat, intel, at, pinned, hp, compact }: {
  lobby: RunLobby; seat: LobbySeatState; intel?: SeatIntel; at: { top: number; right: number };
  /** The seat's Health + Armor as the rail shows them (the Docked card prints the numbers the bar draws). */
  hp?: { alive: boolean; resolve: number; armor: number };
  /** The Docked rail's compact card (owner 2026-10-31). */
  compact?: boolean;
  /** Pinned (clicked) rather than hovered: it takes pointer events so its rune/quest badges can be hovered for
   *  their own tooltips. Dismissed by clicking outside (handled in LobbyPanel), not a corner ×. */
  pinned?: boolean;
}): JSX.Element {
  const results = seatResults(lobby, seat.id, 3);
  // SKINS: a fight-log face is that foe's seat; when the foe was YOU, it is your run's skin.
  const runSkins = useRunSkins();
  const showOppSkins = useGame((st) => st.showOpponentSkins);
  const faceOf = (r: { foeId: string; foeHeroId: string }): string | undefined => heroPortrait(
    r.foeHeroId,
    r.foeId === 's0' ? runSkins : opponentSkins(showOppSkins, lobby.seats.find((x) => x.id === r.foeId)?.cosmetics),
  );
  // KEEP IT ON-SCREEN. The card is position:fixed and opens to the LEFT of the seat; on a large / fullscreen
  // viewport a seat can push it partly off-screen (owner report 2026-08-28). We measure it once and clamp its
  // `right`/`top` into the viewport with an 8px margin, keeping the CSS `translateY(-50%)` centring (so `top` is
  // the card's CENTRE and the entrance animation is untouched). Rendered hidden until measured to avoid a flash
  // at the pre-clamp position; `useLayoutEffect` measures before paint, so there is no visible jump.
  const cardRef = useRef<HTMLDivElement>(null);
  const [clamp, setClamp] = useState<{ top: number; right: number } | null>(null);
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight, m = 8;
    const { w: vw, h: vh } = stageViewport(); // the window in stage px, matching `at` and offsetWidth
    // Horizontal: prefer opening left (right edge 6px left of the seat), then clamp so neither edge leaves the view.
    const right = Math.max(m, Math.min(vw - at.right + 6, vw - w - m));
    // Vertical: `top` is the centre (translateY(-50%)) — keep the whole card between the top/bottom margins.
    const top = Math.max(m + h / 2, Math.min(at.top, vh - m - h / 2));
    setClamp({ top, right });
  }, [at.top, at.right, seat.id, pinned]);

  const [variant, setVariant] = useState(readScoutVariant);
  const cycleVariant = (): void => {
    const next = (variant % SCOUT_VARIANTS) + 1;
    setVariant(next);
    try { localStorage.setItem(SCOUT_VARIANT_KEY, String(next)); } catch { /* ignore */ }
  };

  // VERSUS: a seat with no runes yet says so instead of drawing three empty sockets. (The fight log reads damage, as
  // in a lobby game, since 2026-10-26: R-VERSUS-HEALTH-01.)
  const versusCard = useGame((st) => st.run.mode === 'versus');
  // Shared reads + building blocks; each layout below arranges the SAME data differently.
  const heroName = getHero(seat.heroId).name;
  const tribe = intel?.topTribe;
  const tribeLabel = tribe ? TRIBE_LABEL[tribe] : 'Mixed';
  const tribeCount = intel?.topTribeCount;
  const tribeText = tribeCount ? `${tribeLabel} ×${tribeCount}` : tribeLabel;
  const tribeColor = tribe ? `var(--t-${tribe})` : 'var(--t-neutral)';
  const head = (
    <div className="lobbyscout-head">
      <span className="lobbyscout-name">{seat.label}</span>
      <span className="lobbyscout-hero"><b>Hero:</b> {heroName}</span>
    </div>
  );
  // COMPLETED QUESTS as badges. Runes moved to the socket strip below (owner ask 2026-08-31).
  const badges = intel && (intel.quests?.length ?? 0) > 0 ? (
    <div className="oppbadges lobbyscout-badges">
      {(intel.quests ?? []).filter((id) => QUEST_INDEX[id]).map((id) => {
        const def = QUEST_INDEX[id]!;
        const qart = questArt(def.id);
        const c = def.tribe === 'neutral' ? 'var(--t-neutral)' : `var(--t-${def.tribe})`;
        return (
          <div className="questbadge" style={{ '--c': c } as React.CSSProperties} key={`q:${id}`}>
            {qart
              ? <img decoding="sync" className="questbadge-art" src={qart} alt="" aria-hidden />
              : <span className="questbadge-emblem" aria-hidden><Icon name="star" /></span>}
            <div className="questbadge-tip" role="tooltip">
              <b>{def.name}</b>
              <span className="questbadge-tip-state">Quest · complete</span>
            </div>
          </div>
        );
      })}
    </div>
  ) : null;
  const noIntel = <div className="lobbyscout-empty">No intel yet</div>;
  // ROUND HISTORY — the foe's PORTRAIT rather than their name (owner ask 2026-08-31), with the outcome-tinted
  // damage on the right. Falls back to the label if the hero art is missing.
  const renderLog = (): JSX.Element => (
    <div className="lobbyscout-log">
      {results.length === 0 ? (
        <div className="lobbyscout-empty">No fights yet</div>
      ) : (
        <>
          {/* A titled header row over the four fight-log columns (owner ask 2026-08-31). */}
          <div className="lobbyscout-loghead">
            <span className="lobbyscout-colhead">Round</span>
            <span className="lobbyscout-colhead">Vs</span>
            <span className="lobbyscout-colhead">Outcome</span>
            <span className="lobbyscout-colhead">Dmg</span>
          </div>
          {results.map((r) => (
            <div className={`lobbyscout-row ${r.outcome}`} key={r.round}>
              <span className="lobbyscout-round">{r.round}</span>
              <span className="lobbyscout-vs">
                {r.foeHeroId
                  ? <img decoding="sync" className="lobbyscout-foeface" src={faceOf(r)} alt={r.foeLabel} />
                  : <span className="lobbyscout-vslabel">vs {r.foeLabel}</span>}
              </span>
              {/* The outcome sits BETWEEN the portrait and the damage (owner ask 2026-08-31). */}
              <span className="lobbyscout-result">{OUTCOME_LABEL[r.outcome] ?? ''}</span>
              <span className="lobbyscout-dmg"><img decoding="sync" className="lobbyscout-blast" src="/blast-dmg-icon.webp" alt="" aria-hidden />{r.taken > 0 ? `−${r.taken}` : r.dealt > 0 ? `+${r.dealt}` : '0'}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
  // RUNE SOCKETS — always three (owner ask 2026-08-31): dotted-outline circles marking where runes socket over
  // the match, filled with rune art as the seat acquires them. Filled sockets carry the same hover tip as a badge.
  const runeIds = (intel?.runes ?? []).filter((id) => RUNE_INDEX[id]);
  const runeSockets = intel ? (
    <div className="lobbyscout-runesec">
      <div className="lobbyscout-sectitle">Runes</div>
      {versusCard && runeIds.length === 0 ? <div className="lobbyscout-norunes">None yet</div> : <div className="lobbyscout-runes">
      {[0, 1, 2].map((i) => {
        const rune = runeIds[i] ? RUNE_INDEX[runeIds[i]!] : null;
        const rart = rune ? runeArt(rune.id) : null;
        return (
          <div className={`lobbyscout-socket${rune ? ' filled' : ''}`} key={i}>
            {rune && (rart
              ? <img decoding="sync" className="lobbyscout-socketart" src={rart} alt="" aria-hidden />
              : <span className="questbadge-emblem" aria-hidden><Icon name="sc" /></span>)}
            {rune && (
              <div className="questbadge-tip" role="tooltip">
                <b>{rune.name}</b>
                <span className="questbadge-tip-reward" dangerouslySetInnerHTML={{ __html: mdBold(liveRuneText(rune.id, rune.text, intel?.runeLive)) }} />
                <span className="questbadge-tip-state">Rune · active</span>
              </div>
            )}
          </div>
        );
      })}
      </div>}
    </div>
  ) : null;

  // ── The three candidate layouts (owner picked V1; the others stay for reference). Same data, different form. ──
  let body: JSX.Element;
  if (compact) {
    // THE DOCKED CARD (owner 2026-10-31): the owner's list in his order ("player name, shop tier, number of gilded
    // minions, their most common tribe x, their rune slots, and then the past 3 combat results"), plus the Health / Armor
    // numbers the bar draws. Compact: a header line, one 3-up chip row, small rune sockets, one tight row per fight.
    // Gilded = Gilded units MADE this game (owner ruling 2026-10-31; R-LOBBY-RAIL-02 (3)).
    const sockets = [0, 1, 2].map((i) => {
      const rune = runeIds[i] ? RUNE_INDEX[runeIds[i]!] : null;
      const rart = rune ? runeArt(rune.id) : null;
      return (
        <span className={`lrv-sc-socket${rune ? ' filled' : ''}`} key={i}>
          {rune && (rart ? <img decoding="sync" src={rart} alt="" aria-hidden /> : <Icon name="sc" />)}
          {rune && (
            <span className="questbadge-tip" role="tooltip">
              <b>{rune.name}</b>
              <span className="questbadge-tip-reward" dangerouslySetInnerHTML={{ __html: mdBold(liveRuneText(rune.id, rune.text, intel?.runeLive)) }} />
              <span className="questbadge-tip-state">Rune · active</span>
            </span>
          )}
        </span>
      );
    });
    body = (
      <>
        <div className="lrv-sc-top">
          <span className="lobbyscout-name">{seat.label}</span>
          {hp?.alive && (
            <span className="lrv-sc-hp" aria-label={`Health ${hp.resolve}, Armor ${hp.armor}`}>
              <span className="lrv-sc-heart"><Icon name="heartPill" />{hp.resolve}</span>
              <span className="lrv-sc-arm"><Icon name="armor" />{hp.armor}</span>
            </span>
          )}
        </div>
        {/* VERSUS (owner 2026-10-31: "their hero, tier, gilded made, top tribe, runes, last fights vs you"): the hero under the
            name. A lobby card keeps the owner's lobby list. */}
        {versusCard && <div className="lrv-sc-hero">{heroName}</div>}
        <div className="lrv-sc-chips">
          <span className="lrv-sc-chip"><i>Shop tier</i><b><Icon name="up" />{intel ? intel.tier : '—'}</b></span>
          <span className="lrv-sc-chip"><i>Gilded made</i><b><Icon name="star" />{intel ? intel.triples : '—'}</b></span>
          <span className="lrv-sc-chip lrv-sc-tribe"><i>Top tribe</i><b style={tribe ? { color: tribeColor } : undefined}>{tribeCount ? tribeText : '—'}</b></span>
        </div>
        <div className="lrv-sc-runes"><i>Runes</i>{versusCard && runeIds.length === 0 ? <span className="lrv-sc-none">None yet</span> : sockets}</div>
        <div className="lrv-sc-fights">
          {results.length === 0 ? <span className="lrv-sc-none">No fights yet</span> : results.map((r) => (
            <div className={`lrv-sc-fight ${r.outcome}`} key={r.round}>
              {r.foeHeroId ? <img decoding="sync" className="lrv-sc-foe" src={faceOf(r)} alt="" /> : <span className="lrv-sc-foe" />}
              <span className="lrv-sc-vs">vs {r.foeLabel}</span>
              <span className="lrv-sc-out">{r.outcome === 'win' ? 'W' : r.outcome === 'lose' ? 'L' : 'D'}</span>
              <span className="lrv-sc-dmg">{r.taken > 0 ? `−${r.taken}` : r.dealt > 0 ? `+${r.dealt}` : '0'}</span>
            </div>
          ))}
        </div>
      </>
    );
  } else if (variant === 2) {
    // V2 — identity banner (dominant tribe front + centre) + a thin meta line, history given its own titled block.
    body = (
      <>
        {head}
        {intel ? (
          <>
            <div className="lobbyscout-identity" style={{ '--c': tribeColor } as React.CSSProperties}>
              <span className="lobbyscout-tribe">{tribeLabel}</span>
              {tribeCount ? <span className="lobbyscout-tribect">{tribeCount}</span> : null}
            </div>
            <div className="lobbyscout-meta">
              <span>Tier <b>{intel.tier}</b></span>
              <span className="lobbyscout-metadot">·</span>
              <span><b>{intel.triples}</b> triples</span>
            </div>
          </>
        ) : noIntel}
        {badges}
        <div className="lobbyscout-logtitle">Last fights</div>
        {renderLog()}
        {runeSockets}
      </>
    );
  } else if (variant === 3) {
    // V3 — compact: name + tribe tag on one line, a tight meta line, everything denser (see CSS).
    body = (
      <>
        <div className="lobbyscout-head lobbyscout-head--row">
          <span className="lobbyscout-name">{seat.label}</span>
          {intel ? <span className="lobbyscout-tag" style={{ '--c': tribeColor } as React.CSSProperties}>{tribeText}</span> : null}
        </div>
        <span className="lobbyscout-hero"><b>Hero:</b> {heroName}</span>
        {intel ? (
          <div className="lobbyscout-meta lobbyscout-meta--tight">
            <span>Tier <b>{intel.tier}</b></span>
            <span className="lobbyscout-metadot">·</span>
            <span><b>{intel.triples}</b> triples</span>
          </div>
        ) : noIntel}
        {badges}
        {renderLog()}
        {runeSockets}
      </>
    );
  } else {
    // V1 — refined current: a three-up stat strip (dominant tribe + count first), portrait history, rune sockets.
    body = (
      <>
        {head}
        {intel ? (
          <div className="lobbyscout-stats">
            {/* Shop tier + Gilded made (triples this game, owner 2026-10-16) paired, then the tribe build on its own row beneath (owner ask
                2026-08-31); every stat's title sits ABOVE its value. */}
            <div className="lobbyscout-statrow">
              <span className="lobbyscout-stat"><i>shop tier</i><b>{intel.tier}</b></span>
              <span className="lobbyscout-stat"><i>gilded made</i><b>{intel.triples}</b></span>
            </div>
            <span className="lobbyscout-stat lobbyscout-stat--wide"><i>build</i><b>{tribeText}</b></span>
          </div>
        ) : noIntel}
        {badges}
        {renderLog()}
        {runeSockets}
      </>
    );
  }

  // PORTALED to <body>, then position:fixed + viewport-clamped. Rendered inside the rail, the card could be
  // swallowed by the rail's backplate/overflow on some viewports (owner report 2026-08-28) — as a direct child
  // of <body> no rail ancestor can clip or re-anchor it. The clamp (above) keeps it on-screen; z-index keeps it
  // in front.
  return createPortal(
    <div ref={cardRef} className={`lobbyscout lobbyscout--v${variant}${pinned ? ' pinned' : ''}${compact ? ' lrv-scout' : ''}`} role={pinned ? 'dialog' : 'tooltip'}
      aria-label={pinned ? `${seat.label} scouting report` : undefined}
      style={clamp
        ? { top: clamp.top, right: clamp.right }
        : { top: at.top, right: `calc(var(--lvw, 100vw) - ${at.right}px + 6px)`, visibility: 'hidden' }}
      // React portals bubble synthetic events through the REACT tree, so a click inside this card would reach the
      // seat's onClick and toggle the pin shut. Stop it here; the native mousedown outside-handler (on document)
      // still sees the click and keeps the card open.
      onClick={pinned ? (e) => e.stopPropagation() : undefined}
      onContextMenu={pinned ? (e) => { e.preventDefault(); e.stopPropagation(); } : undefined}>
      {/* DEV-only A/B/C layout switch — corner chip, cycles + persists the chosen variant. */}
      {import.meta.env.DEV && !compact && (
        <button className="lobbyscout-variant" onClick={(e) => { e.stopPropagation(); cycleVariant(); }}
          aria-description="Cycle scout-card layout (dev only)">V{variant}</button>
      )}
      {body}
    </div>,
    stageHost(),
  );
}
