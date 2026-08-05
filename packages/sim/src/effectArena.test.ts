import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { ARENA_EFFECTS, combatSide, makeRng, simulate, type ArenaBody, type BoardMinion, type EffectArena } from '@game/core';
import { fireRecruitDeathrattlesForTest } from './recruit';
import type { BoardCard, RunState } from './state';

/**
 * EFFECT ARENA — Step 1 spike, committed proof (docs/effect-arena-spec.md).
 *
 * `deathrattleGrantWardRandom` (Lastlight) is the first effect written ONCE and dispatched into both phases
 * through adapters. The spike's load-bearing claim: the migration moved NO random draw. Proven before commit
 * with a 40-seed hash probe over both phases — event logs and cursors byte-identical pre/post migration —
 * plus the full suite passing with zero golden updates. These tests pin the properties that keep that true.
 */

const bm = (cardId: string, attack: number, health: number, over: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, ...over } as BoardMinion);

/** A minimal fake arena that records which uids were granted, over a shared seeded stream. */
const fakeArena = (uids: string[], seed: number, golden = false): { arena: EffectArena; granted: string[] } => {
  const bodies = uids.map((uid) => ({ uid, cardId: 'x', attack: 1, health: 1, keywords: [] as string[] }));
  const shielded = new Set<string>();
  const granted: string[] = [];
  const rng = makeRng(seed);
  const arena: EffectArena = {
    phase: 'combat',
    self: { uid: 'SELF', cardId: 'n2_lastlight', attack: 3, health: 2, keywords: [], golden },
    friends: () => [...bodies],
    hasShield: (t: ArenaBody) => shielded.has(t.uid),
    grantShield: (t: ArenaBody) => { shielded.add(t.uid); granted.push(t.uid); },
    buff: () => {},
    grantRubyPower: () => {},
    rubyTallyOf: () => ({ attack: 0, health: 0 }),
    summonToken: () => undefined,
    playRubiesOn: () => {},
    hasReborn: () => false,
    grantReborn: () => {},
    isTribe: () => true,
    gainRubyStats: () => {},
    neighboursOf: () => [],
    grantMaxGold: () => {},
    isCelestial: () => false,
    isImp: () => false,
    grantImpAura: () => {},
    rng: () => rng,
  };
  return { arena, granted };
};

describe('the shared body is phase-blind', () => {
  it('the same stream produces the same picks, whatever the adapter', () => {
    const a = fakeArena(['m1', 'm2', 'm3', 'm4'], 7);
    const b = fakeArena(['m1', 'm2', 'm3', 'm4'], 7);
    ARENA_EFFECTS.deathrattleGrantWardRandom(a.arena, { count: 2 });
    ARENA_EFFECTS.deathrattleGrantWardRandom(b.arena, { count: 2 });
    expect(a.granted).toEqual(b.granted);
    expect(a.granted).toHaveLength(2);
    expect(new Set(a.granted).size, 'targets must be distinct').toBe(2);
  });

  it('golden doubles the count, and the pool bounds it', () => {
    const g = fakeArena(['m1', 'm2', 'm3'], 7, true);
    ARENA_EFFECTS.deathrattleGrantWardRandom(g.arena, { count: 2 });
    expect(g.granted, 'golden wants 4 but only 3 exist').toHaveLength(3);
  });
});

describe('the combat adapter', () => {
  it('a dying Lastlight grants Ward mid-fight through the arena (shieldUp events in the log)', () => {
    const r = simulate(
      [bm('n2_lastlight', 3, 1), bm('sandbag', 2, 9), bm('pack', 2, 9)],
      [bm('sandbag', 9, 9)], makeRng(5), CARD_INDEX, combatSide({ tier: 3 }), combatSide({ tier: 3 }));
    expect(r.events.filter((e) => e.type === 'shieldUp').length).toBeGreaterThanOrEqual(2);
  });
});

describe('the shop adapter', () => {
  const mk = (uid: string, cardId: string, kw: string[] = []): BoardCard =>
    ({ uid, cardId, tribe: 'neutral', attack: 3, health: 3, keywords: kw, golden: false } as BoardCard);
  const state = (): RunState => ({
    board: [mk('a', 'n2_lastlight'), mk('b', 'sandbag'), mk('c', 'pack', ['DS']), mk('d', 'd2_curator')],
    hand: [], shop: [], rngCursor: 123, recruitBuffFx: [], playedThisTurn: [], tribes: [],
  } as unknown as RunState);

  it('a shop-fired Echo grants Ward to unshielded friends and ADVANCES the cursor', () => {
    const s = state();
    fireRecruitDeathrattlesForTest(s, s.board[0]!);
    const ds = s.board.filter((c) => c.uid !== 'a' && c.keywords.includes('DS'));
    expect(ds.length, 'the already-shielded c plus 2 fresh grants').toBe(3);
    // The cursor MUST move: a shop draw that doesn't advance it would replay differently on restore —
    // the exact class of bug the spike's per-call write-back contract exists to prevent.
    expect(s.rngCursor).not.toBe(123);
  });

  it('is deterministic from the cursor — same cursor, same victims', () => {
    const runs = [state(), state()].map((s) => {
      fireRecruitDeathrattlesForTest(s, s.board[0]!);
      return s.board.map((c) => c.keywords.join(',')).join('|') + '@' + s.rngCursor;
    });
    expect(runs[0]).toBe(runs[1]);
  });
});

/**
 * THE RATCHET (Step 2) — migration may only move FORWARD.
 *
 * No phase registry, no allowlist (owner call 2026-08-04): the arena's own reachability is the invariant.
 * Every shared body must be dispatchable from BOTH phases, and the migrated count may never fall. Raise the
 * floor as effects migrate; lowering it is the one edit this test exists to make loud.
 */
describe('the arena ratchet', () => {
  const MIGRATED_FLOOR = 14; // +deathrattleBuffImps, onBattlecryBuffSelf

  it('the migrated count may only rise', () => {
    expect(Object.keys(ARENA_EFFECTS).length).toBeGreaterThanOrEqual(MIGRATED_FLOOR);
  });

  it('every arena body is reachable from BOTH phases', async () => {
    const { FACTORIES } = await import('@game/core');
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const recruitSrc = readFileSync(fileURLToPath(new URL('./recruit.ts', import.meta.url)), 'utf8');
    expect(recruitSrc.length, 'recruit.ts moved — the sweep is reading nothing').toBeGreaterThan(1000);
    for (const id of Object.keys(ARENA_EFFECTS)) {
      expect((FACTORIES as Record<string, unknown>)[id], `${id} has no combat wrapper`).toBeTruthy();
      expect(recruitSrc.includes(`
  ${id}: (`), `${id} has no shop wrapper`).toBe(true);
    }
  });
});
