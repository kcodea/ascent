import { describe, it, expect } from 'vitest';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { mintRubies, applyCardsBought, applyEndOfTurn, RUBY_ID } from './recruit';

/**
 * The Ruby engine (set 2 Kobolds). Rubies are a spell-LIKE token that is NOT a Shop Spell: minted into hand,
 * played onto a friendly minion to grant it the Ruby's stats as a permanent shop buff, tracked on its OWN cast
 * counter so Shop-Spell triggers never see them. These pin the recruit-phase spine before the Kobold cards +
 * UI layer on top of it.
 */
const mkMinion = (uid: string): BoardCard => ({ uid, cardId: 'sandbag', tribe: 'neutral', attack: 2, health: 2, keywords: [], golden: false });

describe('Ruby engine (set 2)', () => {
  it('mints Rubies into hand at base 1/1', () => {
    const s = createRun(1);
    mintRubies(s, 2);
    const rubies = s.hand.filter((c) => c.cardId === RUBY_ID);
    expect(rubies.length).toBe(2);
    expect(rubies.every((r) => r.attack === 1 && r.health === 1)).toBe(true);
  });

  it('a Ruby played from hand grants a friendly minion its stats as a "Ruby" buff, then is consumed', () => {
    let s: RunState = { ...createRun(1), board: [mkMinion('m1')], hand: [] };
    mintRubies(s, 1);
    const ruby = s.hand.find((c) => c.cardId === RUBY_ID)!;
    const spellsBefore = s.spellsCast;
    s = reduce(s, { type: 'play', uid: ruby.uid, targetUid: 'm1' });
    const target = s.board.find((c) => c.uid === 'm1')!;
    expect([target.attack, target.health]).toEqual([3, 3]); // 2/2 + 1/1
    expect(target.buffs?.find((b) => b.source === 'Ruby')).toMatchObject({ attack: 1, health: 1 });
    expect(s.hand.find((c) => c.uid === ruby.uid)).toBeUndefined(); // consumed
    expect(s.rubyCasts).toBe(1);
    expect(s.spellsCast).toBe(spellsBefore); // NOT a Shop Spell — the spell-cast counter is untouched
  });

  it('a Ruby with no valid target fizzles and stays in hand', () => {
    let s: RunState = { ...createRun(1), board: [], hand: [] };
    mintRubies(s, 1);
    const ruby = s.hand.find((c) => c.cardId === RUBY_ID)!;
    s = reduce(s, { type: 'play', uid: ruby.uid, targetUid: 'nope' });
    expect(s.hand.some((c) => c.uid === ruby.uid)).toBe(true); // kept
    expect(s.rubyCasts ?? 0).toBe(0);
  });

  it('a Ruby (target any) can be cast on a tavern OFFER — buffs it pre-buy', () => {
    const base = createRun(1);
    const offer = base.shop[0]!; // the shop holds minion offers; the tavern spell is separate (run.spell)
    let s: RunState = { ...base, hand: [] };
    mintRubies(s, 1);
    const ruby = s.hand.find((c) => c.cardId === RUBY_ID)!;
    s = reduce(s, { type: 'play', uid: ruby.uid, targetUid: offer.uid });
    const o = s.shop.find((x) => x.uid === offer.uid)!;
    expect([o.atk ?? 0, o.hp ?? 0]).toEqual([1, 1]);
    expect(o.buffs?.find((b) => b.source === 'Ruby')).toMatchObject({ attack: 1, health: 1 });
    expect(s.hand.some((c) => c.cardId === RUBY_ID)).toBe(false); // consumed
  });

  it("Chipwick Prospector's Shout mints 2 Rubies into hand (card → getRubies factory → engine)", () => {
    let s: RunState = { ...createRun(1), board: [], hand: [{ uid: 'ch', cardId: 'k_chipwick', tribe: 'kobold', attack: 1, health: 2, keywords: [], golden: false }] };
    s = reduce(s, { type: 'play', uid: 'ch' });
    expect(s.hand.filter((c) => c.cardId === RUBY_ID).length).toBe(2);
    expect(s.board.some((c) => c.cardId === 'k_chipwick')).toBe(true); // Chipwick itself played to board
  });

  it('Deepvein Tender grows Rubies already in HAND and future ones (owner: not future-only)', () => {
    let s: RunState = { ...createRun(1), board: [], hand: [] };
    mintRubies(s, 1); // a Ruby already in hand at base 1/1
    s.hand.push({ uid: 'dv', cardId: 'k_deepvein', tribe: 'kobold', attack: 2, health: 3, keywords: [], golden: false });
    s = reduce(s, { type: 'play', uid: 'dv' }); // Shout: your Rubies gain +0/+1
    expect(s.rubyBonus).toMatchObject({ attack: 0, health: 1 });
    const handRuby = s.hand.find((c) => c.cardId === RUBY_ID)!;
    expect([handRuby.attack, handRuby.health]).toEqual([1, 2]); // the ALREADY-HELD Ruby grew
    mintRubies(s, 1);
    expect(s.hand.filter((c) => c.cardId === RUBY_ID).every((r) => r.attack === 1 && r.health === 2)).toBe(true); // future too
  });

  it('cardsBoughtThisTurn increments on buy (Frenzied Excavator scaler plumbing)', () => {
    let s = createRun(1);
    expect(s.cardsBoughtThisTurn ?? 0).toBe(0);
    s = reduce(s, { type: 'buy', uid: s.shop[0]!.uid });
    expect(s.cardsBoughtThisTurn).toBe(1);
  });

  it('Hoardmaster Krik mints a Ruby every 3 cards bought', () => {
    const s: RunState = { ...createRun(1), board: [{ uid: 'k', cardId: 'k_hoardmaster', tribe: 'kobold', attack: 5, health: 9, keywords: [], golden: false }], hand: [] };
    applyCardsBought(s, 2); // 2 buys → not yet
    expect(s.hand.filter((c) => c.cardId === RUBY_ID).length).toBe(0);
    applyCardsBought(s, 1); // the 3rd buy → mint a Ruby
    expect(s.hand.filter((c) => c.cardId === RUBY_ID).length).toBe(1);
    applyCardsBought(s, 3); // 3 more → another
    expect(s.hand.filter((c) => c.cardId === RUBY_ID).length).toBe(2);
  });

  it('Resonance Idol bounces a played Ruby to both adjacent minions', () => {
    const mk = (uid: string, cardId: string): BoardCard => ({ uid, cardId, tribe: 'kobold', attack: 2, health: 2, keywords: [], golden: false });
    let s: RunState = { ...createRun(1), board: [mk('a', 'sandbag'), mk('idol', 'k_resonance'), mk('b', 'sandbag')], hand: [] };
    mintRubies(s, 1);
    const ruby = s.hand.find((c) => c.cardId === RUBY_ID)!;
    s = reduce(s, { type: 'play', uid: ruby.uid, targetUid: 'idol' });
    expect([s.board.find((c) => c.uid === 'idol')!.attack, s.board.find((c) => c.uid === 'idol')!.health]).toEqual([3, 3]); // 2/2 + Ruby
    expect([s.board.find((c) => c.uid === 'a')!.attack, s.board.find((c) => c.uid === 'a')!.health]).toEqual([3, 3]); // bounced
    expect([s.board.find((c) => c.uid === 'b')!.attack, s.board.find((c) => c.uid === 'b')!.health]).toEqual([3, 3]); // bounced
  });

  it('Ruby Broker gives 3 Gold per Ruby, capped twice per turn', () => {
    let s: RunState = { ...createRun(1), board: [{ uid: 'bk', cardId: 'k_rubybroker', tribe: 'kobold', attack: 2, health: 6, keywords: [], golden: false }], hand: [], embers: 0 };
    mintRubies(s, 3);
    const rubies = s.hand.filter((c) => c.cardId === RUBY_ID).map((c) => c.uid);
    for (const uid of rubies) s = reduce(s, { type: 'play', uid, targetUid: 'bk' });
    expect(s.embers).toBe(6); // 2 procs × 3 Gold; the 3rd Ruby is over the per-turn cap
  });

  it('Pouchpincher grants the set-1 Gold Pouch spell to hand (crossover card)', () => {
    let s: RunState = { ...createRun(1), board: [], hand: [{ uid: 'p', cardId: 'k_pouchpincher', tribe: 'kobold', attack: 4, health: 2, keywords: [], golden: false }] };
    s = reduce(s, { type: 'play', uid: 'p' });
    expect(s.hand.some((c) => c.cardId === 'emberpouch')).toBe(true); // the set-1 Gold Pouch
  });

  it('Candle Conduit casts a Ruby on a random Kobold when you get a Ruby', () => {
    const mk = (uid: string, cardId: string): BoardCard => ({ uid, cardId, tribe: 'kobold', attack: 2, health: 2, keywords: [], golden: false });
    const s: RunState = { ...createRun(1), board: [mk('cc', 'k_candleconduit'), mk('k2', 'sandbag')], hand: [] };
    const before = s.board.reduce((sum, c) => sum + c.attack + c.health, 0);
    mintRubies(s, 1); // getting a Ruby → Candle Conduit casts a Ruby (+1/+1) on a random board Kobold
    const after = s.board.reduce((sum, c) => sum + c.attack + c.health, 0);
    expect(after).toBe(before + 2); // exactly one +1/+1 landed
    expect(s.hand.filter((c) => c.cardId === RUBY_ID).length).toBe(1); // the minted Ruby is in hand
  });

  it('Prismcaster makes a hand Ruby cast an extra time', () => {
    const mk = (uid: string, cardId: string): BoardCard => ({ uid, cardId, tribe: 'kobold', attack: 2, health: 2, keywords: [], golden: false });
    let s: RunState = { ...createRun(1), board: [mk('pc', 'k_prismcaster'), mk('t', 'sandbag')], hand: [] };
    mintRubies(s, 1);
    const ruby = s.hand.find((c) => c.cardId === RUBY_ID)!;
    s = reduce(s, { type: 'play', uid: ruby.uid, targetUid: 't' });
    const t = s.board.find((c) => c.uid === 't')!;
    expect([t.attack, t.health]).toEqual([4, 4]); // 2/2 + a 1/1 Ruby applied TWICE
    expect(s.rubyCasts).toBe(2); // both casts count
  });

  it('a Warding Ruby grants a minion its stats AND Ward (Divine Shield)', () => {
    let s: RunState = { ...createRun(1), board: [{ uid: 'm', cardId: 'sandbag', tribe: 'kobold', attack: 2, health: 2, keywords: [], golden: false }], hand: [] };
    mintRubies(s, 1, 'warding-ruby');
    const wr = s.hand.find((c) => c.cardId === 'warding-ruby')!;
    s = reduce(s, { type: 'play', uid: wr.uid, targetUid: 'm' });
    const m = s.board.find((c) => c.uid === 'm')!;
    expect([m.attack, m.health]).toEqual([3, 3]); // +1/+1
    expect(m.keywords.includes('DS')).toBe(true); // Ward
  });

  it('Wardstone Jeweler mints a Warding Ruby at End of Turn', () => {
    const s: RunState = { ...createRun(1), board: [{ uid: 'w', cardId: 'k_wardstone', tribe: 'kobold', attack: 4, health: 7, keywords: [], golden: false }], hand: [] };
    applyEndOfTurn(s);
    expect(s.hand.some((c) => c.cardId === 'warding-ruby')).toBe(true);
  });

  it('Rubies never triple, even with 3+ in hand — they are spells (owner ruling)', () => {
    // A golden Chipwick mints 4 Rubies at once; `play` runs checkTriples on the grown hand.
    let s: RunState = { ...createRun(1), board: [], hand: [{ uid: 'ch', cardId: 'k_chipwick', tribe: 'kobold', attack: 1, health: 2, keywords: [], golden: true }] };
    s = reduce(s, { type: 'play', uid: 'ch' });
    const rubies = s.hand.filter((c) => c.cardId === RUBY_ID);
    expect(rubies.length).toBe(4); // all four remain — none combined
    expect(rubies.some((r) => r.golden)).toBe(false); // no golden Ruby formed
  });
});
