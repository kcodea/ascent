import { describe, it, expect } from 'vitest';
import { CARD_INDEX, poolFor } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { hasTier7Access } from './config';
import {
  applyEndOfTurn, applyGoldSpent, conjureToHand, mintRubies, noteSpellCast, offerBuyStats, syncGoldSpentScalers,
  goldSpentScalerValue,
} from './recruit';

/**
 * THE RUNE-ONLY MINION BATCH (owner add 2026-08-20) — 16 cards that are reachable ONLY through the Runeforge.
 *
 * Two things are asserted for every one of them: the DATA SHAPE (tier / stats / tribe, and — the part that
 * makes them rune-only at all — `token: true`, which is what keeps them out of `poolFor('set2').buyable` and
 * therefore out of every shop roll and Discover), and the EFFECT actually firing. Recruit cards drive the real
 * reducer / recruit dispatchers; combat cards drive `simulate`.
 *
 * Ancient Wanderer gets extra coverage because it is the batch's live-text card: its printed magnitude is a
 * function of run state, so the text is asserted at two different Gold totals (CLAUDE.md's hard rule).
 */

// ── harness ───────────────────────────────────────────────────────────────────────────────────────────────

/** A combat body. `uid` becomes the minion's `sourceUid` — the key every carry-back is filed under. */
const bm = (cardId: string, uid: string, attack: number, health: number, keywords: string[] = []): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: keywords as BoardMinion['keywords'] });

const recruitBody = (cardId: string, uid: string, golden = false): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden };
};

/** A set-2 recruit state with every tribe in the batch active, so pool-filtered effects can actually resolve. */
const recruit = (over: Partial<RunState> = {}): RunState =>
  ({
    ...createRun(7),
    setId: 'set2',
    phase: 'recruit',
    embers: 40,
    tribes: ['kobold', 'dwarf', 'demon', 'beast', 'dragon'],
    board: [], hand: [], shop: [],
    ...over,
  } as RunState);

const statOf = (s: RunState, uid: string): [number, number] => {
  const c = s.board.find((b) => b.uid === uid)!;
  return [c.attack, c.health];
};

// ── 1. DATA SHAPE — the contract that makes them rune-only ────────────────────────────────────────────────

/** id → [tribe, tier, attack, health]. The owner's roster, transcribed. */
const ROSTER: Record<string, [string, number, number, number]> = {
  n2_deepchef: ['neutral', 5, 4, 3],
  k_gemsage: ['kobold', 4, 3, 7],
  n2_wanderer: ['neutral', 5, 1, 1],
  n2_clockwork: ['neutral', 4, 3, 3],
  dm_nightmarket: ['demon', 5, 4, 4],
  n2_muckslinger: ['neutral', 4, 5, 5],
  n2_salesman: ['neutral', 4, 4, 4],
  dw_kegheart: ['dwarf', 4, 4, 5],
  n2_ninefold: ['neutral', 6, 9, 9],
  n2_echomimic: ['neutral', 5, 4, 7],
  n2_muster: ['neutral', 5, 6, 6],
  b2_stonehorn: ['beast', 5, 6, 6],
  d2_ascendant: ['dragon', 5, 5, 7],
  n2_abomination: ['neutral', 6, 6, 6],
  dm_behemoth: ['demon', 6, 6, 10],
};

describe('rune-only minions (2026-08-20) — data shape', () => {
  const set2 = poolFor('set2');

  it.each(Object.entries(ROSTER))('%s has the rostered tribe/tier/stats', (id, [tribe, tier, attack, health]) => {
    const def = CARD_INDEX[id];
    expect(def, `${id} must resolve through CARD_INDEX`).toBeTruthy();
    expect([def!.tribe, def!.tier, def!.attack, def!.health]).toEqual([tribe, tier, attack, health]);
  });

  it.each(Object.keys(ROSTER))('%s is token: true — forge-only, never drawable', (id) => {
    expect(CARD_INDEX[id]!.token, 'the roster marks these Source = Rune').toBe(true);
    // The load-bearing consequence: a token is filtered out of `buyable`, which is the ONE list every shop
    // roll, conjure and minion Discover draws from. Being absent there is what "rune-only" means mechanically.
    expect(set2.buyable.some((c) => c.id === id), `${id} must not be buyable in set 2`).toBe(false);
    expect(set2.spells.some((c) => c.id === id), `${id} is a minion, not a spell offer`).toBe(false);
    // …but it IS in the set, so a run that is HANDED one resolves it against the pinned pool like any card.
    expect(set2.all.some((c) => c.id === id), `${id} must still be a member of set 2`).toBe(true);
  });

  it('the Trooper token is a plain 1/1 that no pool can offer', () => {
    const t = CARD_INDEX['n2_trooper']!;
    expect([t.tribe, t.tier, t.attack, t.health]).toEqual(['neutral', 1, 1, 1]);
    expect(t.token).toBe(true);
    expect(t.effects, 'the attack-now + improve rules live on Muster General, not on the token').toEqual([]);
    // Tokens live globally in ALL_CARDS and in NO set's own list — reachable only through the card that mints
    // them, exactly like the other set-2 tokens.
    expect(set2.buyable.some((c) => c.id === 'n2_trooper')).toBe(false);
  });

  it('Evolving Abomination is the batch ALL-TYPE body — and does NOT restate it in its text', () => {
    const def = CARD_INDEX['n2_abomination']!;
    expect(def.universalTribe, 'the ALL pill is driven by this flag').toBe(true);
    // Owner ruling 2026-08-20: the pill says it, so the text must not (the same sweep that stripped the clause
    // from every other universal card). A regression here is a text that re-earns the redundancy.
    expect(def.text.toLowerCase()).not.toContain('every type');
    expect(def.text.toLowerCase()).not.toContain('all types');
    expect(def.text.toLowerCase()).not.toContain('counts as');
  });
});

// ── 2. RECRUIT EFFECTS ────────────────────────────────────────────────────────────────────────────────────

describe('rune-only minions — recruit effects', () => {
  it('Deepwater Chef: its Shout hands over one Tier 1, one Tier 3 and one Tier 5 minion', () => {
    let s = recruit({ tier: 6, hand: [recruitBody('n2_deepchef', 'ch')] });
    s = reduce(s, { type: 'play', uid: 'ch' });
    const tiers = s.hand.map((c) => CARD_INDEX[c.cardId]!.tier).sort();
    expect(tiers, 'exactly the three rostered tiers, one each').toEqual([1, 3, 5]);
  });

  it('Gem Sage: a minted Ruby arrives DOUBLED — and two Sages do not recurse', () => {
    const s = recruit({ board: [recruitBody('k_gemsage', 'gs')] });
    mintRubies(s, 1);
    expect(s.hand.filter((c) => CARD_INDEX[c.cardId]?.ruby).length, '1 minted + 1 duplicate').toBe(2);

    // The recursion guard is the whole design note: the duplicate is minted silently, so it cannot re-open the
    // `onGetRuby` round. Two Sages therefore pay 1 + 1 + 1 = 3 and TERMINATE (an un-guarded mint would hang).
    const two = recruit({ board: [recruitBody('k_gemsage', 'a'), recruitBody('k_gemsage', 'b')] });
    mintRubies(two, 1);
    expect(two.hand.filter((c) => CARD_INDEX[c.cardId]?.ruby).length, 'one duplicate per Sage, no chain').toBe(3);
  });

  it('Clockwork Assistant: its Discover is pinned to exactly one Tier above the Shop tier', () => {
    let s = recruit({ tier: 3, hand: [recruitBody('n2_clockwork', 'ck')] });
    s = reduce(s, { type: 'play', uid: 'ck' });
    expect(s.discover, 'a Discover opened').toBeTruthy();
    expect(s.discover!.every((id) => CARD_INDEX[id]!.tier === 4), 'every option is Tier 4').toBe(true);
  });

  it('…and it clamps to the RUN ceiling rather than promising an unreachable Tier 7', () => {
    // A non-Summit run tops out at 6, so a Tier-6 shop offers Tier 6 again instead of a tier the run can't have.
    let s = recruit({ tier: 6, hand: [recruitBody('n2_clockwork', 'ck')] });
    s = reduce(s, { type: 'play', uid: 'ck' });
    expect(s.discover!.every((id) => CARD_INDEX[id]!.tier === 6)).toBe(true);
  });

  it('Night Market Horror: buying a card gives the shop +2/+2 THIS TURN — and a reroll inherits it', () => {
    let s = recruit({
      board: [recruitBody('dm_nightmarket', 'nm')],
      shop: [{ uid: 's0', cardId: 'sandbag' }, { uid: 's1', cardId: 'k_chipwick' }],
    });
    const printed = CARD_INDEX['k_chipwick']!;
    s = reduce(s, { type: 'buy', uid: 's0' });
    expect([s.tavernBuyBonusTurn?.atk, s.tavernBuyBonusTurn?.hp], 'banked in the PER-TURN shop channel').toEqual([2, 2]);
    const left = s.shop.find((o) => o.uid === 's1')!;
    expect(offerBuyStats(s, left), 'the offer standing there reads +2/+2')
      .toEqual({ attack: printed.attack + 2, health: printed.health + 2 });
    // THE POINT of the rework: it is a per-TURN enchant, so a FRESH offer (what a reroll produces) inherits it.
    const rerolled = { uid: 'r0', cardId: 'k_chipwick' };
    s.shop = [rerolled];
    expect(offerBuyStats(s, rerolled), 'a rerolled offer inherits the turn buff')
      .toEqual({ attack: printed.attack + 2, health: printed.health + 2 });
    // …and it is NOT the permanent channel - that distinction is the card's whole text.
    expect([s.tavernBuyBonus.atk, s.tavernBuyBonus.hp], 'nothing leaked into the run-wide buy bonus').toEqual([0, 0]);
  });

  it('…and the shop buff DIES at the turn rollover (after combat)', () => {
    let s = recruit({
      wave: 1, resolve: 999, maxResolve: 999, armor: 999, hand: [],
      board: [
        recruitBody('dm_nightmarket', 'nm'),
        { uid: 't', cardId: 'sandbag', tribe: 'neutral', attack: 0, health: 50, keywords: ['T'], golden: false } as BoardCard,
      ],
      shop: [{ uid: 's0', cardId: 'sandbag' }],
    });
    s = reduce(s, { type: 'buy', uid: 's0' });
    expect(s.tavernBuyBonusTurn, 'armed this turn').toBeTruthy();
    s = reduce(s, { type: 'faceOmen' }) as RunState;
    s = reduce(s, { type: 'resolveCombat' }) as RunState;
    expect(s.tavernBuyBonusTurn, 'gone at the rollover — "this turn" means this turn').toBeFalsy();
  });

  it('Muckslinger: its Shout conjures a minion that actually has a Shout', () => {
    let s = recruit({ tier: 6, hand: [recruitBody('n2_muckslinger', 'mk')] });
    s = reduce(s, { type: 'play', uid: 'mk' });
    expect(s.hand.length, 'one minion granted').toBe(1);
    const got = CARD_INDEX[s.hand[0]!.cardId]!;
    expect(got.effects.some((e) => e.on === 'onPlay') || !!got.chooseOne, `${got.id} must be a Shout minion`).toBe(true);
  });

  it('Traveling Salesman: selling it Discovers only among cards you hold EXACTLY one of', () => {
    let s = recruit({
      board: [
        recruitBody('n2_salesman', 'sm'),
        recruitBody('k_chipwick', 'a1'),                     // one copy → offered
        recruitBody('dw_brunni', 'b1'), recruitBody('dw_brunni', 'b2'), // two copies → not offered
        recruitBody('b2_spots', 'g1', true),                 // GOLDEN = three copies → not offered
      ],
    });
    s = reduce(s, { type: 'sell', uid: 'sm' });
    expect(s.discover, 'the sale opened a Discover').toBeTruthy();
    expect(new Set(s.discover!), 'only the singleton qualifies').toEqual(new Set(['k_chipwick']));
  });

  it('Kegheart Dwarf: gaining a Dwarven Ale is +3/+3 — gaining anything else is not', () => {
    const s = recruit({ board: [recruitBody('dw_kegheart', 'kg')] });
    conjureToHand(s, [CARD_INDEX['veinstorm']!], 1); // a Shop spell, not an Ale
    expect(statOf(s, 'kg'), 'a non-Ale grant must not pay').toEqual([4, 5]);
    conjureToHand(s, [CARD_INDEX['wo_mine']!], 1); // Miner's Ale
    expect(statOf(s, 'kg'), 'the Ale paid +3/+3').toEqual([7, 8]);
  });

  it('Ninefold Broker: a buy hands over a Shop spell OF THAT TIER, and the run is capped at 9', () => {
    let s = recruit({
      tier: 6, embers: 999,
      board: [recruitBody('n2_ninefold', 'nb')],
      shop: [{ uid: 's0', cardId: 'k_chipwick' }],
    });
    const boughtTier = CARD_INDEX['k_chipwick']!.tier;
    s = reduce(s, { type: 'buy', uid: 's0' });
    const spells = s.hand.filter((c) => CARD_INDEX[c.cardId]!.spell);
    expect(spells.length, 'one spell granted').toBe(1);
    expect(CARD_INDEX[spells[0]!.cardId]!.tier, 'matching the tier of the minion bought').toBe(boughtTier);

    // Drive twelve buys and assert the counter stops the engine at nine.
    for (let i = 0; i < 12; i++) {
      s.hand = []; // keep the hand cap out of the way — the CHARGE is what's under test
      s.shop = [{ uid: `x${i}`, cardId: 'k_chipwick' }];
      s = reduce(s, { type: 'buy', uid: `x${i}` });
    }
    expect(s.board.find((c) => c.uid === 'nb')!.buyTick, 'nine charges, then nothing').toBe(9);
  });

  it('Stonehorn Archivist: every SECOND turn it copies the left-most card in hand', () => {
    const s = recruit({
      board: [recruitBody('b2_stonehorn', 'st')],
      hand: [recruitBody('k_chipwick', 'h0'), recruitBody('dw_brunni', 'h1')],
    });
    applyEndOfTurn(s);
    expect(s.hand.length, 'turn 1 of the cadence: nothing yet').toBe(2);
    applyEndOfTurn(s);
    expect(s.hand.filter((c) => c.cardId === 'k_chipwick').length, 'the LEFT-most card was copied').toBe(2);
    expect(s.hand.filter((c) => c.cardId === 'dw_brunni').length, 'and only that one').toBe(1);
  });

  it('Skybound Ascendant: End of Turn steps the minion on its left up one Tier', () => {
    const s = recruit({
      tier: 6,
      board: [recruitBody('k_chipwick', 'nb'), recruitBody('d2_ascendant', 'sk')],
    });
    const fromTier = CARD_INDEX['k_chipwick']!.tier;
    applyEndOfTurn(s);
    const after = s.board.find((c) => c.uid === 'nb')!;
    expect(after.cardId, 'it became something else').not.toBe('k_chipwick');
    expect(CARD_INDEX[after.cardId]!.tier, 'exactly one Tier higher').toBe(fromTier + 1);
  });

  it('…and it CLAMPS at the run ceiling: no Tier 7 without Tier-7 access', () => {
    // A Tier-6 neighbour on an ordinary run re-rolls at SIX. Tier 7 is reachable only through the Summit
    // path (`hasTier7Access`), and a transform must not be a back door into it.
    const six = Object.values(CARD_INDEX).find((d) => d.tier === 6 && !d.spell && !d.ruby && !d.token && d.tribe === 'dragon')!;
    const s = recruit({ tier: 6, board: [recruitBody(six.id, 'nb'), recruitBody('d2_ascendant', 'sk')] });
    expect(hasTier7Access(s), 'the fixture run has no Tier-7 access').toBe(false);
    applyEndOfTurn(s);
    const after = s.board.find((c) => c.uid === 'nb')!;
    expect(CARD_INDEX[after.cardId]!.tier, 'clamped to the run ceiling').toBe(6);
  });

  it('…and WITH Tier-7 access it reaches seven', () => {
    const six = Object.values(CARD_INDEX).find((d) => d.tier === 6 && !d.spell && !d.ruby && !d.token && d.tribe === 'dragon')!;
    const s = recruit({ tier: 6, tier7Access: true, board: [recruitBody(six.id, 'nb'), recruitBody('d2_ascendant', 'sk')] });
    applyEndOfTurn(s);
    const after = s.board.find((c) => c.uid === 'nb')!;
    expect(CARD_INDEX[after.cardId]!.tier, 'the Summit path opens Tier 7').toBe(7);
  });

  it('…and the transform keeps whatever the body had gained above its base', () => {
    const s = recruit({ tier: 6, board: [recruitBody('k_chipwick', 'nb'), recruitBody('d2_ascendant', 'sk')] });
    const nb = s.board.find((c) => c.uid === 'nb')!;
    nb.attack += 10; nb.health += 10; // a heavily-buffed body
    applyEndOfTurn(s);
    const after = s.board.find((c) => c.uid === 'nb')!;
    const base = CARD_INDEX[after.cardId]!;
    expect([after.attack - base.attack, after.health - base.health], 'the +10/+10 rode along').toEqual([10, 10]);
  });

  it('Arcane Behemoth: selling a DEMON feeds it that body’s live stats — selling anything else does not', () => {
    let s = recruit({
      board: [recruitBody('dm_behemoth', 'bh'), recruitBody('k_chipwick', 'kb'), recruitBody('dm_nightmarket', 'dm')],
    });
    const base = statOf(s, 'bh');
    s = reduce(s, { type: 'sell', uid: 'kb' });
    expect(statOf(s, 'bh'), 'a Kobold is not a Demon').toEqual(base);
    // The Demon is buffed first: what it eats is the LIVE stat line, not the printed base.
    const dm = s.board.find((c) => c.uid === 'dm')!;
    dm.attack += 5; dm.health += 5;
    const da = dm.attack, dh = dm.health;
    s = reduce(s, { type: 'sell', uid: 'dm' });
    expect(statOf(s, 'bh'), 'it gained the sold Demon’s whole stat line').toEqual([base[0] + da, base[1] + dh]);
  });

  it('…a universal-tribe ("All types") body counts as a Demon, and Golden doubles the meal', () => {
    const allTribes = Object.values(CARD_INDEX).find((d) => d.universalTribe && !d.spell && !d.ruby)!;
    let s = recruit({ board: [recruitBody('dm_behemoth', 'bh', true), recruitBody(allTribes.id, 'ut')] });
    const base = statOf(s, 'bh');
    const ut = s.board.find((c) => c.uid === 'ut')!;
    const ua = ut.attack, uh = ut.health;
    s = reduce(s, { type: 'sell', uid: 'ut' });
    expect(statOf(s, 'bh'), 'ALL types is a Demon here, and the golden ate double')
      .toEqual([base[0] + ua * 2, base[1] + uh * 2]);
  });
});

// ── 3. ANCIENT WANDERER — the batch's live-text card ──────────────────────────────────────────────────────

describe('Ancient Wanderer — "+1/+1 per 3 Gold spent this run"', () => {
  it('a body on the board tracks the run total as it is spent', () => {
    const s = recruit({ board: [recruitBody('n2_wanderer', 'aw')] });
    s.goldSpent = 9;
    applyGoldSpent(s, 9);
    expect(statOf(s, 'aw'), '9 Gold = 3 steps = +3/+3 on a 1/1').toEqual([4, 4]);
    s.goldSpent = 11; // two more spent — not a full step
    applyGoldSpent(s, 2);
    expect(statOf(s, 'aw'), '11 Gold is still 3 steps').toEqual([4, 4]);
    s.goldSpent = 12;
    applyGoldSpent(s, 1);
    expect(statOf(s, 'aw'), '12 Gold = 4 steps').toEqual([5, 5]);
  });

  it('the sync is IDEMPOTENT — re-running it never double-counts', () => {
    const s = recruit({ board: [recruitBody('n2_wanderer', 'aw')] });
    s.goldSpent = 30;
    syncGoldSpentScalers(s);
    syncGoldSpentScalers(s);
    syncGoldSpentScalers(s);
    expect(statOf(s, 'aw'), '30 Gold = 10 steps, once').toEqual([11, 11]);
    const buffs = s.board.find((c) => c.uid === 'aw')!.buffs ?? [];
    expect(buffs.filter((b) => b.source === 'Ancient Wanderer').length, 'ONE standing enchant row, resized').toBe(1);
  });

  it('a Wanderer PLAYED late is worth the whole run behind it (it "has", it does not "gain")', () => {
    let s = recruit({ hand: [recruitBody('n2_wanderer', 'aw')] });
    s.goldSpent = 30; // the run so far
    s = reduce(s, { type: 'play', uid: 'aw' });
    expect(statOf(s, 'aw'), 'it arrives already carrying 10 steps').toEqual([11, 11]);
  });

  it('a GOLDEN Wanderer scales at +2/+2 per step', () => {
    const s = recruit({ board: [recruitBody('n2_wanderer', 'aw', true)] });
    const aw = s.board[0]!;
    aw.attack = 2; aw.health = 2; // a gilded body starts at double base
    s.goldSpent = 9;
    syncGoldSpentScalers(s);
    expect(statOf(s, 'aw'), '3 steps × +2/+2 on a 2/2').toEqual([8, 8]);
  });

  // THE HARD RULE (CLAUDE.md): the printed text must fold in the number the card produces RIGHT NOW. The
  // sim-side value helper and the UI's `ancientWandererText` read the same params, so pinning the helper at two
  // totals pins what every surface prints (the UI chain is covered by `packages/ui/src/cardText.test.ts`).
  it('the live value + countdown move with the run total (two different totals)', () => {
    const at9 = goldSpentScalerValue('n2_wanderer', 9)!;
    expect([at9.bonus, at9.per, at9.toNext], '9 Gold: +3, next step in 3').toEqual([3, 3, 3]);
    const at31 = goldSpentScalerValue('n2_wanderer', 31)!;
    expect([at31.bonus, at31.per, at31.toNext], '31 Gold: +10, next step in 2').toEqual([10, 3, 2]);
    // …and the two totals must not print the same thing — a helper that ignored its input would pass every
    // single-total assertion above.
    expect(at9.bonus).not.toBe(at31.bonus);
    expect(goldSpentScalerValue('n2_wanderer', 9, true)!.bonus, 'golden doubles the printed value too').toBe(6);
    expect(goldSpentScalerValue('n2_ninefold', 30), 'a card without the effect has no live value').toBeNull();
  });
});

// ── 4. COMBAT EFFECTS ─────────────────────────────────────────────────────────────────────────────────────

const summonsOf = (events: CombatEvent[], cardId: string): CombatEvent[] =>
  events.filter((e) => e.type === 'summon' && (e as { minion: { cardId: string } }).minion.cardId === cardId);

describe('rune-only minions — combat effects', () => {
  it('Echo Mimic: a friendly death grafts that minion\'s Echo, which fires when the Mimic dies', () => {
    // Mama Pup's Echo summons two 1/1 Pups. With a Mimic beside it, the Pups arrive TWICE: once from Mama
    // Pup's own death, once again when the Mimic (now carrying the copy) dies.
    const withMimic = simulate(
      [bm('pack', 'MP', 1, 1), bm('n2_echomimic', 'EM', 1, 1)],
      [bm('dm_clerk', 'BIG', 50, 200)],
      makeRng(5), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    const baseline = simulate(
      [bm('pack', 'MP', 1, 1), bm('sandbag', 'XX', 1, 1)],
      [bm('dm_clerk', 'BIG', 50, 200)],
      makeRng(5), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    expect(summonsOf(baseline.events, 'pup').length, 'without the Mimic: one Echo, two Pups').toBe(2);
    expect(summonsOf(withMimic.events, 'pup').length, 'with it: the Echo resolves a second time').toBe(4);
  });

  it('…and it only copies OTHER friendlies — an enemy death grafts nothing', () => {
    const r = simulate(
      [bm('n2_echomimic', 'EM', 1, 1)],
      [bm('pack', 'EP', 1, 1), bm('dm_clerk', 'BIG', 50, 200)],
      makeRng(5), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
    const playerPups = r.events.filter((e) => e.type === 'summon'
      && (e as { minion: { cardId: string } }).minion.cardId === 'pup'
      && (e as { side: string }).side === 'player');
    expect(playerPups.length, 'the enemy Mama Pup is not a friendly death').toBe(0);
  });

  it('Muster General: Avenge (3) summons a Trooper that strikes at once, and improves the next one', () => {
    // Six fragile bodies feed the Avenge; each threshold crossing summons one Trooper.
    const fodder = [0, 1, 2, 3, 4, 5].map((i) => bm('dm_clerk', `f${i}`, 0, 1));
    const r = simulate(
      [bm('n2_muster', 'MG', 0, 400), ...fodder],
      [bm('dm_clerk', 'BIG', 60, 4000)],
      makeRng(11), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    const troopers = summonsOf(r.events, 'n2_trooper');
    expect(troopers.length, 'two Avenge crossings, two Troopers').toBeGreaterThanOrEqual(2);

    // The IMPROVE is the card's second half: the first Trooper lands at 1/1, the next carries +1/+1.
    const improves = r.events.filter((e) => e.type === 'improve' && (e as { target: string }).target === 'm0');
    expect(improves.length, 'each Avenge improves the General').toBeGreaterThanOrEqual(2);
    const second = troopers[1] as unknown as { minion: { uid: string } };
    const buffed = r.events.some((e) => e.type === 'buff'
      && (e as { target: string }).target === second.minion.uid
      && (e as { source: string }).source === 'm0');
    expect(buffed, 'the second Trooper arrives already improved').toBe(true);

    // "Attacks immediately" — the token swings inside this fight rather than waiting for the next turn order.
    const trooperUids = new Set(troopers.map((t) => (t as unknown as { minion: { uid: string } }).minion.uid));
    expect(r.events.some((e) => e.type === 'attack' && trooperUids.has((e as { attacker: string }).attacker)),
      'a summoned Trooper took its out-of-turn swing').toBe(true);
  });

  it('Evolving Abomination: its Rally doubles compounding — and stops at the per-combat cap', () => {
    const r = simulate(
      [bm('n2_abomination', 'AB', 6, 6, ['RL'])],
      [bm('dm_clerk', 'WALL', 0, 100000)],
      makeRng(3), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    const doubles = r.events.filter((e) => e.type === 'buff' && (e as { source: string }).source === 'm0');
    expect(doubles.length, 'exactly two doublings in a combat, however many times it attacks').toBe(2);
    // Compounding: 6/6 → +6/+6 → 12/12 → +12/+12 → 24/24. A flat re-grant would show +6/+6 twice.
    expect(doubles.map((e) => (e as { attack: number }).attack)).toEqual([6, 12]);
  });

  it('…and a GOLDEN Abomination raises the CAP rather than the multiplier', () => {
    const r = simulate(
      [{ ...bm('n2_abomination', 'AB', 12, 12, ['RL']), golden: true }],
      [bm('dm_clerk', 'WALL', 0, 100000)],
      makeRng(3), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    const doubles = r.events.filter((e) => e.type === 'buff' && (e as { source: string }).source === 'm0');
    expect(doubles.length, 'four doublings, each still a plain double').toBe(4);
  });
});
