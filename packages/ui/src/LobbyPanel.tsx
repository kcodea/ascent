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
import { questArt, runeArt } from './art';
import { heroPortrait, opponentSkins, useRunSkins } from './skins/skins';
import { PortraitFrame, frameIdOf, usePortraitFrame } from './portraitFrame/PortraitFrame';
import { resolveImageFrame, resolvePortraitFrame, type ResolvedFrame } from './portraitFrame/portraitFrameConfig';
import { medalOf } from './leaderboardData';
import { useRailVariant, type RailVariant } from './lobbyRailVariant';
import { liveRuneText } from './runeText';
import { mdBold } from './Card';
import { Icon } from './Icon';
import { FadeImg } from './FadeImg';
import { useGame } from './store';
import { useScreenSwapped, useSwapRef } from './screenSwap';
import { stageHost, stageViewport, toStage } from './stage';
import { useSpectate } from './versus/spectate';
import { useVersus } from './versus/versusStore';
import { groupDuosRailRows } from './versus/versusGroupView';
import { duosRailTeams, duosTeamHealthRow } from './versus/duosRailTeams';
import { isRankedDuosRaw, rankedTeamLabels } from './versus/rankedDuosView';
import { enterTeammateView } from './versus/teammateView';
import { LobbyGuides } from './guides/LobbyGuides';
import { VersusFoe } from './versus/VersusFoe';
import { canEditGuide, guidesFor, type Guide, type GuidesMode } from './guides/guides';
import { ownsMine, useGuides } from './guides/guidesStore';
import './lobbyRail.css'; // the Gem / Classic rail looks (switch: `data-lobby-rail`, 🎨 Lobby Rail Look tuner)
// OWNER REVIEW (2026-10-30): the three candidate rail designs (lobbyRailVariant.ts). Their stylesheet is loaded in a DEV
// build only: in production this branch is dead code, so the file is never bundled and the rail is exactly today's.
if (import.meta.env.DEV) void import('./lobbyRailVariants.css');

/** OWNER REVIEW (2026-10-30): a variant's portrait ring when the seat has no cosmetic frame of its own: the painted
 *  Default ring (the Career / ladder ring), and the Gold ring on YOUR portrait in A and C. Current keeps today's face. */
function variantRing(variant: RailVariant, isYou: boolean, own: ResolvedFrame | null): ResolvedFrame | null {
  if (own || variant === 'current') return own;
  return resolveImageFrame(isYou && variant !== 'ledger' ? 'gold' : 'default');
}

/** A fallen seat's place medal in the variant rails: the ladder's medallion (`.lb-medal`, LadderBits), small. */
function PlaceMedal({ place }: { place: number }): JSX.Element {
  const tier = medalOf(place);
  return (
    <span className={`lb-medal ${tier} lrv-medal`} aria-label={`Finished ${place}`}>
      {tier !== 'plain' && <Icon name="crown" />}
      <span className="lb-medal-n">{place}</span>
    </span>
  );
}

/** The max-damage readout on the rail's top edge: "Max dmg 5", or "No cap" once the round is uncapped. It is this
 *  round's LOSS CAP (`roundLossCap`): the most Health a loss can cost. Labelled since 2026-10-09 (owner: "a bit clearer
 *  on what it's saying"); it used to be a bare "−5". */
export function maxDamageLabel(cap: number): string {
  return Number.isFinite(cap) ? `Max dmg ${cap}` : 'No cap';
}

/** VERSUS: does the rail area show the 1v1 opponent block (`VersusFoe`) instead of the rail? Only a real 1v1: two seats
 *  and not a group match (R-VERSUS-RAIL-LAYOUT-01: a Ranked Duos table before its recorded teams are seated has two). */
export function versusDuelLayout(versus: boolean, seats: number, groupMatch: boolean): boolean {
  return versus && seats <= 2 && !groupMatch;
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
/** VERSUS: the Guides drawer's slide (`.lobbyrail.vsdrawer`, versus.css). */
const VS_DRAWER_MS = 220;
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
  // OWNER REVIEW (2026-10-30): which rail design is on screen ('current' in production, always).
  const variant = useRailVariant();
  const rv = variant !== 'current';
  const myTier = useGame((st) => st.run.tier);
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
  // THE GUIDES VIEW (owner ask 2026-10-09): the tab on the rail's left edge flips the rail between the table and the
  // build guides for this game's set + tribes (guides/guides.ts). It rides the rail, so it is gone with it in combat
  // and comes back on the view it left. Off in the Tutorial, whose coach marks point at the seats.
  const runKey = useGame((st) => `${st.run.runId ?? ''}:${st.run.seed}`);
  const setId = useGame((st) => st.run.setId);
  const runTribes = useGame((st) => st.run.tribes);
  const guidesOn = useGame((st) => st.run.mode !== 'tutorial');
  // VERSUS (owner 2026-10-14): its rail sits at the middle of the right side, not the top (`.vsplace`).
  // VERSUS GROUP (owner 2026-10-24, R-VERSUS-GROUP-03): a 3-4 player match uses the ranked rail as it is (its seats in
  // the rail's place, the Guides tab), so only a 1v1 lobby (two seats) takes the Versus placement and drawer.
  const versusRail = useGame((st) => st.run.mode === 'versus' && (st.run.lobby?.seats.length ?? 0) <= 2);
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
  useLayoutEffect(() => {
    if (!showGuides) return;
    const next = snapGuides();
    // Same three arrays and account as last time = the same snapshot object, so nothing re-renders.
    setGuideSnap((cur) => (cur.list === next.list && cur.mine === next.mine && cur.bookmarked === next.bookmarked && cur.uid === next.uid ? cur : next));
  }, [showGuides]);
  // VERSUS GUIDES DRAWER (owner 2026-10-14: the rail tab "is a botch job"): no rail to flip, so the guides open from the
  // opponent block's Guides plate as a drawer over the right side (the rail's own Guides face, sliding in), closed by
  // its ✕, the plate again, or Esc. `vsClosing` holds it on screen for its slide out.
  const [vsClosing, setVsClosing] = useState(false);
  const closeVsGuides = useCallback((): void => {
    setVsClosing(true);
    window.setTimeout(() => { setVsClosing(false); setView('opponents'); }, VS_DRAWER_MS);
  }, []);
  const toggleVsGuides = (): void => {
    setHovered(null);
    setPinned(null);
    setSwap(null);
    if (view === 'guides') closeVsGuides(); else setView('guides');
  };
  useEffect(() => {
    if (!versusRail || !showGuides || vsClosing) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation(); // the Esc menu does not open under it
      closeVsGuides();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [versusRail, showGuides, vsClosing, closeVsGuides]);
  const toggleView = (): void => {
    setHovered(null);
    setPinned(null);
    setSwap(mode === 'full' ? (view === 'guides' ? 'narrow' : 'wide') : 'fade');
    setView((v) => (v === 'guides' ? 'opponents' : 'guides'));
  };
  const setMode = (m: GuidesMode): void => {
    if (m === mode) return;
    setSwap(m === 'full' ? 'wide' : 'narrow');
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
      if (t instanceof Element && t.closest('.lobbyrail, .lobbyrailtab, .lobbyrailhead, .vsfoe-guides')) return;
      setSwap('narrow');
      setModeState('simple');
      try { localStorage.setItem(GUIDES_MODE_KEY, 'simple'); } catch { /* storage unavailable: the choice lasts this session */ }
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [showGuides, mode]);
  const railMods = `${showGuides ? ` guidesview guides-${mode}` : ''}${swap ? ` swap-${swap}` : ''}${versusRail && view !== 'guides' ? ' vsplace' : ''}${versusRail && showGuides ? ` vsdrawer${vsClosing ? ' closing' : ''}` : ''}`;
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
  // moment the fight settles (owner report 2026-08-25), in VERSUS too. A VERSUS 1v1 shows the opponent's block (their
  // Health + Armor, owner 2026-10-14); your own pools sit under your hero. VERSUS GROUP (R-VERSUS-GROUP-03): the ranked
  // rail with every player (you included) on their Health + Armor, the Copy in the last slot while one is in play.
  // A 1v1 (two seats) keeps its one-opponent block (`versusDuel`).
  // A GROUP match (Group, Duos, Ranked Duos) is never the 1v1 block, whatever its seat count: a Ranked Duos table holds
  // only the live pair until the recorded teams are seated, and showing the teammate as "the opponent" read as the 1v1
  // screen (owner report 2026-10-28, R-VERSUS-RAIL-LAYOUT-01).
  const groupMatch = useVersus((st) => versus && !!st.match?.group);
  const versusDuel = versusDuelLayout(versus, lobby.seats.length, groupMatch);
  // VERSUS DUOS (R-DUOS-01): the teammate's row (always s1), kept next to yours. A click opens their live screen
  // (R-DUOS-VIEW-01), a second way in beside the bottom-right teammate portrait (the pass target, DuosMateDock).
  const duosMate = useVersus((st) => (versus && st.match?.group?.duos?.mate && st.match.group.me ? 's1' : null));
  // RANKED DUOS (owner 2026-10-26: team names "shown on the rail"): each team's name on its first row.
  const rankedRaw = useVersus((st) => (versus && st.match?.group && isRankedDuosRaw(st.match.group.raw) ? st.match.group.raw : null));
  const rankedMe = useVersus((st) => st.match?.group?.me ?? null);
  const teamLabels = useMemo(() => (rankedRaw && rankedMe ? rankedTeamLabels(rankedRaw, rankedMe, rankedRaw.servedTeamNames ?? {}) : null), [rankedRaw, rankedMe]);
  const rail = lobbyRailView(lobby, { opponent: playerOpponent(lobby), ...(versusDuel ? { hideSelf: true } : { self: { resolve: myResolve, armor: myArmor } }) });
  const next = rail.opponent;
  const foe = next?.seat ?? null;
  // The foe's board is already prepared by `playerOpponent`, so reading it is free, and the imminent opponent has
  // CURRENT intel even on round 1. Every card reads the round you are IN, by one rule (`railSeatIntel`).
  const foeIntel: SeatIntel | undefined = foe ? railSeatIntel(lobby, foe, next) : undefined;
  // VERSUS DUOS: team rows grouped (you next to your teammate), never split by Health.
  const rows = duosMate ? groupDuosRailRows(rail.rows) : rail.rows;
  // The rail's height in seat rows (`--lby-n`): VERSUS's head-to-head card takes three; its Guides view takes the
  // lobby's full eight, so the guides read exactly as in a lobby game.
  const railRows = versusDuel ? (showGuides ? 8 : 3) : rows.length;

  // The round's loss cap (the run's own table: the Gauntlet has its own, see `roundLossCap`). Infinity = uncapped.
  const cap = rail.lossCap;
  const capTip = maxDamageTip(cap);
  const leftLabel = showGuides ? `${guideCount} guide${guideCount === 1 ? '' : 's'}` : versusDuel ? '' : `${versus ? rail.left - (lobby.seats.some((x) => x.id === VERSUS_COPY_SEAT_ID) ? 1 : 0) : rail.left} left`;

  return (
    <>
    {/* THE ROUND HEADER sits just ABOVE the rail's top edge, outside it (owner ask 2026-10-02: "move the Round
        text to be above the lobby rail ... move the max dmg next to the new round location ... make both larger
        ... dont let these elements move anything else in the game"). A SIBLING of the rail, not a child: the rail
        is a scroll container and would clip anything placed outside its box. `.lobbyrailhead` is absolutely
        positioned off the rail's own `right` / `top` / `width` (styles.css), so it takes no layout space and
        moves nothing. */}
    {/* VERSUS draws its Round plate on the opponent's block (versus/VersusFoe.tsx); the Guides view keeps this header. */}
    {!(versusDuel && !showGuides) && <div className={`lobbyrailhead${railMods}`}>
      <span className="lobbyround">{showGuides ? 'Guides' : `Round ${rail.round}`}</span>
      {/* OWNER REVIEW variants: the seats-left count joins the round header as one banner. */}
      {rv && !showGuides && leftLabel && <span className="lrv-left">{leftLabel}</span>}
      {versusDuel && showGuides && (
        <button type="button" className="mdd-close pressable vsdrawer-close" aria-label="Close build guides" onClick={closeVsGuides}>
          <span aria-hidden="true">✕</span>
        </button>
      )}
      {/* VERSUS reads the lobby's own cap (R-VERSUS-HEALTH-01); a 1v1's opponent block carries it too (VersusFoe). */}
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
    </div>}
    {/* THE VIEW TAB on the rail's left edge (owner ask 2026-10-09). A SIBLING of the rail like the header (the rail
        clips its children), placed off the rail's own position + height vars (guides/lobbyGuides.css). Two stacked
        glyphs, the current view's lit, so the tab always says which face is showing. */}
    {guidesOn && !versusDuel && (
      <button type="button" className={`lobbyrailtab gtip${railMods}`}
        style={{ '--lby-n': railRows } as React.CSSProperties}
        aria-label={showGuides ? 'Show opponents' : 'Show build guides'} aria-pressed={showGuides}
        data-tip={showGuides ? 'Opponents' : 'Guides'} onClick={toggleView}>
        <span className={`lobbyrailtab-cell${showGuides ? '' : ' on'}`}><Icon name="sword" /></span>
        <span className={`lobbyrailtab-cell${showGuides ? ' on' : ''}`}><Icon name="book" /></span>
      </button>
    )}
    {/* VERSUS (owner 2026-10-14): no rail panel on the Opponents view. The opponent's hero block floats where the rail
        stands (versus/VersusFoe.tsx), mirroring your own; its Round header and the Guides tab stay. */}
    {versusDuel && lobby.seats[1] && (() => {
      const foeSeat = lobby.seats[1]!;
      const foeSkins = opponentSkins(showOppSkins, foeSeat.cosmetics);
      const foeFrameId = frameIdOf(foeSkins);
      return (
        <>
          <VersusFoe
            foe={foeSeat}
            art={heroPortrait(foeSeat.heroId, foeSkins)}
            frame={resolvePortraitFrame('opp', foeFrameId ?? 'default', 'socket')}
            round={lobby.round}
            cap={cap}
            capPop={capPop}
            onGuides={toggleVsGuides}
            guidesOpen={showGuides && !vsClosing}
            faceProps={{
              onMouseEnter: (e) => openScout(e, foeSeat.id),
              onMouseLeave: () => setHovered((h) => (h?.id === foeSeat.id ? null : h)),
              onClick: (e) => pinScout(e, foeSeat.id),
              onContextMenu: (e) => pinScout(e, foeSeat.id),
            }}
          />
          {!staged && !showGuides && hovered?.id === foeSeat.id && pinned?.id !== foeSeat.id && <ScoutCard lobby={lobby} seat={foeSeat} intel={foeIntel} at={hovered} />}
          {!staged && !showGuides && pinned?.id === foeSeat.id && <ScoutCard lobby={lobby} seat={foeSeat} intel={foeIntel} at={pinned} pinned />}
        </>
      );
    })()}
    {/* `--lby-n`: the seat count, so the Gem rail can hold exactly the height Classic sizes to (lobbyRail.css). */}
    {!(versusDuel && !showGuides) && <div className={`lobbyrail${railMods}`} style={{ '--lby-n': railRows } as React.CSSProperties}>
      <div className="lobbyhead">
        <span className="lobbyalive">{leftLabel}</span>
      </div>

      {showGuides ? (
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
          return (
            <div
              key={seat.id}
              data-seat={seat.id}
              className={`lobbyseat${inTeam ? ' inteam' : ''}${isYou ? ' you' : ''}${isFoe ? ' foe' : ''}${isGhost ? ' ghost' : ''}${seat.alive ? '' : ' dead'}${koIds.includes(seat.id) ? ' ko' : ''}${seat.id === duosMate ? ' mate' : ''}`}
              {...(seat.id === duosMate ? { 'aria-label': `${seat.label}, your teammate. Click to watch their board.` } : {})}
              // Hover scouting works on EVERY seat, yours included (owner ask 2026-09-24: "add the same mouseover
              // for self as we have for enemies"). Pinning stays opponent-only; the owner asked for the hover.
              onMouseEnter={(e) => openScout(e, seat.id)}
              onMouseLeave={() => setHovered((h) => (h?.id === seat.id ? null : h))}
              // Left OR right click pins the card (and clicking a different seat switches to it) — owner ask 2026-08-31.
              onClick={isYou ? undefined : seat.id === duosMate ? () => enterTeammateView() : (e) => pinScout(e, seat.id)}
              onContextMenu={isYou ? undefined : (e) => pinScout(e, seat.id)}
            >
              {(() => {
                const src = heroPortrait(seat.heroId, isYou ? runSkins : opponentSkins(showOppSkins, seat.cosmetics));
                // An opponent seat wears its recorded portrait frame (through "Show opponent cosmetics", owner
                // 2026-10-01), else the tuner's opponent ring. `oppFrame` keeps the rail subscribed to tuner writes.
                const seatFrameId = isYou ? null : frameIdOf(opponentSkins(showOppSkins, seat.cosmetics));
                const frame = variantRing(variant, isYou, isYou ? selfFrame : seatFrameId ? resolvePortraitFrame('opp', seatFrameId) : oppFrame);
                // OWNER REVIEW variants: A wears the seat's shop tier on the portrait (yours live, the next foe's from
                // its prepared board, the rest as of their last fight: reading every seat's current board is a
                // prepare per seat, which the rail must never pay). B and C mark the next foe with crossed swords.
                const tier = variant === 'plaque' && row.alive ? (isYou ? myTier : isFoe ? foeIntel?.tier : seat.intel?.tier) : undefined;
                const extras = rv ? (
                  <>
                    {tier ? <span className="lrv-tier" aria-label={`Shop tier ${tier}`}>{tier}</span> : null}
                    {isFoe && variant !== 'plaque' && <span className={`lrv-swords${isGhost ? ' ghost' : ''}`} aria-label="Your next opponent"><Icon name="sword" /><Icon name="sword" /></span>}
                    {!row.alive && row.placement ? <PlaceMedal place={row.placement} /> : null}
                  </>
                ) : null;
                // With a tuner frame on, the face moves into a `.lobbyface` host (it keeps the grid seat + size)
                // that carries the ring; without one the markup is exactly what it always was.
                return frame ? (
                  <span className="lobbyface lobbyface-host pf-on" style={frame.hostStyle}>
                    <FadeImg className="lobbyface-img" src={src} alt="" />
                    <PortraitFrame frame={frame} />
                    {extras}
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
              {!staged && hovered?.id === seat.id && pinned?.id !== seat.id && (isYou
                ? <SelfScoutCard lobby={lobby} seat={seat} at={hovered} />
                : <ScoutCard lobby={lobby} seat={seat} intel={intel} at={hovered} />)}
              {!staged && pinned?.id === seat.id && (
                <ScoutCard lobby={lobby} seat={seat} intel={intel} at={pinned} pinned />
              )}
            </div>
          );
        };
        // OWNER REVIEW A (Plaque): the fallen leave the column for one compact strip of small portraits under it.
        if (!duosMate && variant === 'plaque') {
          const fallen = rows.filter((row) => !row.alive);
          return (
            <>
              {rows.filter((row) => row.alive).map((row) => seatRow(row))}
              {fallen.length > 0 && <div className="lrv-fallen">{fallen.map((row) => seatRow(row))}</div>}
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
    </div>}
    </>
  );
});

/**
 * YOUR OWN seat's hover card: the SAME ScoutCard the opponents get, fed intel read live off your run (the table
 * only records intel for seats it prepares, and your board is the run itself). Subscribes to the run only while
 * mounted, i.e. only while your seat is hovered, so the rail pays nothing for it otherwise.
 */
function SelfScoutCard({ lobby, seat, at }: { lobby: RunLobby; seat: LobbySeatState; at: { top: number; right: number } }): JSX.Element {
  const run = useGame((st) => st.run);
  const intel = useMemo(() => {
    const snap = snapshotBoard(run);
    return boardIntel({ minions: snap.minions, tier: snap.tier, snapshot: snap }, lobby.round);
  }, [run, lobby.round]);
  return <ScoutCard lobby={lobby} seat={seat} intel={intel} at={at} />;
}

const TRIBE_LABEL: Record<string, string> = {
  beast: 'Beasts', dragon: 'Dragons', undead: 'Undead', mech: 'Mechs',
  demon: 'Demons', kobold: 'Kobolds', dwarf: 'Dwarves', neutral: 'Neutral',
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
function ScoutCard({ lobby, seat, intel, at, pinned }: {
  lobby: RunLobby; seat: LobbySeatState; intel?: SeatIntel; at: { top: number; right: number };
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
  // OWNER REVIEW (2026-10-30): the card dresses to match the rail variant on screen; A and C put the seat's ringed
  // portrait in the card's header.
  const railVariant = useRailVariant();
  // C (Medallions) also carries the seat's Health + Armor pill under the name; your own reads the run, as your row does.
  const myPools = useGame((st) => (seat.id === 's0' ? `${st.run.resolve}|${st.run.armor}` : ''));
  const [hpNow, armorNow] = myPools ? myPools.split('|').map(Number) as [number, number] : [seat.resolve, seat.armor];
  const headFace = railVariant === 'plaque' || railVariant === 'medallion' ? (() => {
    const ring = resolveImageFrame(seat.id === 's0' ? 'gold' : 'default');
    const src = heroPortrait(seat.heroId, seat.id === 's0' ? runSkins : opponentSkins(showOppSkins, seat.cosmetics));
    return ring ? (
      <span className="lrv-scoutface lobbyface-host pf-on" style={ring.hostStyle} aria-hidden="true">
        <FadeImg className="lobbyface-img" src={src} alt="" />
        <PortraitFrame frame={ring} />
      </span>
    ) : null;
  })() : null;
  // Shared reads + building blocks; each layout below arranges the SAME data differently.
  const heroName = getHero(seat.heroId).name;
  const tribe = intel?.topTribe;
  const tribeLabel = tribe ? TRIBE_LABEL[tribe] : 'Mixed';
  const tribeCount = intel?.topTribeCount;
  const tribeText = tribeCount ? `${tribeLabel} ×${tribeCount}` : tribeLabel;
  const tribeColor = tribe ? `var(--t-${tribe})` : 'var(--t-neutral)';
  const head = headFace ? (
    <div className="lobbyscout-head lrv-scouthead">
      {headFace}
      <span className="lrv-scoutwho">
        <span className="lobbyscout-name">{seat.label}</span>
        <span className="lobbyscout-hero"><b>Hero:</b> {heroName}</span>
        {railVariant === 'medallion' && seat.alive && (
          <span className="lobbyhp lrv-scouthp" aria-label={`Health ${Math.max(0, hpNow)}${armorNow > 0 ? `, Armor ${armorNow}` : ''}`}>
            <Icon name="heartPill" />{Math.max(0, hpNow)}
            {armorNow > 0 && <span className="lobbyarmor"><Icon name="shield" />{armorNow}</span>}
          </span>
        )}
      </span>
    </div>
  ) : (
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
  if (variant === 2) {
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
    <div ref={cardRef} className={`lobbyscout lobbyscout--v${variant}${pinned ? ' pinned' : ''}${railVariant !== 'current' ? ` lrv-scout lrv-scout-${railVariant}` : ''}`} role={pinned ? 'dialog' : 'tooltip'}
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
      {import.meta.env.DEV && (
        <button className="lobbyscout-variant" onClick={(e) => { e.stopPropagation(); cycleVariant(); }}
          aria-description="Cycle scout-card layout (dev only)">V{variant}</button>
      )}
      {body}
    </div>,
    stageHost(),
  );
}
