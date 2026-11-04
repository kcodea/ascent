import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, type Action, type BoardCard, type RunState } from './state';
import { reduce } from './reducer';

/**
 * R-TARGET-CANCEL-01 / R-TIMER-AIM-01 (owner 2026-11-03): "both choose one and shouts etc should be able to click back
 * and not play the card/send it back to hand", and the clock running under an aim can reach 0:00 there.
 *
 * An aimed play is HELD: the card stays in hand and nothing moves until the pick. These drive the real reducer.
 */

const card = (uid: string, cardId: string): BoardCard => ({
  uid, cardId, tribe: CARD_INDEX[cardId]!.tribe, attack: 3, health: 3, keywords: [], golden: false,
});

/** Everything a cancelled play must leave exactly as it was. */
const fingerprint = (s: RunState) => ({
  hand: s.hand.map((c) => `${c.uid}:${c.attack}/${c.health}`),
  board: s.board.map((c) => `${c.uid}:${c.attack}/${c.health}:${c.keywords.join('')}:${c.sellBonus ?? 0}`),
  shop: s.shop.map((c) => c.uid),
  gold: s.embers, rng: s.rngCursor, uid: s.uidSeq,
  played: [...(s.playedThisTurn ?? [])], total: s.cardsPlayedTotal, shouts: s.shoutsThisTurn ?? 0,
  spells: s.spellsCast,
});

/** Appetite Agent (a Demon-only aimed Shout) in hand, a Demon and a Beast on the board. */
const agentRun = (seed = 3): RunState => ({
  ...createRun(seed), embers: 20,
  board: [card('d', 'impoverseer'), card('b', 'venom')],
  hand: [card('a', 'dm_agent'), card('z', 'stray')],
});

const go = (s: RunState, ...actions: Action[]): RunState => actions.reduce(reduce, s);

describe('R-TARGET-CANCEL-01: an aimed Shout is held in hand until the pick', () => {
  it('opening the aim moves nothing: no board slot, no meter, no RNG', () => {
    const s = agentRun();
    const held = reduce(s, { type: 'play', uid: 'a', toIndex: 1 });
    expect(held.pendingTarget).toMatchObject({ uid: 'a', deferredPlay: true, shoutAim: true, toIndex: 1 });
    expect(fingerprint(held)).toEqual(fingerprint(s));
  });

  it('a cancel is a pure no-op, and the card can be played again', () => {
    const s = agentRun();
    const back = go(s, { type: 'play', uid: 'a' }, { type: 'cancelChoice' });
    expect(back.pendingTarget).toBeUndefined();
    expect(fingerprint(back)).toEqual(fingerprint(s));
    expect(reduce(back, { type: 'play', uid: 'z' }).board.some((c) => c.uid === 'z'), 'the Shop is unlocked').toBe(true);
  });

  it('the pick plays the card in its slot, once, and a cancelled try changes nothing about that', () => {
    const pick: Action[] = [{ type: 'play', uid: 'a', toIndex: 1 }, { type: 'battlecryTarget', targetUid: 'd' }];
    const straight = go(agentRun(), ...pick);
    const retried = go(agentRun(), { type: 'play', uid: 'a', toIndex: 0 }, { type: 'cancelChoice' }, ...pick);
    expect(straight.board.map((c) => c.uid)).toEqual(['d', 'a', 'b']);
    expect(straight.playedThisTurn, 'one play').toEqual(['dm_agent']);
    expect(straight.pendingTarget).toBeUndefined();
    expect(straight.aimPick, 'the scratch never outlives the action').toBeUndefined();
    expect(fingerprint(retried)).toEqual(fingerprint(straight));
  });

  it('a refused pick leaves the prompt up and the card in hand', () => {
    const held = reduce(agentRun(), { type: 'play', uid: 'a' });
    expect(reduce(held, { type: 'battlecryTarget', targetUid: 'b' }), 'off-tribe').toBe(held);
    expect(reduce(held, { type: 'battlecryTarget', targetUid: 'a' }), 'itself').toBe(held);
    expect(reduce(held, { type: 'battlecryTarget', targetUid: 'nobody' }), 'nothing there').toBe(held);
  });

  it('a pick is refused when no legal target is left: the card is not played as a plain body', () => {
    const held = reduce(agentRun(), { type: 'play', uid: 'a' });
    const gone: RunState = { ...held, board: held.board.filter((c) => c.uid !== 'd') }; // only the Beast remains
    expect(reduce(gone, { type: 'battlecryTarget', targetUid: 'b' })).toBe(gone);
    expect(reduce(gone, { type: 'cancelChoice' }).pendingTarget, 'and it can still back out').toBeUndefined();
  });

  it('a full board refuses the play outright, with no prompt', () => {
    const s: RunState = { ...agentRun(), board: Array.from({ length: 7 }, (_, i) => card(`m${i}`, 'impoverseer')) };
    expect(reduce(s, { type: 'play', uid: 'a' })).toBe(s);
  });

  it('a card that leaves the hand under the aim takes the aim with it', () => {
    const held = reduce(agentRun(), { type: 'play', uid: 'a' });
    const after = reduce({ ...held, hand: held.hand.filter((c) => c.uid !== 'a') }, { type: 'battlecryTarget', targetUid: 'd' });
    expect(after.pendingTarget).toBeUndefined();
  });

  it('the per-play hooks hear a Choose One commit once and a cancel never (Trail Forager)', () => {
    const forager = (cardId: string): RunState => ({
      ...createRun(5), embers: 5,
      board: [card('f', 'trailforager'), card('t', 'alley')],
      hand: [card('p', cardId)],
    });
    const bonus = (s: RunState): number => s.board.find((c) => c.uid === 'f')!.sellBonus ?? 0;
    expect(bonus(go(forager('beetle'), { type: 'play', uid: 'p' }, { type: 'cancelChoice' })), 'Choose One, cancelled').toBe(0);
    expect(bonus(go(forager('beetle'), { type: 'play', uid: 'p' }, { type: 'chooseOne', index: 0 }, { type: 'cancelChoice' })), 'Choose One, cancelled at the aim').toBe(0);
    expect(bonus(go(forager('beetle'), { type: 'play', uid: 'p' }, { type: 'chooseOne', index: 0 }, { type: 'battlecryTarget', targetUid: 't' })), 'Choose One, played').toBe(1);
  });

  it('a per-play quest ticks on the commit, and never on an aimed Shout that was cancelled', () => {
    const s: RunState = { ...agentRun(), activeQuests: [{ questId: 'hq_spare_forge', progress: 0, completed: false }] };
    const step = (r: RunState): number => r.activeQuests![0]!.progress;
    expect(step(go(s, { type: 'play', uid: 'a' }, { type: 'cancelChoice' })), 'cancelled').toBe(0);
    expect(step(go(s, { type: 'play', uid: 'a' }, { type: 'battlecryTarget', targetUid: 'd' })), 'played').toBe(1);
  });

  it('a Rune of Refrain roll waits for the pick, off the same cursor', () => {
    const s: RunState = { ...agentRun(), runeRefrain: true, ownedRunes: ['rune_refrain'] };
    const held = reduce(s, { type: 'play', uid: 'a' });
    expect(held.rngCursor).toBe(s.rngCursor);
    const done = reduce(held, { type: 'battlecryTarget', targetUid: 'd' });
    expect(done.rngCursor, 'the Shout fired, so the rune rolled').not.toBe(s.rngCursor);
  });

  it('Common Ground: the second pick can be cancelled, with the card and every meter untouched', () => {
    const s: RunState = { ...agentRun(), board: [card('x', 'alley'), card('y', 'alley')], hand: [card('cg', 'commonground')] };
    const held = reduce(s, { type: 'play', uid: 'cg', targetUid: 'x' });
    expect(held.pendingTarget).toMatchObject({ spell: true, spellFirstUid: 'x', deferredPlay: true });
    expect(fingerprint(held)).toEqual(fingerprint(s));
    expect(fingerprint(reduce(held, { type: 'cancelChoice' }))).toEqual(fingerprint(s));
    const cast = reduce(held, { type: 'battlecryTarget', targetUid: 'y' });
    expect(cast.hand).toEqual([]);
    expect(cast.playedThisTurn).toEqual(['commonground']);
    expect(cast.cardsPlayedTotal, 'the play meter ran once').toBe((s.cardsPlayedTotal ?? 0) + 1);
  });

  it('a committed aim from an older save still resolves, and still cannot be cancelled', () => {
    const s: RunState = { ...agentRun(), board: [card('d', 'impoverseer'), card('a', 'dm_agent')], hand: [], pendingTarget: { uid: 'a', cardId: 'dm_agent' } };
    expect(reduce(s, { type: 'cancelChoice' })).toBe(s);
    expect(reduce(s, { type: 'battlecryTarget', targetUid: 'd' }).pendingTarget).toBeUndefined();
  });
});

describe('R-TIMER-AIM-01: 0:00 under an aim', () => {
  it('closes a held Shout like a cancel: back in hand, nothing paid, the lock on', () => {
    const s = agentRun();
    const out = go(s, { type: 'play', uid: 'a' }, { type: 'shopClockExpired' });
    expect(out.pendingTarget).toBeUndefined();
    expect(out.shopClockExpired).toBe(true);
    expect(fingerprint(out)).toEqual(fingerprint(s));
    expect(reduce(out, { type: 'play', uid: 'a' }), 'plays are locked').toBe(out);
    expect(reduce(out, { type: 'faceOmen' }).phase, 'End Turn still works').not.toBe('recruit');
  });

  it('closes a Choose One aim the same way', () => {
    const s: RunState = { ...createRun(21), embers: 5, board: [card('x', 'alley'), card('y', 'alley')], hand: [card('rb', 'beetle')] };
    const out = go(s, { type: 'play', uid: 'rb' }, { type: 'chooseOne', index: 0 }, { type: 'shopClockExpired' });
    expect(out.pendingTarget).toBeUndefined();
    expect(fingerprint(out)).toEqual(fingerprint(s));
  });

  it('leaves a committed aim from an older save for End Turn', () => {
    const s: RunState = { ...agentRun(), board: [card('d', 'impoverseer'), card('a', 'dm_agent')], hand: [], pendingTarget: { uid: 'a', cardId: 'dm_agent' } };
    expect(reduce(s, { type: 'shopClockExpired' }).pendingTarget, 'its body is already on the board').toBeTruthy();
  });
});

describe('R-TARGET-07: a held Shout the turn ends on', () => {
  it('completes on a random legal target and the turn still ends, the same on every run of the seed', () => {
    const end = (): RunState => go(agentRun(9), { type: 'play', uid: 'a' }, { type: 'faceOmen' });
    const a = end();
    expect(a.phase).not.toBe('recruit');
    expect(a.pendingTarget).toBeUndefined();
    expect(a.aimPick).toBeUndefined();
    expect(a.hand.some((c) => c.uid === 'a'), 'it was played').toBe(false);
    expect(a.playedThisTurn ?? ['dm_agent']).toContain('dm_agent');
    expect(end().rngCursor, 'seeded').toBe(a.rngCursor);
  });
});
