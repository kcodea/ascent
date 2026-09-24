/**
 * THE RUNES THAT REPEAT A CAST CAST AS THE RUNE (owner 2026-09-24, verbatim): *"yeah the runes that repeat casts should
 * use the rune-cast visual."*
 *
 * #1676 left the repeat runes (Shared Pour, Astral Draft, Distillation, Shared Reflection, and the "they cast twice" /
 * "an additional time" runes: Hoardflame, Dragon Breath, the Bottomless Cask) riding the PLAYER's cast, so their
 * extra resolutions recorded nothing and presented as the player's. Now the player's own cast keeps the player's
 * visuals (no `castFx` record, untagged buffs) and every repeat a rune adds runs with THAT RUNE as the cast actor:
 * a `castFx` record against the rune, and buffs tagged `spellId` + `sourceRuneId`, so the UI's rune-cast path (the
 * node on the rail, the flourish, the cast preview) applies. Gameplay is unchanged: the same casts, in the same
 * order, on the same targets (the stat asserts below pin that the total did not move).
 *
 * The presentation half is packages/ui/src/fx/runeCastFlourish.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, runeExtraCasts, spellCasts, type BoardCard, type RunState } from './index';

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: 2, health: 2, keywords: [], golden: false, ...over } as BoardCard;
};
const spell = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard =>
  ({ uid, cardId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false, ...over } as BoardCard);
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), phase: 'recruit', embers: 30, tier: 6, ...over } as RunState);
const runeRecords = (s: RunState, runeId: string) => (s.castFx ?? []).filter((c) => c.source.kind === 'rune' && c.source.id === runeId);

describe('runeExtraCasts splits a play\'s casts into the player\'s and each repeat rune\'s', () => {
  it('Shared Pour: the first Ale each turn is one player cast + one Shared Pour cast', () => {
    const s = run({ runeSharedPour: true, ownedRunes: ['rune_shared_pour'] });
    const ale = CARD_INDEX['wo_attack']!;
    expect(spellCasts(s, ale)).toBe(2);
    expect(runeExtraCasts(s, ale)).toEqual([{ runeId: 'rune_shared_pour', count: 1 }]);
    expect(runeExtraCasts({ ...s, sharedPourUsedThisTurn: true }, ale), 'spent freebie: nothing to split').toEqual([]);
  });

  it('Hoardflame ("they cast twice") under a doubling multiplier: the shares always sum to the extras', () => {
    const s = run({ ownedRunes: ['rune_hoardflame'], runeSpellDouble: ['hoardflame'], spellDoubleAlways: true });
    const hf = CARD_INDEX['hoardflame']!;
    const total = spellCasts(s, hf);
    expect(total).toBe(4); // Ancient Runes x2, then the rune x2
    const shares = runeExtraCasts(s, hf);
    expect(shares).toEqual([{ runeId: 'rune_hoardflame', count: 2 }]);
  });

  it('the Bottomless Cask\'s share excludes the Bottomless Cellar QUEST\'s extra Ale cast', () => {
    const ale = CARD_INDEX['wo_attack']!;
    const cellarOnly = run({ aleExtraCasts: 1 });
    expect(runeExtraCasts(cellarOnly, ale), 'no rune owned: the quest\'s extra is the player\'s').toEqual([]);
    const both = run({ aleExtraCasts: 2, ownedRunes: ['rune_bottomless_cask'] });
    expect(spellCasts(both, ale)).toBe(3);
    expect(runeExtraCasts(both, ale)).toEqual([{ runeId: 'rune_bottomless_cask', count: 1 }]);
  });

  it('a plain spell with no repeat rune splits nothing', () => {
    expect(runeExtraCasts(run(), CARD_INDEX['growth']!)).toEqual([]);
  });
});

describe('the repeated cast records the RUNE as its actor; the player\'s own cast records nothing', () => {
  it('Rune of Shared Pour: one Ale, two casts — the second is the rune\'s (castFx + tagged buffs), stats unchanged', () => {
    const board = [body('a', 'stray'), body('b', 'stray'), body('c', 'stray')];
    const base = run({ setId: 'set2', board, hand: [spell('ale', 'wo_attack')], rngCursor: 7 });
    const withRune = reduce({ ...base, runeSharedPour: true, ownedRunes: ['rune_shared_pour'] } as RunState, { type: 'play', uid: 'ale' });
    expect(runeRecords(withRune, 'rune_shared_pour')).toEqual([{ source: { kind: 'rune', id: 'rune_shared_pour' }, spellId: 'wo_attack', phase: 'recruit' }]);
    const tagged = withRune.recruitBuffFx.filter((e) => e.sourceRuneId === 'rune_shared_pour');
    const own = withRune.recruitBuffFx.filter((e) => e.kind === 'spell' && !e.sourceRuneId);
    expect(tagged.length, 'the rune\'s cast buffed').toBeGreaterThan(0);
    expect(tagged.every((e) => e.spellId === 'wo_attack')).toBe(true);
    expect(own.length, 'the player\'s own cast keeps untagged buffs').toBeGreaterThan(0);
    expect(own.every((e) => e.spellId === undefined)).toBe(true);
    // Gameplay: the Ale still resolved twice, exactly as a plain "casts twice" (a Nimbus charge) resolves it.
    const twice = reduce({ ...base, nextSpellExtraCasts: 1 } as RunState, { type: 'play', uid: 'ale' });
    expect(withRune.board.map((c) => [c.uid, c.attack, c.health])).toEqual(twice.board.map((c) => [c.uid, c.attack, c.health]));
    expect(twice.castFx ?? [], "a non-rune repeat stays the player's: no record").toEqual([]);
  });

  it('Rune of the Astral Draft: the stamped pick\'s extra cast is the rune\'s', () => {
    const s = run({ board: [body('a', 'stray')], hand: [spell('g', 'growth', { extraCasts: 1 })], ownedRunes: ['rune_astral_draft'], runeAstralDraft: true });
    const next = reduce(s, { type: 'play', uid: 'g' });
    expect(runeRecords(next, 'rune_astral_draft')).toHaveLength(1);
    expect(next.castFx!.filter((c) => c.source.kind !== 'rune')).toEqual([]);
    expect(next.recruitBuffFx.some((e) => e.sourceRuneId === 'rune_astral_draft' && e.spellId === 'growth')).toBe(true);
    expect(next.recruitBuffFx.some((e) => e.kind === 'spell' && !e.sourceRuneId), 'the player cast Growth once too').toBe(true);
  });

  it('Rune of Hoardflame: the second Hoardflame cast is the rune\'s', () => {
    const s = run({ board: [body('a', 'stray')], hand: [spell('h', 'hoardflame')], ownedRunes: ['rune_hoardflame'], runeSpellDouble: ['hoardflame'] });
    const next = reduce(s, { type: 'play', uid: 'h', targetUid: 'a' });
    expect(runeRecords(next, 'rune_hoardflame')).toHaveLength(1);
    expect(next.recruitBuffFx.filter((e) => e.sourceRuneId === 'rune_hoardflame')).toHaveLength(1);
  });

  it('Rune of Distillation: a spell on a Shop offer echoes onto your edges AS THE RUNE (no offer -> edge hop)', () => {
    const s = run({
      board: [body('lead', 'stray'), body('tail', 'stray')], hand: [spell('sp', 'spiritfire')],
      shop: [{ uid: 'o1', cardId: 'sandbag' }], runeDistillation: true, ownedRunes: ['rune_distillation'],
    });
    const next = reduce(s, { type: 'play', uid: 'sp', targetUid: 'o1' });
    expect(runeRecords(next, 'rune_distillation').map((c) => c.spellId)).toEqual(['spiritfire', 'spiritfire']);
    const tagged = next.recruitBuffFx.filter((e) => e.sourceRuneId === 'rune_distillation');
    expect(new Set(tagged.map((e) => e.targetUid))).toEqual(new Set(['lead', 'tail']));
    expect((next.bounceFx ?? []).filter((b) => b.kind === 'spell')).toEqual([]);
  });

  it('Rune of Shared Reflection: the first spell on a Mirrorwing spreads to adjacent Dragons AS THE RUNE', () => {
    const s = run({
      setId: 'set2',
      board: [body('d1', 'd2_mirrorwing'), body('mw', 'd2_mirrorwing'), body('x', 'stray')],
      hand: [spell('sp', 'spiritfire')], runeSharedReflection: true, ownedRunes: ['rune_shared_reflection'],
    });
    const next = reduce(s, { type: 'play', uid: 'sp', targetUid: 'mw' });
    const recs = runeRecords(next, 'rune_shared_reflection');
    expect(recs.length, 'the spread cast on the adjacent Dragon').toBeGreaterThan(0);
    expect(next.recruitBuffFx.some((e) => e.sourceRuneId === 'rune_shared_reflection' && e.targetUid === 'd1')).toBe(true);
    expect(next.recruitBuffFx.some((e) => e.sourceRuneId === 'rune_shared_reflection' && e.targetUid === 'x'), 'not a Dragon').toBe(false);
  });
});
