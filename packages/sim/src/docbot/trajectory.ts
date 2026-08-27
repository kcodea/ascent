/**
 * DOC BOT — DETERMINISTIC TRAJECTORY DRIVER (handoff §9.2/§9.3 shared machinery, PR 8).
 *
 * One driver serves three callers with ONE behaviour:
 *   · the coverage-guided corpus builder (fuzz mode — seeded generation, coverage collection);
 *   · the nightly lifecycle lane (fuzz mode — long runs to elimination, checkpoints, budgets);
 *   · the seed minimizer (replay mode — a fixed action list re-executed while shrinking).
 *
 * Everything routes through the REAL `reduceWithPresentation` (one engine, §3.1; capture is proven
 * gameplay-inert by the presentation-parity fuzz lane). Determinism is hermetic:
 *   · the action generator is the invariant-fuzz driver seeded through `makeRng` — same policy weights, so
 *     the nightly explores the same reachable space the PR-gate fuzz samples;
 *   · before EVERY dispatch the current wave's opponent is PINNED to `null` (the procedural threat) when
 *     nothing served it yet — exactly `runQaScenario`'s hermetic pin, so the session-global opponent pool
 *     can never leak into a trajectory, and a retained corpus fixture replays to the same fight.
 *
 * The driver ALSO owns the §8.4/§9.2 safety checks so replay-mode minimization reproduces exactly what
 * fuzz-mode flagged (same code path, same check ids):
 *   · `invariant:` — the structural invariants (Gold ≥ 0, board cap, finite stats, uid uniqueness);
 *   · `explosion:` — the ExplosionGuard budgets + repeated-material-signature cycle detector;
 *   · `roundtrip:` — every `roundtripEvery` steps, serialize→deserialize and DIFF (normalized); the
 *     restored state is then ADOPTED, so later steps also prove the restored run continues identically
 *     (any divergence surfaces in the `replay-reconstruction` comparison the nightly runs on top);
 *   · `combat-budget:` — a combat whose event log exceeds the fail budget (warn below it).
 */
import { makeRng } from '@game/core';
import type { SetId } from '@game/content';
import { CONFIG } from '../config';
import { createRun, deserialize, serialize, type Action, type RunState } from '../state';
import { reduceWithPresentation } from '../reducer';
import { normalizeRunState } from '../qaScenario';
import { coverageKeysFor } from './coverageKeys';
import { DEFAULT_BUDGETS, ExplosionGuard, type GuardBudgets } from './explosionGuard';

/** One random-but-legal-ish action for the current state — the invariant-fuzz policy (modals first, then
 *  weighted real play), EXTENDED with tavern-spell buys (the fuzz lane never casts `s.spell`, which left the
 *  whole spell-cast surface out of the sweep). The weights are the exploration policy, so changing them
 *  re-shapes every corpus/nightly sweep — treat as tuned constants. */
export function nextFuzzAction(s: RunState, rng: { int(n: number): number }): Action {
  if (s.discover) return { type: 'discover', index: rng.int(Math.max(1, s.discover.length)) };
  if (s.chooseOne) return { type: 'chooseOne', index: rng.int(2) };
  if (s.pendingTarget) {
    const t = s.board[rng.int(Math.max(1, s.board.length))] ?? s.board[0];
    return t ? { type: 'battlecryTarget', targetUid: t.uid } : { type: 'faceOmen' };
  }
  if (s.questOffer) return { type: 'buyQuest', index: rng.int(Math.max(1, s.questOffer.length)) };
  if (s.powerOffer) return { type: 'pickPower', index: rng.int(Math.max(1, s.powerOffer.heroIds.length)) };
  if (s.runeforgeOffer) return rng.int(3) === 0 ? { type: 'skipRuneforge' } : { type: 'buyRune', index: rng.int(Math.max(1, s.runeforgeOffer.length)) };
  if (s.scoutedNextOpponent?.length) return { type: 'closeScout' };
  if (s.phase === 'combat') return { type: 'resolveCombat' };
  if (s.lastCombat && !s.combatSettled && s.phase !== 'recruit') return { type: 'settleCombat' };

  const roll = rng.int(100);
  if (roll < 24 && (s.shop.length > 0 || s.spell)) {
    const pool = [...s.shop, ...(s.spell ? [s.spell] : [])];
    return { type: 'buy', uid: pool[rng.int(pool.length)]!.uid };
  }
  if (roll < 44 && s.hand.length > 0) {
    const c = s.hand[rng.int(s.hand.length)]!;
    const target = s.board[rng.int(Math.max(1, s.board.length))];
    return { type: 'play', uid: c.uid, ...(target ? { targetUid: target.uid } : {}) };
  }
  if (roll < 54 && s.board.length > 0) return { type: 'sell', uid: s.board[rng.int(s.board.length)]!.uid };
  if (roll < 64) return { type: 'roll' };
  if (roll < 70) return { type: 'upgrade' };
  if (roll < 76) {
    const t = s.board[rng.int(Math.max(1, s.board.length))];
    return { type: 'heroPower', ...(t ? { uid: t.uid } : {}) };
  }
  if (roll < 82 && s.board.length > 1) return { type: 'reposition', uid: s.board[rng.int(s.board.length)]!.uid, toIndex: rng.int(s.board.length) };
  if (roll < 86) return { type: 'freeze' };
  return { type: 'faceOmen' };
}

/** The structural invariants that must hold in EVERY reachable state — the fuzz lane's set, as data. */
export function invariantViolations(s: RunState): string[] {
  const out: string[] = [];
  if (s.embers < 0) out.push(`Gold is negative (${s.embers})`);
  if (s.board.length > CONFIG.boardMax) out.push(`board over cap (${s.board.length} > ${CONFIG.boardMax})`);
  const uids = [...s.board, ...s.hand, ...s.shop].map((c) => c.uid);
  if (new Set(uids).size !== uids.length) out.push(`duplicate uid across zones (${uids.join(',')})`);
  for (const c of [...s.board, ...s.hand]) {
    if (!Number.isFinite(c.attack) || !Number.isFinite(c.health)) out.push(`${c.cardId} (${c.uid}) has non-finite stats ${c.attack}/${c.health}`);
  }
  return out;
}

/** `runQaScenario`'s hermetic opponent pin, applied per wave: an unserved wave gets the procedural threat. */
export function pinCurrentWave(s: RunState): void {
  if (!(s.wave in (s.servedBoards ?? {}))) s.servedBoards = { ...(s.servedBoards ?? {}), [s.wave]: null };
}

export interface CombatBudget {
  /** Combat event-log length: warn above `warn`, fail above `fail` (an order of magnitude of headroom over
   *  today's loudest legitimate fights — a monitoring rail, not a balance verdict). */
  warn: number;
  fail: number;
}
export const DEFAULT_COMBAT_BUDGET: CombatBudget = { warn: 3000, fail: 20000 };

export interface DriveViolation {
  step: number;
  /** 'invariant' | 'explosion' | 'roundtrip' | 'combat-budget' — the check family (stable, minimizer-keyed). */
  checkId: string;
  detail: string;
}

export interface DriveOptions {
  /** The run seed (`createRun`'s seed — also the value a QaScenario envelope carries). */
  seed: number;
  heroId?: string;
  setId?: string;
  /** REPLAY mode: execute exactly these actions. Mutually exclusive with `generate`. */
  actions?: readonly Action[];
  /** FUZZ mode: generate up to `steps` actions from the seeded policy. */
  generate?: { steps: number; rngSeed: number };
  /** Serialize→deserialize→diff→adopt every N executed steps (0/undefined = never). */
  roundtripEvery?: number;
  /** Collect semantic coverage keys per step (costs the derivation; corpus/nightly want it, replay doesn't). */
  collectCoverage?: boolean;
  combatBudget?: CombatBudget;
  guardBudgets?: GuardBudgets;
  /** Observe each executed step (the corpus builder retains scenarios from here). `serializedBefore` is the
   *  pinned pre-action state, captured BEFORE dispatch (the reducer may write through shared nested objects,
   *  so a post-hoc serialize of the before-reference is not safe). */
  onStep?: (info: {
    step: number;
    action: Action;
    serializedBefore: string;
    accepted: boolean;
    newKeysPossible: string[];
  }) => void;
}

export interface DriveOutcome {
  final: RunState;
  /** Steps EXECUTED (replay mode: the action list length; fuzz mode: until steps/gameover). */
  steps: number;
  /** The full dispatched action trace — the minimizer's raw material. */
  actions: Action[];
  violations: DriveViolation[];
  warnings: string[];
  /** Union of semantic coverage keys reached (sorted), when `collectCoverage` was set. */
  coverageKeys?: string[];
  maxCombatEvents: number;
  endedBy: 'gameover' | 'exhausted';
}

/** Drive one deterministic trajectory through the real reducer, running every safety check per step. */
export function driveTrajectory(opts: DriveOptions): DriveOutcome {
  if (!!opts.actions === !!opts.generate) throw new Error('driveTrajectory needs exactly one of actions (replay) or generate (fuzz)');
  const budget = opts.combatBudget ?? DEFAULT_COMBAT_BUDGET;
  const rng = opts.generate ? makeRng(opts.generate.rngSeed) : undefined;
  const total = opts.generate ? opts.generate.steps : opts.actions!.length;

  let s = createRun(opts.seed, opts.heroId || undefined, 'ascent', CONFIG.defaultLine, (opts.setId || undefined) as SetId | undefined);
  const actions: Action[] = [];
  const violations: DriveViolation[] = [];
  const warnings: string[] = [];
  const coverage = opts.collectCoverage ? new Set<string>() : undefined;
  let maxCombatEvents = 0;
  let endedBy: DriveOutcome['endedBy'] = 'exhausted';
  let step = 0;

  for (; step < total; step++) {
    pinCurrentWave(s);
    const a: Action = opts.generate ? nextFuzzAction(s, rng!) : opts.actions![step]!;
    const serializedBefore = opts.onStep ? serialize(s) : '';
    const before = s;
    const { state: after, batch } = reduceWithPresentation(s, a, true);
    actions.push(a);

    // Safety checks — same families, same ids, fuzz and replay alike.
    for (const v of invariantViolations(after)) violations.push({ step, checkId: 'invariant', detail: `after ${a.type}: ${v}` });
    // A FRESH guard per step: the per-action budgets are exactly the guard's contract, but its repeated-
    // material-signature lane is scoped to ONE action loop — across free-play steps a repeat is legal
    // (freeze→unfreeze, reposition-and-back), so feeding a whole trajectory into one guard would flag
    // ordinary play as a cycle.
    const guard = new ExplosionGuard(opts.guardBudgets ?? DEFAULT_BUDGETS);
    guard.step(before, after, `step ${step} ${a.type}`);
    for (const f of guard.report().failures) violations.push({ step, checkId: 'explosion', detail: f });
    warnings.push(...guard.report().warnings);
    const newCombat = after.lastCombat && after.lastCombat !== before.lastCombat ? after.lastCombat : undefined;
    if (newCombat) {
      maxCombatEvents = Math.max(maxCombatEvents, newCombat.events.length);
      if (newCombat.events.length > budget.fail) violations.push({ step, checkId: 'combat-budget', detail: `combat emitted ${newCombat.events.length} events (budget ${budget.fail})` });
      else if (newCombat.events.length > budget.warn) warnings.push(`step ${step}: combat emitted ${newCombat.events.length} events`);
    }

    if (coverage || opts.onStep) {
      const keys = coverageKeysFor({
        before, after, action: a,
        events: batch?.events ?? [],
        ...(newCombat ? { combatLog: newCombat.events } : {}),
      });
      const fresh: string[] = [];
      if (coverage) for (const k of keys) { if (!coverage.has(k)) { coverage.add(k); fresh.push(k); } }
      opts.onStep?.({ step, action: a, serializedBefore, accepted: after !== before, newKeysPossible: fresh });
    }

    s = after;

    // Checkpoint: round-trip, diff, adopt.
    const every = opts.roundtripEvery ?? 0;
    if (every > 0 && (step + 1) % every === 0) {
      const restored = deserialize(serialize(s));
      if (normalizeRunState(restored) !== normalizeRunState(s)) {
        violations.push({ step, checkId: 'roundtrip', detail: `serialize→deserialize changed the state at step ${step} (normalized diff)` });
      }
      s = restored; // adopted: from here on the trajectory ALSO proves the restored run continues identically
    }

    if (s.phase === 'gameover') { endedBy = 'gameover'; step++; break; }
  }

  return {
    final: s,
    steps: actions.length,
    actions,
    violations,
    warnings,
    ...(coverage ? { coverageKeys: [...coverage].sort() } : {}),
    maxCombatEvents,
    endedBy,
  };
}
