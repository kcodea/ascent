import { describe, it, expect } from 'vitest';
import { type CardDef, combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { addBuff, applyEndOfTurn, applyGoldSpent, fireOnRubyPlayed, mintRubies, RUBY_ID } from './recruit';

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
    // A Ruby is a CARD PLAYED (owner ruling 2026-07-31: everything you literally play or cast counts) —
    // Closing-Time Foreman and Rune of Action read this list, and the Ruby branch used to skip it.
    expect(s.playedThisTurn).toContain(RUBY_ID);
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

  it("the goldSpent Ruby cadence mints every 5 Gold (Hoardmaster Krik's primitive)", () => {
    // Krik was PULLED from the roster 2026-07-31 ("for now" — the owner expects him back), and he was the only
    // card using `cardsBoughtGetRubies`. The primitive stays, and this test keeps it honest via a synthetic
    // card rather than deleting the coverage — so whenever Krik (or a successor) returns, the cadence is
    // already proven. Both `cardsBought` and `goldSpent` ride the same continuous per-instance meter, so a
    // single big spend crossing the threshold twice comes free.
    const krik: CardDef = { id: 'dbg_krik', name: 'Krik', tribe: 'kobold', tier: 5, attack: 4, health: 7, keywords: [],
      effects: [{ on: 'goldSpent', do: 'cardsBoughtGetRubies', params: { every: 5, count: 1 } }], text: '' };
    CARD_INDEX[krik.id] = krik;
    const s: RunState = { ...createRun(1), board: [{ uid: 'k', cardId: krik.id, tribe: 'kobold', attack: 4, health: 7, keywords: [], golden: false }], hand: [] };
    applyGoldSpent(s, 4); // 4 Gold → not yet
    expect(s.hand.filter((c) => c.cardId === RUBY_ID).length).toBe(0);
    applyGoldSpent(s, 1); // crosses 5 → mint
    expect(s.hand.filter((c) => c.cardId === RUBY_ID).length).toBe(1);
    applyGoldSpent(s, 10); // one spend crossing twice → two more
    expect(s.hand.filter((c) => c.cardId === RUBY_ID).length).toBe(3);
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

  it('Cheap Date pays out when SOLD, not when played (owner rework 2026-07-29)', () => {
    // Was Pouchpincher (T2 4/2, "Shout: get a Gold Pouch"); the owner's roster card is a T1 body whose value is
    // in selling it. Playing it must now grant nothing, and selling it must grant a Tier 1 minion.
    let s: RunState = { ...createRun(1), setId: 'set2', board: [], hand: [{ uid: 'p', cardId: 'k_pouchpincher', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false }] } as RunState;
    s = reduce(s, { type: 'play', uid: 'p' });
    expect(s.hand.some((c) => c.cardId === 'emberpouch'), 'the old Gold Pouch Shout still fired').toBe(false);
    const handBeforeSell = s.hand.length;
    s = reduce(s, { type: 'sell', uid: 'p' });
    expect(s.hand.length, 'selling granted nothing').toBe(handBeforeSell + 1);
    expect(CARD_INDEX[s.hand[s.hand.length - 1]!.cardId]!.tier, 'the granted minion was not Tier 1').toBe(1);
  });

  it('Candle Conduit (rework 2026-08-07): every Ruby played bounces its stats to 1 more minion', () => {
    const mk = (uid: string, cardId: string): BoardCard => ({ uid, cardId, tribe: 'kobold', attack: 2, health: 2, keywords: [], golden: false });
    const s: RunState = { ...createRun(1), board: [mk('cc', 'k_candleconduit'), mk('k2', 'sandbag'), mk('k3', 'sandbag')], hand: [] };
    const before = s.board.reduce((sum, c) => sum + c.attack + c.health, 0);
    // Play a Ruby on k2 through the real path: the Ruby lands (+1/+1) AND the Conduit bounces its stats to
    // one more random friendly (+1/+1 again) — total board delta +4, not +2.
    const target = s.board.find((c) => c.uid === 'k2')!;
    addBuff(target, 'Ruby', 1, 1);
    fireOnRubyPlayed(s, target, 1, 1);
    const after = s.board.reduce((sum, c) => sum + c.attack + c.health, 0);
    expect(after - before, 'the Ruby + exactly one bounce').toBe(4);
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

  it('Alchemist Brisbane: Shout buffs your Rubies, End of Turn plays a Ruby on a Kobold', () => {
    let s: RunState = { ...createRun(1), board: [], hand: [{ uid: 'ab', cardId: 'k_alchemist', tribe: 'kobold', attack: 9, health: 6, keywords: [], golden: false }] };
    s = reduce(s, { type: 'play', uid: 'ab' }); // Shout: your Rubies +1/+1
    expect(s.rubyBonus).toMatchObject({ attack: 1, health: 1 });
    const before = s.board.reduce((sum, c) => sum + c.attack + c.health, 0);
    applyEndOfTurn(s); // EoT: play a Ruby (2/2 with the bonus) on a Kobold (High King Mykel itself)
    expect(s.board.reduce((sum, c) => sum + c.attack + c.health, 0)).toBe(before + 4);
  });

  it('Gemgorge Fiend consumes a Shop minion every 3 Rubies cast', () => {
    const mk = (uid: string, cardId: string): BoardCard => ({ uid, cardId, tribe: 'kobold', attack: 6, health: 6, keywords: [], golden: false });
    let s: RunState = { ...createRun(1), board: [mk('gg', 'k_gemgorge'), mk('t', 'sandbag')], hand: [] };
    const shopBefore = s.shop.length;
    const g0 = s.board.find((c) => c.uid === 'gg')!;
    const ggStatsBefore = g0.attack + g0.health;
    mintRubies(s, 3);
    for (const uid of s.hand.filter((c) => c.cardId === RUBY_ID).map((c) => c.uid)) s = reduce(s, { type: 'play', uid, targetUid: 't' });
    expect(s.shop.length).toBe(shopBefore - 1); // the 3rd Ruby cast consumed one offer
    const g1 = s.board.find((c) => c.uid === 'gg')!;
    expect(g1.attack + g1.health).toBeGreaterThan(ggStatsBefore); // Gemgorge gained the consumed offer's stats
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

/**
 * Rubies played MID-COMBAT must reach the target's own `onRubyPlayed` effects, exactly like a Ruby played from
 * hand does in the shop. Owner report 2026-07-25: "Geode Guardian rubies played on Resonance Idol do not bounce
 * to adjacent minions."
 *
 * The cause was the simulation/presentation-adjacent seam between the two phases — Geode Guardian's Echo is a
 * COMBAT factory, while Resonance Idol's bounce existed only as a RECRUIT factory, so mid-fight Rubies had
 * nobody listening. Combat's `playRubyOn` now notifies the target and the Idol has a combat half.
 */
describe('set 2 — a Ruby played in COMBAT fires the target’s onRubyPlayed', () => {
  const bm = (cardId: string, uid: string, attack: number, health: number): BoardMinion =>
    ({ cardId, attack, health, sourceUid: uid, keywords: [] });

  /** Ruby buffs only: a Ruby grants +1/+1 (no rubyBonus here), so filtering on health > 0 excludes the
   *  attack-only combat buffs the enemy sandbag generates. Combat uids are positional — m0, m1, m2. */
  type BuffEvent = { type: 'buff'; target: string; attack: number; health: number; source: string };
  const rubyBuffs = (r: { events: readonly { type: string }[] }): BuffEvent[] =>
    (r.events as readonly BuffEvent[]).filter((e) => e.type === 'buff' && e.health > 0);

  // Geode Guardian no longer plays Rubies on its neighbours (2026-07-31 rework: it summons Golems instead),
  // so these Idol-bounce tests drive the ADJACENT-play factory through a synthetic card — the machinery under
  // test (a combat Ruby firing the target's onRubyPlayed) outlived the card that first exposed it.
  const adjRattler: CardDef = { id: 'adj_rattler', name: 'AdjRattler', tribe: 'kobold', tier: 2, attack: 1, health: 1, keywords: [],
    effects: [{ on: 'onDeath', do: 'deathrattlePlayRubiesAdjacent', params: { rubies: 1 } }], text: '' };
  const CARDS_ADJ = { ...CARD_INDEX, adj_rattler: adjRattler };

  it("a dying adjacent-Ruby rattler's Ruby bounces off an adjacent Resonance Idol", () => {
    // Board order matters: [outer, Idol, rattler]. The rattler dies, plays a Ruby on its neighbour (the Idol),
    // and the Idol bounces those stats onward to ITS other neighbour (`outer`, m0). Before the fix the Ruby
    // landed on the Idol and stopped there — the Idol's bounce was a recruit-only factory.
    const r = simulate(
      [bm('sandbag', 'OUT', 1, 40), bm('k_resonance', 'IDOL', 2, 40), bm('adj_rattler', 'GEO', 1, 1)],
      [{ cardId: 'sandbag', attack: 10, health: 400 }], makeRng(5), CARDS_ADJ,
      combatSide({ tier: 6, tribes: ['kobold'] }), combatSide({ tier: 1 }),
    );
    const buffs = rubyBuffs(r);
    // The Ruby landed on the Idol (m1), sourced from Geode (m2)…
    expect(buffs.some((b) => b.target === 'm1' && b.source === 'm2' && b.attack === 1 && b.health === 1)).toBe(true);
    // …and BOUNCED to the Idol's other neighbour (m0), sourced from the IDOL. This is the reported bug.
    expect(buffs.some((b) => b.target === 'm0' && b.source === 'm1' && b.attack === 1 && b.health === 1)).toBe(true);
  });

  it('two adjacent Resonance Idols do not bounce a Ruby forever', () => {
    // The recursion guard: a bounced Ruby must not itself count as "a Ruby played on" the neighbour. Without it
    // this pair ping-pongs until the stack blows, so terminating at all IS the assertion.
    const r = simulate(
      [bm('k_resonance', 'I1', 2, 40), bm('k_resonance', 'I2', 2, 40), bm('adj_rattler', 'GEO', 1, 1)],
      [{ cardId: 'sandbag', attack: 10, health: 400 }], makeRng(5), CARDS_ADJ,
      combatSide({ tier: 6, tribes: ['kobold'] }), combatSide({ tier: 1 }),
    );
    expect(r.result).toBeTruthy();
    expect(r.events.length).toBeLessThan(5000);
  });
});
