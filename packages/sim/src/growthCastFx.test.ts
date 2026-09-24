/**
 * GROWTH'S (AND WAKING RIFT'S) CAST EFFECT, SHOP HALF (owner 2026-09-24): *"i added a growth effect for whenever growth is cast, by
 * any means. player,rune,minion etc and any phase."* The UI plays a spell's own effect off the sim's per-action
 * cast records (`castFx`, one per cast) for every RUNE / MINION cast in the Shop and at End of Turn, and off the
 * `spellCast` moment for the player's own cast. These pin that every shop-side source reaches a record:
 *
 *   · the player's cast from hand — NO record (its effect rides the `spellCast` moment; a record would double it);
 *   · a rune's Shop cast (Rune of the Gilded Ledger rolling Growth) — recorded against the rune;
 *   · a minion's cast (Mage-Pup's Shout casting its taught Growth) — recorded against the minion;
 *   · a Rally fired in the shop (Hoardbreaker Drake's "cast Growth" — the arena's `castRepeat`, which resolves
 *     inline rather than through `castSpell`) — recorded too, via the shared `recordActorCast`;
 *   · a rune's End-of-Turn cast (Rune of Recurrence re-casting the turn's first spell) — recorded `endOfTurn`,
 *     sliced onto its End-of-Turn beat (`EotStepFx.casts`).
 *
 * The combat half is `packages/core/src/combat/growthCastTag.test.ts`; the presentation half (each record /
 * moment / `sc` event playing `growth-effect`) is `packages/ui/src/fx/spellCastFx.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { advanceRuneThresholds, applyEndOfTurn, fireShopRally, projectEndOfTurnSteps } from './recruit';

const card = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack: 2, health: 2, keywords: [], golden: false, ...over });
const run = (over: Partial<RunState> = {}): RunState => ({ ...createRun(1), phase: 'recruit', ...over } as RunState);
const growths = (s: RunState, spellId = 'growth') => (s.castFx ?? []).filter((c) => c.spellId === spellId);
/** Growth and Waking Rift (id `sparkplug`, kept from Spark Plug) — the two spells with an owner-authored cast effect. */
const SPELLS = [['Growth', 'growth'], ['Waking Rift', 'sparkplug']] as const;

describe('Growth cast records — every shop-side source', () => {
  it.each(SPELLS)('the PLAYER casting %s from hand records nothing (the spellCast moment carries it)', (_n, id) => {
    const s = run({ board: [card('a', 'stray')], hand: [card('g', id)] });
    const next = reduce(s, { type: 'play', uid: 'g' });
    expect(next.hand.some((c) => c.uid === 'g'), 'the spell was cast').toBe(false);
    expect(growths(next, id)).toEqual([]);
  });

  it.each(SPELLS)('a MINION casting %s in the Shop (a Mage-Pup taught it, played from hand) is recorded against it', (_n, id) => {
    const s = run({ board: [card('a', 'stray')], hand: [card('p', 'b2_magepup', { attack: 1, health: 1, taughtSpellId: id })] });
    const next = reduce(s, { type: 'play', uid: 'p', toIndex: 1 });
    expect(growths(next, id)).toEqual([{ source: { kind: 'minion', uid: 'p', cardId: 'b2_magepup' }, spellId: id, phase: 'recruit' }]);
  });

  it('a Rally fired in the Shop (Hoardbreaker Drake: "cast Growth", the arena castRepeat) is recorded too', () => {
    const drake = card('hb', 'hoardbreaker', { attack: 4, health: 4, keywords: [...CARD_INDEX['hoardbreaker']!.keywords] });
    const s = run({ board: [drake, card('a', 'stray')] });
    fireShopRally(s, drake);
    expect(growths(s)).toEqual([{ source: { kind: 'minion', uid: 'hb', cardId: 'hoardbreaker' }, spellId: 'growth', phase: 'recruit' }]);
  });

  it.each(SPELLS)('a RUNE casting %s in the Shop (Rune of the Gilded Ledger rolls it) is recorded against the rune', (_n, id) => {
    const reward = RUNE_INDEX['rune_gilded_ledger']!.reward as { kind: 'runeThreshold'; meter: 'gold'; per: number; castStatSpell: number };
    // The Ledger casts a RANDOM stat spell — walk seeds until it rolls this one (deterministic: the first such seed).
    let found: RunState['castFx'] | undefined;
    for (let seed = 1; seed <= 400 && !found; seed++) {
      const s = run({ tier: 6, rngCursor: seed, board: [card('a', 'stray')], runeThresholds: [{ ...reward, sourceId: 'rune_gilded_ledger', tick: 0 }] as never });
      advanceRuneThresholds(s, 'gold', reward.per);
      if (growths(s, id).length > 0) found = growths(s, id);
    }
    expect(found, 'no seed rolled the spell from the Ledger').toBeDefined();
    expect(found).toEqual([{ source: { kind: 'rune', id: 'rune_gilded_ledger' }, spellId: id, phase: 'recruit' }]);
  });

  it.each(SPELLS)('a RUNE casting %s at End of Turn (Rune of Recurrence) is recorded endOfTurn, once per cast, on its beat', (_n, id) => {
    const over = { board: [card('a', 'stray')], questRecurringEndOfTurn: ['recastFirstSpell'], firstSpellThisTurnId: id } as Partial<RunState>;
    const s = run(over);
    applyEndOfTurn(s);
    const recs = growths(s, id);
    expect(recs).toHaveLength(2); // Recurrence casts it TWICE (owner sheet 2026-07-31) — two effects, not one
    expect(recs.every((c) => c.phase === 'endOfTurn' && c.source.kind === 'rune')).toBe(true);
    const { fx } = projectEndOfTurnSteps(run(over));
    const onBeats = fx.flatMap((f) => f.casts ?? []).filter((c) => c.spellId === id);
    expect(onBeats, 'the legacy End-of-Turn player reads the same casts per beat').toHaveLength(2);
  });
});
