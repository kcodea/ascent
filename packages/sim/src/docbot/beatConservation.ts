/**
 * DOC BOT — BEAT CONSERVATION (the presentation half of the conservation laws).
 *
 * The recruit reducer EMITS a presentation batch beside every state change (`reduceWithPresentation`): each
 * trigger scope diffs the state around its effect and claims what it did — `statsChanged`, `cardGranted`,
 * `cardSummoned`, `cardDestroyed`, `rubyPlayed`, `resourceChanged`. The UI animates those claims and never
 * re-diffs state (blueprint §7 rule 1), so a claim that is not exactly what happened is a defect the player
 * SEES: Rope Wrangler's steals were previewed twice (Bug Board bb5195d5), Arnold's Beefy read +16/+16 for a
 * real +8/+8 (af51e5a3) — a scope opened INSIDE another diffed the same window and both levels emitted.
 *
 * This module reconciles the batch against the actual (before → after) diff of one action. Doctrine (the
 * conservationLaws LAW 4 shape): EXACT equality, no catch-all —
 *
 *   OVER-CLAIM / MISATTRIBUTION (hard, every action, the shipped bug class):
 *     · a stat claim on a uid that exists nowhere (phantom body);
 *     · per uid present on both sides, Σ claimed Attack/Health ≠ the actual delta — a doubled emission
 *       overshoots, a claim on the wrong body puts the number on the wrong card;
 *     · a `cardGranted` / `cardSummoned` for a uid that did not arrive, or claimed twice for one arrival;
 *     · a `cardDestroyed` (with uid) for a body that did not leave (unless it is rising), or claimed twice;
 *     · a `cardTransformed` for a uid not on the board afterwards;
 *     · a consequence outside any trigger scope (no `parentId`) — a consequence nobody is the source of;
 *   UNDER-CLAIM (the "missing beat" class) — a body that changed with NO beat claiming it, or an arrival /
 *     departure no beat announced, beyond the action's own primary move (the bought / played / sold /
 *     picked card is the action itself, not an effect). This half is gated per action type: where an
 *     action's whole resolution is scoped (End of Turn, a hero power, a shop death) it is a hard gate; the
 *     dispatch sites that open no scope today are pinned shrink-only in the test (`KNOWN_UNATTRIBUTED`).
 *   GOLD (hero powers only): a power's batch is one whole-action diff, so Σ `resourceChanged: gold` must
 *     equal the actual Gold delta exactly. Other actions move Gold through the action itself (a price) plus
 *     rewards a beat may claim, so the sum is not reconcilable from outside — not asserted, as documented.
 */
import type { GamePresentationEvent } from '@game/core';
import type { Action, RunState } from '../state';

interface Stat { a: number; h: number }
interface Body { uid: string; cardId: string; attack: number; health: number }

export interface BeatClaims {
  /** Σ statsChanged + rubyPlayed per target uid. */
  stats: Map<string, Stat & { cardIds: Set<string> }>;
  /** cardGranted / cardSummoned / cardDestroyed / cardTransformed counts per uid. */
  granted: Map<string, { count: number; cardId: string }>;
  summoned: Map<string, { count: number; cardId: string }>;
  destroyed: Map<string, { count: number; rise: boolean }>;
  transformed: Map<string, string[]>;
  /** Σ resourceChanged gold, or null when nothing claimed Gold. */
  gold: number | null;
  /** Consequences with no `parentId` — attributed to no trigger. */
  orphans: string[];
}

/** The phases whose consequences describe the RUN state (board / hand / Gold). A `startOfCombat` /
 *  `combat` / `postCombat` trigger emitted at the hand-off (Fleeting Vigor, Rayse's vigour) describes the
 *  combat copies — the run board does not move, so those claims are not this ledger's. */
const RUN_PHASES = new Set(['recruit', 'endOfTurn']);

/** Fold a batch's consequence events into per-uid claims. Pure. */
export function claimsOf(events: readonly GamePresentationEvent[]): BeatClaims {
  const c: BeatClaims = { stats: new Map(), granted: new Map(), summoned: new Map(), destroyed: new Map(), transformed: new Map(), gold: null, orphans: [] };
  const bump = (m: Map<string, { count: number; cardId: string }>, k: string, cardId: string): void => {
    const cur = m.get(k) ?? { count: 0, cardId };
    cur.count += 1;
    m.set(k, cur);
  };
  const triggers = new Map<string, { phase: string; parentId?: string }>();
  for (const e of events) if (e.type === 'sourceTrigger') triggers.set(e.id, { phase: e.phase, ...(e.parentId ? { parentId: e.parentId } : {}) });
  const rootPhase = (parentId: string | undefined): string | undefined => {
    let cur = parentId ? triggers.get(parentId) : undefined;
    let guard = 0;
    while (cur?.parentId && triggers.has(cur.parentId) && guard++ < 32) cur = triggers.get(cur.parentId);
    return cur?.phase;
  };
  for (const e of events) {
    if (e.type === 'sourceTrigger') continue;
    if (!e.parentId) { c.orphans.push(`${e.type}${'target' in e && e.target?.uid ? `@${e.target.uid}` : ''}`); continue; }
    const phase = rootPhase(e.parentId);
    if (phase !== undefined && !RUN_PHASES.has(phase)) continue;
    switch (e.type) {
      case 'statsChanged':
      case 'rubyPlayed': {
        const uid = e.target.uid;
        if (!uid) break; // a zone-level claim (no body) — nothing to reconcile per uid
        const cur = c.stats.get(uid) ?? { a: 0, h: 0, cardIds: new Set<string>() };
        cur.a += e.attack ?? 0;
        cur.h += e.health ?? 0;
        if (e.target.cardId) cur.cardIds.add(e.target.cardId);
        c.stats.set(uid, cur);
        break;
      }
      case 'cardGranted': if (e.target.uid) bump(c.granted, e.target.uid, e.cardId); break;
      case 'cardSummoned': if (e.target.uid) bump(c.summoned, e.target.uid, e.cardId); break;
      case 'cardDestroyed': {
        if (!e.target.uid) break; // Fodder / eaten-offer destroys carry no board uid — fodderEaten is their record
        const cur = c.destroyed.get(e.target.uid) ?? { count: 0, rise: false };
        cur.count += 1;
        cur.rise ||= !!e.rise;
        c.destroyed.set(e.target.uid, cur);
        break;
      }
      case 'cardTransformed': {
        const uid = e.target.uid;
        if (!uid) break;
        c.transformed.set(uid, [...(c.transformed.get(uid) ?? []), e.toCardId]);
        break;
      }
      case 'resourceChanged':
        if (e.resource === 'gold') c.gold = (c.gold ?? 0) + e.amount;
        break;
      default:
        break;
    }
  }
  return c;
}

export interface ActualDiff {
  /** Per uid present in BOTH states (board or hand): the stat delta. */
  stats: Map<string, Stat & { cardId: string }>;
  handArrivals: Body[];
  boardArrivals: Body[];
  boardDepartures: Body[];
  gold: number;
}

const bodies = (s: RunState): { board: Body[]; hand: Body[] } => ({
  board: s.board.map((c) => ({ uid: c.uid, cardId: c.cardId, attack: c.attack, health: c.health })),
  hand: s.hand.map((c) => ({ uid: c.uid, cardId: c.cardId, attack: c.attack, health: c.health })),
});

/** The real (before → after) diff along the dimensions beats claim. Pure. */
export function actualDiffOf(before: RunState, after: RunState): ActualDiff {
  const b = bodies(before);
  const a = bodies(after);
  const beforeBy = new Map([...b.board, ...b.hand].map((x) => [x.uid, x]));
  const stats = new Map<string, Stat & { cardId: string }>();
  for (const now of [...a.board, ...a.hand]) {
    const was = beforeBy.get(now.uid);
    if (!was) continue;
    stats.set(now.uid, { a: now.attack - was.attack, h: now.health - was.health, cardId: now.cardId });
  }
  const beforeHand = new Set(b.hand.map((x) => x.uid));
  const beforeBoard = new Set(b.board.map((x) => x.uid));
  const afterBoard = new Set(a.board.map((x) => x.uid));
  return {
    stats,
    handArrivals: a.hand.filter((x) => !beforeHand.has(x.uid) && !beforeBoard.has(x.uid)),
    boardArrivals: a.board.filter((x) => !beforeBoard.has(x.uid) && !beforeHand.has(x.uid)),
    boardDepartures: b.board.filter((x) => !afterBoard.has(x.uid)),
    gold: after.embers - before.embers,
  };
}

export interface ConservationOptions {
  /** Assert the UNDER-CLAIM half (every change has a claiming beat). Off for action types whose dispatch
   *  sites open no scope yet — those are pinned in the test, not silently excused here. */
  underClaims: boolean;
}

/**
 * Every way the batch disagrees with what the action actually did. Empty = conserved. Messages name the
 * uid, its cardId, the claimed and the actual numbers, so a failure reads like the bug report it prevents.
 */
export function beatConservationViolations(
  before: RunState,
  after: RunState,
  action: Action,
  events: readonly GamePresentationEvent[],
  opts: ConservationOptions = { underClaims: true },
): string[] {
  const out: string[] = [];
  // No batch at all: nothing to over-claim; whether the SILENCE is legal is the under-claim half's call.
  if (events.length === 0 && !opts.underClaims) return out;
  const claims = claimsOf(events);
  const actual = actualDiffOf(before, after);
  const exists = (uid: string): boolean =>
    [...before.board, ...before.hand, ...after.board, ...after.hand].some((c) => c.uid === uid);
  const name = (uid: string): string => {
    const c = [...after.board, ...after.hand, ...before.board, ...before.hand].find((x) => x.uid === uid);
    return c ? `${c.cardId} (${uid})` : uid;
  };

  for (const o of claims.orphans) out.push(`orphan consequence ${o} — emitted outside any trigger scope, so no beat is its source`);

  // ── Stats: per uid, claimed === actual (both directions) ──
  for (const [uid, claim] of claims.stats) {
    if (!exists(uid)) { out.push(`statsChanged claims +${claim.a}/+${claim.h} on uid ${uid}, which exists in neither state — a phantom body`); continue; }
    const real = actual.stats.get(uid);
    if (!real) continue; // buffed then removed (or arrived then buffed) within the action — no delta to bound against
    if (claim.a === real.a && claim.h === real.h) continue;
    const over = (x: number, y: number): boolean => Math.abs(x) > Math.abs(y) || Math.sign(x) * Math.sign(y) < 0;
    const isOver = over(claim.a, real.a) || over(claim.h, real.h);
    // A claim SMALLER than the change is the missing-beat half (a scoped effect plus an unscoped one on the
    // same body) — reported only where under-claims are gated; an over-claim is always a defect.
    if (!isOver && !opts.underClaims) continue;
    out.push(`${name(uid)}: beats claim ${fmt(claim.a, claim.h)} but the action changed it by ${fmt(real.a, real.h)} — ${isOver ? 'OVER-claimed (a doubled emission?)' : 'under-claimed (a change with no beat?)'}`);
  }
  if (opts.underClaims) {
    for (const [uid, real] of actual.stats) {
      if (real.a === 0 && real.h === 0) continue;
      if (claims.stats.has(uid)) continue; // an unequal claim was already reported above
      out.push(`${name(uid)}: changed by ${fmt(real.a, real.h)} with NO beat claiming it — a missing beat`);
    }
  }

  // ── Membership: grants / summons / destroys — each claimed at most once, each real ──
  const handArrived = new Set(actual.handArrivals.map((x) => x.uid));
  const boardArrived = new Set(actual.boardArrivals.map((x) => x.uid));
  const departed = new Set(actual.boardDepartures.map((x) => x.uid));
  // A uid in NEITHER state is TRANSIENT: it arrived and left inside the one action (an Echo summon that
  // completed a triple and merged into a fresh golden uid). Its arrival was real but is not provable from the
  // outside, so only the duplicate check applies to it; a uid in the BEFORE state that is claimed as an
  // arrival is a phantom claim either way.
  for (const [uid, { count: n }] of claims.granted) {
    if (n > 1) out.push(`cardGranted claimed ${n}× for ${name(uid)} — one arrival, ${n} previews (the Rope Wrangler class)`);
    if (!handArrived.has(uid) && !boardArrived.has(uid) && exists(uid)) out.push(`cardGranted for ${name(uid)}, which did not arrive this action`);
  }
  for (const [uid, { count: n }] of claims.summoned) {
    if (n > 1) out.push(`cardSummoned claimed ${n}× for ${name(uid)} — one arrival, ${n} ghosts`);
    if (!boardArrived.has(uid) && exists(uid)) out.push(`cardSummoned for ${name(uid)}, which is not a new board body this action`);
  }
  for (const [uid, d] of claims.destroyed) {
    if (d.count > 1 && !d.rise) out.push(`cardDestroyed claimed ${d.count}× for ${name(uid)} — one departure, ${d.count} deaths`);
    if (!departed.has(uid) && !d.rise && exists(uid)) out.push(`cardDestroyed for ${name(uid)}, which is still on the board (and not rising)`);
  }
  for (const [uid] of claims.transformed) {
    if (!after.board.some((c) => c.uid === uid) && exists(uid)) out.push(`cardTransformed for ${name(uid)}, which is not on the board afterwards`);
  }
  if (opts.underClaims) {
    const primary = primaryMoveUids(before, after, action, claims);
    for (const b of actual.handArrivals) {
      if (primary.has(b.uid) || claims.granted.has(b.uid)) continue;
      out.push(`${b.cardId} (${b.uid}) arrived in hand with no cardGranted beat`);
    }
    for (const b of actual.boardArrivals) {
      if (primary.has(b.uid) || claims.summoned.has(b.uid)) continue;
      out.push(`${b.cardId} (${b.uid}) arrived on the board with no cardSummoned beat`);
    }
    for (const b of actual.boardDepartures) {
      if (primary.has(b.uid) || claims.destroyed.has(b.uid)) continue;
      out.push(`${b.cardId} (${b.uid}) left the board with no cardDestroyed beat`);
    }
  }

  // ── Gold: a hero power's batch is a whole-action diff, so it must reconcile exactly ──
  if (action.type === 'heroPower' && (claims.gold ?? 0) !== actual.gold) {
    out.push(`hero power: beats claim ${claims.gold ?? 0} Gold but the action moved ${actual.gold}`);
  }
  return out;
}

const fmt = (a: number, h: number): string => `${a >= 0 ? '+' : ''}${a}/${h >= 0 ? '+' : ''}${h}`;

/**
 * The uids an action moves ITSELF — the player's own click, not an effect: the bought card landing in hand,
 * the played card landing on the board (a spell is consumed, not moved), the sold card leaving, the Discover
 * pick arriving, the Choose One / aimed card the modal was holding. Plus, on EVERY action, a triple merge:
 * the gilded copy is a fresh uid and its plain copies vanish — engine mechanics with no beat of their own
 * today (the merge animates from `state.recentTriples` on the legacy path). These are not under-claims.
 */
function primaryMoveUids(before: RunState, after: RunState, action: Action, claims: BeatClaims): Set<string> {
  const set = new Set<string>();
  const inBefore = (uid: string): boolean => before.board.some((x) => x.uid === uid) || before.hand.some((x) => x.uid === uid);
  // A triple: a NEW golden uid whose cardId had ≥2 plain copies — held before, or claimed as arrivals within
  // this action (an Echo summoning the third copy) — → it and every plain copy of that id.
  const copies = new Map<string, number>();
  for (const c of [...before.board, ...before.hand]) if (!c.golden) copies.set(c.cardId, (copies.get(c.cardId) ?? 0) + 1);
  for (const m of [claims.granted, claims.summoned]) for (const { cardId } of m.values()) copies.set(cardId, (copies.get(cardId) ?? 0) + 1);
  for (const c of [...after.board, ...after.hand]) {
    if (c.golden && !inBefore(c.uid) && (copies.get(c.cardId) ?? 0) >= 2) {
      set.add(c.uid);
      for (const x of [...before.board, ...before.hand]) if (x.cardId === c.cardId && !x.golden) set.add(x.uid);
    }
  }
  switch (action.type) {
    case 'buy': {
      // The bought offer is re-minted as a hand instance with a FRESH uid — match the arrival by cardId.
      const offer = before.shop.find((o) => o.uid === action.uid) ?? (before.spell?.uid === action.uid ? before.spell : undefined);
      for (const c of after.hand) if (!inBefore(c.uid) && (!offer || c.cardId === offer.cardId)) { set.add(c.uid); break; }
      break;
    }
    case 'play': case 'sell': set.add(action.uid); break;
    case 'discover':
      for (const c of [...after.hand, ...after.board]) if (!inBefore(c.uid)) set.add(c.uid);
      break;
    case 'chooseOne': if (before.chooseOne) set.add(before.chooseOne.uid); break;
    case 'battlecryTarget': if (before.pendingTarget) set.add(before.pendingTarget.uid); break;
    default: break;
  }
  return set;
}

// ── Combat: the `factory:` stamp is the log's attribution channel ─────────────────────────────────────────

/**
 * COMBAT ATTRIBUTION. Every event a combat effect emits is stamped `key: 'factory:<do>:<on>'` + `srcCard`
 * (simulate.ts `withEffect`) — that stamp is how presentation binds authored FX to the effect that fired and
 * how the coverage corpus counts fires. The event-log RECONSTRUCTION law (conservationLaws.test.ts) already
 * proves the log's life/death facts; this proves the stamps are honest:
 *   · `key` and `srcCard` travel together (a half-stamp binds FX to nothing / to nobody);
 *   · `key` is well-formed;
 *   · `srcCard` names a card whose definition actually carries a `<do>` effect on `<on>` — a stamp on the
 *     wrong body is the combat twin of a consequence attributed to the wrong card. A copy-family factory
 *     (`/copy/i`, the coverage corpus's `copy:` family) fires an effect it borrowed, so the running card's
 *     def legitimately lacks it — the one sanctioned mismatch, and it must name a copier to be excused.
 */
export function combatStampViolations(
  events: readonly unknown[],
  defOf: (cardId: string) => { effects: readonly { do: string; on: string }[] } | undefined,
): string[] {
  const out: string[] = [];
  events.forEach((raw, i) => {
    const e = raw as { type: string; key?: string; srcCard?: string };
    if (e.key === undefined && e.srcCard === undefined) return;
    if (e.key === undefined || e.srcCard === undefined) { out.push(`event #${i} (${e.type}) is half-stamped: key=${e.key ?? '∅'} srcCard=${e.srcCard ?? '∅'}`); return; }
    const m = /^factory:([^:]+):([^:]+)$/.exec(e.key);
    if (!m) { out.push(`event #${i} (${e.type}) carries a malformed stamp "${e.key}"`); return; }
    const def = defOf(e.srcCard);
    if (!def) { out.push(`event #${i} (${e.type}) is stamped by unknown card "${e.srcCard}"`); return; }
    const carries = def.effects.some((x) => x.do === m[1] && x.on === m[2]);
    const copier = def.effects.some((x) => /copy/i.test(x.do));
    if (!carries && !copier) out.push(`event #${i} (${e.type}) is stamped ${e.key} by ${e.srcCard}, whose definition carries no such effect — attributed to the wrong body`);
  });
  return out;
}
