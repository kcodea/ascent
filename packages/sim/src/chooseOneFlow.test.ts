import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { chooseBothActive, chooseOneNeedsChoice, createRun, reduce, type BoardCard, type RunState } from './index';

/**
 * THE CHOOSE ONE FLOW (owner rulings 2026-08-28).
 *
 *  1. ALWAYS choose first, then target — one flow for every targeted Choose One: play → choose → target.
 *  2. A MINION Choose One is not summoned until the choice resolves; it waits in hand through the whole
 *     prompt, so nothing fires early and the summon's consequences all land once, afterwards.
 *  3. Clicking away CANCELS: the card returns to hand untouched — no effects, no Gold, no triggers, no RNG.
 *  4. When both branches are already enabled the prompt is SKIPPED and both resolve.
 *
 * Plus the compatibility contract: old recordings carry the OLD action shape (a `play` with `targetUid` for a
 * Choose One spell) and must still reproduce.
 */

const hand = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => ({
  uid, cardId, tribe: CARD_INDEX[cardId]!.tribe,
  attack: CARD_INDEX[cardId]!.attack, health: CARD_INDEX[cardId]!.health,
  keywords: [], golden: false, ...extra,
});

/** The three TARGETED Choose Ones: two spells (any / friendly) and one minion. */
const TARGETED = ['crestclimb', 'fieldmaneuvers', 'beetle'] as const;

const set2 = (over: Partial<RunState> = {}): RunState => ({ ...createRun(7, 'drakko'), setId: 'set2', ...over } as RunState);

describe('Choose One — the choice comes before the target', () => {
  it.each(TARGETED)('%s: playing it opens the PROMPT, never an aim', (id) => {
    const s0: RunState = {
      ...createRun(3),
      board: [{ uid: 'ally', cardId: 'alley', tribe: 'beast', attack: 4, health: 4, keywords: [], golden: false }],
      hand: [hand('c', id)],
    };
    const s1 = reduce(s0, { type: 'play', uid: 'c' });
    expect(s1.chooseOne?.cardId, 'the prompt must open first').toBe(id);
    expect(s1.pendingTarget, 'nothing may aim before a branch is chosen').toBeUndefined();
    // Nothing has been committed: the card is untouched in hand.
    expect(s1.hand.map((c) => c.uid)).toEqual(['c']);
    expect(s1.board.map((c) => c.uid)).toEqual(['ally']);

    const s2 = reduce(s1, { type: 'chooseOne', index: 0 });
    expect(s2.chooseOne).toBeUndefined();
    expect(s2.pendingTarget?.deferredPlay, 'now — and only now — it aims').toBe(true);
    expect(s2.hand.map((c) => c.uid), 'still unplayed while aiming').toEqual(['c']);

    const s3 = reduce(s2, { type: 'battlecryTarget', targetUid: 'ally' });
    expect(s3.pendingTarget).toBeUndefined();
    expect(s3.hand, 'the card resolved out of hand').toHaveLength(0);
  });

  it('a targeted Choose One spell is dragged up WITHOUT a target — the aim comes after the pick', () => {
    // Crest of the Climb (`any`) lands its +4 on the minion the AIM step picks, not one the drag chose.
    let s: RunState = {
      ...createRun(4),
      board: [
        { uid: 'a', cardId: 'alley', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false },
        { uid: 'b', cardId: 'alley', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false },
      ],
      hand: [hand('cc', 'crestclimb')],
    };
    s = reduce(s, { type: 'play', uid: 'cc' }); // no targetUid — the new gesture
    s = reduce(s, { type: 'chooseOne', index: 1 }); // +4 Health
    s = reduce(s, { type: 'battlecryTarget', targetUid: 'b' });
    expect(s.board.find((c) => c.uid === 'a')!.health, 'the unaimed minion is untouched').toBe(2);
    expect(s.board.find((c) => c.uid === 'b')!.health).toBe(6);
    expect(s.board.find((c) => c.uid === 'b')!.attack, 'the OTHER branch must not have resolved').toBe(2);
  });
});

describe('Choose One — a minion is not summoned until the choice resolves', () => {
  it('the body stays in hand through the prompt, then lands with its Battlecry — once', () => {
    // Wildwood Shaper's second branch summons a Stray. If the deferral re-ran any part of the play twice we
    // would see two Strays (or two entries in `playedThisTurn`); if it fired early we would see the Stray
    // before the pick.
    let s: RunState = { ...createRun(5), hand: [hand('ws', 'shaper')] };
    s = reduce(s, { type: 'play', uid: 'ws' });
    expect(s.board, 'nothing may be summoned before the choice').toHaveLength(0);
    expect(s.playedThisTurn ?? [], 'the play-count meter must not move either').toEqual([]);
    s = reduce(s, { type: 'chooseOne', index: 1 });
    expect(s.board.filter((c) => c.cardId === 'shaper')).toHaveLength(1);
    expect(s.board.filter((c) => c.cardId === 'stray'), 'the Battlecry fires exactly once').toHaveLength(1);
    expect(s.playedThisTurn, 'counted as played exactly once, after the choice').toEqual(['shaper']);
    expect(s.board.find((c) => c.cardId === 'shaper')!.chosenOption).toBe(1);
  });

  it('a FULL board refuses the play outright rather than prompting for a summon that cannot happen', () => {
    const full = Array.from({ length: 7 }, (_, i) => ({ uid: `f${i}`, cardId: 'alley', tribe: 'beast' as const, attack: 1, health: 1, keywords: [], golden: false }));
    const s0: RunState = { ...createRun(6), board: full, hand: [hand('ws', 'shaper')] };
    const s1 = reduce(s0, { type: 'play', uid: 'ws' });
    expect(s1, 'a refused play is the untouched state').toBe(s0);
  });
});

describe('Choose One — clicking away cancels', () => {
  /** Everything a cancel must leave EXACTLY as it was. */
  const fingerprint = (s: RunState) => ({
    hand: s.hand.map((c) => `${c.uid}:${c.cardId}:${c.attack}/${c.health}`),
    board: s.board.map((c) => `${c.uid}:${c.cardId}:${c.attack}/${c.health}`),
    gold: s.embers, rng: s.rngCursor, uid: s.uidSeq,
    played: [...(s.playedThisTurn ?? [])], cardsPlayed: s.cardsPlayedTotal, spellsCast: s.spellsCast,
    rubyBonus: s.rubyBonus, shoutsThisTurn: s.shoutsThisTurn,
  });

  it('from the CHOICE step — a minion Choose One', () => {
    const s0: RunState = {
      ...createRun(8), embers: 5,
      board: [{ uid: 'ally', cardId: 'alley', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false }],
      hand: [hand('ws', 'shaper'), hand('gf', 'godfodder')],
    };
    const before = fingerprint(s0);
    const opened = reduce(s0, { type: 'play', uid: 'ws' });
    expect(opened.chooseOne).toBeDefined();
    const back = reduce(opened, { type: 'cancelChoice' });
    expect(back.chooseOne, 'the prompt is closed').toBeUndefined();
    expect(back.pendingTarget).toBeUndefined();
    expect(fingerprint(back), 'a cancel is a pure no-op').toEqual(before);
    // …and the card is still playable afterwards.
    expect(reduce(back, { type: 'play', uid: 'ws' }).chooseOne?.cardId).toBe('shaper');
  });

  it('from the CHOICE step — a spell Choose One (no Gold moved, no cast counted)', () => {
    const s0: RunState = { ...set2({ embers: 6, hand: [hand('f', 'facetwright')] }) };
    const before = fingerprint(s0);
    const back = reduce(reduce(s0, { type: 'play', uid: 'f' }), { type: 'cancelChoice' });
    expect(back.chooseOne).toBeUndefined();
    expect(fingerprint(back)).toEqual(before);
  });

  it('from the TARGET step — the chosen-but-unplaced card returns to hand', () => {
    const s0: RunState = {
      ...createRun(9),
      board: [{ uid: 'ally', cardId: 'alley', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false }],
      hand: [hand('rb', 'beetle')],
    };
    const before = fingerprint(s0);
    const aiming = reduce(reduce(s0, { type: 'play', uid: 'rb' }), { type: 'chooseOne', index: 0 });
    expect(aiming.pendingTarget?.deferredPlay).toBe(true);
    const back = reduce(aiming, { type: 'cancelChoice' });
    expect(back.pendingTarget, 'the aim is dropped').toBeUndefined();
    expect(fingerprint(back), 'nothing was stranded and nothing resolved').toEqual(before);
  });

  it('never touches an ORDINARY battlecry aim — that body is already committed', () => {
    // Toxin Tender is on the board with a real pending aim. `cancelChoice` is scoped to the deferred Choose
    // One flow, so it must refuse here rather than silently dropping a Battlecry the player already paid for.
    const s0: RunState = {
      ...createRun(10),
      board: [{ uid: 'u', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false }],
      pendingTarget: { uid: 'x', cardId: 'alley' },
    };
    expect(reduce(s0, { type: 'cancelChoice' })).toBe(s0);
  });

  it('ending the turn during a deferred aim abandons it — it never auto-summons what was not confirmed', () => {
    let s: RunState = {
      ...createRun(11),
      board: [{ uid: 'ally', cardId: 'alley', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false }],
      hand: [hand('rb', 'beetle')],
    };
    s = reduce(reduce(s, { type: 'play', uid: 'rb' }), { type: 'chooseOne', index: 0 });
    s = reduce(s, { type: 'faceOmen' });
    expect(s.pendingTarget).toBeUndefined();
    expect(s.board.some((c) => c.cardId === 'beetle'), 'never summoned').toBe(false);
    expect(s.hand.some((c) => c.uid === 'rb'), 'kept, to play next turn').toBe(true);
  });
});

describe('(Both) — the prompt is skipped when every branch is already on', () => {
  it('the predicate covers all three sources, and only them', () => {
    const orivax = CARD_INDEX['d2_orivax']!;
    expect(chooseBothActive({}, { golden: true }, orivax)).toBe(true);
    expect(chooseBothActive({}, { golden: false }, orivax)).toBe(false);
    expect(chooseBothActive({ runeFacetwright: true }, undefined, CARD_INDEX['facetwright'])).toBe(true);
    expect(chooseBothActive({ runeUnbrokenVein: true }, undefined, CARD_INDEX['k_veinbreaker'])).toBe(true);
    // Never leaks onto another Choose One, and never onto a card without one.
    expect(chooseBothActive({ runeFacetwright: true, runeUnbrokenVein: true }, { golden: true }, CARD_INDEX['shaper'])).toBe(false);
    expect(chooseBothActive({ runeFacetwright: true }, { golden: true }, CARD_INDEX['alley'])).toBe(false);
    // `chooseOneNeedsChoice` is its exact complement, for cards that have a Choose One at all.
    expect(chooseOneNeedsChoice({}, { golden: false }, orivax)).toBe(true);
    expect(chooseOneNeedsChoice({}, { golden: true }, orivax)).toBe(false);
    expect(chooseOneNeedsChoice({}, undefined, CARD_INDEX['alley'])).toBe(false);
  });

  it('a GOLDEN Orivax plays straight through and installs both modes', () => {
    const s0: RunState = { ...set2({ hand: [hand('o', 'd2_orivax', { golden: true })] }) };
    const s = reduce(s0, { type: 'play', uid: 'o' });
    expect(s.chooseOne, 'a (Both) card must never prompt').toBeUndefined();
    expect(s.board.map((c) => c.cardId)).toEqual(['d2_orivax']);
    expect(s.board[0]!.chosenOption, 'it became neither branch — it gained them all').toBeUndefined();
    expect(s.shoutExtraAlways ?? 0, 'branch A installed').toBeGreaterThan(0);
    expect(s.spellFirstMultEachTurn ?? 1, 'branch B installed').toBeGreaterThan(1);
  });

  it('a Veinbreaker under the Rune of the Unbroken Vein plays straight through and does both', () => {
    const s0: RunState = { ...set2({ runeUnbrokenVein: true, hand: [hand('v', 'k_veinbreaker')] }) };
    const s = reduce(s0, { type: 'play', uid: 'v' });
    expect(s.chooseOne).toBeUndefined();
    expect(s.rubyBonus, 'branch A — Rubies grew').toEqual({ attack: 1, health: 1 });
    expect(s.hand.filter((c) => CARD_INDEX[c.cardId]?.ruby).length, 'branch B — four Rubies').toBe(4);
  });
});

describe('Choose One — old recordings still reproduce', () => {
  /** Replay an action trail exactly as `replayActions` would. */
  const replay = (start: RunState, actions: Parameters<typeof reduce>[1][]): RunState =>
    actions.reduce((s, a) => reduce(s, a), start);

  it('a LEGACY targeted spell (play carrying its targetUid) resolves target-first, and counts once', () => {
    // The pre-2026-08-28 shape: the drag aimed, so `play` carried `targetUid` and the prompt opened with the
    // target already pinned. Kept working verbatim — an old `replayActions` log is re-executed, not migrated.
    const s0: RunState = {
      ...createRun(12),
      board: [{ uid: 'ally', cardId: 'alley', tribe: 'beast', attack: 3, health: 3, keywords: [], golden: false }],
      hand: [hand('cc', 'crestclimb')],
    };
    const s = replay(s0, [
      { type: 'play', uid: 'cc', targetUid: 'ally' },
      { type: 'chooseOne', index: 0 }, // +4 Attack
    ]);
    expect(s.board[0]!.attack).toBe(7);
    expect(s.board[0]!.health, 'only the picked branch').toBe(3);
    expect(s.hand, 'the spell was consumed').toHaveLength(0);
    expect(s.playedThisTurn, 'counted as played exactly once — not once per step').toEqual(['crestclimb']);
    expect(s.cardsPlayedTotal ?? 0, 'the cards-played meter moved exactly once').toBe(1);
  });

  it('a legacy MINION trail (play → chooseOne → battlecryTarget) reaches the same board', () => {
    // The minion trail's action SHAPE is unchanged by the deferral — only the moment the body appears moved —
    // so an old recording of Runic Beetle replays through the new flow and lands identically.
    const s0: RunState = {
      ...createRun(13),
      board: [{ uid: 'ally', cardId: 'alley', tribe: 'beast', attack: 3, health: 3, keywords: [], golden: false }],
      hand: [hand('rb', 'beetle')],
    };
    const s = replay(s0, [
      { type: 'play', uid: 'rb', toIndex: 0 },
      { type: 'chooseOne', index: 0 }, // Rise + +1/+1
      { type: 'battlecryTarget', targetUid: 'ally' },
    ]);
    expect(s.board.map((c) => c.uid), 'landed at the recorded slot').toEqual(['rb', 'ally']);
    const ally = s.board.find((c) => c.uid === 'ally')!;
    expect(ally.attack).toBe(4);
    expect(ally.health).toBe(4);
    expect(ally.keywords).toContain('R');
    expect(s.playedThisTurn).toEqual(['beetle']);
  });

  it('opening and cancelling draws no RNG and mints no uid — a replay of it diverges from nothing', () => {
    const s0: RunState = { ...createRun(14), hand: [hand('ws', 'shaper')] };
    const cancelled = replay(s0, [{ type: 'play', uid: 'ws' }, { type: 'cancelChoice' }]);
    expect(cancelled.rngCursor).toBe(s0.rngCursor);
    expect(cancelled.uidSeq).toBe(s0.uidSeq);
    // Playing it for real afterwards reaches the same state as if the cancel had never happened.
    const direct = replay(s0, [{ type: 'play', uid: 'ws' }, { type: 'chooseOne', index: 1 }]);
    const after = replay(cancelled, [{ type: 'play', uid: 'ws' }, { type: 'chooseOne', index: 1 }]);
    expect(after.rngCursor).toBe(direct.rngCursor);
    expect(after.uidSeq).toBe(direct.uidSeq);
    expect(after.board.map((c) => c.cardId)).toEqual(direct.board.map((c) => c.cardId));
  });
});
