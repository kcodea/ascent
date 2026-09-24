/**
 * SPELL EFFECTS FROM EVERY SOURCE, SHOP HALF (owner report 2026-09-24, verbatim): *"dragonflame animation is not
 * playing from the gilded ledger etc. why? all spell animations and sfx should be wired to play whenever a spell or
 * minion is cast/played from any source. can you find the disconnect?"*
 *
 * The disconnect was here, in the sim's buff records. Dragonflame (`spellBuffRandomPerTribe`, one capture per repeat,
 * R-REPEAT-01), Great Pot (`buffOnePerTribe`, one capture per recipient) and the targeted Gifts open their OWN nested
 * buff capture inside the cast. The nested capture claims its targets, so the cast's outer capture (the one stamped
 * with the spell, the rune and the caster) skipped them, and the records went out UNTAGGED: the UI saw a plain
 * sourceless spell buff and drew the generic descend. Dragonflame's column and sound never played for a rune's or a
 * minion's cast. Every buff a cast produces now carries the cast's tag however the factory captures it
 * (`captureCastBuffFx`), and a MINION caster is named (`castByUid`) so a travelling row can leave its body.
 *
 * The presentation half is packages/ui/src/fx/spellFxEverySource.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import { makeCollector } from '@game/core';
import { createRun, reduce, withActiveCollector, type BoardCard, type RunState } from './index';
import { advanceRuneThresholds, fireShopRally } from './recruit';

const card = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack: 2, health: 2, keywords: [], golden: false, ...over });
const run = (over: Partial<RunState> = {}): RunState => ({ ...createRun(1), phase: 'recruit', ...over } as RunState);
/** Two Dragons and a Beast: Dragonflame repeats 3 times, Great Pot hits one minion of each type (2 bodies). */
const board = (): BoardCard[] => [card('d1', 'hoardbreaker'), card('d2', 'd2_flamebeat'), card('b', 'stray')];

/** Walk seeds until the Ledger rolls `spellId` (deterministic: the first such seed), and return that run. */
function ledgerCasts(spellId: string): RunState {
  const reward = RUNE_INDEX['rune_gilded_ledger']!.reward as { kind: 'runeThreshold'; meter: 'gold'; per: number; castStatSpell: number };
  for (let seed = 1; seed <= 800; seed++) {
    const s = run({ tier: 6, rngCursor: seed, board: board(), runeThresholds: [{ ...reward, sourceId: 'rune_gilded_ledger', tick: 0 }] as never });
    advanceRuneThresholds(s, 'gold', reward.per);
    if ((s.castFx ?? []).some((c) => c.spellId === spellId)) return s;
  }
  throw new Error(`no seed rolled ${spellId} from the Ledger`);
}

describe('every buff a non-player cast produces carries the cast (the Dragonflame disconnect)', () => {
  it('Rune of the Gilded Ledger casting DRAGONFLAME: every repeat\'s buff names the spell and the rune', () => {
    const s = ledgerCasts('sp_dragonflame');
    expect(s.recruitBuffFx.length, 'Dragonflame repeated once per Dragon plus one').toBeGreaterThanOrEqual(3);
    for (const e of s.recruitBuffFx) expect(e).toMatchObject({ kind: 'spell', spellId: 'sp_dragonflame', sourceRuneId: 'rune_gilded_ledger' });
    expect(new Set(s.recruitBuffFx.map((e) => e.fxWave)).size, 'one wave per repeat, as before').toBe(s.recruitBuffFx.length);
  });

  it('Rune of the Gilded Ledger casting GREAT POT: each type\'s buff names the spell and the rune', () => {
    const s = ledgerCasts('greatpot');
    expect(s.recruitBuffFx.length).toBeGreaterThanOrEqual(2);
    for (const e of s.recruitBuffFx) expect(e).toMatchObject({ kind: 'spell', spellId: 'greatpot', sourceRuneId: 'rune_gilded_ledger' });
  });

  it.each([['Dragonflame', 'sp_dragonflame'], ['Great Pot', 'greatpot'], ['Bloody Ale', 'wo_attack']])(
    'a MINION casting %s in the Shop (a Mage-Pup taught it): its buffs name the spell and the caster', (_n, id) => {
      const s = run({ board: board(), hand: [card('p', 'b2_magepup', { attack: 1, health: 1, taughtSpellId: id })] });
      const next = reduce(s, { type: 'play', uid: 'p', toIndex: 3 });
      const cast = next.recruitBuffFx.filter((e) => e.kind === 'spell');
      expect(cast.length, 'the cast buffed someone').toBeGreaterThan(0);
      for (const e of cast) expect(e).toMatchObject({ spellId: id, castByUid: 'p' });
      expect(cast.every((e) => e.sourceRuneId === undefined)).toBe(true);
    });

  it('a shop Rally casting Dragonflame (Flamebeat Drake): its buffs name the spell and the Drake', () => {
    const drake = card('fb', 'd2_flamebeat', { attack: 6, health: 5, keywords: [...CARD_INDEX['d2_flamebeat']!.keywords] });
    const s = run({ board: [drake, card('d1', 'hoardbreaker'), card('b', 'stray')] });
    fireShopRally(s, drake);
    const cast = s.recruitBuffFx.filter((e) => e.kind === 'spell');
    expect(cast.length).toBeGreaterThan(0);
    for (const e of cast) expect(e).toMatchObject({ spellId: 'sp_dragonflame', castByUid: 'fb' });
  });

  it.each([['Dragonflame', 'sp_dragonflame'], ['Great Pot', 'greatpot']])(
    'the PLAYER casting %s from hand stays untagged (its own cast cue claims these buffs)', (_n, id) => {
      const s = run({ board: board(), hand: [card('g', id)] });
      const next = reduce(s, { type: 'play', uid: 'g' });
      expect(next.recruitBuffFx.length).toBeGreaterThan(0);
      for (const e of next.recruitBuffFx) {
        expect(e.spellId).toBeUndefined();
        expect(e.sourceRuneId).toBeUndefined();
        expect(e.castByUid).toBeUndefined();
      }
    });

  it('END OF TURN (authoritative beats): a minion\'s Dragonflame gain names the spell and the caster', () => {
    const drake = card('fb', 'd2_flamebeat', { attack: 6, health: 5, keywords: [...CARD_INDEX['d2_flamebeat']!.keywords] });
    const s = run({ board: [drake, card('d1', 'hoardbreaker'), card('b', 'stray')] });
    const collector = makeCollector('t', 'endOfTurn');
    withActiveCollector(collector, () => fireShopRally(s, drake));
    const gains = (collector.finish()?.events ?? []).filter((e) => e.type === 'statsChanged') as { spellId?: string; castByUid?: string; castByRune?: string }[];
    expect(gains.length).toBeGreaterThan(0);
    for (const g of gains) expect(g).toMatchObject({ spellId: 'sp_dragonflame', castByUid: 'fb' });
    expect(gains.every((g) => g.castByRune === undefined)).toBe(true);
  });
});
