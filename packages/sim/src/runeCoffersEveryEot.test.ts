import { describe, it, expect } from 'vitest';
import { CONFIG, createRun, reduce, reduceWithPresentation, type RunState } from './index';
import { triggerBorrowedEcho } from './recruit';
import { CARD_INDEX } from '@game/content';
import type { BoardCard } from './state';
import type { SourceTriggerEvent, ResourceChangedConsequence } from '@game/core';

/**
 * Rune of the Coffers - "End of Turn: increase your maximum Gold by 1." - must pay EVERY End of Turn.
 *
 * Owner report 2026-10-06 (verbatim): "rune of the coffers only triggered once - it should trigger every end of turn".
 *
 * Root cause: the rune wrote its +1 into `maxEmbers`, the NATURAL curve. The next turn start grows that curve with
 * `max(maxEmbers, min(cap, maxEmbers + 1))`, so once a Coffers raise pushed it to the cap (10) the natural +1 it
 * would have had anyway was eaten: the raise only pre-spent growth the player was getting for free. Near the cap
 * the rune looked like it did nothing. Same #642 class Nadja's Goldspring hit on 2026-07-22. Fixed by routing the
 * grant through `maxGoldBonus` (the above-the-cap channel Robin x Time, Gold Font and Nadja already use).
 */
const clearModals = (s: RunState): RunState => {
  let guard = 0;
  while ((s.discover || s.questOffer || s.chooseOne || s.pendingTarget || s.runeforgeOffer) && guard++ < 40) {
    if (s.discover) s = reduce(s, { type: 'discover', index: 0 });
    else if (s.questOffer) s = reduce(s, { type: 'buyQuest', index: 0 });
    else if (s.chooseOne) s = reduce(s, { type: 'chooseOne', index: 0 });
    else if (s.pendingTarget) s = reduce(s, { type: 'battlecryTarget', targetUid: s.board[0]?.uid ?? s.pendingTarget.uid });
    else if (s.runeforgeOffer) s = reduce(s, { type: 'skipRuneforge' });
  }
  return s;
};

/** One full turn (End of Turn -> combat -> next recruit phase). */
const turn = (s: RunState): RunState => {
  s = clearModals(s);
  s = reduce(s, { type: 'faceOmen' });
  let guard = 0;
  while (s.phase !== 'recruit' && guard++ < 40) {
    if (s.phase === 'combat') s = reduce(s, { type: 'resolveCombat' });
    else if (s.discover) s = reduce(s, { type: 'discover', index: 0 });
    else if (s.questOffer) s = reduce(s, { type: 'buyQuest', index: 0 });
    else break;
  }
  return clearModals(s);
};

/** A run that cannot die, so a long test never stops on an empty board's losses. */
const fresh = (seed: number): RunState => ({ ...createRun(seed, 'warden'), resolve: 9999 });

/** The max Gold the player actually gets each turn (the reducer's turn-start budget, before one-off Gold). */
const maxGold = (s: RunState): number => s.maxEmbers + (s.maxGoldBonus ?? 0);

describe('Rune of the Coffers triggers every End of Turn', () => {
  it('each End of Turn adds exactly +1 max Gold over a plain run, across the cap', () => {
    let plain: RunState = fresh(7);
    let coffers: RunState = { ...fresh(7), runeCoffers: true };
    for (let t = 1; t <= 12; t++) {
      plain = turn(plain);
      coffers = turn(coffers);
      // After t End of Turns the lead is t: no fire is eaten by the natural curve, before OR after the cap.
      expect(maxGold(coffers) - maxGold(plain), `lead after ${t} End of Turns`).toBe(t);
    }
    expect(plain.phase).toBe('recruit');
    expect(plain.maxEmbers).toBe(CONFIG.embersCap);
  });

  it('two copies pay +2 every End of Turn', () => {
    let plain: RunState = fresh(3);
    let coffers: RunState = { ...fresh(3), runeCoffers: true, runeStacks: { rune_coffers: 2 } };
    for (let t = 1; t <= 10; t++) { plain = turn(plain); coffers = turn(coffers); }
    expect(maxGold(coffers) - maxGold(plain)).toBe(20);
  });

  it('bought late (already at the cap) still pays every turn', () => {
    let plain: RunState = fresh(11);
    let s: RunState = fresh(11);
    for (let t = 1; t <= 9; t++) { plain = turn(plain); s = turn(s); }
    s = { ...s, runeCoffers: true };
    for (let t = 1; t <= 4; t++) { plain = turn(plain); s = turn(s); expect(maxGold(s) - maxGold(plain)).toBe(t); }
  });

  it('survives a save/restore (JSON round trip) and keeps paying', () => {
    let s: RunState = { ...fresh(5), runeCoffers: true };
    for (let t = 1; t <= 3; t++) s = turn(s);
    const restored = JSON.parse(JSON.stringify(s)) as RunState;
    const a = turn(s);
    const b = turn(restored);
    expect(maxGold(b)).toBe(maxGold(a));
    expect(b.runeCoffersGold).toBe(4);
  });

  it('plays its own Gold-pill beat on EVERY End of Turn, valueAfter = the max Gold the player will have', () => {
    let s: RunState = { ...fresh(9), runeCoffers: true };
    for (let t = 1; t <= 10; t++) {
      s = clearModals(s);
      const { state, batch } = reduceWithPresentation(s, { type: 'faceOmen' }, true);
      const beats = (batch?.events ?? []).filter(
        (e): e is SourceTriggerEvent => (e as { type: string }).type === 'sourceTrigger' && (e as SourceTriggerEvent).source.id === 'rune_coffers',
      );
      expect(beats.length, `one Coffers beat at End of Turn ${t}`).toBe(1);
      const gold = (batch?.events ?? []).filter(
        (e): e is ResourceChangedConsequence => e.type === 'resourceChanged' && e.resource === 'maxGold',
      );
      expect(gold.length, `exactly one max-Gold consequence at End of Turn ${t} (no double count)`).toBe(1);
      expect(gold[0]).toMatchObject({ parentId: beats[0]!.id, amount: 1, valueAfter: maxGold(state) });
      expect(state.runeCoffersGold).toBe(t);
      s = turn(state);
    }
  });
});

/**
 * SIBLINGS (same root cause): every other "raise your maximum Gold" grant also wrote the natural `maxEmbers` curve,
 * so a raise that pushed it into the cap evaporated the same way. The two chokepoints now land in `maxGoldBonus`:
 * the Shop arena's `grantMaxGold` (Bone Taxer's Echo) and settleCombat's `playerMaxGoldGain` carry-back (Soulsman,
 * Bone Taxer in combat, Rune of Soul Taxes).
 */
describe('max-Gold grants near the cap are not eaten by the natural curve', () => {
  it('a combat max-Gold carry-back at 9 max Gold is still +1 over a plain run next turn', () => {
    const at9 = (): RunState => reduce({ ...fresh(21), maxEmbers: 9, embers: 9 }, { type: 'faceOmen' });
    let plain = at9();
    let gained = at9();
    expect(gained.phase).toBe('combat');
    gained = { ...gained, lastCombat: { ...gained.lastCombat!, playerMaxGoldGain: 1 } };
    gained = reduce(gained, { type: 'settleCombat' });
    plain = reduce(plain, { type: 'resolveCombat' });
    gained = reduce(gained, { type: 'resolveCombat' });
    expect(plain.maxEmbers).toBe(CONFIG.embersCap);
    expect(maxGold(gained) - maxGold(plain)).toBe(1);
  });

  it("Bone Taxer's Echo in the Shop at 9 max Gold is still +1 over a plain run next turn", () => {
    const body: BoardCard = { uid: 'bt', cardId: 'bonetaxer', tribe: CARD_INDEX.bonetaxer!.tribe, attack: 3, health: 3, keywords: [], golden: false };
    let plain: RunState = { ...fresh(22), maxEmbers: 9, embers: 9 };
    let taxed: RunState = { ...fresh(22), maxEmbers: 9, embers: 9 };
    triggerBorrowedEcho(taxed, body);
    plain = turn(plain);
    taxed = turn(taxed);
    expect(maxGold(taxed) - maxGold(plain)).toBe(1);
  });
});
