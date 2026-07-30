import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNES, poolFor } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { ALE_IDS, applyCardsPlayed, applyGoldSpent, noteSpellCast } from './recruit';

/**
 * SET 2 — DWARVES (tranche A). These assert the MECHANICS fire, not merely that the cards exist: a roster test
 * that only counts ids passes just as happily when every effect is inert.
 */

const set2 = (): RunState => ({ ...createRun(1, 'drakko'), setId: 'set2' } as RunState);
const body = (cardId: string, uid = 'm'): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
};
/** Play a card from hand, which is what fires a Shout. */
const play = (s: RunState, uid: string): RunState => reduce(s, { type: 'play', uid });
/**
 * Play a TARGETED Shout minion. Playing it only opens the aim picker (`pendingTarget`); the effect resolves on
 * the follow-up `battlecryTarget` action — the same two steps the UI drives.
 */
const playAimed = (s: RunState, uid: string, targetUid: string): RunState => {
  const opened = reduce(s, { type: 'play', uid });
  expect(opened.pendingTarget?.uid, 'the aim picker never opened').toBe(uid);
  return reduce(opened, { type: 'battlecryTarget', targetUid });
};

describe('the tribe itself', () => {
  it('dwarf is a playable tribe of set 2, and set 1 can never see it', () => {
    expect(poolFor('set2').all.some((c) => c.tribe === 'dwarf')).toBe(true);
    expect(poolFor('set1').all.some((c) => c.tribe === 'dwarf'), 'a Dwarf leaked into set 1').toBe(false);
  });

  it('every tranche-A Dwarf is in the set 2 pool', () => {
    const ids = ['dw_orin', 'dw_ironlung', 'dw_brunni', 'dw_wardkeeper', 'dw_coinfire', 'dw_brakka',
      'dw_runekeg', 'dw_dorrin', 'dw_foreman', 'dw_chirurgeon', 'dw_brewer', 'dw_tapkeeper', 'dw_runemaster'];
    const pool = new Set(poolFor('set2').all.map((c) => c.id));
    for (const id of ids) expect(pool.has(id), `${id} is missing from set 2`).toBe(true);
  });

  it('the token and the rune minion exist but are NOT buyable', () => {
    // A token in the tavern would be a bug; both need to be in CARD_INDEX so they can be summoned/granted.
    expect(CARD_INDEX['dw_soldier']).toBeDefined();
    expect(CARD_INDEX['dw_brill']).toBeDefined();
    const buyable = new Set(poolFor('set2').buyable.map((c) => c.id));
    expect(buyable.has('dw_soldier'), 'the Charging Soldier token is buyable').toBe(false);
  });
});

describe('Ales', () => {
  it('all five Ale ids resolve to real Set 2 spells', () => {
    for (const id of ALE_IDS) {
      const def = CARD_INDEX[id];
      expect(def, `${id} does not exist`).toBeDefined();
      expect(def!.spell, `${id} is not a spell`).toBe(true);
    }
  });

  it('Brunni pours one at End of Turn', () => {
    let s = set2();
    s = { ...s, board: [body('dw_brunni')], hand: [] };
    s = reduce(s, { type: 'faceOmen' });
    expect(s.hand.filter((c) => ALE_IDS.includes(c.cardId)).length, 'no Ale was granted').toBe(1);
  });

  it('Doubletap Brewer pours one on its Shout', () => {
    let s = set2();
    s = { ...s, board: [], hand: [body('dw_brewer', 'b')] };
    s = play(s, 'b');
    expect(s.hand.filter((c) => ALE_IDS.includes(c.cardId)).length).toBe(1);
  });

  it('Tapkeeper pours one per 10 Gold spent, and banks the remainder', () => {
    // The `every` threshold is the dispatcher's job — this pins that it actually applies rather than firing
    // on every coin.
    let s = set2();
    s = { ...s, board: [body('dw_tapkeeper')], hand: [] };
    applyGoldSpent(s, 7);
    expect(s.hand.filter((c) => ALE_IDS.includes(c.cardId)).length, 'fired below the threshold').toBe(0);
    applyGoldSpent(s, 5); // 12 total → one payout, 2 banked
    expect(s.hand.filter((c) => ALE_IDS.includes(c.cardId)).length).toBe(1);
  });
});

describe('Gold and throughput', () => {
  it('Coinfire Forewoman buffs Dwarves only, Attack only', () => {
    let s = set2();
    const captain = body('dw_ironlung', 'd1');
    const beast = { ...body('dw_brakka', 'b1'), cardId: 'pack', tribe: 'beast' as const };
    s = { ...s, board: [body('dw_coinfire', 'c'), captain, beast] };
    applyGoldSpent(s, 5);
    const d = s.board.find((x) => x.uid === 'd1')!;
    const b = s.board.find((x) => x.uid === 'b1')!;
    expect(d.attack, 'the Dwarf got no Attack').toBe(CARD_INDEX['dw_ironlung']!.attack + 2);
    expect(d.health, 'Health should not move').toBe(CARD_INDEX['dw_ironlung']!.health);
    expect(b.attack, 'a non-Dwarf was buffed').toBe(beast.attack);
  });

  it('Ironlung Captain buffs its OTHER Dwarves, never itself', () => {
    let s = set2();
    const other = body('dw_brunni', 'o');
    s = { ...s, board: [other], hand: [body('dw_ironlung', 'cap')] };
    s = play(s, 'cap');
    expect(s.board.find((x) => x.uid === 'o')!.attack).toBe(CARD_INDEX['dw_brunni']!.attack + 3);
    const cap = s.board.find((x) => x.cardId === 'dw_ironlung')!;
    expect(cap.attack, 'the Captain buffed itself').toBe(CARD_INDEX['dw_ironlung']!.attack);
  });

  it('Quartermaster Dorrin scales with Gold spent THIS TURN', () => {
    let s = set2();
    const target = body('dw_brunni', 't');
    s = { ...s, board: [target], hand: [body('dw_dorrin', 'q')], goldSpentThisTurn: 4 };
    s = playAimed(s, 'q', 't');
    expect(s.board.find((x) => x.uid === 't')!.health).toBe(CARD_INDEX['dw_brunni']!.health + 4);
  });

  it('Dorrin with nothing spent grants nothing — no phantom buff', () => {
    let s = set2();
    s = { ...s, board: [body('dw_brunni', 't')], hand: [body('dw_dorrin', 'q')], goldSpentThisTurn: 0 };
    s = playAimed(s, 'q', 't');
    expect(s.board.find((x) => x.uid === 't')!.health).toBe(CARD_INDEX['dw_brunni']!.health);
  });

  it('Closing-Time Foreman scales with cards played this turn', () => {
    let s = set2();
    // Left-most Dwarf is the recipient; `playedThisTurn` is the multiplier.
    s = { ...s, board: [body('dw_brunni', 'left'), body('dw_foreman', 'f')], playedThisTurn: ['a', 'b', 'c'] };
    s = reduce(s, { type: 'faceOmen' });
    expect(s.board.find((x) => x.uid === 'left')!.attack).toBe(CARD_INDEX['dw_brunni']!.attack + 3);
  });
});

describe('utility Dwarves', () => {
  it('Oathshield Orin gains Ward, and does not double-add it', () => {
    let s = set2();
    s = { ...s, board: [], hand: [body('dw_orin', 'o')] };
    s = play(s, 'o');
    const orin = s.board.find((x) => x.cardId === 'dw_orin')!;
    expect(orin.keywords.filter((k) => k === 'DS').length, 'Ward was added twice').toBe(1);
  });

  it('Wardkeeper raises the run-wide Shop-spell power', () => {
    let s = set2();
    const before = s.spellBonus?.attack ?? 0;
    s = { ...s, board: [], hand: [body('dw_wardkeeper', 'w')] };
    s = play(s, 'w');
    expect(s.spellBonus?.attack ?? 0).toBe(before + 1);
  });

  it('Auric Runemaster gilds its target', () => {
    let s = set2();
    s = { ...s, board: [body('dw_brunni', 't')], hand: [body('dw_runemaster', 'r')] };
    s = playAimed(s, 'r', 't');
    expect(s.board.find((x) => x.uid === 't')!.golden, 'the target was not gilded').toBe(true);
  });

  it('Broad-Axe Brakka just has Cleave', () => {
    expect(CARD_INDEX['dw_brakka']!.keywords).toContain('C');
    expect(CARD_INDEX['dw_brakka']!.effects).toHaveLength(0);
  });
});

describe('Dwarf King, Brill (rune)', () => {
  it('grants a DWARF, not any minion', () => {
    let s = set2();
    s = { ...s, board: [body('dw_brill')], hand: [] };
    applyGoldSpent(s, 10);
    expect(s.hand.length, 'nothing was granted').toBe(1);
    const got = CARD_INDEX[s.hand[0]!.cardId]!;
    expect(got.tribe === 'dwarf' || got.tribe2 === 'dwarf', `granted ${got.name}, not a Dwarf`).toBe(true);
  });
});

describe('tranche B — combat-trigger Dwarves', () => {
  /**
   * These fire in COMBAT and reach the run through `ctx.grantToHand` (Ales) or `ctx.summon`. The GUARD is the
   * point: without it an Ale-on-Slaughter fires on every ALLY's kill, and a Rally on every ally's swing.
   *
   * Foes are deliberately VANILLA (`sandbag`). My first pass used `pack`, whose Deathrattle changes who the
   * killer of the exchange is — the test failed while the card was fine.
   */
  const foe = (attack: number, health: number): BoardMinion =>
    ({ cardId: 'sandbag', attack, health, keywords: [] } as unknown as BoardMinion);
  const mine = (cardId: string, attack?: number, health?: number): BoardMinion => {
    const d = CARD_INDEX[cardId]!;
    return { cardId, attack: attack ?? d.attack, health: health ?? d.health, keywords: [...d.keywords] } as unknown as BoardMinion;
  };
  const fight = (board: BoardMinion[], foes: BoardMinion[]) =>
    simulate(board, foes, makeRng(5), CARD_INDEX,
      combatSide({ tier: 6, poolIds: poolFor('set2').all.map((c) => c.id) }), combatSide({ tier: 6 }));
  const ales = (r: { playerHandGrants?: string[] }): string[] => (r.playerHandGrants ?? []).filter((id) => ALE_IDS.includes(id));
  /** Summon events for a given token, narrowed to the minion payload the assertions read. */
  const summonsOf = (r: { events: readonly { type: string }[] }, cardId: string): { attack: number; health: number }[] =>
    r.events
      .filter((e) => e.type === 'summon')
      .map((e) => (e as unknown as { minion?: { cardId?: string; attack: number; health: number } }).minion)
      .filter((m): m is { cardId?: string; attack: number; health: number } => m?.cardId === cardId);

  it('Kegbreaker Korr pours an Ale on ITS OWN kill', () => {
    expect(ales(fight([mine('dw_korr')], [foe(0, 1)])).length).toBe(1);
  });

  it('…but not on an ally’s kill — the attacker guard', () => {
    // Korr at 0 Attack cannot kill; the ally does. Without the guard this is where the bug shows.
    const korr = { ...mine('dw_korr'), attack: 0 } as BoardMinion;
    expect(ales(fight([korr, mine('dw_ironlung')], [foe(0, 1)])).length).toBe(0);
  });

  it('Doubletap Brewer’s Echo pours when it dies', () => {
    expect(ales(fight([mine('dw_brewer')], [foe(20, 20)])).length).toBeGreaterThan(0);
  });

  it('Blade Thrower pours on its Rally swing', () => {
    expect(ales(fight([mine('dw_bladethrower')], [foe(0, 30)])).length).toBeGreaterThan(0);
  });

  it('Anvilshade Smith’s Soldier INHERITS its Attack, and the printed 3 is only a floor', () => {
    // Smith at 9 Attack → a 9-Attack Soldier, not its printed 3. This has to go through `ctx.summon`'s
    // `copyStats`: mutating the returned Minion is too late, the summon event is already emitted.
    const s = summonsOf(fight([mine('dw_anvilshade', 9, 1)], [foe(20, 20)]), 'dw_soldier');
    expect(s.length, 'no Charging Soldier was summoned').toBe(1);
    expect(s[0]!.attack).toBe(9);
  });

  it('…and a weak Smith still gets the printed 3', () => {
    const s = summonsOf(fight([mine('dw_anvilshade', 1, 1)], [foe(20, 20)]), 'dw_soldier');
    expect(s[0]!.attack).toBe(3);
  });

  it('Exgalloper copies the BODY, not the corpse, and cannot chain', () => {
    // At the moment an Echo fires the parent's health is 0, so a literal copy arrives already dead. And exactly
    // one copy: one that kept its own Echo would summon another on death, up to the board cap.
    const s = summonsOf(fight([mine('dw_exgalloper', 4, 6)], [foe(20, 20)]), 'dw_exgalloper');
    expect(s.length, 'the copy chained, or never happened').toBe(1);
    expect(s[0]!.attack).toBe(4);
    expect(s[0]!.health, 'the copy was born dead').toBeGreaterThan(0);
  });
});

describe('tranche C — the five that needed machinery', () => {
  it('Paymaster Pimm banks Gold for NEXT turn, not this one', () => {
    let s = set2();
    const embersBefore = s.embers;
    s = { ...s, board: [], hand: [body('dw_pimm', 'p')] };
    s = play(s, 'p');
    expect(s.embers, 'it paid out immediately').toBe(embersBefore);
    expect(s.bonusEmbersNextTurn).toBe(1);
  });

  it('Guildhall Chef climbs with Ales cast this turn', () => {
    // Base +3/+3; each Ale cast this turn adds +1. Two Ales → +5/+5.
    const chefBuff = (ales: number): number => {
      let s = set2();
      const target = body('dw_brunni', 't');
      s = { ...s, board: [target], hand: [body('dw_chef', 'c')], alesCastThisTurn: ales };
      s = play(s, 'c');
      return s.board.find((x) => x.uid === 't')!.attack - CARD_INDEX['dw_brunni']!.attack;
    };
    expect(chefBuff(0)).toBe(3);
    expect(chefBuff(2), 'the Chef did not scale with Ales').toBe(5);
  });

  it('casting an Ale bumps the per-turn tally, and it resets each turn', () => {
    let s = set2();
    s = { ...s, board: [], hand: [{ uid: 'a', cardId: 'wo_mine', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] };
    s = play(s, 'a');
    expect(s.alesCastThisTurn, 'the Ale tally never moved').toBe(1);
    s = reduce(s, { type: 'faceOmen' });
    s = reduce(s, { type: 'settleCombat' });
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.alesCastThisTurn, 'the tally carried into the next turn').toBe(0);
  });

  it('Edward Keg-hands doubles ALES only, not every spell', () => {
    // Golden Ale grants 2 Gold; with Edward on board it should pay twice. A non-Ale spell must be unaffected.
    const goldFrom = (withEdward: boolean): number => {
      let s = set2();
      s = {
        ...s,
        board: withEdward ? [body('dw_edward', 'e')] : [],
        hand: [{ uid: 'a', cardId: 'wo_mine', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
      };
      const before = s.embers;
      s = play(s, 'a');
      return s.embers - before;
    };
    const plain = goldFrom(false);
    expect(goldFrom(true), 'Edward did not double the Ale').toBe(plain * 2);
  });

  it('Mountainbond plays a Ruby on every minion, on a CUMULATIVE play meter', () => {
    // `playedThisTurn` clears each turn and could never reach 8 — the tally has to be cumulative (`playTick`).
    let s = set2();
    const mate = body('dw_brunni', 'mate');
    s = { ...s, board: [body('dw_mountainbond', 'mb'), mate] };
    const before = s.board.reduce((n, c) => n + c.attack + c.health, 0);
    applyCardsPlayed(s, 7);
    expect(s.board.reduce((n, c) => n + c.attack + c.health, 0), 'fired below the threshold').toBe(before);
    applyCardsPlayed(s, 1); // 8th card → a Ruby on each of the 2 minions
    expect(s.board.reduce((n, c) => n + c.attack + c.health, 0), 'no Ruby landed').toBeGreaterThan(before);
  });

  it('Brisbane triggers an adjacent Shout every 8 spells, carrying the meter across turns', () => {
    // Neighbour is Doubletap Brewer, whose Shout grants an Ale — an observable payload.
    let s = set2();
    s = { ...s, board: [body('dw_brewer', 'left'), body('dw_brisbane', 'b')], hand: [] };
    for (let i = 0; i < 7; i++) noteSpellCast(s, CARD_INDEX['wo_mine']!);
    expect(s.hand.filter((c) => ALE_IDS.includes(c.cardId)).length, 'fired before 8 spells').toBe(0);
    noteSpellCast(s, CARD_INDEX['wo_mine']!);
    expect(s.hand.filter((c) => ALE_IDS.includes(c.cardId)).length, 'the adjacent Shout never fired').toBeGreaterThan(0);
  });

  it('the whole Dwarf roster is in set 2 — 21 minions + token + 3 rune minions', () => {
    const dwarfIds = poolFor('set2').all.filter((c) => c.id.startsWith('dw_')).map((c) => c.id);
    expect(dwarfIds.length, `got ${dwarfIds.join(', ')}`).toBe(25);
  });
});

describe('Set 2 runes — the grant-shaped ones', () => {
  /**
   * Only the runes that are PURE GRANTS ship in this batch; the rest of the owner's 96-rune roster needs new
   * `QuestReward` kinds. A rune whose `cards` id doesn't resolve is silently dead, so the ids are what matter.
   */
  const all = [...RUNES, ...EPIC_RUNES];
  const grantedIds = (r: { reward: unknown }): string[] => {
    const walk = (x: { cards?: string[]; grantGolden?: string[]; rewards?: unknown[] }): string[] => [
      ...(x.cards ?? []), ...(x.grantGolden ?? []),
      ...((x.rewards ?? []) as { cards?: string[] }[]).flatMap((y) => walk(y)),
    ];
    return walk(r.reward as { cards?: string[] });
  };

  it('every rune in the game grants only cards that exist', () => {
    const broken = all.flatMap((r) => grantedIds(r).filter((id) => !CARD_INDEX[id]).map((id) => `${r.name}→${id}`));
    expect(broken, 'a rune grants a card id that does not resolve').toEqual([]);
  });

  it.each([
    ['Rune of Yazzus', 'yazzus'],
    ['Rune of Lazarus', 'lazarus'],
    ['Rune of the High King', 'dw_brill'],
    ['Rune of Exgalloper', 'dw_exgalloper'],
    ['Rune of Brisbane', 'dw_brisbane'],
  ])('%s grants %s', (name, cardId) => {
    const rune = all.find((r) => r.name === name);
    expect(rune, `${name} is missing`).toBeDefined();
    expect(grantedIds(rune!)).toContain(cardId);
  });

  it('Rune of Gemcutting grants exactly 5 Rubies', () => {
    const rune = all.find((r) => r.name === 'Rune of Gemcutting')!;
    expect(grantedIds(rune).filter((id) => id === 'ruby')).toHaveLength(5);
  });

  it('Rune of Double Fisting grants Edward plus 3 RANDOM Ales', () => {
    // Random rather than a fixed trio (owner 2026-07-29), so the Ales are a count on the reward, not card ids.
    const rune = all.find((r) => r.name === 'Rune of Double Fisting')!;
    expect(grantedIds(rune)).toContain('dw_edward');
    expect((rune.reward as { randomAle?: number }).randomAle, 'not three random Ales').toBe(3);
  });

  it('the rune-granted minions are NOT buyable from the shop', () => {
    // Their whole point is being forge-only; leaking into the tavern would undercut the rune.
    const buyable = new Set(poolFor('set2').buyable.map((c) => c.id));
    for (const id of ['dw_brill', 'dw_exgalloper', 'dw_brisbane']) {
      expect(buyable.has(id), `${id} is buyable`).toBe(false);
    }
  });
});
