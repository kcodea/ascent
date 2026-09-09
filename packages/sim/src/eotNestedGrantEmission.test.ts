import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, reduceWithPresentation, type RunState } from './index';

/**
 * NESTED BEAT SCOPES EMIT EACH CONSEQUENCE ONCE (Bug Board bb5195d5 + af51e5a3, 2026-09-09: Rope Wrangler
 * "briefly displays 2x the amount of cards given to hand").
 *
 * Rope Wrangler's End of Turn casts Lasso; `castSpell` opens its own nested scope per cast; the outer
 * End-of-Turn scope's hand diff, taken before the casts, then emitted every stolen card a second time. The
 * projection dedupes by event id, so the hand row drew two previews per card until the commit wiped them.
 */
const faceOmen = { type: 'faceOmen' } as const;
const mk = (uid: string, id: string) => ({ uid, cardId: id, tribe: CARD_INDEX[id]!.tribe, attack: CARD_INDEX[id]!.attack, health: CARD_INDEX[id]!.health, keywords: [...CARD_INDEX[id]!.keywords], golden: false });
const ropeWrangler = (): RunState => ({
  ...createRun(11, 'warden'), phase: 'recruit', goldSpentThisTurn: 6, hand: [],
  board: [mk('b1', 'ropewrangler')],
  shop: [{ uid: 's1', cardId: 'stray' }, { uid: 's2', cardId: 'stray' }, { uid: 's3', cardId: 'stray' }],
}) as unknown as RunState;

describe('nested recruit scopes — the outer scope emits only what it changed itself', () => {
  it("Rope Wrangler: one cardGranted per stolen card, unique uids, equal to the real hand delta", () => {
    const s = ropeWrangler();
    const { state: next, batch } = reduceWithPresentation(s, faceOmen, true);
    const grants = (batch?.events ?? []).filter((e) => e.type === 'cardGranted') as { target: { uid?: string } }[];
    const delta = next.hand.length - s.hand.length;
    expect(delta, 'the fixture steals something').toBeGreaterThan(0);
    expect(grants.length).toBe(delta);
    expect(new Set(grants.map((g) => g.target.uid)).size).toBe(delta);
  });

  it('is byte-identical to plain reduce, capture on and off', () => {
    const s = ropeWrangler();
    const plain = reduce(s, faceOmen);
    expect(JSON.stringify(reduceWithPresentation(s, faceOmen, false).state)).toBe(JSON.stringify(plain));
    expect(JSON.stringify(reduceWithPresentation(s, faceOmen, true).state)).toBe(JSON.stringify(plain));
  });

  it("Arnold (End of Turn: cast Beefy on this): the batch's stat delta equals the real +8/+8, not double", () => {
    const s = { ...createRun(11, 'warden'), phase: 'recruit', hand: [], board: [mk('b1', 'dw_arnold')] } as unknown as RunState;
    const { state: next, batch } = reduceWithPresentation(s, faceOmen, true);
    const real = next.board.find((c) => c.uid === 'b1')!.attack - s.board[0]!.attack;
    const emitted = (batch?.events ?? []).filter((e) => e.type === 'statsChanged' && (e as { target: { uid?: string } }).target.uid === 'b1')
      .reduce((n, e) => n + (e as { attack: number }).attack, 0);
    expect(real).toBeGreaterThan(0);
    expect(emitted).toBe(real);
  });
});
