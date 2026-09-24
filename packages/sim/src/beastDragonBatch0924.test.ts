import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { ARCHIVED_CARDS, ARCHIVED_RUNES, CARD_INDEX, EPIC_RUNES, RUNES, poolFor } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { applyEndOfTurn, fireRecruitDeathrattlesForTest, fireShopRally, fireSummonBuffs } from './recruit';

/**
 * The owner's Beast/Dragon batch (2026-09-24), pinned on the real reducer / simulate paths.
 *
 *   EXECUTE — "Execute is what we renamed Venom. it's the same mechanic as that but reworded." The keyword is `V`;
 *   Venom carries it; Raven and Tort grant it.
 *   GRIM — "+3/+2 for every Echo triggered this game", its own Echo counted (owner ruling).
 */

const bc = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, ...(d.tribe2 ? { tribe2: d.tribe2 } : {}), attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over } as BoardCard;
};
const shop = (board: BoardCard[], over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(5, 'warden', 'ascent', undefined, 'set2'), phase: 'recruit', embers: 30, board, hand: [], ...over } as RunState);
const on = (s: RunState, uid: string) => s.board.find((c) => c.uid === uid)!;

const bm = (cardId: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])], ...extra });
const fight = (player: BoardMinion[], enemy: BoardMinion[], seed = 3, deathrattles = 0) =>
  simulate(player, enemy, makeRng(seed), CARD_INDEX, combatSide({ tier: 6, tribes: ['beast', 'dragon'], deathrattles }), combatSide({ tier: 1 }));
const uidOf = (r: ReturnType<typeof simulate>, cardId: string, nth = 0) => r.initial.player.filter((m) => m.cardId === cardId)[nth]!.uid;
const executeGrants = (r: ReturnType<typeof simulate>) =>
  r.events.filter((e): e is Extract<CombatEvent, { type: 'keyword' }> => e.type === 'keyword' && e.keyword === 'V');
const buffs = (r: ReturnType<typeof simulate>) => r.events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff');

const set2Pool = new Set(poolFor('set2').buyable.map((c) => c.id));

// ── Execute ───────────────────────────────────────────────────────────────────────────────────────────────
describe('Execute is the Venom mechanic (owner 2026-09-24)', () => {
  it('Venom carries the Execute keyword and is drawable in set 2', () => {
    expect(CARD_INDEX['venom']!.keywords).toContain('V');
    expect(set2Pool.has('venom')).toBe(true);
  });
});

// ── 1. Grim ───────────────────────────────────────────────────────────────────────────────────────────────
describe('Grim: +3/+2 per Echo triggered this game, its own included', () => {
  it('is Tier 5, 7/1, and reads the per-game tally', () => {
    const g = CARD_INDEX['grim']!;
    expect([g.tier, g.attack, g.health]).toEqual([5, 7, 1]);
    expect(g.effects[0]).toMatchObject({ on: 'onDeath', do: 'deathrattleBuffTribeByTally', params: { tribe: 'beast', attack: 3, health: 2 } });
    expect(set2Pool.has('grim')).toBe(true);
  });

  it('COMBAT: the run-wide tally carries across fights, plus this fight\'s Echoes, plus Grim itself', () => {
    // 4 Echoes banked from earlier fights; T-Rex dies first this fight (1 more); then Grim (its own) → N = 6.
    const r = fight([bm('b2_trex', 1, 1), bm('grim', 1, 1), bm('alley', 1, 900)], [{ cardId: 'sandbag', attack: 1, health: 900 }], 3, 4);
    const ally = uidOf(r, 'alley');
    const grim = uidOf(r, 'grim');
    const fromGrim = buffs(r).filter((b) => b.target === ally && b.source === grim);
    expect(fromGrim.map((b) => [b.attack, b.health])).toEqual([[18, 12]]);
  });

  it('SHOP: an out-of-combat Echo reads the same tally and counts itself (Graverobber-class proc)', () => {
    const s = shop([bc('g', 'grim'), bc('t', 'b2_trex')], { deathrattlesTriggered: 2 });
    fireRecruitDeathrattlesForTest(s, on(s, 'g'));
    expect(s.deathrattlesTriggered).toBe(3);
    expect(on(s, 't').attack - CARD_INDEX['b2_trex']!.attack, '3 Echoes x +3').toBe(9);
    expect(on(s, 't').health - CARD_INDEX['b2_trex']!.health, '3 Echoes x +2').toBe(6);
  });

  it('GILDED doubles the rate', () => {
    const s = shop([bc('g', 'grim', { golden: true }), bc('t', 'b2_trex')], { deathrattlesTriggered: 0 });
    fireRecruitDeathrattlesForTest(s, on(s, 'g'));
    expect([on(s, 't').attack - CARD_INDEX['b2_trex']!.attack, on(s, 't').health - CARD_INDEX['b2_trex']!.health]).toEqual([6, 4]);
  });
});

// ── 2. Wolvie (shop half; the combat half lives in beastBatchAug12.test.ts) ───────────────────────────────
describe('Wolvie: "Taunt. Echo: Give a Beast +2/+4 and Rise." (SHOP)', () => {
  it('a shop-fired Echo gives a random OTHER Beast +2/+4 and Rise, never a non-Beast', () => {
    const s = shop([bc('w', 'b2_wolvie'), bc('a', 'alley'), bc('d', 'd2_broodfire')]);
    fireRecruitDeathrattlesForTest(s, on(s, 'w'));
    expect([on(s, 'a').attack - CARD_INDEX['alley']!.attack, on(s, 'a').health - CARD_INDEX['alley']!.health]).toEqual([2, 4]);
    expect(on(s, 'a').keywords).toContain('R');
    expect(on(s, 'd').keywords).not.toContain('R');
    expect(on(s, 'w').keywords, 'never itself').not.toContain('R');
  });

  it('prefers a Beast without Rise, so the keyword is not wasted', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const s = shop([bc('w', 'b2_wolvie'), bc('r', 'alley', { keywords: ['R'] }), bc('a', 'alley')], { rngCursor: seed } as Partial<RunState>);
      fireRecruitDeathrattlesForTest(s, on(s, 'w'));
      expect(on(s, 'a').keywords, `seed ${seed}`).toContain('R');
      expect(on(s, 'r').attack, `seed ${seed}: the Beast that already had Rise was passed over`).toBe(CARD_INDEX['alley']!.attack);
    }
  });

  it('GILDED: 2 different Beasts, each +4/+8 and Rise', () => {
    const s = shop([bc('w', 'b2_wolvie', { golden: true }), bc('a', 'alley'), bc('b', 'alley'), bc('c', 'alley')]);
    fireRecruitDeathrattlesForTest(s, on(s, 'w'));
    const hit = ['a', 'b', 'c'].filter((u) => on(s, u).keywords.includes('R'));
    expect(hit.length).toBe(2);
    for (const u of hit) expect([on(s, u).attack - CARD_INDEX['alley']!.attack, on(s, u).health - CARD_INDEX['alley']!.health]).toEqual([4, 8]);
  });

  it('keeps Taunt and prints the owner text', () => {
    const w = CARD_INDEX['b2_wolvie']!;
    expect(w.keywords).toEqual(['T']);
    expect(w.text).toBe('**Taunt. Echo:** give a **Beast** **+2/+4** and **Rise**.');
  });
});

// ── 3/4/7. Archives ───────────────────────────────────────────────────────────────────────────────────────
describe('archived: Dunkey, Moira, Moonhowl Mentor, Embercrest, and Rune of the White Wolf', () => {
  it('the four minions are in the archive, in no set pool, and still resolve by id', () => {
    for (const id of ['b2_dunkey', 'b2_moira', 'b2_moonhowl', 'd2_embercrest']) {
      expect(ARCHIVED_CARDS.some((c) => c.id === id), `${id} archived`).toBe(true);
      expect(set2Pool.has(id), `${id} left set 2`).toBe(false);
      expect(CARD_INDEX[id], `${id} still resolves`).toBeDefined();
    }
  });

  it('Rune of the White Wolf (the Moonhowl Mentor Mage-Pup rune) is archived; nothing live teaches a Mage-Pup', () => {
    expect(ARCHIVED_RUNES.some((r) => r.id === 'rune_white_wolf')).toBe(true);
    expect([...RUNES, ...EPIC_RUNES].some((r) => r.id === 'rune_white_wolf')).toBe(false);
    const live = [...RUNES, ...EPIC_RUNES].filter((r) => (r.previewCards ?? []).includes('b2_magepup') || /Mage-Pup|Moonhowl/.test(r.text));
    expect(live.map((r) => r.id)).toEqual([]);
  });
});

// ── 5/6/8/9. Dragons ──────────────────────────────────────────────────────────────────────────────────────
describe('Dragon balance (owner 2026-09-24)', () => {
  it('Karwind T4, +2/+2 per Shout (SHOP, through the real reducer)', () => {
    const k = CARD_INDEX['karwind']!;
    expect(k.tier).toBe(4);
    let s = shop([bc('k', 'karwind', { attack: 2, health: 12 })], { hand: [bc('c', 'cleric')], shop: [] });
    s = reduce(s, { type: 'play', uid: 'c' });
    // Hoard Cleric's Shout +3/+3 to Dragons, then Karwind's reaction +2/+2.
    expect([on(s, 'k').attack, on(s, 'k').health]).toEqual([2 + 3 + 2, 12 + 3 + 2]);
  });

  it('Mushy T4, Flutterdrake T4, Earthbreaker T3', () => {
    expect(CARD_INDEX['d2_scalefeather']!.tier).toBe(4);
    expect(CARD_INDEX['d2_flutterdrake']!.tier).toBe(4);
    expect(CARD_INDEX['d2_scalechanter']!.tier).toBe(3);
  });

  it('Earthbreaker: each Shop spell gives your Dragons +2/+1 (gilded +4/+2)', () => {
    for (const golden of [false, true]) {
      let s = shop([bc('e', 'd2_scalechanter', { golden })], { hand: [{ uid: 'sp', cardId: 'emberpouch', tribe: 'neutral', attack: 0, health: 0, keywords: [], golden: false } as BoardCard] });
      const before = [on(s, 'e').attack, on(s, 'e').health];
      s = reduce(s, { type: 'play', uid: 'sp' });
      const g = golden ? 2 : 1;
      expect([on(s, 'e').attack - before[0]!, on(s, 'e').health - before[1]!]).toEqual([2 * g, 1 * g]);
    }
  });
});

// ── 10. Raven ─────────────────────────────────────────────────────────────────────────────────────────────
describe('Raven: Rally: give another Beast Execute', () => {
  it('is a set-2 T4 4/6 Beast with Rally', () => {
    const d = CARD_INDEX['b2_raven']!;
    expect([d.tribe, d.tier, d.attack, d.health, d.keywords]).toEqual(['beast', 4, 4, 6, ['RL']]);
    expect(set2Pool.has('b2_raven')).toBe(true);
  });

  it('COMBAT: its attack grants Execute to a random OTHER Beast without it, never itself, never a non-Beast', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const r = fight([bm('b2_raven', 4, 900), bm('alley', 1, 900), bm('d2_broodfire', 1, 900)], [{ cardId: 'sandbag', attack: 0, health: 90000 }], seed);
      const raven = uidOf(r, 'b2_raven');
      const grants = executeGrants(r).filter((k) => k.source === raven);
      expect(grants.length, 'the Rally fired at least once').toBeGreaterThan(0);
      expect(grants.every((k) => k.target === uidOf(r, 'alley')), 'only the other Beast').toBe(true);
      expect(grants.length, 'never re-granted to a body that already has it').toBe(1);
    }
  });

  it('COMBAT GILDED: two different Beasts', () => {
    const r = fight([bm('b2_raven', 4, 900, { golden: true }), bm('alley', 1, 900), bm('alley', 1, 900)], [{ cardId: 'sandbag', attack: 0, health: 90000 }]);
    const raven = uidOf(r, 'b2_raven');
    const first = executeGrants(r).filter((k) => k.source === raven);
    expect(new Set(first.map((k) => k.target)).size).toBe(2);
  });

  it('SHOP: a shop Rally (End-of-Turn replay) grants Execute to the other Beast', () => {
    const s = shop([bc('r', 'b2_raven'), bc('a', 'alley')]);
    fireShopRally(s, on(s, 'r'));
    expect(on(s, 'a').keywords).toContain('V');
    expect(on(s, 'r').keywords).not.toContain('V');
  });

  it('no legal target is a quiet no-op', () => {
    const s = shop([bc('r', 'b2_raven')]);
    fireShopRally(s, on(s, 'r'));
    expect(on(s, 'r').keywords).toEqual(['RL']);
  });
});

// ── 11. Tort ──────────────────────────────────────────────────────────────────────────────────────────────
describe('Tort: Avenge (4): give another Beast Execute', () => {
  it('is a set-2 T5 2/9 Beast', () => {
    const d = CARD_INDEX['b2_tort']!;
    expect([d.tribe, d.tier, d.attack, d.health]).toEqual(['beast', 5, 2, 9]);
    expect(set2Pool.has('b2_tort')).toBe(true);
  });

  it('COMBAT: after 4 friendly deaths, another Beast gains Execute', () => {
    const r = fight([
      bm('stray', 1, 1), bm('stray', 1, 1), bm('stray', 1, 1), bm('stray', 1, 1),
      bm('b2_tort', 0, 9000), bm('alley', 0, 9000),
    ], [{ cardId: 'sandbag', attack: 5, health: 90000 }]);
    const tort = uidOf(r, 'b2_tort');
    const grants = executeGrants(r).filter((k) => k.source === tort);
    expect(grants.map((k) => k.target)).toEqual([uidOf(r, 'alley')]);
  });
});

// ── 12. Flo Rida ──────────────────────────────────────────────────────────────────────────────────────────
describe('Flo Rida: when you summon a Beast, give your Beasts +4/+4', () => {
  it('is a set-2 T6 7/5 Beast', () => {
    const d = CARD_INDEX['b2_florida']!;
    expect([d.tribe, d.tier, d.attack, d.health]).toEqual(['beast', 6, 7, 5]);
    expect(set2Pool.has('b2_florida')).toBe(true);
  });

  it('SHOP: playing a Beast buffs every Beast (itself and the arriver included), not the Dragon', () => {
    let s = shop([bc('f', 'b2_florida'), bc('a', 'alley'), bc('d', 'd2_broodfire')], { hand: [bc('n', 'b2_packstrider')] });
    s = reduce(s, { type: 'play', uid: 'n' });
    expect(on(s, 'f').attack).toBe(7 + 4);
    expect(on(s, 'a').attack).toBe(CARD_INDEX['alley']!.attack + 4);
    expect(on(s, 'n').attack, 'the arriving Beast is one of your Beasts').toBe(CARD_INDEX['b2_packstrider']!.attack + 4);
    expect(on(s, 'd').attack, 'not a Beast').toBe(CARD_INDEX['d2_broodfire']!.attack);
  });

  it('SHOP: a token summon (Pack Leader’s Echo in the Shop) fires it once per Beast summoned', () => {
    const s = shop([bc('f', 'b2_florida'), bc('p', 'pack'), bc('a', 'alley')]);
    fireRecruitDeathrattlesForTest(s, on(s, 'p'));
    expect(s.board.filter((c) => c.cardId === 'pup').length).toBe(2);
    expect(on(s, 'f').attack, 'two summons, +4 each').toBe(7 + 8);
    expect(on(s, 'a').attack).toBe(CARD_INDEX['alley']!.attack + 8);
  });

  it('END OF TURN: a Beast summoned at End of Turn fires it too (Spots under Rune of Combat Prowess procs Pack Leader)', () => {
    const s = shop([bc('p', 'pack'), bc('sp', 'b2_spots'), bc('f', 'b2_florida')], { runeCombatProwess: true } as Partial<RunState>);
    applyEndOfTurn(s);
    const pups = s.board.filter((c) => c.cardId === 'pup').length;
    expect(pups, 'the End-of-Turn Echo summoned Pups').toBeGreaterThan(0);
    expect(on(s, 'f').attack - 7, '+4 per Beast summoned at End of Turn').toBe(pups * 4);
  });

  it('SHOP: its own arrival does not trigger it', () => {
    const s = shop([bc('a', 'alley'), bc('f', 'b2_florida')]);
    fireSummonBuffs(s, on(s, 'f'));
    expect(on(s, 'a').attack).toBe(CARD_INDEX['alley']!.attack);
  });

  it('COMBAT: an Echo-summoned Beast buffs the Beasts (+8/+8 gilded)', () => {
    for (const golden of [false, true]) {
      const r = fight([bm('pack', 1, 1), bm('b2_florida', 7, 900, golden ? { golden: true } : {})], [{ cardId: 'sandbag', attack: 1, health: 90000 }]);
      const flo = uidOf(r, 'b2_florida');
      const selfBuffs = buffs(r).filter((b) => b.target === flo && b.source === flo);
      expect(selfBuffs.length, 'one per summoned Pup').toBe(2);
      expect(selfBuffs.every((b) => b.attack === (golden ? 8 : 4) && b.health === (golden ? 8 : 4))).toBe(true);
    }
  });
});

// ── 13. Beev ──────────────────────────────────────────────────────────────────────────────────────────────
describe('Beev: when a Beast attacks, give it and this +2/+2', () => {
  it('is a set-2 T3 4/4 Beast', () => {
    const d = CARD_INDEX['b2_beev']!;
    expect([d.tribe, d.tier, d.attack, d.health]).toEqual(['beast', 3, 4, 4]);
    expect(set2Pool.has('b2_beev')).toBe(true);
  });

  it('COMBAT: another Beast attacking buffs it AND Beev; a Dragon attacking buffs nobody', () => {
    const r = fight([bm('alley', 1, 900), bm('b2_beev', 0, 900), bm('d2_broodfire', 1, 900)], [{ cardId: 'sandbag', attack: 0, health: 90000 }]);
    const beev = uidOf(r, 'b2_beev');
    const alley = uidOf(r, 'alley');
    const dragon = uidOf(r, 'd2_broodfire');
    const fromBeev = buffs(r).filter((b) => b.source === beev);
    expect(fromBeev.some((b) => b.target === alley && b.attack === 2 && b.health === 2)).toBe(true);
    expect(fromBeev.some((b) => b.target === beev && b.attack === 2 && b.health === 2)).toBe(true);
    expect(fromBeev.some((b) => b.target === dragon), 'a Dragon attacking is not a Beast attacking').toBe(false);
  });

  it('COMBAT: when Beev itself attacks it gains +2/+2 once ("it" and "this" are one body)', () => {
    const r = fight([bm('b2_beev', 1, 900)], [{ cardId: 'sandbag', attack: 0, health: 90000 }]);
    const beev = uidOf(r, 'b2_beev');
    const firstAttack = r.events.findIndex((e) => e.type === 'attack' && e.attacker === beev);
    const nextAttack = r.events.findIndex((e, i) => i > firstAttack && e.type === 'attack');
    const window = r.events.slice(firstAttack, nextAttack < 0 ? undefined : nextAttack);
    const own = window.filter((e) => e.type === 'buff' && e.target === beev && e.source === beev);
    expect(own.length).toBe(1);
  });

  it('SHOP: a Beast Rally replay in the shop pays Beev and the rallier', () => {
    const s = shop([bc('p', 'b2_packstrider'), bc('b', 'b2_beev')]);
    const pBefore = on(s, 'p').attack;
    fireShopRally(s, on(s, 'p'));
    expect(on(s, 'b').attack).toBe(4 + 2);
    expect(on(s, 'p').attack - pBefore, 'Packstrider own Rally (+1 per Beast = +2) and Beev (+2)').toBeGreaterThanOrEqual(2);
  });
});

// ── 14. Humphry ───────────────────────────────────────────────────────────────────────────────────────────
describe('Humphry: Shout: give a friendly Dragon +3/+4', () => {
  it('is a set-2 T3 3/5 Dragon, targeted at Dragons', () => {
    const d = CARD_INDEX['d2_humphry']!;
    expect([d.tribe, d.tier, d.attack, d.health, d.target, d.targetTribe]).toEqual(['dragon', 3, 3, 5, 'friendly', 'dragon']);
    expect(set2Pool.has('d2_humphry')).toBe(true);
  });

  it('SHOP: the aimed Shout lands +3/+4 on the chosen Dragon (gilded +6/+8)', () => {
    for (const golden of [false, true]) {
      let s = shop([bc('d', 'd2_broodfire')], { hand: [bc('h', 'd2_humphry', { golden })] });
      s = reduce(reduce(s, { type: 'play', uid: 'h' }), { type: 'battlecryTarget', targetUid: 'd' });
      const g = golden ? 2 : 1;
      expect([on(s, 'd').attack, on(s, 'd').health]).toEqual([CARD_INDEX['d2_broodfire']!.attack + 3 * g, CARD_INDEX['d2_broodfire']!.health + 4 * g]);
    }
  });
});
