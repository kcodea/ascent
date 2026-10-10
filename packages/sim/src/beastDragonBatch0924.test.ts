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
 *   GRIM — superseded 2026-09-28 (flat "+8/+8 this combat"; pinned in beastCombatOnly0928.test.ts).
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

// ── 1. Grim — SUPERSEDED 2026-09-28: the per-game Echo tally is gone; Grim is "Echo: Give all Beasts +8/+8 this
//    combat." (R-AURA-03). Its pins live in beastCombatOnly0928.test.ts.

// ── 2. Wolvie (shop half; the combat half lives in beastBatchAug12.test.ts) ───────────────────────────────
// RE-PINNED 2026-10-07 (owner batch): "Taunt. Echo: Give a friendly Beast Rise." No stats; gilded = 2 Beasts.
describe('Wolvie: "Taunt. Echo: Give a friendly Beast Rise." (SHOP)', () => {
  it('a shop-fired Echo gives a random OTHER Beast Rise and no stats, never a non-Beast', () => {
    const s = shop([bc('w', 'b2_wolvie'), bc('a', 'alley'), bc('d', 'd2_broodfire')]);
    fireRecruitDeathrattlesForTest(s, on(s, 'w'));
    expect([on(s, 'a').attack, on(s, 'a').health]).toEqual([CARD_INDEX['alley']!.attack, CARD_INDEX['alley']!.health]);
    expect(on(s, 'a').keywords).toContain('R');
    expect(on(s, 'd').keywords).not.toContain('R');
    expect(on(s, 'w').keywords, 'never itself').not.toContain('R');
  });

  it('prefers a Beast without Rise, so the keyword is not wasted', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const s = shop([bc('w', 'b2_wolvie'), bc('r', 'alley', { keywords: ['R'] }), bc('a', 'alley')], { rngCursor: seed } as Partial<RunState>);
      fireRecruitDeathrattlesForTest(s, on(s, 'w'));
      expect(on(s, 'a').keywords, `seed ${seed}`).toContain('R');
    }
  });

  it('GILDED: two different Beasts take Rise, still no stats', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = shop([bc('w', 'b2_wolvie', { golden: true }), bc('a', 'alley'), bc('b', 'alley'), bc('c', 'alley')], { rngCursor: seed } as Partial<RunState>);
      fireRecruitDeathrattlesForTest(s, on(s, 'w'));
      const hit = ['a', 'b', 'c'].filter((u) => on(s, u).keywords.includes('R'));
      expect(hit.length, `seed ${seed}: two Beasts`).toBe(2);
      for (const u of ['a', 'b', 'c']) expect(on(s, u).attack, `seed ${seed}: ${u} has no stat change`).toBe(CARD_INDEX['alley']!.attack);
    }
  });

  it('keeps Taunt and prints the owner text', () => {
    const w = CARD_INDEX['b2_wolvie']!;
    expect(w.keywords).toEqual(['T']);
    expect(w.text).toBe('**Taunt. Echo:** give a friendly **Beast** **Rise**.');
    expect(w.goldenText).toBe('**Taunt. Echo:** give **2** friendly **Beasts** **Rise**.');
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
  // RE-PIN 2026-10-10 (owner balance batch): Karwind is now T5, +4/+4 (was T4, +2/+2).
  it('Karwind T5, +4/+4 per Shout (SHOP, through the real reducer)', () => {
    const k = CARD_INDEX['karwind']!;
    expect(k.tier).toBe(5);
    let s = shop([bc('k', 'karwind', { attack: 2, health: 12 })], { hand: [bc('c', 'cleric')], shop: [] });
    s = reduce(s, { type: 'play', uid: 'c' });
    // Hoard Cleric's Shout +3/+3 to Dragons, then Karwind's reaction +4/+4.
    expect([on(s, 'k').attack, on(s, 'k').health]).toEqual([2 + 3 + 4, 12 + 3 + 4]);
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
// RE-PINNED 2026-10-07 (owner batch): "When you summon a Beast, give it +5/+5 and improve this." Each Beast
// summoned with Flo out gets the current grant (5, 10, 15 ...), and Flo itself is not buffed. Every phase still fires.
describe('Flo Rida: when you summon a Beast, give it +5/+5 and improve this', () => {
  it('is a set-2 T6 7/5 Beast', () => {
    const d = CARD_INDEX['b2_florida']!;
    expect([d.tribe, d.tier, d.attack, d.health]).toEqual(['beast', 6, 7, 5]);
    expect(set2Pool.has('b2_florida')).toBe(true);
  });

  it('SHOP: playing a Beast buffs THAT Beast +5/+5 only, not Flo, the board or the Dragon', () => {
    let s = shop([bc('f', 'b2_florida'), bc('a', 'alley'), bc('d', 'd2_broodfire')], { hand: [bc('n', 'b2_packstrider')] });
    s = reduce(s, { type: 'play', uid: 'n' });
    expect(on(s, 'f').attack).toBe(7);
    expect(on(s, 'a').attack).toBe(CARD_INDEX['alley']!.attack);
    expect(on(s, 'n').attack, 'the arriving Beast').toBe(CARD_INDEX['b2_packstrider']!.attack + 5);
    expect(on(s, 'd').attack, 'not a Beast').toBe(CARD_INDEX['d2_broodfire']!.attack);
  });

  it('SHOP: a token summon (Pack Leader’s Echo in the Shop) fires it once per Beast, improving between them (+5, +10)', () => {
    const s = shop([bc('f', 'b2_florida'), bc('p', 'pack'), bc('a', 'alley')]);
    fireRecruitDeathrattlesForTest(s, on(s, 'p'));
    const pups = s.board.filter((c) => c.cardId === 'pup');
    expect(pups.length).toBe(2);
    expect(pups.map((c) => c.attack - CARD_INDEX['pup']!.attack).sort((x, y) => x - y)).toEqual([5, 10]);
  });

  it('END OF TURN: a Beast summoned at End of Turn fires it too (Spots under Rune of Combat Prowess procs Pack Leader)', () => {
    const s = shop([bc('p', 'pack'), bc('sp', 'b2_spots'), bc('f', 'b2_florida')], { runeCombatProwess: true } as Partial<RunState>);
    applyEndOfTurn(s);
    const pups = s.board.filter((c) => c.cardId === 'pup');
    expect(pups.length, 'the End-of-Turn Echo summoned Pups').toBeGreaterThan(0);
    expect(pups.every((c) => c.attack > CARD_INDEX['pup']!.attack), 'each End-of-Turn Pup got the grant').toBe(true);
  });

  it('SHOP: its own arrival does not trigger it', () => {
    const s = shop([bc('a', 'alley'), bc('f', 'b2_florida')]);
    fireSummonBuffs(s, on(s, 'f'));
    expect(on(s, 'a').attack).toBe(CARD_INDEX['alley']!.attack);
  });

  it('COMBAT: Echo-summoned Beasts take +5 then +10 (gilded +10 then +20)', () => {
    for (const golden of [false, true]) {
      const r = fight([bm('pack', 1, 1), bm('b2_florida', 7, 900, golden ? { golden: true } : {})], [{ cardId: 'sandbag', attack: 1, health: 90000 }]);
      const flo = uidOf(r, 'b2_florida');
      const grants = buffs(r).filter((b) => b.source === flo && b.target !== flo).map((b) => [b.attack, b.health]);
      expect(grants).toEqual(golden ? [[10, 10], [20, 20]] : [[5, 5], [10, 10]]);
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
describe('Humphry: Shout: give a friendly Dragon +5/+5 (owner ruling 2026-09-24)', () => {
  it('is a set-2 T3 3/5 Dragon, targeted at Dragons', () => {
    const d = CARD_INDEX['d2_humphry']!;
    expect([d.tribe, d.tier, d.attack, d.health, d.target, d.targetTribe]).toEqual(['dragon', 3, 3, 5, 'friendly', 'dragon']);
    expect(set2Pool.has('d2_humphry')).toBe(true);
  });

  // RE-PIN 2026-10-10 (owner balance batch): "+2/+2 for every Dragon played this turn" (was a flat +5/+5). Played as
  // the turn's first Dragon, Humphry counts itself: +2/+2 (gilded +4/+4). The count rule lives in dragonBatch1010.test.ts.
  it('SHOP: the aimed Shout lands +2/+2 on the chosen Dragon as the first Dragon played (gilded +4/+4)', () => {
    for (const golden of [false, true]) {
      let s = shop([bc('d', 'd2_broodfire')], { hand: [bc('h', 'd2_humphry', { golden })] });
      s = reduce(reduce(s, { type: 'play', uid: 'h' }), { type: 'battlecryTarget', targetUid: 'd' });
      const g = golden ? 2 : 1;
      expect([on(s, 'd').attack, on(s, 'd').health]).toEqual([CARD_INDEX['d2_broodfire']!.attack + 2 * g, CARD_INDEX['d2_broodfire']!.health + 2 * g]);
    }
  });

  it('prints the owner text, plain and gilded', () => {
    const d = CARD_INDEX['d2_humphry']!;
    expect(d.text).toBe('**Shout:** give a friendly **Dragon +2/+2** for every **Dragon** played this turn.');
    expect(d.goldenText).toBe('**Shout:** give a friendly **Dragon +4/+4** for every **Dragon** played this turn.');
  });
});
