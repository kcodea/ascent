/**
 * REPLAY V2 — state replay (docs/replay-v2-handoff.md, Phase A: capture).
 *
 * The recording IS the ground truth; playback is a pure renderer. A replay is a flat, wall-clock-ordered
 * list of frames: one ShopFrame per recruit-phase action (plus a `turnStart` frame when a shop opens), and
 * one CombatFrame per fight — exactly the `lastCombat` the arena already animates, plus identity. Nothing
 * here re-derives anything: no `reduce()`, no `simulate()`, no RNG.
 *
 * KEEP THIS MODULE OFF THE REDUCER PATH — it is capture/replay metadata, not run state. Nothing in
 * reducer.ts / recruit.ts may import it (it imports THEM, one-way).
 */
import { combatSide, socTwilightExtraFires, type BoardMinion, type CombatResult, type EnemyScalers, type Keyword, type MinionSnapshot } from '@game/core';
import { CARD_INDEX } from '@game/content';
import type { Action, RunMode, RunState } from './state';
import type { BoardSnapshot } from './snapshot';
import type { RankResult } from './rank';
import { nextOpponent, playerBoardMinions, playerCombatSideState, playerCombatConfig, questCombatMods } from './reducer';
import { defIsTribe } from './recruit';
import { pairRunLobby, type RunLobby } from './lobby/runLobby';
import { poolOf } from './cardPool';
import { boardStrength } from './boardModel';
import type { CombatOddsInput } from './odds';

/**
 * What produced a shop frame. Derived from the `Action` union — THE §7.2 exhaustiveness guarantee: a new
 * action type is a new `Action['type']` member and so is representable here by construction; the stats
 * panel's per-round counts can never silently under-report because a cause was missing from a hand-written
 * union. `'turnStart'` marks the synthetic frame pushed when a shop phase opens (combat → recruit flip).
 */
export type ActionCause = Action['type'] | 'turnStart';

/**
 * The ONLY RunState keys a ShopFrame omits — engine-only, unbounded-growth, or replaced by a recorded fact.
 * Everything else is captured BY DEFAULT (inclusion-by-omission — see salvage-replay/shopview-contract.md:
 * the recruit render tree reads 200+ RunState fields, so a whitelist would rot within a week).
 */
export const SHOP_VIEW_EXCLUDED_KEYS = [
  'pool',            // card-pool counts — engine-only (shop rolls); the largest single field
  'pendingTavern',   // engine roll queue; never rendered
  'fodderSchedule',  // engine roll queue; never rendered
  'rngCursor',       // engine-only; playback never draws
  'lastCombat',      // the CombatFrame carries it verbatim
  'servedBoards',    // replaced by `nextFoe` (only [wave] ever renders during recruit)
  'discoverQueue',   // invisible queued prompts; only the OPEN `discover` renders
  'tutorialCourseId', 'tutorialShopScript', 'tutorialShopRoll', 'tutorialRuneScript',
  'tutorialAttackFirst', 'tutorialForceEnemyTarget', // tutorial scripts; replays are lobby runs
  'runDamage', 'runProcs', // end-screen tallies; unbounded growth, never read in recruit
] as const satisfies readonly (keyof RunState)[];

export type ShopViewExcludedKey = (typeof SHOP_VIEW_EXCLUDED_KEYS)[number];

/**
 * Everything the recruit screen reads, snapshotted — `RunState` minus the denylist, plus the pinned next
 * foe. A NEW RunState field is captured automatically; only the keys above are trimmed.
 */
export type ShopView = Omit<RunState, ShopViewExcludedKey> & {
  /** `nextOpponent(run)` evaluated AT CAPTURE — kills the unpinned-turn-start pool-drift hole (§7 of the
   *  contract doc): on an unpinned frame `nextOpponent` falls through to today's pool, so playback must
   *  read this recorded fact instead. Lobby runs (the shipped mode) pair from `lobby` seats and never
   *  render the pool foe, so this is captured only for non-lobby runs (null otherwise). */
  nextFoe?: BoardSnapshot | null;
};

/**
 * The recorded PATH of the card drag that produced a frame's action (owner ask 2026-08-19: "1:1 hands" —
 * the replay viewer sees a ghost of the card travel the same path over the same duration, ending where the
 * drop landed, instead of the result snapping in). Rides ON the frame because the drop IS the action that
 * produced it — unlike the inspect trail, which has no frame to ride and so carries its own clock ticks.
 *
 * `pts` are VIEWPORT-FRACTION coordinates ([0..1] of window width/height, 3-decimal precision), first point
 * = the grab, last = the drop — fractions, not pixels, so a replay watched at another resolution still
 * tracks the layout (the game is a fullscreen anchored layout). The UI capture samples ~30 Hz, simplifies
 * (near-collinear points dropped) and caps the count before attaching, so a frame costs tens of points, not
 * hundreds. `durMs` is the REAL drag duration — playback spends exactly that long on the ghost (÷ speed).
 */
export interface DragPath {
  cardId: string;
  /** The dragged INSTANCE's uid (2026-09-19) — so playback can lift the source card out of its zone the way
   *  the live drag does (the ghost is the moving card; the original must not stay standing). Absent on
   *  earlier recordings, where playback derives it from the frame diff / a cardId match instead. */
  uid?: string;
  durMs: number;
  pts: [number, number][];
}

export interface ShopFrame {
  kind: 'shop';
  wave: number;
  /** Cumulative ms from run start — the timeline position (drives scrub + pacing). */
  tMs: number;
  cause: ActionCause;
  /** FULL visible recruit-phase state AFTER this action. Deep-cloned at capture. */
  view: ShopView;
  /** The drag that produced this action, when it was drag-driven (buy/play/sell/reorder/reposition). */
  drag?: DragPath;
  /** The causing action's `index`, when it had one. Recorded so playback can reproduce a CHOICE, not just
   *  its outcome: `buyRune` clears the whole offer, so which of the three was picked is otherwise only
   *  recoverable by diffing owned runes - which a DUPLICATE purchase makes ambiguous. Added 2026-08-30 for
   *  the lock-in ceremony; absent on earlier recordings, which fall back to that diff. */
  causeIndex?: number;
}

/**
 * One fight — EXACTLY a `lastCombat` (the full recorded `CombatResult`, so the arena animates it verbatim
 * with every optional carry-back intact) plus identity + timeline fields. `oddsInput` is stripped: it is
 * display-only Monte-Carlo INPUT (full boards + both side states + config — pure payload weight) whose only
 * consumer re-simulates 200 fights, which is the §2 drift class playback must never touch.
 */
export interface CombatFrame extends Omit<CombatResult, 'oddsInput'> {
  kind: 'combat';
  wave: number;
  tMs: number;
  /** Who you were paired against (display). Lobby: the seat pairing; non-lobby: the served snapshot. */
  opponent: { author: string; heroId: string };
  /** Damage dealt TO the opponent (the lobby's `enemyDamage` carry-out; 0 when unrecorded). */
  playerDamageDealt: number;
  /** Total health the player lost to this fight — armor + Resolve, Armor absorbing first (the same number
   *  the lobby table's −X floats show). Settles on `settleCombat`/`resolveCombat` — the capture layer
   *  patches this after the settle action (it is 0 at `faceOmen` time). */
  resolveLost: number;
  /** `odds` (inherited from `CombatResult`) is ABSENT at `faceOmen` time — the 200-sim probe is deferred to UI
   *  idle time (perf audit 2026-08-01) — so the capture layer stamps it onto this frame once the live probe
   *  finishes (`stampReplayOdds`, 2026-09-19): the replay viewer's "Win %" column is then the EXACT number the
   *  player saw in the Combat Summary. Recordings from before the stamp existed carry none, and the viewer
   *  backfills an approximation from the recorded rosters (`oddsInputFromCombatFrame`). */
}

/**
 * DELTA-ENCODED shop frame (§8 — implemented because it was MEASURED: a full ShopView is ~7 KB and a human
 * run takes ~250 actions, projecting ~1.9 MB/run; deltas collapse that, since most actions touch one slot).
 * Every wave's `turnStart` frame is a KEYFRAME (a full `ShopFrame`); each following action within the wave
 * records only the top-level RunState keys that changed (`changed`, JSON-compared) and the keys that
 * disappeared (`removed`). `expandFrames` reconstructs the full views; seeking never needs more than one
 * keyframe + the wave's deltas.
 */
export interface ShopDeltaFrame {
  /** See `ShopFrame.causeIndex`. */
  causeIndex?: number;
  kind: 'shopDelta';
  wave: number;
  tMs: number;
  cause: ActionCause;
  changed: Partial<ShopView>;
  removed: string[];
  /** The drag that produced this action, when it was drag-driven — see `ShopFrame.drag`. */
  drag?: DragPath;
}

export type ReplayFrame = ShopFrame | ShopDeltaFrame | CombatFrame;

export interface ReplayV2 {
  version: 2;
  /** Identity + display only. `seed` is kept for debugging/repro; playback must NEVER re-simulate from it. */
  seed: number;
  heroId: string;
  mode: RunMode;
  /** Display handle at capture time. */
  author: string;
  /** Content revision at capture (provenance / bug triage). */
  patch: string;
  /** Stamped on upload; capture scripts can't be trusted with Date.now(). */
  createdAtMs?: number;
  /** A recording that does NOT begin at wave 1. Since 2026-08-20 the capture layer persists frames per round
   *  to IndexedDB, so an ordinary quit-and-resume produces a COMPLETE replay; this is now reserved for the
   *  cases where that failed (see `partialReason`). Viewers must label the recorded range rather than imply
   *  the missing rounds were filtered out. */
  partial?: true;
  /** The earliest wave the recording actually contains — what a partial replay advertises up front. */
  firstRecordedWave?: number;
  /** Why the recording is short. `resumed_without_frames` = resumed before draft persistence existed, or the
   *  draft was missing; `storage_failure` = IndexedDB refused/failed mid-run; `legacy_capture` = recorded by
   *  a build that never persisted drafts at all. */
  partialReason?: 'resumed_without_frames' | 'storage_failure' | 'legacy_capture';
  /** Wall-clock order. */
  frames: ReplayFrame[];
  /** Open/close events of the card-inspect overlay (right-click), on the SAME clock as `frames[].tMs` —
   *  playback re-opens the same panel on the same card at the same moment (literal 1:1). Optional: absent
   *  on recordings made before it existed. See the inspect-trail section at the bottom of this module. */
  inspectTrail?: InspectEvent[];
  /** The FREE-CURSOR trail (2026-09-19): where the recorded player's pointer was on the recruit screen, on
   *  the SAME clock as `frames[].tMs`, sampled at ≤20 Hz, simplified per round and capped at
   *  `CURSOR_TRAIL_MAX` samples for the whole run (thinned uniformly beyond). Playback moves a gauntlet
   *  sprite along it. Optional and backward-compatible: the version stays 2, and a recording made before the
   *  trail existed simply has none (the viewer's Cursor toggle then has nothing to show). Drag paths are NOT
   *  duplicated here — the ghost plays those from the frame's `drag`; the trail carries the hand between
   *  drags. See the cursor-trail section at the bottom of this module. */
  cursorTrail?: CursorSample[];
  /** The recorded truth about the outcome. */
  result: {
    /** Lobby finish, 1..8 (1 = won). */
    placement: number;
    record: { wins: number; losses: number; draws: number };
    /** Legacy numeric delta; since medals the APPLIED rank delta (patched in when the server confirms). */
    ratingDelta?: number;
    /** MEDAL RANK (2026-09-20): the server-confirmed, immutable result of this run — patched onto the local
     *  recording when the settlement lands. Optional: a recording from before medals, an unrated run, or one
     *  whose settlement is still pending simply lacks it. NEVER recomputed from later rules. */
    rank?: RankResult;
    /** The end-state board the leaderboard/Career shows (null for an empty board). */
    finalBoard: BoardSnapshot | null;
  };
}

/**
 * Project the FULL visible recruit-phase state out of a run: shallow-copy, delete the excluded keys
 * (BEFORE the clone, so the heavy engine fields are never copied), deep-clone what remains, and pin the
 * next foe. The `structuredClone` is the §5 no-mutation-leak guarantee — the reducer shares `lastCombat` /
 * `servedBoards` by reference and mutates boards in place, so a shallow capture would let later turns
 * corrupt earlier frames.
 */
export function projectShopView(run: RunState): ShopView {
  const raw: Record<string, unknown> = { ...run };
  for (const k of SHOP_VIEW_EXCLUDED_KEYS) delete raw[k];
  const view = structuredClone(raw) as ShopView;
  // Lobby runs pair from seats (already in the view via `lobby`); only non-lobby modes render the pool foe.
  const foe = run.lobby ? null : nextOpponent(run);
  view.nextFoe = foe ? structuredClone(foe) : null;
  return view;
}

/** Build one FULL shop frame (a keyframe) from the run state AFTER an action — used for every `turnStart`
 *  (shop opening) and as the fallback when no previous view exists to delta against. */
export function shopFrameOf(run: RunState, cause: ActionCause, tMs: number, causeIndex?: number): ShopFrame {
  const f: ShopFrame = { kind: 'shop', wave: run.wave, tMs, cause, view: projectShopView(run) };
  if (typeof causeIndex === 'number') f.causeIndex = causeIndex;
  return f;
}

/** JSON-model equality — the payload is JSON, so JSON equality is the equality that matters. */
const jsonEqual = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * Build one DELTA shop frame against the previous frame's (reconstructed) view, and return the new full view
 * for the NEXT diff. The returned frame shares subtree references with the returned view — both are
 * capture-owned clones that nothing mutates, so the sharing is safe and costs no extra copies.
 */
export function deltaShopFrameOf(
  prevView: ShopView,
  run: RunState,
  cause: ActionCause,
  tMs: number,
  causeIndex?: number,
): { frame: ShopDeltaFrame; view: ShopView } {
  const view = projectShopView(run);
  const prev = prevView as unknown as Record<string, unknown>;
  const cur = view as unknown as Record<string, unknown>;
  const changed: Record<string, unknown> = {};
  const removed: string[] = [];
  for (const k of Object.keys(cur)) {
    // A key EXPLICITLY set to undefined must travel as a REMOVAL, never inside `changed` — JSON serialization
    // silently drops undefined values, so an uploaded replay would lose the clear and the old value would
    // survive the merge forever. Found live 2026-08-19: the reducer clears a spent Runeforge with
    // `s.runeforgeOffer = undefined`, and the forge overlay never closed in playback.
    if (cur[k] === undefined) { if (k in prev && prev[k] !== undefined) removed.push(k); continue; }
    if (!(k in prev) || !jsonEqual(prev[k], cur[k])) changed[k] = cur[k];
  }
  for (const k of Object.keys(prev)) if (!(k in cur)) removed.push(k);
  const frame: ShopDeltaFrame = { kind: 'shopDelta', wave: run.wave, tMs, cause, changed: changed as Partial<ShopView>, removed };
  if (typeof causeIndex === 'number') frame.causeIndex = causeIndex;
  return { frame, view };
}

/**
 * Reconstruct the full-view timeline from a (possibly delta-encoded) frame list. Combat frames pass through;
 * every `shopDelta` is folded onto the running view (shallow top-level merge — deltas are top-level-key).
 * Expanded views share unchanged subtrees with their predecessors: playback treats views as READ-ONLY (it
 * never reduces or mutates them), so the sharing is free rather than dangerous. A delta with no preceding
 * keyframe (impossible for frames this module's capture rules produced) throws rather than rendering blanks.
 */
export function expandFrames(frames: readonly ReplayFrame[]): (ShopFrame | CombatFrame)[] {
  const out: (ShopFrame | CombatFrame)[] = [];
  let cur: ShopView | null = null;
  for (const f of frames) {
    if (f.kind === 'combat') { out.push(f); continue; }
    if (f.kind === 'shop') { cur = f.view; out.push(f); continue; }
    if (!cur) throw new Error('expandFrames: a shopDelta frame arrived before any keyframe');
    const next = { ...cur, ...f.changed } as ShopView;
    for (const k of f.removed) delete (next as unknown as Record<string, unknown>)[k];
    cur = next;
    // `drag` and `causeIndex` carry through expansion — playback reads both off the expanded frame (the
    // ghost, and the rune lock-in ceremony respectively).
    out.push({
      kind: 'shop', wave: f.wave, tMs: f.tMs, cause: f.cause, view: next,
      ...(f.drag ? { drag: f.drag } : {}),
      ...(typeof f.causeIndex === 'number' ? { causeIndex: f.causeIndex } : {}),
    });
  }
  return out;
}

/** The identity of the opponent the player's fight this round was served against. Identity ONLY — never
 *  prepares a board (driver prep costs 200-900 ms per seat; the pairing itself is a cheap pure search). */
export function combatOpponentIdentity(prev: RunState, next: RunState): { author: string; heroId: string } {
  const lobby: RunLobby | undefined = prev.lobby;
  if (lobby) {
    const { pairs, bye } = pairRunLobby(lobby);
    const pair = pairs.find(([a, b]) => a.id === 's0' || b.id === 's0');
    if (pair) {
      const foe = pair[0].id === 's0' ? pair[1] : pair[0];
      return { author: foe.label, heroId: foe.heroId };
    }
    if (bye?.id === 's0') {
      // Holding the bye: the ghost is the most recently fallen seat (mirrors `ghostFor`, identity only).
      const fallen = lobby.seats
        .filter((x) => !x.alive && x.eliminatedRound !== undefined && x.eliminatedRound < lobby.round)
        .sort((a, b) => (b.eliminatedRound ?? 0) - (a.eliminatedRound ?? 0))[0];
      if (fallen) return { author: fallen.label, heroId: fallen.heroId };
    }
  }
  // Non-lobby: the served snapshot (pinned by faceOmen into `next.servedBoards`), or the procedural threat.
  const served = next.servedBoards?.[prev.wave];
  if (served) return { author: served.author ?? '', heroId: served.heroId };
  return { author: '', heroId: '' };
}

/**
 * Build one combat frame from a resolved `faceOmen` transition: `prev` is the pre-action state (the wave +
 * lobby pairing the fight used), `next` carries the fresh `lastCombat`. The whole recorded CombatResult is
 * deep-cloned (minus `oddsInput`) — the reducer keeps mutating the SAME `lastCombat` reference afterwards.
 * `resolveLost` starts at 0; the capture layer patches it when the settle action lands.
 */
export function combatFrameOf(prev: RunState, next: RunState, tMs: number): CombatFrame {
  const lc = next.lastCombat;
  if (!lc) throw new Error('combatFrameOf: next.lastCombat is missing');
  const recorded: Partial<CombatResult> = { ...lc };
  delete recorded.oddsInput; // stripped BEFORE the clone — see the CombatFrame doc
  const clone = structuredClone(recorded) as Omit<CombatResult, 'oddsInput'>;
  return {
    ...clone,
    kind: 'combat',
    wave: prev.wave,
    tMs,
    opponent: combatOpponentIdentity(prev, next),
    playerDamageDealt: lc.enemyDamage ?? 0,
    resolveLost: 0,
  };
}

/** One rail row per round (§7.1): where to seek to, and how the round's fight went. */
export interface RoundMark {
  wave: number;
  /** Seek target: the wave's `turnStart` shop frame (the shop opening), falling back to its first frame. */
  tMs: number;
  result?: 'win' | 'loss' | 'draw';
  resolveLost?: number;
  /** Frame INDEX of the wave's shop opening (the `turnStart` frame, else its first shop frame) — the rail's
   *  Recruit cell seeks here. Absent when the wave recorded no shop frame at all. */
  shopIndex?: number;
  /** Frame index of the wave's LAST shop frame — the end-of-recruit board the Power / Win % columns read. */
  lastShopIndex?: number;
  /** Frame index of the wave's combat frame — the rail's Combat cell seeks here (the fight plays from its
   *  start). Absent when the wave recorded no fight (a partial recording's open final wave). */
  combatIndex?: number;
}

/** Derive the round rail's index — one pass over the frames, wave order preserved (frames are appended in
 *  wall-clock order, so waves arrive contiguous and ascending). */
export function roundMarks(frames: readonly ReplayFrame[]): RoundMark[] {
  const byWave = new Map<number, RoundMark & { sawTurnStart?: boolean }>();
  frames.forEach((f, i) => {
    let mark = byWave.get(f.wave);
    if (!mark) {
      mark = { wave: f.wave, tMs: f.tMs };
      byWave.set(f.wave, mark);
    }
    if (f.kind !== 'combat') {
      if (f.cause === 'turnStart' && !mark.sawTurnStart) { mark.tMs = f.tMs; mark.shopIndex = i; mark.sawTurnStart = true; }
      else if (mark.shopIndex === undefined) mark.shopIndex = i;
      mark.lastShopIndex = i;
    } else {
      mark.result = f.result === 'lose' ? 'loss' : f.result;
      mark.resolveLost = f.resolveLost;
      if (mark.combatIndex === undefined) mark.combatIndex = i;
    }
  });
  return [...byWave.values()]
    .sort((a, b) => a.wave - b.wave)
    .map(({ sawTurnStart: _s, ...mark }) => mark);
}

/**
 * The BOARD POWER the replay viewer prints per round (2026-09-19, "Power" column): the learned board-strength
 * model (`boardStrength`, packages/sim/src/boardModel.ts — the evaluator the production bots search with) over
 * a recorded end-of-recruit board, squashed to 0..1 and printed as 0..100. `null` for an empty board (the
 * model declines to score it — the column prints an em-dash rather than a misleading 0).
 */
export function boardPowerOf(view: Pick<ShopView, 'board'>, wave: number): number | null {
  if (!view.board?.length) return null;
  const minions: BoardMinion[] = view.board.map((b) => ({
    cardId: b.cardId, attack: b.attack, health: b.health, keywords: [...b.keywords] as Keyword[], golden: b.golden,
  }));
  const s = boardStrength(minions, wave);
  return s > 0 ? Math.round(s * 100) : null;
}

/**
 * APPROXIMATE odds input for a recording whose combat frame carries no stamped `odds` (made before
 * 2026-09-19). The exact `oddsInput` is stripped at capture (the §2 drift class), so this rebuilds the matchup
 * from what the recording DOES carry:
 *
 *  - Both starting rosters from `initial` (the instantiated boards before the first Start-of-Combat event):
 *    stats, keywords, gilding — post-End-of-Turn, with the banked keyword grants and Open the Gates' Imps in.
 *  - The PLAYER'S run-level side state from the round's last shop frame: a `ShopView` is the RunState minus a
 *    few engine-only keys, so the SAME builder the real fight used (`playerCombatSideState`: runes, quest mods,
 *    spell power, auras, hand, hero power — ~45 scalers) rebuilds it verbatim. This was the bug (owner report
 *    2026-09-19): the first backfill fed a NEUTRAL side, so a Beast build's Rune of Beastial Swarm / Rune of
 *    Warding never fired in the estimate and recorded wins read ~0%.
 *  - The player's per-instance carries (grafted effects, Bloodlust, Imp banks, buff breakdowns, alignment)
 *    from the shop frame's board, matched onto the `initial` bodies by position + card id.
 *  - The ENEMY'S side from the frame's `enemyScalers` (spell power, Imp aura, Ruby strength, …) at the paired
 *    seat's scouted tier. A rival seat's runes / quest mods and its Undead / Beast / Attachment auras are not
 *    in the recording (its snapshot lives in the opponent pool, not the replay), so the enemy side is the
 *    weaker approximation — the number stays an estimate and the viewer marks it `~`.
 *
 * `initial` already carries the LIVE auras the simulator folds into the player's starting bodies (Imp aura,
 * Undead Lantern) — those are backed out before the probe re-applies them. Fleeting Vigor is the reverse:
 * `enterCombat` rewinds it out of `initial` into opening events, so the bank still on the shop frame is put back.
 * New recordings carry the exact figure and never come through here.
 */
export function oddsInputFromCombatFrame(
  frame: Pick<CombatFrame, 'initial' | 'enemyScalers' | 'opponent'>,
  view: ShopView | null,
): CombatOddsInput {
  const poolIds = poolOf(view ?? {}).all.map((c) => c.id);
  const tier = view?.tier ?? 1;
  if (!view) {
    // No shop frame for the round (a partial recording) — the neutral estimate is all there is.
    const toMinion = (m: MinionSnapshot): BoardMinion => ({ cardId: m.cardId, attack: m.attack, health: m.health, keywords: [...m.keywords], golden: m.golden ?? false });
    return {
      player: frame.initial.player.map(toMinion),
      enemy: frame.initial.enemy.map(toMinion),
      playerState: combatSide({ tier, poolIds }),
      enemyState: combatSide({ tier, poolIds }),
      config: {},
    };
  }
  // The view is `RunState` minus `SHOP_VIEW_EXCLUDED_KEYS`; the player-side builders read none of those keys
  // (pinned in `replayOdds.test.ts`), so the view stands in for the run.
  const run = view as unknown as RunState;
  const playerState = playerCombatSideState(run);
  // One extra pass per Twilight COPY (`socTwilightExtraFires`, the definition combat's pass consults) — a second
  // copy used to triple minion effects in combat but only double these (reviewer 2026-09-21).
  const twilightMult = 1 + socTwilightExtraFires({ runeTwilight: !!run.questFlags?.runeTwilight, flagCopies: run.flagCopies });
  const fleeting = run.fleetingVigor && (run.fleetingVigor.attack !== 0 || run.fleetingVigor.health !== 0)
    ? { attack: run.fleetingVigor.attack * twilightMult, health: run.fleetingVigor.health * twilightMult }
    : null;
  const player = overlayRoster(frame.initial.player, playerBoardMinions(run.board), (m, snap, fromBoard) => {
    // Back out the live auras `simulate` applied to the starting bodies (it re-applies them from the side state).
    const def = CARD_INDEX[snap.cardId];
    if (def?.imp) { m.attack = Math.max(0, m.attack - playerState.impAtk); m.health -= playerState.impHp; }
    if (defIsTribe(def, 'undead') || m.universalTribe) { m.attack = Math.max(0, m.attack - playerState.undeadAtk); m.health -= playerState.undeadHp; }
    // Fleeting Vigor covered the run board only — not the Imps appended after it.
    if (fleeting && fromBoard) { m.attack += fleeting.attack; m.health += fleeting.health; }
  });
  const foe = replayFoeSeat(view, frame.opponent);
  // `enemyScalers` grew field by field (2026-08 → 09); an older recording carries a subset, so every read
  // defaults — the shape on disk is whatever the build that recorded it knew.
  const es: Partial<EnemyScalers> = frame.enemyScalers ?? {};
  const pair = (p: { attack?: number; health?: number } | undefined): { attack: number; health: number } => ({ attack: p?.attack ?? 0, health: p?.health ?? 0 });
  const enemyState = combatSide({
    tier: foe?.intel?.tier ?? tier,
    poolIds,
    spellPowerAtk: pair(es.spellPower).attack, spellPowerHp: pair(es.spellPower).health,
    spellsThisTurn: es.spellsThisTurn ?? 0, beastsPlayed: es.beastsPlayed ?? 0, deathrattles: es.deathrattles ?? 0,
    conductorBuff: es.conductorBuff ?? 0, spellsCast: es.spellsCast ?? 0, rubyCasts: es.rubyCasts ?? 0,
    spiritsPlayed: es.spiritsPlayed ?? 0, tribesPlayed: es.tribesPlayed ?? {}, revelerX: es.revelerX ?? 0,
    impAtk: pair(es.impAura).attack, impHp: pair(es.impAura).health,
    fodderConsumedAtk: pair(es.fodderConsumed).attack, fodderConsumedHp: pair(es.fodderConsumed).health,
    undeadBuyAtk: es.undeadBuyAtk ?? 0, cardBuffs: es.cardBuffs ?? {}, alesLastTurn: es.alesLastTurn ?? 0,
    lastSpellCastId: es.lastSpellCastId, rememberedSpellIds: [...(es.rememberedSpellIds ?? [])],
    spellEscalation: pair(es.spellEscalation), growthBonus: es.growthBonus ?? 0, rubyBonus: pair(es.rubyBonus),
    // The rival's hero power is the one run-level enemy scaler the recording names (Atrius' Possession, …).
    questMods: questCombatMods({ heroId: frame.opponent.heroId, spellsCast: es.spellsCast ?? 0 } as RunState),
  });
  const enemy = overlayRoster(frame.initial.enemy, [], () => {});
  return { player, enemy, playerState, enemyState, config: playerCombatConfig(run) };
}

/** The lobby seat the player was paired with for this fight, for its scouted intel — matched by hero + label
 *  (the seat's pairing is not stored on the frame). Null for a non-lobby run / an unmatched opponent. */
function replayFoeSeat(view: ShopView, opponent: CombatFrame['opponent']): RunLobby['seats'][number] | null {
  const seats = view.lobby?.seats ?? [];
  return seats.find((s) => s.id !== 's0' && s.heroId === opponent.heroId && s.label === opponent.author)
    ?? seats.find((s) => s.id !== 's0' && s.heroId === opponent.heroId)
    ?? null;
}

/**
 * The probe's roster for one side: the `initial` bodies (what actually entered the fight, End of Turn included —
 * stats, keywords, gilding and the per-instance tallies the snapshot carries) laid over the run board's
 * per-instance fields the snapshot does NOT carry (grafted effects, Bloodlust, Imp banks, alignment, …), matched
 * by position when the card id agrees, else by the next unused board card of that id. A body with no match (an
 * Imp Open the Gates appended, a token) is built from the snapshot alone. `adjust` runs per body with
 * `fromBoard` = matched.
 */
function overlayRoster(
  snaps: readonly MinionSnapshot[],
  board: readonly BoardMinion[],
  adjust: (m: BoardMinion, snap: MinionSnapshot, fromBoard: boolean) => void,
): BoardMinion[] {
  const used = new Set<number>();
  return snaps.map((snap, i) => {
    let bi = board[i]?.cardId === snap.cardId && !used.has(i) ? i : -1;
    if (bi < 0) bi = board.findIndex((b, j) => !used.has(j) && b.cardId === snap.cardId);
    const base = bi >= 0 ? board[bi]! : null;
    if (bi >= 0) used.add(bi);
    // The snapshot's own fields win where it carries one (they are post-End-of-Turn); its identity fields
    // (`uid`, `name`, `tribe`) are combat-instance data a BoardMinion does not hold.
    const defined = Object.fromEntries(Object.entries(snap).filter(([k, v]) => v !== undefined && k !== 'uid' && k !== 'name' && k !== 'tribe'));
    const m: BoardMinion = { ...(base ?? {}), ...defined, cardId: snap.cardId, attack: snap.attack, health: snap.health, keywords: [...snap.keywords], golden: snap.golden ?? false };
    adjust(m, snap, base !== null);
    return m;
  });
}

/** The metrics drawer's three numbers, per round (§7.4). A pure fold over recorded frames — it cannot
 *  drift from the replay being watched, and it works retroactively on any v2 recording. */
export interface RoundStat {
  wave: number;
  /** Gross Gold spent this round — the run's own per-turn tally (`goldSpentThisTurn`: incremented in the
   *  reducer's single `spendGold` chokepoint, reset each wave), read off the wave's LAST shop frame. */
  goldSpent: number;
  /** Player actions this round: the wave's shop frames with `cause !== 'turnStart'`. */
  actions: number;
  /** Shop tier when the round's shop opened (the `turnStart` frame; first frame as a fallback). */
  tierAtStart: number;
}

export function rollupRounds(frames: readonly ReplayFrame[]): RoundStat[] {
  const byWave = new Map<number, RoundStat & { sawTurnStart: boolean }>();
  for (const f of expandFrames(frames)) {
    if (f.kind !== 'shop') continue;
    let stat = byWave.get(f.wave);
    if (!stat) {
      stat = { wave: f.wave, goldSpent: 0, actions: 0, tierAtStart: f.view.tier, sawTurnStart: false };
      byWave.set(f.wave, stat);
    }
    if (f.cause === 'turnStart') {
      if (!stat.sawTurnStart) { stat.tierAtStart = f.view.tier; stat.sawTurnStart = true; }
    } else {
      stat.actions += 1;
    }
    stat.goldSpent = f.view.goldSpentThisTurn ?? 0; // the wave's LAST shop frame wins (per-turn gross tally)
  }
  return [...byWave.values()]
    .sort((a, b) => a.wave - b.wave)
    .map(({ sawTurnStart: _s, ...stat }) => stat);
}

// ── Inspect trail (owner ask 2026-08-19: literal 1:1 includes the inspect overlay) ─────────────────────────
// When the recorded player right-clicked a card open (the centred inspect panel), the replay viewer sees the
// same panel open on the same card at the same moment, and close when it closed. Inspect is STORE-level UI
// state, not a reducer action, so it rides its own capture channel: a wall-clock trail of open/close events
// on the SAME clock the frames use. The payload per open is the UI's full CardView snapshot — the panel
// renders `store.inspect` directly (buffs breakdown + the plated Card), and the CardView is a small plain-
// JSON projection that already folds in live card text, so replaying it verbatim is both the faithful choice
// (the hard live-text rule) and the crash-proof one (no uid lookup against a frame can miss).

/** The inspect payload: the UI's CardView, opaque to sim (the ui package owns the shape; playback feeds it
 *  back to the store verbatim). `cardId` is the one field the coalescing rule reads (per-target throttle). */
export type InspectSnapshot = { cardId: string } & Record<string, unknown>;

export interface InspectEvent {
  /** Same cumulative-ms clock as the frames' `tMs` — the two timelines are one timeline. */
  tMs: number;
  /** The opened card's snapshot, or null = the panel closed. */
  inspect: InspectSnapshot | null;
}

/** An open+close round-trip shorter than this is hover noise — both events are dropped. */
export const INSPECT_NOISE_MS = 150;
/** Re-opens of the SAME card are throttled to one recorded open per this window (the newer one wins). */
export const INSPECT_OPEN_THROTTLE_MS = 100;
/** Trail cap — a hover-happy run can't bloat the payload. A close may exceed it by one so the trail can
 *  never end stuck-open. */
export const INSPECT_TRAIL_MAX = 2000;

/**
 * Append one inspect event to the trail IN PLACE, applying the coalescing rules. Pure with respect to
 * everything but `trail` — unit-testable. The rules:
 *  - a CLOSE that lands < `INSPECT_NOISE_MS` after the open it closes, where dropping BOTH returns the trail
 *    to a closed state, is hover noise: the open is popped and the close dropped;
 *  - an OPEN of the same card < `INSPECT_OPEN_THROTTLE_MS` after its previous recorded open REPLACES it;
 *  - a CLOSE is otherwise always recorded (deduped: never two closes in a row, never a leading close);
 *  - at `max` events, new opens are dropped; a close still lands if the trail would otherwise end open.
 */
export function appendInspectEvent(trail: InspectEvent[], ev: InspectEvent, max = INSPECT_TRAIL_MAX): void {
  const last = trail[trail.length - 1];
  if (ev.inspect === null) {
    if (!last || last.inspect === null) return; // already closed — nothing to record
    const beforeLast = trail[trail.length - 2];
    if (ev.tMs - last.tMs < INSPECT_NOISE_MS && (!beforeLast || beforeLast.inspect === null)) {
      trail.pop(); // noise: the blip open + its close both vanish, restoring the closed state
      return;
    }
    trail.push(ev); // a close always lands (the +1 over `max` is deliberate — never end stuck-open)
    return;
  }
  if (last && last.inspect && last.inspect.cardId === ev.inspect.cardId
      && ev.tMs - last.tMs < INSPECT_OPEN_THROTTLE_MS) {
    trail[trail.length - 1] = ev; // per-target throttle: the newer open replaces the recorded one
    return;
  }
  if (trail.length >= max) return; // capped: drop further opens (closes above still land)
  trail.push(ev);
}

// ── Cursor trail (2026-09-19: the replay viewer shows the recorded player's hand between drags) ───────────
// The recruit screen samples `pointermove` at ≤20 Hz (`ui/replay/cursorTrace.ts`) into a trail of
// `[tMs, x, y]` tuples on the SAME cumulative clock as the frames — viewport FRACTIONS like `DragPath.pts`, so
// a replay watched at another resolution still tracks the fullscreen anchored layout. Tuples rather than
// objects because the trail is the one payload that scales with TIME rather than with actions: a 20-minute
// shop at 20 Hz is 24,000 raw samples, and the key overhead of `{t,x,y}` JSON would triple its weight.

/** One cursor sample: `[tMs, xFraction, yFraction]` (x/y at 3-decimal precision). */
export type CursorSample = [number, number, number];

/** Sampling floor: at most one recorded sample per this many ms (20 Hz). */
export const CURSOR_SAMPLE_MS = 50;
/** Cap on the WHOLE run's trail — beyond it the trail is thinned uniformly (`thinCursorTrail`). ~6,000 tuples
 *  is ~120 KB of JSON: bounded, whatever the run's length. */
export const CURSOR_TRAIL_MAX = 6000;

/** Uniform thinning to at most `max` samples, first and last kept. Returns a copy when already under. Pure. */
export function thinCursorTrail(trail: readonly CursorSample[], max = CURSOR_TRAIL_MAX): CursorSample[] {
  if (trail.length <= max) return trail.slice();
  if (max <= 1) return trail.length ? [trail[0]!] : [];
  const out: CursorSample[] = [];
  for (let i = 0; i < max; i++) out.push(trail[Math.round((i * (trail.length - 1)) / (max - 1))]!);
  return out;
}

/** The cursor position at `tMs` — linear interpolation between the surrounding samples; the first sample
 *  before the trail begins, the last after it ends; `null` for an empty trail. `hint` is the index of the
 *  sample at-or-before the previous query, so a monotone playback clock advances in O(1) per frame rather
 *  than re-searching (a seek passes no hint and pays one binary search). Pure — tested. */
export function cursorAt(trail: readonly CursorSample[], tMs: number, hint?: number): { x: number; y: number; index: number } | null {
  const n = trail.length;
  if (n === 0) return null;
  const holds = (k: number): boolean => k >= 0 && k < n && trail[k]![0] <= tMs && (k === n - 1 || trail[k + 1]![0] > tMs);
  let i: number;
  if (hint !== undefined && holds(hint)) i = hint;
  else if (hint !== undefined && holds(hint + 1)) i = hint + 1; // the common case: the clock advanced one sample
  else {
    let lo = 0, hi = n - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (trail[mid]![0] <= tMs) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    i = ans;
  }
  if (i < 0) return { x: trail[0]![1], y: trail[0]![2], index: 0 };
  const a = trail[i]!;
  const b = trail[i + 1];
  if (!b || b[0] <= a[0]) return { x: a[1], y: a[2], index: i };
  const f = Math.max(0, Math.min(1, (tMs - a[0]) / (b[0] - a[0])));
  return { x: a[1] + (b[1] - a[1]) * f, y: a[2] + (b[2] - a[2]) * f, index: i };
}
