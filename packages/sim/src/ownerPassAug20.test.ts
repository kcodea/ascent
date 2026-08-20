import { describe, it, expect } from 'vitest';
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import { createRun, reduce, reduceWithPresentation, type BoardCard, type RunState } from './index';

/**
 * THE OWNER'S 2026-08-20 CORRECTION PASS — four reports against the rune batch that shipped the same day.
 *
 * The two this file owns are the ones no existing suite had a seam for:
 *
 *  - **Skybound Ascendant transforms in REAL TIME.** Its End-of-Turn tier-up resolved invisibly inside the
 *    commit: the emission diff produced a stat delta and nothing else, so nothing told the projection the
 *    card had BECOME another card and the swap only appeared after the phase flipped. It now emits a
 *    `cardTransformed` consequence on its own (`ownBeat`) trigger, which is what the UI animates against.
 *  - **The ten tribe-faucet runes pay IMMEDIATELY.** Taking one granted nothing until the next turn setup
 *    (owner: buying a rune mid-turn must not feel like buying nothing) — the same rule Rune of Ruby
 *    Resonance already follows.
 */

const faceOmen = { type: 'faceOmen' } as const;

const body = (uid: string, cardId: string): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
};

// ── 1. the transform emits its own beat ───────────────────────────────────────────────────────────────────

type Trig = { type: string; id?: string; parentId?: string; policyKey?: string; source: { uid?: string; cardId?: string } };
type Transform = { type: string; parentId?: string; toCardId: string; target: { uid?: string; cardId?: string; zone?: string } };

/** [neighbour, Skybound Ascendant] — the Ascendant steps the body on its LEFT up a tier at End of Turn. */
const ascendantBoard = (): RunState => ({
  ...createRun(7), setId: 'set2', phase: 'recruit', tier: 6, hand: [], shop: [],
  tribes: ['kobold', 'dwarf', 'demon', 'beast', 'dragon'],
  board: [body('nb', 'k_chipwick'), body('sk', 'd2_ascendant')],
} as RunState);

describe('Skybound Ascendant transforms on its own beat (owner report: "in real time")', () => {
  it('gameplay is byte-identical to plain reduce (capture on)', () => {
    const s = ascendantBoard();
    expect(JSON.stringify(reduceWithPresentation(s, faceOmen, true).state)).toBe(JSON.stringify(reduce(s, faceOmen)));
  });

  it('emits cardTransformed, on the Ascendant’s trigger, naming what the neighbour became', () => {
    const { batch, state } = reduceWithPresentation(ascendantBoard(), faceOmen, true);
    const trigs = (batch!.events as unknown as Trig[]).filter((e) => e.type === 'sourceTrigger');
    const beat = trigs.find((t) => t.policyKey === 'factory:endOfTurnTransformLeftTierUp:endOfTurn');
    expect(beat, 'the transform has its own source-attributed trigger').toBeTruthy();
    expect(beat!.source.uid, 'sourced on the ASCENDANT, the acting minion').toBe('sk');

    const transforms = (batch!.events as unknown as Transform[]).filter((e) => e.type === 'cardTransformed');
    expect(transforms, 'exactly one body transformed').toHaveLength(1);
    const t = transforms[0]!;
    expect(t.parentId, 'delivered on the transform’s own beat').toBe(beat!.id);
    expect(t.target.uid, 'the NEIGHBOUR is what changed').toBe('nb');
    expect(t.target.cardId, 'the target names what it WAS').toBe('k_chipwick');
    // …and what it says it became is what the commit actually produced — the projection and the committed
    // board can no longer disagree, which is the whole point of animating from the consequence.
    expect(t.toCardId).toBe(state.board.find((c) => c.uid === 'nb')!.cardId);
    expect(t.toCardId).not.toBe('k_chipwick');
  });

  it('a turn with no transform emits none (the diff is not a blanket board scan)', () => {
    const s = { ...ascendantBoard(), board: [body('nb', 'k_chipwick')] } as RunState;
    const { batch } = reduceWithPresentation(s, faceOmen, true);
    expect((batch?.events ?? []).some((e) => e.type === 'cardTransformed')).toBe(false);
  });
});

// ── 2. the ten tribe-faucet runes pay at purchase ─────────────────────────────────────────────────────────

/** [rune id, tribe, cards per payout]. The owner's ten: five Basic (1 card) + five Epic (2 cards). */
const TRIBE_RUNES: [string, string, number][] = [
  ['rune_basic_beast', 'beast', 1], ['rune_basic_demon', 'demon', 1], ['rune_basic_dragon', 'dragon', 1],
  ['rune_basic_dwarf', 'dwarf', 1], ['rune_basic_kobold', 'kobold', 1],
  ['rune_epic_beast', 'beast', 2], ['rune_epic_demon', 'demon', 2], ['rune_epic_dragon', 'dragon', 2],
  ['rune_epic_dwarf', 'dwarf', 2], ['rune_epic_kobold', 'kobold', 2],
];

/** Buy a rune through the REAL Runeforge path — the same `reduce` a player drives. */
const armed = (id: string, over: Partial<RunState> = {}): RunState => reduce(
  {
    ...createRun(3, 'runesmith'), setId: 'set2', wave: 7, tier: 6, phase: 'recruit', embers: 40,
    tribes: ['kobold', 'dwarf', 'demon', 'beast', 'dragon'], hand: [], board: [], runeforgeOffer: [id],
  } as RunState,
  { type: 'buyRune', index: 0 },
) as RunState;

const isOf = (cardId: string, tribe: string): boolean => {
  const d = CARD_INDEX[cardId];
  return !!d && (d.tribe === tribe || d.tribe2 === tribe || !!d.universalTribe);
};

describe('the ten tribe-faucet runes pay ONCE IMMEDIATELY, then every turn after', () => {
  it('every one of the ten exists and is a per-turn tribe drip', () => {
    for (const [id, tribe, count] of TRIBE_RUNES) {
      const r = RUNE_INDEX[id];
      expect(r, `${id} is missing`).toBeTruthy();
      expect(r!.reward).toMatchObject({ kind: 'runeTribeDrip', tribe, count });
    }
  });

  it.each(TRIBE_RUNES)('%s hands over its cards the moment it is taken', (id, tribe, count) => {
    const s = armed(id);
    expect(s.hand, `${id} granted nothing on purchase`).toHaveLength(count);
    for (const c of s.hand) expect(isOf(c.cardId, tribe), `${c.cardId} is not a ${tribe}`).toBe(true);
    // The immediate grant obeys the recurring one's TIER CAP: a rune must not hand you a card the shop couldn't.
    for (const c of s.hand) expect(CARD_INDEX[c.cardId]!.tier).toBeLessThanOrEqual(s.tier);
  });

  it.each(TRIBE_RUNES)('%s keeps paying at the next turn setup — and does not double-pay on the turn it was bought', (id, _tribe, count) => {
    let s = armed(id, {
      wave: 1, resolve: 999, maxResolve: 999, armor: 999,
      board: [{ uid: 't', cardId: 'sandbag', tribe: 'neutral', attack: 0, health: 50, keywords: ['T'], golden: false } as BoardCard],
    });
    expect(s.hand, 'exactly ONE payout on the buying turn, not two').toHaveLength(count);
    s = reduce(s, faceOmen) as RunState;
    s = reduce(s, { type: 'resolveCombat' }) as RunState;
    expect(s.hand.length, 'the recurrence paid again at the next turn setup').toBe(count * 2);
  });

  it('two tribe runes both pay immediately (the reward is PUSHED, not assigned)', () => {
    let s = armed('rune_basic_beast');
    s.runeforgeOffer = ['rune_basic_demon'];
    s.embers = 40;
    s = reduce(s, { type: 'buyRune', index: 0 }) as RunState;
    expect(s.hand, 'one Beast + one Demon').toHaveLength(2);
    expect(s.runeTribeDrip).toHaveLength(2);
  });
});
