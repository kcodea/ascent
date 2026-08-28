import { describe, it, expect } from 'vitest';
import { createRun, reduce, prepareActionWithPresentation, type RunState } from './index';

/**
 * BEAT CHOREOGRAPHER PR 3 — prepared-transaction equivalence (blueprint §22.3).
 *
 * The gate for this PR, and the question the old projection approach could never answer: does resolving an
 * action ONCE and holding the result give exactly what dispatching it directly gives?
 *
 * If `after` ever diverges from `reduce(before, action)` — by a Gold, an RNG cursor, a served opponent — then
 * the animation would be showing a run that isn't the one the player continues into. Everything downstream
 * (the live player, the projection, the cutover) rests on this being byte-identical.
 */
const faceOmen = { type: 'faceOmen' } as never;

function eotRun(seed = 3): RunState {
  const run = createRun(seed, 'warden');
  return {
    ...run,
    phase: 'recruit',
    board: [{ uid: 'b1', cardId: 'stray', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false }],
    runeCoffers: true,
    runeShopkeep: true,
    runeLapidary: true,
    upgradeCost: 9,
  } as RunState;
}

describe('prepared faceOmen === dispatched faceOmen', () => {
  it('`after` is byte-identical to a direct reduce', () => {
    const before = eotRun();
    const prepared = prepareActionWithPresentation(before, faceOmen);
    expect(JSON.stringify(prepared.after)).toBe(JSON.stringify(reduce(before, faceOmen)));
  });

  it('the RNG cursor advances identically — randomness is consumed once, the same way', () => {
    const before = eotRun();
    const prepared = prepareActionWithPresentation(before, faceOmen);
    const direct = reduce(before, faceOmen) as RunState & { rngCursor?: number };
    expect((prepared.after as typeof direct).rngCursor).toBe(direct.rngCursor);
  });

  it('the combat is generated once and matches', () => {
    const before = eotRun();
    const prepared = prepareActionWithPresentation(before, faceOmen);
    const direct = reduce(before, faceOmen);
    expect(JSON.stringify(prepared.after.lastCombat)).toBe(JSON.stringify(direct.lastCombat));
  });

  it('the served opponent board matches — pinning is unaffected', () => {
    const before = eotRun();
    const prepared = prepareActionWithPresentation(before, faceOmen);
    const direct = reduce(before, faceOmen);
    expect(JSON.stringify(prepared.after.servedBoards)).toBe(JSON.stringify(direct.servedBoards));
  });

  it('`before` keeps its GAMEPLAY state — the recruit scene stays renderable while playback runs', () => {
    // `reduce` deliberately resets per-action FX scratch on the INPUT before its clone (documented at the top
    // of `reduce`), so those fields are expected to move. Everything the recruit screen actually reads —
    // board, hand, shop, Gold, phase, runes, quests — must be exactly as it was, or preparing would snap the
    // scene to its post-End-of-Turn values before a single beat has played (blueprint §25's first trap).
    // `shopDeathFx` joined the list on 2026-08-28 (the shop death / Echo cues).
    const SCRATCH = new Set(['recruitBuffFx', 'auraFx', 'veinstormStamped', 'weldFxBaseSeq', 'shopDeathFx']);
    const before = eotRun();
    const snapshot = JSON.parse(JSON.stringify(before)) as Record<string, unknown>;
    const prepared = prepareActionWithPresentation(before, faceOmen);
    const now = JSON.parse(JSON.stringify(before)) as Record<string, unknown>;
    for (const key of new Set([...Object.keys(snapshot), ...Object.keys(now)])) {
      if (SCRATCH.has(key)) continue;
      expect(JSON.stringify(now[key]), `before.${key} changed while preparing`).toBe(JSON.stringify(snapshot[key]));
    }
    expect(prepared.before).toBe(before);
  });

  it('specifically: board, shop, hand and Gold do not move when an action is prepared', () => {
    const before = eotRun();
    const board = JSON.stringify(before.board);
    const shop = JSON.stringify(before.shop);
    const hand = JSON.stringify(before.hand);
    const { embers, maxEmbers, upgradeCost, phase } = before;
    prepareActionWithPresentation(before, faceOmen);
    expect(JSON.stringify(before.board)).toBe(board);
    expect(JSON.stringify(before.shop)).toBe(shop);
    expect(JSON.stringify(before.hand)).toBe(hand);
    expect([before.embers, before.maxEmbers, before.upgradeCost, before.phase]).toEqual([embers, maxEmbers, upgradeCost, phase]);
  });

  it('preparing does not resolve twice — two prepares of the same state agree', () => {
    const before = eotRun();
    const a = prepareActionWithPresentation(before, faceOmen);
    const b = prepareActionWithPresentation(before, faceOmen);
    expect(JSON.stringify(a.after)).toBe(JSON.stringify(b.after));
    expect(a.id).toBe(b.id); // deterministic identity, never time/uuid
  });

  it('carries the emitted batch for the timeline to compile', () => {
    const prepared = prepareActionWithPresentation(eotRun(), faceOmen);
    expect(prepared.batch?.phase).toBe('endOfTurn');
    expect(prepared.batch!.events.length).toBeGreaterThan(0);
  });

  it('holds across several seeds', () => {
    for (const seed of [1, 7, 4242, 90210]) {
      const before = eotRun(seed);
      expect(JSON.stringify(prepareActionWithPresentation(before, faceOmen).after), `seed ${seed}`)
        .toBe(JSON.stringify(reduce(before, faceOmen)));
    }
  });
});
