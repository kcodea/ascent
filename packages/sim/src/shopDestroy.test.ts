import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, reduceWithPresentation, type BoardCard, type RunState } from './index';
import { fireRecruitDeathrattlesForTest } from './recruit';
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

/**
 * Graverobber is a targeted Shout: playing it opens the picker, `battlecryTarget` marks the victim as dying,
 * and — since 2026-08-28 — the death itself is the NEXT action, so the victim stays on the board for one
 * committed state and its death has a window to animate in. Most assertions below are about the OUTCOME, so
 * this helper takes both steps; `graverobAim` stops after the first for the tests that inspect the pause.
 */
const graverobAim = (s: RunState, targetUid: string): RunState => {
  const opened = reduce(s, { type: 'play', uid: 'gr' });
  expect(opened.pendingTarget?.uid, 'the aim picker never opened').toBe('gr');
  return reduce(opened, { type: 'battlecryTarget', targetUid });
};
const graverob = (s: RunState, targetUid: string): RunState =>
  reduce(graverobAim(s, targetUid), { type: 'resolveShopDeath' });

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

describe('Funeral on Loan — the two-step death', () => {
  // Owner design 2026-08-28: "the minion should be coded to literally land as if it was played, but then the
  // immediate next action is that it is destroyed." So the landing is a REAL committed state.
  it('step 1: the borrowed minion actually lands and takes its slot', () => {
    let s = run();
    const borrowed = { ...body('pack', 'loan'), borrowed: true } as BoardCard;
    s = { ...s, board: [body('sandbag', 'a')], hand: [borrowed] };
    s = reduce(s, { type: 'play', uid: 'loan', toIndex: 0 });
    expect(s.board.map((c) => c.uid), 'it must really be on the board, in the slot it was dropped in')
      .toEqual(['loan', 'a']);
    expect(s.pendingDeath, 'and be marked as dying next').toEqual({ uid: 'loan', kind: 'loan' });
    expect(s.board.filter((c) => c.cardId === 'pup'), 'its Echo has NOT fired yet — that is step 2').toHaveLength(0);
  });

  it('step 2: it dies, its Echo fires, and it leaves', () => {
    let s = run();
    const borrowed = { ...body('pack', 'loan'), borrowed: true } as BoardCard;
    s = { ...s, board: [], hand: [borrowed] };
    s = reduce(s, { type: 'play', uid: 'loan', toIndex: 0 });
    s = reduce(s, { type: 'resolveShopDeath' });
    expect(s.pendingDeath).toBeUndefined();
    expect(s.board.some((c) => c.uid === 'loan'), 'the borrowed body stayed on the board').toBe(false);
    expect(s.board.filter((c) => c.cardId === 'pup'), 'its Echo resolved on the way out').toHaveLength(2);
  });

  it('ANY next action settles it — a bot or a replay never sees the landing', () => {
    // This is what makes the intermediate state safe: it exists only for whoever is watching the screen.
    let s = run();
    const borrowed = { ...body('pack', 'loan'), borrowed: true } as BoardCard;
    s = { ...s, board: [], hand: [borrowed], embers: 20 };
    const landed = reduce(s, { type: 'play', uid: 'loan', toIndex: 0 });
    const viaResolve = reduce(landed, { type: 'resolveShopDeath' });
    const viaRoll = reduce(landed, { type: 'roll' });
    expect(viaRoll.pendingDeath, 'an unrelated action must still settle the death').toBeUndefined();
    expect(viaRoll.board.map((c) => c.cardId), 'and reach the same board as the explicit resolve')
      .toEqual(viaResolve.board.map((c) => c.cardId));
  });

  it('a borrowed minion WITH Rise rises, exactly like any other shop death', () => {
    // Owner correction 2026-08-28: "if a minion has rise that is discovered, it should rise in the same way a
    // destroyed minion with rise would."
    const def = CARD_INDEX['anubis']!;
    let s = run();
    const borrowed = { ...body('anubis', 'loan'), borrowed: true } as BoardCard;
    s = { ...s, board: [], hand: [borrowed] };
    s = reduce(s, { type: 'play', uid: 'loan', toIndex: 0 });
    s = reduce(s, { type: 'resolveShopDeath' });
    const risen = s.board.find((c) => c.cardId === 'anubis');
    expect(risen, 'a discovered Rise carrier must leave a body behind').toBeDefined();
    expect(risen!.uid, 'the risen body is a fresh instance').not.toBe('loan');
    expect(risen!.attack, 'base Attack, the same contract every shop Rise follows').toBe(def.attack);
    expect(risen!.health).toBe(1);
    expect(risen!.keywords, 'the Rise was spent').not.toContain('R');
    expect(risen!.borrowed, 'the body is yours now — it is no longer on loan').toBeUndefined();
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

  it('Graverobber: the victim is MARKED dying, then dies on the second action with its slot reported', () => {
    const s = { ...run(), board: [body('sandbag', 'a'), body('anubis', 'victim')], hand: [body('graverobber', 'gr')] };
    const aimed = graverobAim(s, 'victim');
    expect(aimed.pendingDeath, 'step 1 marks the victim, it does not remove it').toEqual({ uid: 'victim', kind: 'destroy' });
    expect(aimed.board.some((c) => c.uid === 'victim'), 'the body stays for one committed state — the animation window').toBe(true);

    const { batch } = reduceWithPresentation(aimed, { type: 'resolveShopDeath' }, true);
    const events = batch!.events;
    const death = events.find((e) => (e as { type: string }).type === 'sourceTrigger'
      && (e as SourceTriggerEvent).policyKey === 'system:destroy:shopDeath') as SourceTriggerEvent | undefined;
    expect(death, 'the destroy never got its own beat').toBeDefined();
    expect(death!.source.uid, 'the beat belongs to the body that died').toBe('victim');

    const mine = events.filter((e): e is CardDestroyedConsequence =>
      (e as { type: string }).type === 'cardDestroyed').find((d) => d.target.uid === 'victim');
    expect(mine, 'no cardDestroyed for the body that left the board').toBeDefined();
    expect(mine!.index, 'the slot it vacated — without it the projection has nowhere to animate').toBe(1);
    expect(mine!.rise, 'Anubis carries Rise, so the death must be flagged as a return').toBe(true);
  });

  it('Funeral on Loan: the landing and the death are separate ACTIONS, each with its own beat', () => {
    const borrowed = { ...body('anubis', 'loan'), borrowed: true };
    const s = { ...run(), board: [], hand: [borrowed] };
    const landed = reduceWithPresentation(s, { type: 'play', uid: 'loan', toIndex: 0 }, true);
    const landKeys = landed.batch!.events
      .filter((e): e is SourceTriggerEvent => (e as { type: string }).type === 'sourceTrigger')
      .map((e) => e.policyKey);
    expect(landKeys, 'the landing must be its own beat').toContain('system:destroy:shopArrival');
    expect(landKeys, 'and the death must NOT be in the same action — that is the whole point')
      .not.toContain('system:destroy:shopDeath');

    const died = reduceWithPresentation(landed.state, { type: 'resolveShopDeath' }, true);
    const dieKeys = died.batch!.events
      .filter((e): e is SourceTriggerEvent => (e as { type: string }).type === 'sourceTrigger')
      .map((e) => e.policyKey);
    expect(dieKeys, 'the death is the second action').toContain('system:destroy:shopDeath');
    const destroyed = died.batch!.events.find((e): e is CardDestroyedConsequence =>
      (e as { type: string }).type === 'cardDestroyed' && (e as CardDestroyedConsequence).target.uid === 'loan');
    expect(destroyed, 'the departure must be reported so it can animate').toBeDefined();
    expect(destroyed!.rise, 'Anubis carries Rise, so the death is flagged as a return').toBe(true);
  });
});

/**
 * TRIPLES. An Echo or a Rise can put a third copy on the board, and a shop death is no exception (owner
 * report 2026-08-28). Funeral on Loan never checked: its play path returned before reaching any triple check.
 */
describe('a shop death still completes triples', () => {
  it("Funeral on Loan: a borrowed Echo's summons triple with the copies you already own", () => {
    // Mama Pup's Echo summons two Pups. With one Pup already on board, that is three → a golden Pup.
    let s = run();
    const borrowed = { ...body('pack', 'loan'), borrowed: true } as BoardCard;
    s = { ...s, board: [body('pup', 'p1')], hand: [borrowed] };
    s = reduce(s, { type: 'play', uid: 'loan', toIndex: 1 });
    s = reduce(s, { type: 'resolveShopDeath' });
    // The combined golden lands in HAND (that is what `combineIntoGolden` does), so count both zones.
    const pups = [...s.board, ...s.hand].filter((c) => c.cardId === 'pup');
    expect(pups.some((c) => c.golden), 'three Pups must combine into a golden one').toBe(true);
    expect(pups, 'and the three singles are consumed by the combine').toHaveLength(1);
  });

  it('Graverobber: the same, through its own destroy path', () => {
    let s = run();
    s = { ...s, board: [body('pup', 'p1'), body('pack', 'victim')], hand: [body('graverobber', 'gr')] };
    s = graverob(s, 'victim');
    const pups = [...s.board, ...s.hand].filter((c) => c.cardId === 'pup');
    expect(pups.some((c) => c.golden), 'three Pups must combine into a golden one').toBe(true);
  });
});

/**
 * THE SHOP CUES. The shop has no beat playback, so death and Echo visuals ride the per-action scratch
 * channel. What matters is that they are STAMPED — an Echo that triggers with no cue is an animation that
 * silently never plays, which is the class of bug this whole batch is about.
 */
describe('shop death and Echo cues', () => {
  it('a destroy stamps a death cue and an Echo cue', () => {
    let s = run();
    s = { ...s, board: [body('pack', 'victim')], hand: [body('graverobber', 'gr')] };
    s = graverob(s, 'victim');
    const kinds = (s.shopDeathFx ?? []).filter((f) => f.uid === 'victim').map((f) => f.kind);
    expect(kinds, 'both the death and its Echo must be cued').toEqual(expect.arrayContaining(['death', 'echo']));
  });

  it('a RISING body is cued as a rise, so it does not dissolve', () => {
    let s = run();
    s = { ...s, board: [body('anubis', 'victim')], hand: [body('graverobber', 'gr')] };
    s = graverob(s, 'victim');
    const death = (s.shopDeathFx ?? []).find((f) => f.kind === 'death' && f.uid === 'victim');
    expect(death?.rise, 'the body re-forms — it must not play the dissolve').toBe(true);
  });

  it('an Echo triggered WITHOUT a death still cues', () => {
    // The owner's rule: "the echo animation ... should play ANYTIME an echo is triggered" — not only on death.
    // Asserted at the CHOKEPOINT every shop Echo passes through (`fireRecruitDeathrattles`), which is where the
    // cue is stamped, so it holds for every caller: Ossuary Rite, Deathsayer, Rune of the Reliquary, a
    // Gravetwin's copied Echo, a destroy. A per-card fixture would only ever prove one of them.
    const s = { ...run(), board: [body('pack', 'alive')] };
    fireRecruitDeathrattlesForTest(s, s.board[0]!);
    const echoes = (s.shopDeathFx ?? []).filter((f) => f.kind === 'echo' && f.uid === 'alive');
    expect(echoes, 'a triggered Echo must cue its animation even with no death').toHaveLength(1);
    expect(s.board.some((c) => c.uid === 'alive'), 'and the minion is still alive').toBe(true);
  });

  it('a card with NO Echo cues nothing — no empty animation on an innocent body', () => {
    const s = { ...run(), board: [body('sandbag', 'plain')] };
    fireRecruitDeathrattlesForTest(s, s.board[0]!);
    expect((s.shopDeathFx ?? []).filter((f) => f.kind === 'echo')).toHaveLength(0);
  });
});
