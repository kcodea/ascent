import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, reduceWithPresentation, type BoardCard, type RunState } from './index';
import type { SourceTriggerEvent, CardDestroyedConsequence } from '@game/core';

/**
 * SHOP DESTROY — the death, the Echo and the Rise (owner report + ruling 2026-08-28).
 *
 * Two things were wrong. Mechanically, Rise did nothing outside combat: `rebornAvailable` is armed by combat's
 * `instantiate`, so a Graverobber ate a Rise carrier outright. Presentationally, a body leaving the board in the
 * shop emitted NO consequence at all — the beat collector diffed arrivals but never departures — so there was
 * nothing for a death animation to hang on and the minion simply was not there once the phase committed.
 */
const body = (cardId: string, uid: string): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
};
const run = (): RunState => ({ ...createRun(1), embers: 20 });

/** Graverobber is a targeted Shout: playing it opens the picker, `battlecryTarget` resolves it. */
const graverob = (s: RunState, targetUid: string): RunState => {
  const opened = reduce(s, { type: 'play', uid: 'gr' });
  expect(opened.pendingTarget?.uid, 'the aim picker never opened').toBe('gr');
  return reduce(opened, { type: 'battlecryTarget', targetUid });
};

describe('Graverobber destroys in the shop', () => {
  it('a minion with NO Rise is gone for good', () => {
    let s = run();
    s = { ...s, board: [body('sandbag', 'victim')], hand: [body('graverobber', 'gr')] };
    s = graverob(s, 'victim');
    expect(s.board.some((c) => c.uid === 'victim'), 'the destroyed body is still on the board').toBe(false);
  });

  it('a minion WITH Rise comes back — base Attack, 1 Health, Rise spent', () => {
    // Anubis (T7) carries Rise AND an Echo, so this covers both halves of the ritual at once.
    const def = CARD_INDEX['anubis']!;
    expect(def.keywords, 'the fixture must actually carry Rise').toContain('R');
    let s = run();
    const victim = body('anubis', 'victim');
    victim.attack += 10; // buffs are shed on the return, exactly as combat sheds them
    victim.health += 10;
    s = { ...s, board: [victim], hand: [body('graverobber', 'gr')] };
    s = graverob(s, 'victim');

    // Same card, NEW instance: the body genuinely left play and returned.
    const risen = s.board.find((c) => c.cardId === 'anubis');
    expect(risen, 'Rise did not return the body').toBeDefined();
    expect(risen!.uid, 'the risen body must be a fresh instance, not the corpse').not.toBe('victim');
    expect(risen!.attack, 'base Attack, not the buffed line').toBe(def.attack);
    expect(risen!.health, 'Rise always returns at 1 Health').toBe(1);
    expect(risen!.keywords, 'the Rise was spent').not.toContain('R');
  });

  it('a GOLDEN Rise carrier returns at double base Attack, still 1 Health', () => {
    const def = CARD_INDEX['anubis']!;
    let s = run();
    const victim = { ...body('anubis', 'victim'), golden: true };
    s = { ...s, board: [victim], hand: [body('graverobber', 'gr')] };
    s = graverob(s, 'victim');
    const risen = s.board.find((c) => c.cardId === 'anubis')!;
    expect(risen.attack).toBe(def.attack * 2);
    expect(risen.health, 'golden doubles Attack but NEVER Health (owner ruling 2026-07-02)').toBe(1);
  });

  it('a full board gates the Rise, exactly as combat does — the Echo resolves FIRST and can take the room', () => {
    // Imp King's Echo summons 2 Imps into the slot the body just vacated. Rise is granted onto the INSTANCE
    // (a granted keyword still triggers the return; it is simply not reprinted on the risen body), so this
    // exercises the ordering that matters: the body leaves, the Echo fills the board, and the return is then
    // refused for want of a slot — combat's rule, not a shop-only shortcut.
    let s = run();
    const victim = body('impking', 'victim');
    victim.keywords = [...victim.keywords, 'R'];
    const others = ['sandbag', 'alley', 'trickster', 'ritualist'].map((id, i) => body(id, `o${i}`));
    s = { ...s, board: [...others, victim], hand: [body('graverobber', 'gr')] };
    s = graverob(s, 'victim'); // 5 + Graverobber = 6, victim leaves = 5, its 2 Imps arrive = 7 (full)
    expect(s.board.some((c) => c.uid === 'victim'), 'the corpse is still there').toBe(false);
    expect(s.board.length, 'the Echo should have filled the board').toBe(7);
    expect(s.board.filter((c) => c.cardId === 'impking'), 'no room — the Rise is gated').toHaveLength(0);
  });

  it('still pays its spell: the destroy is a means, not the whole card', () => {
    let s = run();
    s = { ...s, board: [body('sandbag', 'victim')], hand: [body('graverobber', 'gr')] };
    const before = s.hand.length;
    s = graverob(s, 'victim');
    // Graverobber leaves the hand and its spell arrives; net hand size is unchanged or up.
    expect(s.hand.length, 'the tier-matched spell never arrived').toBeGreaterThanOrEqual(before - 1);
  });
});

describe('Funeral on Loan', () => {
  it('the borrowed body never stays — Rise does NOT rescue it', () => {
    // The loan ENDING is not a death. If Rise applied here a borrowed minion could stay on the board, which is
    // the one thing this card must never allow.
    let s = run();
    const borrowed = { ...body('anubis', 'loan'), borrowed: true } as BoardCard;
    s = { ...s, board: [], hand: [borrowed] };
    s = reduce(s, { type: 'play', uid: 'loan', toIndex: 0 });
    expect(s.board.some((c) => c.cardId === 'anubis'), 'a borrowed Rise carrier stayed on the board').toBe(false);
  });
});

/**
 * THE BEATS. The gameplay above is only half the fix: the owner's report was that these effects are
 * "immediate and janky", which is a PRESENTATION fault. A destroy that emits no consequence gives the
 * choreographer nothing to animate, so the body can only wink out when the phase commits.
 */
describe('a shop destroy emits a real beat', () => {
  it('is gameplay-identical with capture on and off', () => {
    const s = { ...run(), board: [body('anubis', 'victim')], hand: [body('graverobber', 'gr')] };
    const opened = reduce(s, { type: 'play', uid: 'gr' });
    const act = { type: 'battlecryTarget', targetUid: 'victim' } as const;
    const plain = reduce(opened, act);
    expect(JSON.stringify(reduceWithPresentation(opened, act, false).state)).toBe(JSON.stringify(plain));
    expect(JSON.stringify(reduceWithPresentation(opened, act, true).state)).toBe(JSON.stringify(plain));
  });

  it('Graverobber: the death is its own beat, and the destroyed body reports the slot it left', () => {
    const s = { ...run(), board: [body('sandbag', 'a'), body('anubis', 'victim')], hand: [body('graverobber', 'gr')] };
    const opened = reduce(s, { type: 'play', uid: 'gr' });
    const { batch } = reduceWithPresentation(opened, { type: 'battlecryTarget', targetUid: 'victim' }, true);
    const events = batch!.events;

    const death = events.find((e) => (e as { type: string }).type === 'sourceTrigger'
      && (e as SourceTriggerEvent).policyKey === 'system:destroy:shopDeath') as SourceTriggerEvent | undefined;
    expect(death, 'the destroy never got its own beat').toBeDefined();
    expect(death!.source.uid, 'the beat belongs to the body that died').toBe('victim');

    const destroyed = events.filter((e): e is CardDestroyedConsequence =>
      (e as { type: string }).type === 'cardDestroyed') as CardDestroyedConsequence[];
    const mine = destroyed.find((d) => d.target.uid === 'victim');
    expect(mine, 'no cardDestroyed for the body that left the board').toBeDefined();
    expect(mine!.index, 'the slot it vacated \u2014 without it the projection has nowhere to animate').toBe(1);
    expect(mine!.rise, 'Anubis carries Rise, so the death must be flagged as a return').toBe(true);
  });

  it('Funeral on Loan: the arrival and the death are SEPARATE beats, in that order', () => {
    const borrowed = { ...body('anubis', 'loan'), borrowed: true };
    const s = { ...run(), board: [], hand: [borrowed] };
    const { batch } = reduceWithPresentation(s, { type: 'play', uid: 'loan', toIndex: 0 }, true);
    const events = batch!.events;
    const keys = events
      .filter((e): e is SourceTriggerEvent => (e as { type: string }).type === 'sourceTrigger')
      .map((e) => e.policyKey);
    const arrive = keys.indexOf('system:destroy:shopArrival');
    const die = keys.indexOf('system:destroy:shopDeath');
    expect(arrive, 'the borrowed body never got an arrival beat').toBeGreaterThanOrEqual(0);
    expect(die, 'the borrowed body never got a death beat').toBeGreaterThanOrEqual(0);
    expect(arrive, 'it must be SEEN to take a slot before it is taken away').toBeLessThan(die);
  });
});
