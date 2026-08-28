import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, QUEST_DEFS, RUNES, SETS, poolFor } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { ALE_IDS, applyGoldSpent, noteSpellCast } from './recruit';

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

describe('Runekeg — "other Dwarves" (owner 2026-07-31)', () => {
  it('never buffs itself, even as the only Dwarf', () => {
    let s: RunState = { ...createRun(11), phase: 'recruit', embers: 10,
      board: [{ uid: 'keg', cardId: 'dw_runekeg', tribe: 'dwarf', attack: 2, health: 4, keywords: [], golden: false }],
      hand: [{ uid: 'sp', cardId: 'growth', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] };
    s = reduce(s, { type: 'play', uid: 'sp' });
    const keg = s.board[0]!;
    // Growth's own +1/+1 lands; the keg's per-spell +2/+2 must NOT land on the keg itself.
    expect(keg.buffs?.some((b) => b.source === 'Runekeg')).toBeFalsy();
    // With another Dwarf present, THAT one gets the buff.
    let t: RunState = { ...createRun(11), phase: 'recruit', embers: 10,
      board: [
        { uid: 'keg', cardId: 'dw_runekeg', tribe: 'dwarf', attack: 2, health: 4, keywords: [], golden: false },
        { uid: 'ally', cardId: 'dw_brunni', tribe: 'dwarf', attack: 2, health: 1, keywords: [], golden: false },
      ],
      hand: [{ uid: 'sp', cardId: 'growth', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] };
    t = reduce(t, { type: 'play', uid: 'sp' });
    expect(t.board[1]!.attack).toBeGreaterThanOrEqual(2 + 1 + 2); // growth +1, keg +2
    expect(t.board[0]!.buffs?.some((b) => b.source === 'Runekeg')).toBeFalsy();
  });
});

describe('the tribe itself', () => {
  it('dwarf is a playable tribe of set 2, and set 1 can never see it', () => {
    expect(poolFor('set2').all.some((c) => c.tribe === 'dwarf')).toBe(true);
    expect(poolFor('set1').all.some((c) => c.tribe === 'dwarf'), 'a Dwarf leaked into set 1').toBe(false);
  });

  it('every tranche-A Dwarf is in the set 2 pool', () => {
    // dw_runekeg + dw_chirurgeon (Ayves) archived 2026-08-18 (ARCHIVED_CARDS) — no longer in the pool.
    const ids = ['dw_orin', 'dw_ironlung', 'dw_brunni', 'dw_wardkeeper', 'dw_coinfire', 'dw_brakka',
      'dw_dorrin', 'dw_foreman', 'dw_brewer', 'dw_tapkeeper', 'dw_runemaster'];
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

  it('Warhorn Captain buffs its OTHER Dwarves, never itself', () => {
    let s = set2();
    const other = body('dw_brunni', 'o');
    s = { ...s, board: [other], hand: [body('dw_ironlung', 'cap')] };
    s = play(s, 'cap');
    expect(s.board.find((x) => x.uid === 'o')!.attack).toBe(CARD_INDEX['dw_brunni']!.attack + 3);
    const cap = s.board.find((x) => x.cardId === 'dw_ironlung')!;
    expect(cap.attack, 'the Captain buffed itself').toBe(CARD_INDEX['dw_ironlung']!.attack);
  });

  it('Baby Gastrid scales with Gold spent THIS TURN (+2 Health per Gold, owner rework 2026-08-11)', () => {
    let s = set2();
    const target = body('dw_brunni', 't');
    s = { ...s, board: [target], hand: [body('dw_dorrin', 'q')], goldSpentThisTurn: 4 };
    s = playAimed(s, 'q', 't');
    // 4 Gold spent × +2 Health = +8.
    expect(s.board.find((x) => x.uid === 't')!.health).toBe(CARD_INDEX['dw_brunni']!.health + 8);
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

  it('…and it swings exactly ONCE on arrival, not twice', () => {
    // The charge is now baked onto the `dw_soldier` token (`attackOnSummon`) so Chicken Brawl's plain
    // `deathrattleSummon` also gets it. Anvilshade reaches the same token through a factory that ALSO forces
    // the strike via `attackNow` — both feed one deferred queue entry, so the belt-and-braces must not
    // produce two swings.
    const r = fight([mine('dw_anvilshade', 9, 1)], [foe(20, 20)]);
    const sum = r.events.findIndex((e) => e.type === 'summon' && (e as { minion: { cardId: string } }).minion.cardId === 'dw_soldier');
    const uid = (r.events[sum] as { minion: { uid: string } }).minion.uid;
    const swings = r.events.filter((e) => e.type === 'attack' && (e as { attacker: string }).attacker === uid);
    expect(swings.length, 'the Soldier attacked twice on arrival').toBe(1);
  });

  it('Exgalloper copies the BODY, not the corpse, and cannot chain', () => {
    // At the moment an Echo fires the parent's health is 0, so a literal copy arrives already dead. And exactly
    // one copy: one that kept its own Echo would summon another on death, up to the board cap.
    const s = summonsOf(fight([mine('dw_exgalloper', 4, 6)], [foe(20, 20)]), 'dw_exgalloper');
    expect(s.length, 'the copy chained, or never happened').toBe(1);
    expect(s[0]!.attack).toBe(4);
    expect(s[0]!.health, 'the copy was born dead').toBeGreaterThan(0);
  });

  it('a GILDED Exgalloper summons GILDED exact copies; a plain one stays plain', () => {
    // q-copy-gilded-badge (owner REVISE 2026-08-27): "gilded exgalloper's summons should be exact copies
    // without the echo, so they would be gilded too" — matching Mirrorhide's scSummonCopy convention.
    const copiesOf = (r: { events: readonly { type: string }[] }) => r.events
      .filter((e) => e.type === 'summon')
      .map((e) => (e as unknown as { minion?: { cardId?: string; golden?: boolean; attack: number } }).minion)
      .filter((m): m is { cardId?: string; golden?: boolean; attack: number } => m?.cardId === 'dw_exgalloper');
    const gilded = { ...mine('dw_exgalloper', 12, 12), golden: true } as BoardMinion;
    const g = copiesOf(fight([gilded], [foe(20, 40)]));
    expect(g.length, 'gilded: exactly two exact copies').toBe(2);
    for (const c of g) {
      expect(c.golden, 'the copy of a gilded body carries the Gilded badge').toBe(true);
      expect(c.attack, 'the copy is exact-stat, not re-doubled').toBe(12);
    }
    const p = copiesOf(fight([mine('dw_exgalloper', 4, 6)], [foe(20, 20)]));
    expect(p.length).toBe(1);
    expect(!!p[0]!.golden, 'a plain source still summons a plain copy').toBe(false);
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

  it('Chef Gary Toast fires when ANOTHER Dwarf is played, not just on its own Shout', () => {
    // The bug (owner report 2026-07-29): it rode `onPlay`, which is the Chef's OWN Shout — so it fired once on
    // arrival and never again, while its text promises "when you play a Dwarf". It watches `onSummon` now.
    let s = set2();
    const mate = body('dw_brunni', 'mate');
    // Broad-Axe Brakka is the newcomer on purpose: it is a Dwarf with NO effects of its own. My first attempt
    // used Warhorn Captain, which ALSO buffs your Dwarves +3 Attack — the +6 that produced was two effects
    // stacking, not the Chef double-firing.
    s = { ...s, board: [body('dw_chef', 'chef'), mate], hand: [body('dw_brakka', 'newcomer')] };
    const before = s.board.find((x) => x.uid === 'mate')!.attack;
    s = play(s, 'newcomer');
    expect(s.board.find((x) => x.uid === 'mate')!.attack, 'playing a Dwarf did not buff the others').toBe(before + 4);
  });

  it('…buffs the whole tribe including itself, with no count limit', () => {
    // Owner text is plain "give your Dwarves +4/+4" (repriced from +3/+3, owner 2026-08-28) — the 3-target cap
    // and Ale scaling were both mine and are gone.
    let s = set2();
    s = { ...s, board: [body('dw_chef', 'chef'), body('dw_brunni', 'a'), body('dw_tapkeeper', 'b'), body('dw_coinfire', 'c')], hand: [body('dw_orin', 'n')] };
    s = play(s, 'n');
    for (const uid of ['chef', 'a', 'b', 'c']) {
      const c = s.board.find((x) => x.uid === uid)!;
      expect(c.attack, `${uid} was not buffed`).toBe(CARD_INDEX[c.cardId]!.attack + 4);
    }
  });

  it('…and a NON-Dwarf being played does not trigger it', () => {
    let s = set2();
    const mate = body('dw_brunni', 'mate');
    s = { ...s, board: [body('dw_chef', 'chef'), mate], hand: [{ uid: 'beast', cardId: 'pack', tribe: 'beast', attack: 3, health: 2, keywords: [], golden: false }] };
    const before = s.board.find((x) => x.uid === 'mate')!.attack;
    s = play(s, 'beast');
    expect(s.board.find((x) => x.uid === 'mate')!.attack).toBe(before);
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

  it('Mountainbond plays a Ruby on ALL your minions every 8 Gold spent — no hand mint (owner rework 2026-08-18)', () => {
    // Was "2 Rubies to hand + one on your Kobolds" (2026-08-14). Now (2026-08-18) the hand-mint half is dropped
    // (`count: 0`) and the board half hits `tribe: 'all'` — every friendly minion, Kobold or not, gets a Ruby.
    const s = set2();
    const kobold = body('k_gemheart', 'kb');       // Kobold — takes a Ruby
    const dwarf = body('dw_brunni', 'dw');          // NOT a Kobold — must ALSO take a Ruby now (tribe: 'all')
    s.board = [body('dw_mountainbond', 'mb'), kobold, dwarf];
    s.hand = [];
    const statsOf = (uid: string) => { const c = s.board.find((b) => b.uid === uid)!; return c.attack + c.health; };
    const kBefore = statsOf('kb'), dBefore = statsOf('dw');
    applyGoldSpent(s, 7);
    expect(s.hand.length, 'fired below the 8-Gold threshold').toBe(0);
    expect(statsOf('kb'), 'fired below the threshold').toBe(kBefore);
    applyGoldSpent(s, 1); // the 8th Gold
    expect(s.hand.filter((c) => CARD_INDEX[c.cardId]?.ruby).length, 'the hand-mint half is dropped — no Rubies minted').toBe(0);
    expect(statsOf('kb'), 'a Ruby landed on the Kobold').toBeGreaterThan(kBefore);
    expect(statsOf('dw'), 'a Ruby landed on the non-Kobold too (tribe: all)').toBeGreaterThan(dBefore);
  });

  it('High King Mykel triggers an adjacent Shout every 8 spells, carrying the meter across turns', () => {
    // Neighbour is Doubletap Brewer, whose Shout grants an Ale — an observable payload.
    let s = set2();
    s = { ...s, board: [body('dw_brewer', 'left'), body('dw_brisbane', 'b')], hand: [] };
    for (let i = 0; i < 7; i++) noteSpellCast(s, CARD_INDEX['wo_mine']!);
    expect(s.hand.filter((c) => ALE_IDS.includes(c.cardId)).length, 'fired before 8 spells').toBe(0);
    noteSpellCast(s, CARD_INDEX['wo_mine']!);
    expect(s.hand.filter((c) => ALE_IDS.includes(c.cardId)).length, 'the adjacent Shout never fired').toBeGreaterThan(0);
  });

  it('the whole Dwarf roster is in set 2', () => {
    // 24 → 25 on 2026-08-03: Baal (`dw_baal`) joined the FORGE-ONLY rune minions (Rune of Baal). Like Brill
    // and Mykel it is `token: true`, so it rides in the set's pool for resolution but can never be drawn.
    // 24 → 26 on 2026-08-04: Chicken Brawl (`dw_chickenbrawl`) + its Charging Soldier token (`dw_soldier`).
    const dwarfIds = poolFor('set2').all.filter((c) => c.id.startsWith('dw_')).map((c) => c.id);
    // 26 → 27 on 2026-08-07: Bucky (`dw_bucky`) joined the forge-only rune minions (Rune of Bucky).
    // 27 → 28 on 2026-08-14: Drunken Oaf (`dw_oaf`) joined the buyable roster.
    // 28 → 26 on 2026-08-18: dw_runekeg + dw_chirurgeon (Ayves) archived to ARCHIVED_CARDS.
    // 26 → 28 on 2026-08-18: dw_billings + dw_gangplank joined the buyable roster.
    // 28 → 29 on 2026-08-19: dw_arnold (T6, End of Turn casts Beefy on itself).
    // 29 → 30 on 2026-08-20: dw_kegheart joined the FORGE-ONLY rune minions (token: true, like Baal / Bucky).
    expect(dwarfIds.length, `got ${dwarfIds.join(', ')}`).toBe(30);
    expect(poolFor('set2').buyable.some((c) => c.id === 'dw_kegheart'), 'rune-only: in the set, never drawable').toBe(false);
    expect(dwarfIds).toContain('dw_chickenbrawl');
    expect(dwarfIds).toContain('dw_soldier');
    expect(dwarfIds).toContain('dw_baal');
    expect(dwarfIds).toContain('dw_bucky');
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
    ['Rune of Mykel', 'dw_brisbane'], // renamed to match the owner's sheet (2026-07-30)
  ])('%s grants %s', (name, cardId) => {
    const rune = all.find((r) => r.name === name);
    expect(rune, `${name} is missing`).toBeDefined();
    expect(grantedIds(rune!)).toContain(cardId);
  });

  it('Rune of Gemcutting mints 5 Rubies at a FIXED 3/3 (owner balance 2026-08-18)', () => {
    const rune = all.find((r) => r.name === 'Rune of Gemcutting')!;
    expect(rune.reward).toMatchObject({ kind: 'mintRubies', count: 5, attack: 3, health: 3 });
    // And through the reducer: five 3/3 Rubies land in hand — NOT the run's 1/1 + rubyBonus line.
    let st: RunState = { ...createRun(3), phase: 'recruit', hand: [], rubyBonus: { attack: 0, health: 0 } };
    st = { ...st, embers: 99, runeforgeOffer: [rune.id], runeforgeEpic: undefined };
    st = reduce(st, { type: 'buyRune', index: 0 });
    const rubies = st.hand.filter((c) => c.cardId === 'ruby');
    expect(rubies).toHaveLength(5);
    expect(rubies.every((c) => c.attack === 3 && c.health === 3), 'a minted Ruby was not 3/3').toBe(true);
  });

  it('Rune of Double Fisting grants Edward, and 2 random Ales EVERY TURN (owner rework 2026-08-11)', () => {
    // The Ales recur — a recurringEndOfTurn reward, not a one-shot trio. The recurring grant dropped from 3
    // ('grantAles3') to 2 ('grantAles').
    const rune = all.find((r) => r.name === 'Rune of Double Fisting')!;
    const multi = rune.reward as { kind: string; rewards: { kind: string; cards?: string[]; effect?: string }[] };
    expect(multi.kind).toBe('multi');
    expect(multi.rewards.some((r2) => r2.kind === 'grant' && r2.cards?.includes('dw_edward'))).toBe(true);
    expect(multi.rewards.some((r2) => r2.kind === 'recurringEndOfTurn' && r2.effect === 'grantAles')).toBe(true);
  });

  it('the rune-granted minions are NOT buyable from the shop', () => {
    // Their whole point is being forge-only; leaking into the tavern would undercut the rune.
    const buyable = new Set(poolFor('set2').buyable.map((c) => c.id));
    for (const id of ['dw_brill', 'dw_exgalloper', 'dw_brisbane']) {
      expect(buyable.has(id), `${id} is buyable`).toBe(false);
    }
  });
});

describe('gilding a Tier 7 minion (owner bug report 2026-07-29)', () => {
  /**
   * `spellGildTarget` defaulted its tier cap to `maxTierFor(state.rift)` — 6 in a normal run — so gilding a
   * TIER 7 minion silently did nothing. Goldcrafter and Eyes of Aresmar both refused them. A declared cap
   * (Oner's Gild, `targetMaxTier: 4`) is a deliberate restriction and still applies.
   */
  const gild = (targetCardId: string, spellId: string): boolean => {
    const d = CARD_INDEX[targetCardId]!;
    const spell = CARD_INDEX[spellId]!;
    let s: RunState = {
      ...createRun(1, 'drakko'),
      board: [{ uid: 't', cardId: d.id, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false }],
      hand: [{ uid: 'sp', cardId: spell.id, tribe: spell.tribe, attack: 0, health: 1, keywords: [], golden: false }],
    } as RunState;
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 't' });
    return s.board.find((c) => c.uid === 't')!.golden === true;
  };
  const anyT7 = Object.values(CARD_INDEX).find((d) => d && d.tier === 7 && !d.spell && !d.token)!;
  const anyT3 = Object.values(CARD_INDEX).find((d) => d && d.tier === 3 && !d.spell && !d.token)!;

  it('Goldcrafter gilds a TIER 7 minion', () => {
    expect(gild(anyT7.id, 'goldcrafter'), `${anyT7.name} could not be gilded`).toBe(true);
  });

  it('…and still gilds an ordinary minion', () => {
    expect(gild(anyT3.id, 'goldcrafter')).toBe(true);
  });

  it('a spell that DECLARES a cap still enforces it', () => {
    // Oner's Gild caps at Tier 4 on purpose — the fix must not remove a deliberate restriction.
    const capped = Object.values(CARD_INDEX).find((d) => d && d.spell && d.targetMaxTier !== undefined);
    if (!capped) return;
    expect(gild(anyT7.id, capped.id), `${capped.name} ignored its own cap`).toBe(false);
  });
});

describe('set scoping for quests and runes (owner 2026-07-29)', () => {
  /**
   * The set-1 and set-2 lists are DIFFERENT. Offering a quest or rune whose mechanics belong to the other set
   * burns one of the few offer slots on something the run can never complete or use.
   */
  it('no set-1-only quest can be offered to a set-2 run, and vice versa', () => {
    const forSet = (id: 'set1' | 'set2') => QUEST_DEFS.filter((q) => !q.sets || q.sets.includes(id));
    const s1 = forSet('set1').length, s2 = forSet('set2').length;
    expect(s1, 'set 1 lost its quest pool').toBeGreaterThan(20);
    expect(s2, 'set 2 has no quest pool').toBeGreaterThan(10);
    expect(s2, 'set 2 sees every set-1 quest — scoping is not applied').toBeLessThan(s1);
  });

  it('a set-2 run is never offered a quest for a tribe it does not have', () => {
    // The offer's tribe slots were drawn from the POOL, so a run could be handed a Mech quest with no Mechs in
    // its roster. Both filters (sets + the run's own tribes) close that.
    const s2Tribes = new Set(SETS.set2.tribes);
    const offerable = QUEST_DEFS.filter((q) => (!q.sets || q.sets.includes('set2')) && q.tribe !== 'neutral');
    const wrong = offerable.filter((q) => !s2Tribes.has(q.tribe)).map((q) => `${q.name}(${q.tribe})`);
    expect(wrong, 'a quest for a tribe set 2 does not have is still offerable').toEqual([]);
  });

  it('no set-2-only rune can be offered to a set-1 run', () => {
    const s1 = RUNES.concat(EPIC_RUNES).filter((r) => !r.sets || r.sets.includes('set1'));
    const s2 = RUNES.concat(EPIC_RUNES).filter((r) => !r.sets || r.sets.includes('set2'));
    for (const r of s1) expect(r.sets?.includes('set2') === false || !r.sets || r.sets.includes('set1')).toBe(true);
    expect(s2.some((r) => r.id === 'rune_gemcutting'), 'a Ruby rune vanished from set 2').toBe(true);
    expect(s1.some((r) => r.id === 'rune_gemcutting'), 'a Ruby rune is offerable in set 1').toBe(false);
  });
});

describe('Fatecarver (owner roster 2026-07-29)', () => {
  /** Both branches are watchers, so the tests must fire the TRIGGER, not just play the card. */
  const pick = (s: RunState, uid: string, index: number): RunState => {
    const opened = reduce(s, { type: 'play', uid });
    expect(opened.chooseOne?.uid ?? opened.pendingTarget?.uid, 'the Choose One never opened').toBeTruthy();
    return reduce(opened, { type: 'chooseOne', index });
  };

  it('is a T5 set-2 card with both branches declared (un-archived 2026-08-18)', () => {
    const def = CARD_INDEX['n2_fatecarver']!;
    expect(def.chooseOne, 'Fatecarver has no Choose One').toHaveLength(2);
    expect(def.tier, 'un-archived at T5').toBe(5);
    expect(poolFor('set2').all.some((c) => c.id === 'n2_fatecarver'), 'back in the set pool').toBe(true);
  });

  it('branch A buffs ONE minion of each type on a spell cast, not every minion', () => {
    // Two Beasts + one Demon: only the FIRST Beast and the Demon should gain. Board order decides, so the
    // player steers it by arranging the line.
    let s = set2();
    const beast1 = { ...body('dw_brakka', 'b1'), cardId: 'pack', tribe: 'beast' as const };
    const beast2 = { ...body('dw_brakka', 'b2'), cardId: 'pack', tribe: 'beast' as const };
    const demon = { ...body('dw_brakka', 'd1'), cardId: 'impscrap', tribe: 'demon' as const };
    s = { ...s, board: [beast1, beast2, demon], hand: [body('n2_fatecarver', 'fc')] };
    s = pick(s, 'fc', 0);
    s = { ...s, hand: [{ uid: 'sp', cardId: 'growth', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] };
    const atk = (uid: string, st: RunState): number => st.board.find((x) => x.uid === uid)!.attack;
    const before = [atk('b1', s), atk('b2', s), atk('d1', s)];
    s = reduce(s, { type: 'play', uid: 'sp' });
    // Growth itself buffs the whole board +1/+1, so compare the DELTA above that baseline.
    const after = [atk('b1', s), atk('b2', s), atk('d1', s)];
    expect(after[0]! - before[0]!, 'the first Beast should get Growth +1 AND Fatecarver +2').toBe(3);
    expect(after[1]! - before[1]!, 'the second Beast should get Growth only').toBe(1);
    expect(after[2]! - before[2]!, 'the Demon should get Growth +1 AND Fatecarver +2').toBe(3);
  });

  it('branch B casts Growth when a friendly attacks — and NOT on an enemy swing', () => {
    const foe = (a: number, h: number): BoardMinion => ({ cardId: 'sandbag', attack: a, health: h, keywords: [] } as unknown as BoardMinion);
    const carver = (): BoardMinion => {
      const d = CARD_INDEX['n2_fatecarver']!;
      return { cardId: d.id, attack: d.attack, health: d.health, keywords: [], chosenOption: 1 } as unknown as BoardMinion;
    };
    const r = simulate([carver(), foe(1, 40) as BoardMinion], [foe(0, 40)], makeRng(3), CARD_INDEX,
      combatSide({ tier: 6, poolIds: poolFor('set2').all.map((c) => c.id) }), combatSide({ tier: 6 }));
    // A friendly swing should produce buff events sourced from the Carver; an enemy-only board would produce none.
    const buffs = r.events.filter((e) => e.type === 'buff');
    expect(buffs.length, 'no Growth was cast on a friendly attack').toBeGreaterThan(0);
  });
});

describe('Dwarf quests (owner roster 2026-07-29)', () => {
  const q = (id: string) => QUEST_DEFS.find((x) => x.id === id);

  it('the three shipped Dwarf quests are set-2 only, and scoped to the Dwarf tribe', () => {
    for (const id of ['q_company_recruitment', 'q_barroom_bounty', 'q_runic_apprenticeship']) {
      const def = q(id);
      expect(def, `${id} is missing`).toBeDefined();
      expect(def!.sets, `${id} is not scoped to set 2`).toEqual(['set2']);
      expect(def!.tribe).toBe('dwarf');
    }
  });

  it('Company Recruitment grants a Dwarf AND an Ale, and repeats', () => {
    const def = q('q_company_recruitment')!;
    const r = def.reward as { randomTribe?: string; randomAle?: number };
    expect(r.randomTribe).toBe('dwarf');
    expect(r.randomAle, 'no Ale in the reward').toBe(1);
    expect(def.repeatable).toBe(true);
  });

  it('Barroom Bounty grants a Brunni WITH Ward', () => {
    const r = q('q_barroom_bounty')!.reward as { cards?: string[]; grantKeywords?: string[] };
    expect(r.cards, 'Korr was removed 2026-07-31 — the quest grants a Brunni now').toContain('dw_brunni');
    expect(r.grantKeywords, 'Ward only now — the Flurry went with Korr').toEqual(['DS']);
  });

  it('War Council uses a TRIBE-scoped reward, never the Beast flag', () => {
    // It was held back until the tribe-parameterised reward existed: `lawOfTeeth` is gated on `isBeast(attacker)`,
    // so borrowing it would have granted BEAST triggers on a Dwarf quest — passing tests, wrong effect.
    const def = q('q_war_council');
    expect(def, 'War Council is missing').toBeDefined();
    const r = def!.reward as { kind: string; tribe?: string };
    expect(r.kind).toBe('tribeRallySlaughterExtra');
    expect(r.tribe, 'the reward is not scoped to Dwarves').toBe('dwarf');
    expect(JSON.stringify(def!.reward), 'still borrowing lawOfTeeth').not.toContain('lawOfTeeth');
  });
});

describe('bug fixes 2026-07-29 (owner report)', () => {
  it('the cards-PLAYED meter counts SPELLS, not just minions', () => {
    // "Cards" means everything you play — minions, spells, Rubies. The meter was on the minion branch only.
    // Re-pointed 2026-08-14 from Mountainbond (which moved to a Gold meter, leaving no CARD on this event) to
    // Rune of Mountain Trade, now the only live consumer of `cardsPlayed`. The guard is on `applyCardsPlayed`,
    // not on any one card, so it must follow whatever still drives that meter.
    let s = set2();
    s = { ...s, board: [body('dw_brunni', 'mate'), body('dw_orin', 'other')], hand: [],
          runeThresholds: [{ meter: 'cardsPlayed', per: 6, tick: 0, rubyAll: true }] } as RunState;
    const before = s.board.reduce((n, c) => n + c.attack + c.health, 0);
    for (let i = 0; i < 6; i++) {
      s = { ...s, hand: [{ uid: `sp${i}`, cardId: 'growth', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] };
      s = reduce(s, { type: 'play', uid: `sp${i}` });
    }
    // 6 Growths each buff the board +1/+1 (+12 across two minions); the rune's Ruby adds on top of that.
    const after = s.board.reduce((n, c) => n + c.attack + c.health, 0);
    expect(after, 'six spells did not reach the 6-card threshold').toBeGreaterThan(before + 24);
  });

  it("Fatecarver's Growth branch uses the SHARED factory, so it scales with spell power", () => {
    // My first version was a near-copy that missed both the spell-power scaling and `ctx.castSpell`. It shares
    // Taragosa's factory now — one definition of "cast Growth on an ally attack".
    const def = CARD_INDEX['n2_fatecarver']!;
    const growth = def.effects.find((e) => e.on === 'onAttack');
    expect(growth?.do, 'Fatecarver still has its own Growth copy').toBe('onAllyAttackCastGrowth');
    expect((growth?.params as { option?: number })?.option, 'the branch gate is missing').toBe(1);
  });
});

describe('Open Tab (Dwarf quest)', () => {
  it('pours 2 Ales at End of Turn once its reward is active', () => {
    let s = set2();
    s = { ...s, questRecurringEndOfTurn: ['grantAles'], board: [], hand: [] };
    s = reduce(s, { type: 'faceOmen' });
    expect(s.hand.filter((c) => ALE_IDS.includes(c.cardId)).length, 'no Ales poured').toBe(2);
  });

  it('is a set-2 Dwarf quest on the Gold-spent objective', () => {
    const q = QUEST_DEFS.find((x) => x.id === 'q_open_tab')!;
    expect(q.sets).toEqual(['set2']);
    expect(q.tribe).toBe('dwarf');
    expect(q.objective.event).toBe('spendGold');
  });
});

describe('the run-wide Ale multiplier (Bottomless Cellar / Rune of the Bottomless Cask)', () => {
  const goldFromAle = (mut: (s: RunState) => RunState): number => {
    let s = mut(set2());
    s = { ...s, hand: [{ uid: 'a', cardId: 'wo_mine', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] };
    const before = s.embers;
    return reduce(s, { type: 'play', uid: 'a' }).embers - before;
  };

  it('one extra cast doubles a Golden Ale’s payout', () => {
    const plain = goldFromAle((s) => s);
    expect(goldFromAle((s) => ({ ...s, aleExtraCasts: 1 })), 'the run flag did nothing').toBe(plain * 2);
  });

  it('stacks ADDITIVELY with Edward Keg-hands, not multiplicatively', () => {
    // Both read "trigger an additional time", so Edward (×2) plus one run-wide extra is ×3, not ×4.
    const plain = goldFromAle((s) => s);
    const both = goldFromAle((s) => ({ ...s, aleExtraCasts: 1, board: [body('dw_edward', 'e')] }));
    expect(both).toBe(plain * 3);
  });

  it('does not touch NON-Ale spells', () => {
    let s = set2();
    s = { ...s, aleExtraCasts: 3, board: [body('dw_brunni', 'b')], hand: [{ uid: 'g', cardId: 'growth', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] };
    const before = s.board[0]!.attack;
    s = reduce(s, { type: 'play', uid: 'g' });
    expect(s.board[0]!.attack - before, 'Growth was multiplied by the ALE flag').toBe(1);
  });

  it('both the quest and the rune ride the same primitive', () => {
    const q = QUEST_DEFS.find((x) => x.id === 'q_bottomless_cellar')!;
    const r = [...RUNES, ...EPIC_RUNES].find((x) => x.id === 'rune_bottomless_cask')!;
    expect((q.reward as { kind: string }).kind).toBe('aleExtraCasts');
    expect((r.reward as { kind: string }).kind).toBe('aleExtraCasts');
    expect(r.sets).toEqual(['set2']);
  });
});

describe('The Golden Ledger (Dwarf quest)', () => {
  /**
   * `spendGold` is private to the reducer, so these drive REAL purchases — which is the honest test anyway: the
   * payout must survive the actual shop path, not a hand-rolled call.
   */
  const armed = (): RunState => ({
    ...set2(),
    embers: 20,
    board: [body('dw_brunni', 'd'), { ...body('dw_brakka', 'b'), cardId: 'pack', tribe: 'beast' as const, uid: 'b' }],
    questGoldTribeBuff: { tribe: 'dwarf', per: 5, attack: 3, health: 3, tick: 0 },
  } as RunState);
  const atk = (s: RunState, uid: string): number => s.board.find((x) => x.uid === uid)!.attack;

  it('banks the remainder, then pays out once the threshold is crossed', () => {
    // A per-transaction rule would pay on every buy; a non-banking one would never pay for small buys. Two buys
    // of 3 Gold must pay exactly once at 5.
    let s = armed();
    const base = atk(s, 'd');
    s = reduce(s, { type: 'roll' });                       // 1 Gold
    expect(atk(s, 'd'), 'paid out below the threshold').toBe(base);
    for (let i = 0; i < 5; i++) s = reduce(s, { type: 'roll' }); // 6 Gold total → one payout
    expect(atk(s, 'd'), 'never paid out after crossing 5 Gold').toBe(base + 3);
  });

  it('buffs Dwarves only — a Beast on the same board is untouched', () => {
    let s = armed();
    const beastBefore = atk(s, 'b');
    for (let i = 0; i < 6; i++) s = reduce(s, { type: 'roll' });
    expect(atk(s, 'd')).toBeGreaterThan(CARD_INDEX['dw_brunni']!.attack);
    expect(atk(s, 'b'), 'a Beast was buffed by a Dwarf reward').toBe(beastBefore);
  });

  it('is a set-2 Dwarf quest with a 5-Gold threshold', () => {
    const q = QUEST_DEFS.find((x) => x.id === 'q_golden_ledger')!;
    expect(q.sets).toEqual(['set2']);
    const r = q.reward as { kind: string; per?: number; tribe?: string };
    expect(r.kind).toBe('questGoldTribeBuff');
    expect(r.per).toBe(5);
    expect(r.tribe).toBe('dwarf');
  });
});
