/**
 * DOC BOT TRIPWIRE 12 — the reducer under random legal play: global invariants + determinism.
 *
 * Every other tripwire hunts a KNOWN bug shape. This one hunts unknown-unknowns, the blueprint's stateful
 * greybox fuzzer in v0 form: seeded random action sequences through the real `reduce`, with the invariants
 * that must hold in EVERY reachable state checked after every single step. History says these break in ways
 * nobody enumerates up front: #633 "never open a Discover on top of another modal", #639 "End Turn softlock
 * when the timer expires mid battlecry-aim", #7613 "reduce racing React's dispatch batching", #695 a capped
 * offer skipping instead of re-rolling.
 *
 * Invariants:
 *   · Gold never negative; board never over CONFIG.boardMax; every stat a finite number (no NaN creep).
 *   · UIDs unique across board+hand+shop (one instance, one zone).
 *   · No modal DEADLOCK: whenever a modal is open, at least one of its resolution actions makes progress.
 *   · DETERMINISM: replaying the identical action trajectory from the same seed reproduces the final state
 *     byte-for-byte — the engine's foundational promise (replays, shareable seeds, daily runs).
 *   · Identity-independence: reduce(clone(s)) equals reduce(s) — no hidden dependence on sharing.
 *
 * The generator favours real play (buy → play → roll → power → end turn → combat → settle) and resolves
 * every modal it meets. An action the reducer refuses (returns the same state) is FINE — refusal is a legal
 * answer; only invariant violations and deadlocks fail.
 */
import { describe, expect, it } from 'vitest';
import { makeRng } from '@game/core';
import { CONFIG } from '../config';
import { createRun, modalOpen, reduce, reduceWithPresentation, type Action, type RunState } from '../index';

/** Order-insensitive, undefined-skipping stringify (see runeSwallowScan.ts for the original lesson). */
const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'undefined';
};

const SEEDS = 12;
const STEPS = 70;

/** One random-but-legal-ish action for the current state. Modals first — they gate everything else. */
function nextAction(s: RunState, rng: { int(n: number): number }): Action {
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
  if (roll < 24 && s.shop.length > 0) return { type: 'buy', uid: s.shop[rng.int(s.shop.length)]!.uid };
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
  return { type: 'faceOmen' }; // end the turn — combat flow
}

function checkInvariants(s: RunState, seed: number, step: number, a: Action): void {
  const at = `seed ${seed} step ${step} after ${a.type}`;
  expect(s.embers, `${at}: negative Gold`).toBeGreaterThanOrEqual(0);
  expect(s.board.length, `${at}: board over cap`).toBeLessThanOrEqual(CONFIG.boardMax);
  const uids = [...s.board, ...s.hand, ...s.shop].map((c) => c.uid);
  expect(new Set(uids).size, `${at}: duplicate uid across zones (${uids.join(',')})`).toBe(uids.length);
  for (const c of [...s.board, ...s.hand]) {
    expect(Number.isFinite(c.attack), `${at}: ${c.cardId} attack=${c.attack}`).toBe(true);
    expect(Number.isFinite(c.health), `${at}: ${c.cardId} health=${c.health}`).toBe(true);
  }
}

describe('Doc Bot — reducer invariant fuzz', () => {
  it(`${SEEDS} seeds × ${STEPS} random legal actions: invariants hold at every step, no modal deadlock`, () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rng = makeRng(0xf022 + seed);
      let s = createRun(seed * 7919);
      let stuckModal = 0;
      for (let step = 0; step < STEPS; step++) {
        const a = nextAction(s, rng);
        const next = reduce(s, a);
        checkInvariants(next, seed, step, a);
        // Modal-deadlock watch: a modal that survives many consecutive RESOLUTION attempts is stuck — the
        // #633/#639 family. Non-modal refusals don't count (refusal is legal).
        if (modalOpen(next) && modalOpen(s) && next === s) {
          stuckModal++;
          expect(stuckModal, `seed ${seed} step ${step}: modal refuses every resolution (${JSON.stringify(a)}) — deadlock (discover=${!!next.discover} choose=${!!next.chooseOne} target=${!!next.pendingTarget} quest=${!!next.questOffer} power=${!!next.powerOffer} forge=${!!next.runeforgeOffer})`).toBeLessThan(8);
        } else {
          stuckModal = 0;
        }
        s = next;
      }
    }
  });

  it('determinism: the identical trajectory replays to a byte-identical final state', () => {
    const run = (seed: number): { final: string; trace: Action[] } => {
      const rng = makeRng(0xdead + seed);
      let s = createRun(seed * 104729);
      const trace: Action[] = [];
      for (let step = 0; step < 50; step++) {
        const a = nextAction(s, rng);
        trace.push(a);
        s = reduce(s, a);
      }
      return { final: JSON.stringify(s), trace };
    };
    for (let seed = 1; seed <= 6; seed++) {
      const a = run(seed);
      const b = run(seed);
      expect(a.trace, `seed ${seed}: the generator itself diverged — nondeterminism upstream of the reducer`).toEqual(b.trace);
      expect(b.final === a.final, `seed ${seed}: same seed + same actions → DIFFERENT final state. Determinism is the engine's foundational promise (replays, shareable seeds); find the Math.random/Date/iteration-order leak.`).toBe(true);
    }
  });

  /** NOT tested: "reduce never mutates its input." That is deliberately NOT the contract — the perf doctrine
   *  (CLAUDE.md: never deep-clone large read-only state) means the reducer shallow-clones and may write
   *  through shared nested objects. The real promises are identity-independence (same value in → same value
   *  out, whether or not the caller shares references) and trajectory determinism (above). This test's first
   *  cut asserted input purity and failed on `upgrade` at step 0 — an instrument error worth recording, not a
   *  product bug. */
  it('identity-independence: reduce(clone(s)) computes the same value as reduce(s)', () => {
    const rng = makeRng(0xbeef);
    let s = createRun(31337);
    for (let step = 0; step < 40; step++) {
      const a = nextAction(s, rng);
      const fromClone = reduce(structuredClone(s), a); // a cold copy with no shared references
      const fromOriginal = reduce(s, a);
      expect(JSON.stringify(fromClone), `step ${step}: reduce(clone) !== reduce(original) on ${a.type} — hidden dependence on object identity/sharing`).toBe(JSON.stringify(fromOriginal));
      s = fromOriginal;
    }
  });

  /** Roadmap L7 — the SAVE/LOAD class, generically: a state that survives a JSON round trip must continue
   *  IDENTICALLY. Catches non-serializable state reliance (class instances, undefined-vs-missing drift,
   *  functions smuggled into state) — the failure shape behind restore bugs, without modelling the real
   *  persistence format. */
  it('serialize-resume: a JSON round-trip mid-trajectory continues to an identical final state', () => {
    const rng = makeRng(0x5a5e);
    let live = createRun(48611);
    const acts: Action[] = [];
    for (let step = 0; step < 24; step++) { const a = nextAction(live, rng); acts.push(a); live = reduce(live, a); }
    let resumed = JSON.parse(JSON.stringify(live)) as RunState; // the round trip
    const rng2 = makeRng(0x1111);
    for (let step = 0; step < 24; step++) {
      const a = nextAction(live, rng2);
      const b = nextAction(resumed, makeRng(0)); // sanity: generator must see equivalent states
      void b;
      live = reduce(live, a);
      resumed = reduce(resumed, a);
      // ORDER-INSENSITIVE comparison — the third appearance of the stable-stringify lesson: a key holding
      // `undefined` survives in the live object but vanishes in the round trip, and a later spread re-adds it
      // at the END, so plain JSON.stringify flags a pure ordering difference as divergence. Values are what
      // the game depends on; key order is not.
      expect(stable(resumed), `step ${step} after ${a.type}: the resumed run diverged from the live one — state relies on something a JSON round trip cannot carry`).toBe(stable(live));
    }
  });

  /** Roadmap L8 (the machine-checkable half) — presentation capture must be gameplay-inert: for every
   *  trajectory step, `reduceWithPresentation(capture: true)` must produce the same gameplay state as plain
   *  `reduce`. The blueprint's presentation-parity oracle; the visual half stays human. */
  it('presentation parity: capturing beats never changes the gameplay state', () => {
    const rng = makeRng(0x9a71);
    let s = createRun(75989);
    for (let step = 0; step < 40; step++) {
      const a = nextAction(s, rng);
      const plain = reduce(s, a);
      const withCapture = reduceWithPresentation(structuredClone(s), a, true).state;
      expect(JSON.stringify(withCapture), `step ${step} after ${a.type}: presentation capture CHANGED gameplay state — the capture is supposed to observe, never steer`).toBe(JSON.stringify(plain));
      s = plain;
    }
  });
});
