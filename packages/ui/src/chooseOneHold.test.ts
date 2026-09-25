import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from '@game/sim';
import { chooseOneHeldSlot } from './chooseOneHold';

/**
 * THE CHOOSE ONE HOLD (owner bug 2026-09-25, verbatim): *"for choose ones, after choosing a choose one option,
 * the card is sent back to hand. the card should stay on board like it is during the choose animation for that
 * targeting animation, too, and only go back to hand if i cancel the targeting animation or w/e the action is."*
 *
 * The reducer never moved the card (a Choose One commits nothing until it resolves, so it sits in `run.hand`
 * throughout, with its drop slot carried on `pendingTarget.toIndex`). The board only PREVIEWED it while
 * `run.chooseOne` was open, so picking a targeted branch dropped the preview and the card popped back into
 * the hand, beam and all. `chooseOneHeldSlot` is the one gate both the board splice and the hand row read;
 * these tests drive the real reducer through every path and pin what the gate says at each step.
 */

const card = (uid: string, cardId: string): BoardCard => ({
  uid, cardId, tribe: CARD_INDEX[cardId]!.tribe,
  attack: CARD_INDEX[cardId]!.attack, health: CARD_INDEX[cardId]!.health,
  keywords: [], golden: false,
});

/** Everything a cancel must leave exactly as it was. */
const fingerprint = (s: RunState) => ({
  hand: s.hand.map((c) => `${c.uid}:${c.cardId}:${c.attack}/${c.health}`),
  board: s.board.map((c) => `${c.uid}:${c.cardId}:${c.attack}/${c.health}:${c.keywords.join('')}`),
  gold: s.embers, rng: s.rngCursor, uid: s.uidSeq,
  played: [...(s.playedThisTurn ?? [])], cardsPlayed: s.cardsPlayedTotal,
});

/** Two friendly Beasts, Runic Beetle in hand (Choose One, both branches aim a friendly Beast). */
const beetleRun = (): RunState => ({
  ...createRun(21), embers: 5,
  board: [card('a', 'alley'), card('b', 'alley')],
  hand: [card('rb', 'beetle')],
});

describe('Choose One hold — the card keeps its board slot through the targeting step', () => {
  it('Choose One → target → commit: held at the drop slot through both steps, then lands there', () => {
    const s0 = beetleRun();
    expect(chooseOneHeldSlot(s0)).toBeNull();

    const prompt = reduce(s0, { type: 'play', uid: 'rb', toIndex: 1 });
    expect(chooseOneHeldSlot(prompt), 'held during the prompt').toEqual({ uid: 'rb', toIndex: 1 });

    const aiming = reduce(prompt, { type: 'chooseOne', index: 0 });
    expect(aiming.chooseOne).toBeUndefined();
    expect(aiming.pendingTarget?.deferredPlay).toBe(true);
    expect(chooseOneHeldSlot(aiming), 'STILL held at the same slot while aiming (the bug)').toEqual({ uid: 'rb', toIndex: 1 });
    // The sim keeps it in hand (nothing committed); the board only shows it there.
    expect(aiming.hand.map((c) => c.uid)).toEqual(['rb']);
    expect(aiming.board.map((c) => c.uid)).toEqual(['a', 'b']);

    const done = reduce(aiming, { type: 'battlecryTarget', targetUid: 'b' });
    expect(chooseOneHeldSlot(done), 'nothing is held once the play commits').toBeNull();
    expect(done.board.map((c) => c.uid), 'it lands in the slot it was held in').toEqual(['a', 'rb', 'b']);
    expect(done.hand).toHaveLength(0);
    const b = done.board.find((c) => c.uid === 'b')!;
    const base = CARD_INDEX['alley']!;
    expect([b.attack, b.health], 'Rise + +1/+1 landed on the picked target').toEqual([base.attack + 1, base.health + 1]);
    expect(done.board.find((c) => c.uid === 'a')!.attack, 'the other Beast is untouched').toBe(base.attack);
    expect(b.keywords).toContain('R');
    expect(done.playedThisTurn).toEqual(['beetle']);
  });

  it('Choose One → cancel at targeting: back in hand, state unchanged', () => {
    const s0 = beetleRun();
    const before = fingerprint(s0);
    const aiming = reduce(reduce(s0, { type: 'play', uid: 'rb', toIndex: 0 }), { type: 'chooseOne', index: 1 });
    expect(chooseOneHeldSlot(aiming)).toEqual({ uid: 'rb', toIndex: 0 });
    const back = reduce(aiming, { type: 'cancelChoice' });
    expect(chooseOneHeldSlot(back), 'released only by the cancel').toBeNull();
    expect(back.pendingTarget).toBeUndefined();
    expect(fingerprint(back), 'no Gold, no counters, no RNG, no board change').toEqual(before);
  });

  it('Choose One → cancel at the prompt: back in hand, state unchanged', () => {
    const s0 = beetleRun();
    const before = fingerprint(s0);
    const back = reduce(reduce(s0, { type: 'play', uid: 'rb', toIndex: 2 }), { type: 'cancelChoice' });
    expect(chooseOneHeldSlot(back)).toBeNull();
    expect(fingerprint(back)).toEqual(before);
  });

  it('a Choose One branch with no target commits immediately at the drop slot', () => {
    // Wildwood Shaper: neither branch aims, so the pick replays the play straight away.
    const s0: RunState = { ...createRun(22), board: [card('a', 'alley'), card('b', 'alley')], hand: [card('ws', 'shaper')] };
    const prompt = reduce(s0, { type: 'play', uid: 'ws', toIndex: 1 });
    expect(chooseOneHeldSlot(prompt)).toEqual({ uid: 'ws', toIndex: 1 });
    const done = reduce(prompt, { type: 'chooseOne', index: 0 });
    expect(done.pendingTarget, 'no aim step').toBeUndefined();
    expect(chooseOneHeldSlot(done)).toBeNull();
    expect(done.board.map((c) => c.uid).slice(0, 3)).toEqual(['a', 'ws', 'b']);
  });

  it('a plain targeted Battlecry is really on the board while it aims — nothing to hold', () => {
    // Twilight Emissary: an ordinary targeted Battlecry commits its body at play time, so the board shows the
    // real card and the gate stays out of it (it only covers the DEFERRED Choose One aim).
    const s0: RunState = { ...createRun(23), board: [card('d', 'emissary')], hand: [card('e', 'emissary')] };
    const aiming = reduce(s0, { type: 'play', uid: 'e', toIndex: 0 });
    expect(aiming.pendingTarget?.uid).toBe('e');
    expect(aiming.pendingTarget?.deferredPlay).toBeFalsy();
    expect(aiming.board.map((c) => c.uid), 'body committed at the drop slot').toEqual(['e', 'd']);
    expect(chooseOneHeldSlot(aiming)).toBeNull();
    const done = reduce(aiming, { type: 'battlecryTarget', targetUid: 'd' });
    expect(done.pendingTarget).toBeUndefined();
    expect(done.board.map((c) => c.uid)).toEqual(['e', 'd']);
  });

  it('a spell or an Equipment is never held (no slot, no card)', () => {
    expect(chooseOneHeldSlot({ chooseOne: { uid: 's', cardId: 'crestclimb', spell: true } } as RunState)).toBeNull();
    expect(chooseOneHeldSlot({ chooseOne: { uid: 'q', cardId: '', equipmentId: 'x' } } as unknown as RunState)).toBeNull();
    expect(chooseOneHeldSlot({ pendingTarget: { uid: 's', cardId: 'crestclimb', spell: true, deferredPlay: true } } as RunState)).toBeNull();
    // Common Ground's second pick is a spell aim, not a deferred play.
    expect(chooseOneHeldSlot({ pendingTarget: { uid: 's', cardId: 'x', spell: true, spellFirstUid: 'a' } } as RunState)).toBeNull();
  });

  it('Recruit reads the gate for the board splice, the hand row, and both cancel paths', () => {
    const RECRUIT = readFileSync(join(__dirname, 'Recruit.tsx'), 'utf8');
    expect(RECRUIT).toContain('chooseOneHeldSlot({ chooseOne: run.chooseOne, pendingTarget: run.pendingTarget })');
    expect(RECRUIT).toContain('const chooseOnePreviewUid = chooseOneHeld?.uid;');
    // The aim step's click-away cancel captures the Flip state first, so the card glides home too.
    expect(RECRUIT).toContain("if (pendingTarget.deferredPlay) { captureCoalesce(); dispatch({ type: 'cancelChoice' }); }");
  });
});
