import { describe, it, expect } from 'vitest';
import { createRun, reduceWithPresentation, projectEndOfTurnSteps, type RunState } from './index';
import { applyEndOfTurn } from './recruit';
import type { StatsChangedConsequence } from '@game/core';

/**
 * BEAT SYSTEM PR 6 — the End-of-Turn equivalence harness. Before the live shop animation can EVER be cut over
 * to the event stream (a later PR, gated on full consequence coverage), the events must faithfully represent
 * what really happens. This asserts the batch's per-uid stat deltas equal the GROUND TRUTH — the board deltas
 * a real `applyEndOfTurn` produces — so there are no phantom or missing stat events. It also confirms the
 * legacy projector (`projectEndOfTurnSteps`) still runs unchanged (the live path is untouched by PR 5/6).
 */
type Delta = Map<string, { a: number; h: number }>;

/** Ground truth: run applyEndOfTurn on a clone (no collector active → NOOP) and diff the board by uid. */
function realDeltas(state: RunState): Delta {
  const clone = JSON.parse(JSON.stringify(state)) as RunState;
  const before = new Map(clone.board.map((c) => [c.uid, { a: c.attack, h: c.health }]));
  applyEndOfTurn(clone);
  const d: Delta = new Map();
  for (const c of clone.board) {
    const b = before.get(c.uid);
    if (!b) continue;
    const da = c.attack - b.a;
    const dh = c.health - b.h;
    if (da !== 0 || dh !== 0) d.set(c.uid, { a: da, h: dh });
  }
  return d;
}

/** The batch's per-uid net stat delta from statsChanged consequences. */
function batchDeltas(state: RunState): Delta {
  const { batch } = reduceWithPresentation(state, { type: 'faceOmen' } as never, true);
  const d: Delta = new Map();
  for (const e of batch?.events ?? []) {
    if (e.type !== 'statsChanged') continue;
    const c = e as StatsChangedConsequence;
    const uid = c.target.uid;
    if (!uid) continue;
    const p = d.get(uid) ?? { a: 0, h: 0 };
    p.a += c.attack; p.h += c.health;
    d.set(uid, p);
  }
  return d;
}

function eot(over: Partial<RunState> = {}): RunState {
  return {
    ...createRun(3, 'warden'),
    phase: 'recruit',
    board: [{ uid: 'b1', cardId: 'stray', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false }],
    ...over,
  } as RunState;
}

describe('End-of-Turn event ↔ gameplay equivalence', () => {
  const cases: Array<[string, RunState]> = [
    ['Lapidary (rubies on board)', eot({ runeLapidary: true, playedThisTurn: ['a', 'b', 'c'] })],
    ['no armed EoT effects', eot()],
    ['Lapidary + a second board minion', eot({
      runeLapidary: true, playedThisTurn: ['a', 'b'],
      board: [
        { uid: 'b1', cardId: 'stray', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false },
        { uid: 'b2', cardId: 'stray', tribe: 'beast', attack: 4, health: 4, keywords: [], golden: false },
      ],
    })],
  ];

  for (const [name, state] of cases) {
    it(`the batch's stat deltas equal the real board deltas — ${name}`, () => {
      const real = realDeltas(state);
      const evts = batchDeltas(state);
      // Every real stat delta is represented in the batch…
      for (const [uid, d] of real) expect(evts.get(uid), `missing event for ${uid}`).toEqual(d);
      // …and the batch invents no phantom stat change on a uid that didn't really change.
      for (const uid of evts.keys()) expect(real.has(uid), `phantom event for ${uid}`).toBe(true);
    });
  }

  it('the legacy projector still runs unchanged (live EoT path untouched)', () => {
    const s = eot({ runeLapidary: true, playedThisTurn: ['a', 'b'] });
    const projected = projectEndOfTurnSteps(s);
    expect(projected.steps.length, 'projector still produces beats').toBeGreaterThan(0);
    // The projector's Ruby FX still carries the same count as the cards played (PR 5 didn't disturb it).
    const rubies = projected.fx.flatMap((f) => f.ruby ?? []).reduce((n, r) => n + r.count, 0);
    expect(rubies).toBe(2);
  });
});
