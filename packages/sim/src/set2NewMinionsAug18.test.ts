import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { applyGoldSpent, applyStartOfTurn, conjureToHand, consumeShopMinion, applyEndOfTurn } from './recruit';

/**
 * SET 2 — the 2026-08-18 minion batch (owner add): behavioural coverage for the NEW mechanics, not just their
 * presence. Combat cases drive `simulate`; recruit cases drive the reducer / recruit dispatchers. Where a card's
 * value carries out of combat (Rubies, Imp buff) the assertion is the carry-back channel, since a combat-only
 * buff would leave that field unset.
 */

// A combat body. `uid` becomes the minion's `sourceUid` — the key every carry-back is filed under.
const bm = (cardId: string, uid: string, attack: number, health: number, keywords: string[] = []): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: keywords as BoardMinion['keywords'] });
/** Player-side combat uids are assigned m0, m1, … in board order (enemy continues the same counter). */
const buffsFrom = (events: CombatEvent[], uid: string) =>
  events.filter((e) => (e as { type: string; source?: string }).type === 'buff' && (e as { source?: string }).source === uid)
    .map((e) => e as { attack: number; health: number; source: string });

const recruitBody = (cardId: string, uid: string): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
};

// ── COMBAT: the Demon-damage trigger (`friendlyDemonDealtDamage`) ─────────────────────────────────────────
// The enemy is an INERT wall: `dm_clerk` is combat-inert (its only effect is a recruit-phase Shout) and given
// 0 Attack, so it never retaliates and never mutates the fight — unlike Target Dummy, which gains Attack when
// hit and flips initiative. Each reactor starts at 0 Attack; it may pick up Attack from its own procs and start
// swinging too, so the exact instance count isn't pinned. The invariant asserted instead is the one that
// matters: every proc is the right magnitude, co-firing reactors agree instance-for-instance, and the Imp
// carry-back equals +3/+3 times the number of procs.
describe('set 2 — the Demon-damage trigger (combat)', () => {
  it('Axeman gains +3/+3 and Leech gains +1 Attack on the SAME Demon-damage instances', () => {
    const r = simulate(
      [bm('dm_chosenfiend', 'CF', 0, 400), bm('dm_leech', 'LE', 0, 400), bm('dm_clerk', 'AT', 5, 400)],
      [bm('dm_clerk', 'BAG', 0, 99999)],
      makeRng(3), CARD_INDEX, combatSide({ tier: 4 }), combatSide({ tier: 1 }));
    const cf = buffsFrom(r.events, 'm0'); // Axeman
    const le = buffsFrom(r.events, 'm1'); // Leech
    expect(cf.length, 'the trigger fired repeatedly').toBeGreaterThan(1);
    expect(cf.every((b) => b.attack === 3 && b.health === 3), 'each Axeman proc is +3/+3').toBe(true);
    expect(le.every((b) => b.attack === 1 && b.health === 0), 'each Leech proc is +1 Attack only').toBe(true);
    expect(le.length, 'both react to the exact same damage instances').toBe(cf.length);
  });

  it('a hit absorbed by a WARD (0 damage landed) does NOT proc the trigger', () => {
    // Axeman alone into a single 0/1 warded bag. Hit 1 pops the shield (0 landed → no proc, and no
    // on-damaged either); the bag survives at 1 HP with 0 Attack, and hit 2 kills it (4 landed → one proc). So
    // the fight ends with EXACTLY one proc — proof the shield-absorbed hit was skipped. A trigger that fired on
    // the shield pop would show 2.
    const r = simulate(
      [bm('dm_chosenfiend', 'CF', 4, 40)],
      [bm('sandbag', 'W', 0, 1, ['DS'])],
      makeRng(3), CARD_INDEX, combatSide({ tier: 4 }), combatSide({ tier: 1 }));
    const cf = buffsFrom(r.events, 'm0');
    expect(cf.length, 'only the landed killing blow procs; the warded hit does not').toBe(1);
    expect(cf[0]).toMatchObject({ attack: 3, health: 3 });
  });

  it('Impossible Todd grants the run-wide Imp buff on each Demon-damage instance (carried back)', () => {
    // Every instance swells Todd +4/+4 (permanently) AND showers Imps +2/+2. The Imp grant is the run carry-back
    // channel (`playerImpBuffGain`), so a combat-only buff would leave it unset — and it must equal +2/+2 per proc.
    const r = simulate(
      [bm('dm_todd', 'TD', 0, 400), bm('dm_clerk', 'AT', 5, 400)],
      [bm('dm_clerk', 'BAG', 0, 99999)],
      makeRng(3), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    const td = buffsFrom(r.events, 'm0');
    expect(td.length, 'Todd self-buffs on each instance').toBeGreaterThan(1);
    expect(td.every((b) => b.attack === 4 && b.health === 4), 'each self-buff is +4/+4').toBe(true);
    expect(r.playerImpBuffGain, 'the Imp buff carried back at +2/+2 per instance').toEqual({ attack: 2 * td.length, health: 2 * td.length });
  });
});

// ── COMBAT: Fel Spikes Echo — friendly Demons spared, enemy Demons hit ────────────────────────────────────
describe('set 2 — Fel Spikes Echo (combat)', () => {
  it('deals 1 to all minions except the controller’s OWN Demons — enemy Demons ARE hit', () => {
    // Board: m0 Fel Spikes (Taunt, 1 HP — dies), m1 a FRIENDLY Demon (spared), m2 a FRIENDLY non-Demon (hit).
    // Enemy m3 is a Demon (hit — the exclusion is friendly-only). Both bystanders are 0-attack walls so the only
    // 4-damage in the whole fight is the Echo (owner balance 2026-08-18: Tier 5, echo amount 1 → 4).
    const r = simulate(
      [bm('dm_felspikes', 'FS', 4, 1, ['T']), bm('dm_clerk', 'FD', 0, 40), bm('sandbag', 'FN', 0, 40)],
      [bm('dm_clerk', 'ED', 10, 40)],
      makeRng(3), CARD_INDEX, combatSide({ tier: 3 }), combatSide({ tier: 1 }));
    const oneDmgTargets = new Set(
      r.events.filter((e) => e.type === 'dmg' && (e as { amount: number }).amount === 4)
        .map((e) => (e as { target: string }).target));
    expect(oneDmgTargets.has('m2'), 'the friendly NON-Demon takes 1').toBe(true);
    expect(oneDmgTargets.has('m3'), 'the ENEMY Demon takes 1 — exclusion is friendly-only').toBe(true);
    expect(oneDmgTargets.has('m1'), 'the friendly Demon must be spared').toBe(false);
    expect(oneDmgTargets, 'exactly the non-Demon + the enemy Demon').toEqual(new Set(['m2', 'm3']));
  });
});

// ── COMBAT: permanent Rubies carry back to the run board ──────────────────────────────────────────────────
describe('set 2 — permanent Rubies survive combat (carry-back)', () => {
  it('Boulderdash’s Rally Rubies are recorded as a permanent Ruby carry-back, and land on the run board', () => {
    const r = simulate(
      [bm('k_boulderdash', 'B', 6, 60, ['RL'])],
      [{ cardId: 'sandbag', attack: 0, health: 300 }],
      makeRng(3), CARD_INDEX, combatSide({ tier: 5 }), combatSide({ tier: 1 }));
    const perma = (r.playerPermaBuffs ?? []).filter((p) => p.sourceUid === 'B' && p.ruby);
    expect(perma.length, 'Boulderdash accrued a permanent Ruby gain').toBeGreaterThan(0);
    expect(perma[0]!.attack, 'the carry-back has real stats').toBeGreaterThan(0);

    // …and the reducer actually applies it to the run board at settle (not lost at combat end).
    let s: RunState = {
      ...createRun(5), phase: 'combat', combatSettled: false, embers: 99, freeRolls: 99,
      board: [recruitBody('k_boulderdash', 'B')], hand: [], shop: [],
      lastCombat: r,
    } as unknown as RunState;
    const before = s.board[0]!.attack + s.board[0]!.health;
    s = reduce(s, { type: 'resolveCombat' });
    const settled = s.board.find((c) => c.uid === 'B')!;
    expect(settled.attack + settled.health, 'the permanent Rubies landed on the run-board body').toBeGreaterThan(before);
  });

  it('Kobe’s Start-of-Combat Rubies carry back for itself (permanent)', () => {
    const r = simulate(
      [bm('k_kobe', 'K', 5, 60, ['SC']), bm('k_deepvein', 'N', 1, 60)],
      [{ cardId: 'sandbag', attack: 0, health: 300 }],
      makeRng(3), CARD_INDEX, combatSide({ tier: 4 }), combatSide({ tier: 1 }));
    const kobe = (r.playerPermaBuffs ?? []).filter((p) => p.sourceUid === 'K' && p.ruby);
    expect(kobe.length, 'Kobe recorded a permanent Ruby gain on itself').toBeGreaterThan(0);
    expect(kobe[0]!.attack, 'with real stats (2 Rubies × 1/1)').toBeGreaterThanOrEqual(2);
  });
});

// ── RECRUIT: sell / start-of-turn / consume / gold-spent / on-gain-card mechanics ─────────────────────────
describe('set 2 — the 2026-08-18 recruit mechanics (reducer)', () => {
  const recruit = (over: Partial<RunState> = {}): RunState =>
    ({ ...createRun(1), phase: 'recruit', embers: 40, ...over } as RunState);
  const rubyCount = (s: RunState) => s.hand.filter((c) => CARD_INDEX[c.cardId]?.ruby).length;

  it('Beggy: selling it mints 2 Rubies', () => {
    let s = recruit({ board: [recruitBody('k_beggy', 'beg')], hand: [], shop: [] });
    expect(rubyCount(s)).toBe(0);
    s = reduce(s, { type: 'sell', uid: 'beg' });
    expect(rubyCount(s), 'the on-sell payout minted 2 Rubies').toBe(2);
  });

  it('Gemline Martyr: END of Turn gets a Veinstorm, and no longer touches Rubies (owner rework 2026-08-19)', () => {
    const s = recruit({ board: [recruitBody('k_gemline', 'gm')], hand: [], shop: [] });
    const before = s.rubyBonus ?? { attack: 0, health: 0 };
    applyStartOfTurn(s);
    expect(s.hand.length, 'the Start-of-Turn shape is gone').toBe(0);
    applyEndOfTurn(s);
    expect(s.hand.some((c) => c.cardId === 'veinstorm'), 'a Veinstorm was granted to hand').toBe(true);
    expect(s.rubyBonus ?? { attack: 0, health: 0 }, 'the Ruby-improvement half was dropped').toEqual(before);
  });

  it('Fel Conjurer: Start of Turn gets a Quick Study (owner add 2026-08-19)', () => {
    const s = recruit({ board: [recruitBody('d2_felconjurer', 'fc')], hand: [], shop: [] });
    applyStartOfTurn(s);
    expect(s.hand.filter((c) => c.cardId === 'quickstudy').length, 'one Quick Study granted').toBe(1);
  });

  it('Dwarven Sharpshooter: Shout gets a Deep Delve Writ (owner add 2026-08-19)', () => {
    let s = recruit({ board: [], hand: [{ ...recruitBody('dw_sharpshooter', 'ss') }], shop: [] });
    s = reduce(s, { type: 'play', uid: 'ss' });
    expect(s.hand.filter((c) => c.cardId === 'deepdelvewrit').length, 'one Writ granted').toBe(1);
  });

  it('Grevlin & Co.: consumes the right-most Shop minion after the 3rd sale', () => {
    let s = recruit({
      board: [recruitBody('dm_grevlin', 'grv'), recruitBody('sandbag', 'f1'), recruitBody('sandbag', 'f2'), recruitBody('sandbag', 'f3')],
      hand: [], shop: [{ uid: 's0', cardId: 'dm_hungerling' }],
    });
    const atkBefore = s.board.find((c) => c.uid === 'grv')!.attack;
    s = reduce(s, { type: 'sell', uid: 'f1' });
    s = reduce(s, { type: 'sell', uid: 'f2' });
    expect(s.shop.length, 'nothing eaten before the 3rd sale').toBe(1);
    s = reduce(s, { type: 'sell', uid: 'f3' });
    expect(s.shop.length, 'the 3rd sale triggers the consume').toBe(0);
    expect(s.board.find((c) => c.uid === 'grv')!.attack, 'Grevlin grew on the eaten minion').toBeGreaterThan(atkBefore);
  });

  it('Enigma: consuming a minion permanently buffs the Shop', () => {
    const s = recruit({ board: [recruitBody('dm_jumbo', 'jb')], hand: [], shop: [{ uid: 's0', cardId: 'sandbag' }] });
    expect([s.tavernBuyBonus.atk, s.tavernBuyBonus.hp]).toEqual([0, 0]);
    consumeShopMinion(s, s.board.find((c) => c.uid === 'jb')!, 0); // Enigma itself eats
    expect([s.tavernBuyBonus.atk, s.tavernBuyBonus.hp], 'onConsume gave the Shop +2/+1 permanently').toEqual([2, 1]);
  });

  it('Billings: every 5 Gold spent buffs exactly 2 random Dwarves +5/+5', () => {
    const s = recruit({
      board: [recruitBody('dw_billings', 'bl'), recruitBody('dw_brunni', 'd1'), recruitBody('dw_brunni', 'd2'), recruitBody('dw_brunni', 'd3')],
      hand: [], shop: [],
    });
    const sum = (key: 'attack' | 'health') => s.board.reduce((n, c) => n + c[key], 0);
    const aBefore = sum('attack'), hBefore = sum('health');
    applyGoldSpent(s, 5);
    expect(sum('attack') - aBefore, 'two recipients × +5 Attack').toBe(10);
    expect(sum('health') - hBefore, 'two recipients × +5 Health').toBe(10);
  });

  it('Gangplank: a card conjured to hand buffs a friendly Dwarf +1/+2', () => {
    const s = recruit({ board: [recruitBody('dw_brunni', 'd1'), recruitBody('dw_gangplank', 'gp')], hand: [], shop: [] });
    const before = s.board.map((c) => c.attack + c.health).reduce((a, b) => a + b, 0);
    conjureToHand(s, [CARD_INDEX['veinstorm']!], 1); // fires onGainCard once
    const after = s.board.map((c) => c.attack + c.health).reduce((a, b) => a + b, 0);
    expect(after - before, 'exactly one Dwarf gained +1/+2').toBe(3);
  });

  it('Gangplank picks a RANDOM Dwarf, not always the left-most (owner report 2026-08-20)', () => {
    // It used to `.find(...)` the first match, so the left-most body soaked every grant for the whole run —
    // a seating decision the card never claimed to make. Drive many conjures across a Dwarf line and assert
    // the grants actually SPREAD; the left-most soaking all of them is the exact bug.
    const s = recruit({
      board: [
        recruitBody('dw_brunni', 'd1'), recruitBody('dw_brunni', 'd2'),
        recruitBody('dw_brunni', 'd3'), recruitBody('dw_gangplank', 'gp'),
      ],
      hand: [], shop: [],
    });
    const start = new Map(s.board.map((c) => [c.uid, c.attack + c.health]));
    for (let i = 0; i < 40; i++) { s.hand = []; conjureToHand(s, [CARD_INDEX['veinstorm']!], 1); }
    const gained = s.board.filter((c) => (c.attack + c.health) > (start.get(c.uid) ?? 0));
    expect(gained.length, 'every grant landed on ONE body — still left-most-only').toBeGreaterThan(1);
    const d1 = s.board.find((c) => c.uid === 'd1')!;
    expect(d1.attack + d1.health - (start.get('d1') ?? 0), 'the left-most must not soak all 40 grants').toBeLessThan(40 * 3);
  });

  it('…and the random pick is SEEDED — the same run state replays identically', () => {
    const build = () => recruit({
      board: [
        recruitBody('dw_brunni', 'd1'), recruitBody('dw_brunni', 'd2'),
        recruitBody('dw_brunni', 'd3'), recruitBody('dw_gangplank', 'gp'),
      ],
      hand: [], shop: [],
    });
    const run = (st: ReturnType<typeof build>) => {
      for (let i = 0; i < 12; i++) { st.hand = []; conjureToHand(st, [CARD_INDEX['veinstorm']!], 1); }
      return st.board.map((c) => `${c.uid}:${c.attack}/${c.health}`).join('|');
    };
    expect(run(build()), 'the pick must consume the seeded run cursor, not Math.random').toBe(run(build()));
  });

  it('Mountainbond: every 8 Gold spent plays a Ruby on ALL your minions (Kobold and not)', () => {
    const s = recruit({
      board: [recruitBody('dw_mountainbond', 'mb'), recruitBody('k_gemheart', 'kb'), recruitBody('dw_brunni', 'dw')],
      hand: [], shop: [],
    });
    const stat = (uid: string) => { const c = s.board.find((b) => b.uid === uid)!; return c.attack + c.health; };
    const [kb0, dw0] = [stat('kb'), stat('dw')];
    applyGoldSpent(s, 8);
    expect(s.hand.filter((c) => CARD_INDEX[c.cardId]?.ruby).length, 'no hand-mint half anymore').toBe(0);
    expect(stat('kb'), 'the Kobold got a Ruby').toBeGreaterThan(kb0);
    expect(stat('dw'), 'the non-Kobold got a Ruby too (tribe: all)').toBeGreaterThan(dw0);
  });
});
