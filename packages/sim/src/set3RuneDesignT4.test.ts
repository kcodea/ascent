/**
 * SET 3 RUNE DESIGN PASS, TRANCHE 4 (owner 2026-09-27): the HYBRID runes, SHOP / END OF TURN / settle halves through
 * the real reducer and the real Shop chokepoints. The combat halves are
 * `packages/core/src/combat/set3RuneDesignT4.test.ts`. No Tavern Tab (owner); its Dwarf + Spirit slot is the owner's
 * pick, the Last Call, shipped as "Rune of Closing Time" (the Set 2 `rune_last_call` owns "Rune of Last Call").
 */
import { describe, expect, it } from 'vitest';
import { ALE_IDS, RUBY_TYPE_IDS, type CardDef } from '@game/core';
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import { applyEndOfTurn, applyGoldSpent, castSpell, destroyMinionInShop, displayedStatsOf, grimToastFold, makeContext, mintRubies, raiseUndeadAuraShop, GEM_STAR_CAP } from './recruit';
import { questCombatMods } from './reducer';
import { createStarform, starformStats } from './starform';
import { createRun, reduce, type BoardCard, type BoardSnapshot, type RunState } from './index';

const probe = (id: string, over: Partial<CardDef>): CardDef => ({ id, name: id, tribe: 'kobold', tier: 1, attack: 1, health: 1, keywords: [], effects: [], text: '', ...over });
const KOBOLD = probe('dbg_t4s_kobold', { attack: 2, health: 2 });
const RISER = probe('dbg_t4s_riser', { attack: 2, health: 2, keywords: ['R'] });
const UNDEAD = probe('dbg_t4s_undead', { tribe: 'undead', attack: 2, health: 2 });
const NEUTRAL = probe('dbg_t4s_neutral', { tribe: 'neutral', attack: 2, health: 2 });
const HELD = probe('dbg_t4s_held', { tribe: 'neutral', attack: 1, health: 1 });
const DWARF = probe('dbg_t4s_dwarf', { tribe: 'dwarf', attack: 2, health: 2 });
const UNDEAD_DWARF = probe('dbg_t4s_udwarf', { tribe: 'dwarf', tribe2: 'undead', attack: 2, health: 2 });
const EOT_ALE = probe('dbg_t4s_eotale', { tribe: 'dwarf', effects: [{ on: 'endOfTurn', do: 'castSpell', params: { spellId: 'wo_attack' } }] });
const EOT_RUBY = probe('dbg_t4s_eotruby', { tribe: 'neutral', effects: [{ on: 'endOfTurn', do: 'endOfTurnPlayRuby', params: { tribe: 'kobold', count: 1 } }] });
const EOT_LANTERN = probe('dbg_t4s_eotlantern', { tribe: 'undead', effects: [{ on: 'endOfTurn', do: 'castSpell', params: { spellId: 'lanternofsouls' } }] });
for (const c of [KOBOLD, RISER, UNDEAD, NEUTRAL, HELD, DWARF, UNDEAD_DWARF, EOT_ALE, EOT_RUBY, EOT_LANTERN]) CARD_INDEX[c.id] = c;

const card = (id: string, uid: string): BoardCard => {
  const c = CARD_INDEX[id]!;
  return { uid, cardId: id, tribe: c.tribe, attack: c.attack, health: c.health, keywords: [...c.keywords], golden: false } as BoardCard;
};
const run = (board: BoardCard[], runes: string[], hand: BoardCard[] = []): RunState => {
  let s: RunState = { ...createRun(11, 'warden', 'ascent', undefined, 'set3'), phase: 'recruit', embers: 30, hand: [], board } as RunState;
  for (const id of runes) s = reduce(s, { type: 'devGrant', kind: 'rune', id });
  return { ...s, discover: undefined, discoverQueue: undefined, hand };
};
const SRC = { cardId: 'dbg_t4s', name: 'Test' };
const sf = (s: RunState): [number, number] | null => { const st = starformStats(s); return st ? [st.attack, st.health] : null; };
const at = (s: RunState, uid: string) => [...s.board, ...s.hand].find((c) => c.uid === uid)!;
const stats = (s: RunState, uid: string): [number, number] => [at(s, uid).attack, at(s, uid).health];
/** Mint one plain Ruby into hand and play it on `target`. */
const playRuby = (s: RunState, target: string): RunState => {
  mintRubies(s, 1);
  const ruby = s.hand[s.hand.length - 1]!;
  return reduce(s, { type: 'play', uid: ruby.uid, targetUid: target });
};

describe('the tranche 4 roster (owner 2026-09-27)', () => {
  it('eight hybrid runes at the doc costs, Set 3 only, gated to both tribes; no Tavern Tab', () => {
    const want: [string, number, boolean, string[]][] = [
      ['rune_minted_gems', 2, false, ['kobold', 'dwarf']], ['rune_gem_crypt', 3, false, ['kobold', 'undead']],
      ['rune_pallbearer', 4, false, ['undead', 'spirit']], ['rune_star_tap', 3, false, ['dwarf', 'celestial']],
      ['rune_closing_time', 3, false, ['dwarf', 'spirit']], ['rune_grim_toast', 4, true, ['dwarf', 'undead']],
      ['rune_gem_star', 4, true, ['kobold', 'celestial']], ['rune_keepsake_gem', 4, true, ['kobold', 'spirit']],
    ];
    for (const [id, cost, epic, tribes] of want) {
      const r = RUNE_INDEX[id]!;
      expect([r.cost, !!r.epic, r.sets, r.tribes], id).toEqual([cost, epic, ['set3'], tribes]);
      expect(r.text, `${id}: no em dash`).not.toMatch(/—|--/);
    }
    expect(RUNE_INDEX['rune_tavern_tab']).toBeUndefined();
    // The owner's texts, verbatim.
    expect(RUNE_INDEX['rune_minted_gems']!.text).toBe('When you spend **8 Gold**, get a random **Ruby**.');
    expect(RUNE_INDEX['rune_grim_toast']!.text).toBe('Your **Dwarves** also get your **Undead Aura**.');
    expect(RUNE_INDEX['rune_closing_time']!.text).toBe('When you sell a **Reveler**, get a **Dwarven Ale**.');
    expect(RUNE_INDEX['rune_keepsake_gem']!.text).toBe('Your **Rubies** also cast on the left-most minion in your hand.');
    expect(RUNE_INDEX['rune_last_call']!.sets, 'the Set 2 Rune of Last Call is untouched').toEqual(['set2']);
  });
});

describe('Rune of Minted Gems', () => {
  it('every 8 Gold spent gets one random Ruby (any of the six types); 7 is not enough', () => {
    const s = run([], ['rune_minted_gems']);
    applyGoldSpent(s, 7);
    expect(s.hand.filter((c) => CARD_INDEX[c.cardId]?.ruby)).toHaveLength(0);
    applyGoldSpent(s, 1);
    const rubies = s.hand.filter((c) => CARD_INDEX[c.cardId]?.ruby);
    expect(rubies).toHaveLength(1);
    expect(RUBY_TYPE_IDS).toContain(rubies[0]!.cardId);
    applyGoldSpent(s, 16);
    expect(s.hand.filter((c) => CARD_INDEX[c.cardId]?.ruby)).toHaveLength(3);
  });
  it('a real buy spends through the same meter (the badge reads x/8)', () => {
    let s = run([], ['rune_minted_gems']);
    const t = s.runeThresholds!.find((x) => x.sourceId === 'rune_minted_gems')!;
    expect([t.meter, t.per, t.grantRandomRuby]).toEqual(['gold', 8, 1]);
    const offer = s.shop.find((o) => { const d = CARD_INDEX[o.cardId]; return !!d && !d.spell && !o.starform; })!;
    s = reduce(s, { type: 'buy', uid: offer.uid });
    expect(s.runeThresholds!.find((x) => x.sourceId === 'rune_minted_gems')!.tick).toBeGreaterThan(0);
  });
});

describe('Rune of the Gem Crypt — Shop', () => {
  it('a Shop Rise brings the body back with the Rubies it had; without the rune it returns printed', () => {
    for (const rune of [true, false]) {
      const s = run([card(RISER.id, 'r'), card(NEUTRAL.id, 'n')], rune ? ['rune_gem_crypt'] : []);
      const r = at(s, 'r');
      r.buffs = [{ source: 'Ruby', attack: 3, health: 3, count: 1 }];
      r.attack += 3; r.health += 3;
      destroyMinionInShop(makeContext(s), r);
      const back = s.board.find((c) => c.cardId === RISER.id)!;
      expect(back, 'it rose').toBeDefined();
      expect([back.attack, back.health], rune ? 'kept its Rubies' : 'printed').toEqual(rune ? [5, 4] : [2, 1]);
    }
  });
});

describe('Rune of the Pallbearer — Shop', () => {
  it('a friendly Undead destroyed in the Shop gives the left-most hand minion +2/+2; a non-Undead pays nothing', () => {
    const s = run([card(UNDEAD.id, 'u'), card(NEUTRAL.id, 'n')], ['rune_pallbearer'], [card('crescendo', 'sp'), card(HELD.id, 'h')]);
    destroyMinionInShop(makeContext(s), at(s, 'n'));
    expect(stats(s, 'h')).toEqual([1, 1]);
    destroyMinionInShop(makeContext(s), at(s, 'u'));
    expect(stats(s, 'h')).toEqual([3, 3]);
  });
  it('combat: an Undead death buffs the held card, and the buff is on the run hand after settle', () => {
    let s = run([card(UNDEAD.id, 'u')], ['rune_pallbearer'], [card(HELD.id, 'h')]);
    const foes: BoardSnapshot = { v: 1, wave: s.wave, heroId: 'indy', resolve: 30, tier: 1, triples: 0, tribes: [], threat: 'glass', power: 1, minions: [{ cardId: 'sandbag', attack: 50, health: 500, keywords: [] }], seed: 1, origin: 'self' };
    s = reduce({ ...s, servedBoards: { [s.wave]: foes } }, { type: 'faceOmen' });
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.lastCombat!.events.some((e) => e.type === 'questTrigger' && e.flag === 'runePallbearer')).toBe(true);
    expect(stats(s, 'h')).toEqual([3, 3]);
  });
});

describe('Rune of the Star Tap — Shop and End of Turn', () => {
  it('every Dwarven Ale cast gives the Starform +3/+3; another spell does not; no Starform = nothing', () => {
    const s = run([card(DWARF.id, 'd')], ['rune_star_tap']);
    castSpell(s, CARD_INDEX['wo_attack']!, at(s, 'd'));
    expect(sf(s), 'no Starform yet').toBeNull();
    createStarform(s, SRC);
    const before = sf(s)!;
    castSpell(s, CARD_INDEX['wo_attack']!, at(s, 'd'));
    expect(sf(s)).toEqual([before[0] + 3, before[1] + 3]);
    castSpell(s, CARD_INDEX['crescendo']!);
    expect(sf(s)).toEqual([before[0] + 3, before[1] + 3]);
  });
  it('an Ale cast at End of Turn feeds it too', () => {
    const s = run([card(EOT_ALE.id, 'e')], ['rune_star_tap']);
    createStarform(s, SRC);
    const before = sf(s)!;
    applyEndOfTurn(s);
    expect(sf(s)).toEqual([before[0] + 3, before[1] + 3]);
  });
});

describe('Rune of Closing Time (the owner\'s Last Call)', () => {
  it('selling a Reveler gets a Dwarven Ale; selling anything else does not', () => {
    let s = run([card('sp3_flamereveler', 'f'), card(NEUTRAL.id, 'n')], ['rune_closing_time']);
    s = reduce(s, { type: 'sell', uid: 'n' });
    expect(s.hand.filter((c) => ALE_IDS.includes(c.cardId))).toHaveLength(0);
    s = reduce(s, { type: 'sell', uid: 'f' });
    expect(s.hand.filter((c) => ALE_IDS.includes(c.cardId))).toHaveLength(1);
  });
});

describe('Rune of the Grim Toast — the one Aura fold', () => {
  it('a non-Undead Dwarf shows the whole Undead Aura (Lantern + buy Attack, Soul Furnace Health), live; an Undead Dwarf once', () => {
    const s = run([card(DWARF.id, 'd'), card(UNDEAD_DWARF.id, 'ud'), card(NEUTRAL.id, 'n')], ['rune_grim_toast', 'rune_soul_furnace']);
    raiseUndeadAuraShop(s, 4);
    s.undeadBuyAtk = 2;
    expect(grimToastFold(s)).toEqual({ attack: 6, health: s.undeadHealthBonus });
    expect(s.undeadHealthBonus, 'the Soul Furnace term rides the Aura Health').toBeGreaterThan(0);
    expect(displayedStatsOf(s, at(s, 'd'))).toEqual({ attack: 2 + 6, health: 2 + s.undeadHealthBonus });
    expect(displayedStatsOf(s, at(s, 'ud')), 'an Undead Dwarf folds the Undead Lantern channel, not twice').toEqual({ attack: 2 + 4, health: 2 + s.undeadHealthBonus });
    expect(displayedStatsOf(s, at(s, 'n'))).toEqual({ attack: 2, health: 2 });
    raiseUndeadAuraShop(s, 1);
    expect(displayedStatsOf(s, at(s, 'd')).attack, 'a Shop Aura rise shows at once').toBe(2 + 7);
    expect(questCombatMods(s).runeGrimToast).toBe(true);
  });
  it('without the rune a Dwarf folds nothing', () => {
    const s = run([card(DWARF.id, 'd')], []);
    raiseUndeadAuraShop(s, 4);
    expect(grimToastFold(s)).toBeUndefined();
    expect(displayedStatsOf(s, at(s, 'd'))).toEqual({ attack: 2, health: 2 });
  });
  it('an Aura rise at End of Turn (a Lantern of Souls cast) reaches the Dwarves too', () => {
    const s = run([card(EOT_LANTERN.id, 'l'), card(DWARF.id, 'd')], ['rune_grim_toast']);
    const before = displayedStatsOf(s, at(s, 'd')).attack;
    applyEndOfTurn(s);
    expect(s.undeadAttackBonus).toBeGreaterThan(0);
    expect(displayedStatsOf(s, at(s, 'd')).attack).toBe(before + s.undeadAttackBonus);
  });
});

describe('Rune of the Gem Star — Shop and End of Turn', () => {
  it('the first 4 Rubies cast each turn give the Starform their stats; the 5th does not; combat gets what is left', () => {
    let s = run([card(KOBOLD.id, 'k')], ['rune_gem_star']);
    createStarform(s, SRC);
    const before = sf(s)!;
    for (let i = 0; i < GEM_STAR_CAP; i++) s = playRuby(s, 'k');
    expect(sf(s)).toEqual([before[0] + 4, before[1] + 4]);
    expect(questCombatMods(s).gemStarLeft).toBe(0);
    s = playRuby(s, 'k');
    expect(sf(s), 'the fifth Ruby does not feed it').toEqual([before[0] + 4, before[1] + 4]);
  });
  it('the combat mods carry the turn\'s remaining count', () => {
    let s = run([card(KOBOLD.id, 'k')], ['rune_gem_star']);
    createStarform(s, SRC);
    s = playRuby(s, 'k');
    expect(questCombatMods(s).gemStarLeft).toBe(3);
    expect(questCombatMods(s).runeGemStar).toBe(true);
  });
  it('a Ruby cast at End of Turn counts', () => {
    const s = run([card(EOT_RUBY.id, 'e'), card(KOBOLD.id, 'k')], ['rune_gem_star']);
    createStarform(s, SRC);
    const before = sf(s)!;
    applyEndOfTurn(s);
    expect(s.gemStarThisTurn).toBe(1);
    expect(sf(s)![0]).toBeGreaterThan(before[0]);
  });
});

describe('Rune of the Keepsake Gem — Shop and End of Turn', () => {
  it('every Ruby cast on a minion also lands on the left-most minion in hand (spells and Rubies in hand skipped)', () => {
    let s = run([card(KOBOLD.id, 'k')], ['rune_keepsake_gem'], [card('crescendo', 'sp'), card(HELD.id, 'h'), card(NEUTRAL.id, 'n')]);
    s = playRuby(s, 'k');
    expect(stats(s, 'k')).toEqual([3, 3]);
    expect(stats(s, 'h')).toEqual([2, 2]);
    expect(stats(s, 'n'), 'only the left-most').toEqual([2, 2]);
    s = playRuby(s, 'k');
    expect(stats(s, 'h'), 'every Ruby, not only the first each turn').toEqual([3, 3]);
  });
  it('the relay is not a cast: a Ruby watcher on the board hears exactly one Ruby per cast (no loop)', () => {
    let s = run([card(KOBOLD.id, 'k')], ['rune_keepsake_gem', 'rune_gem_star'], [card(HELD.id, 'h')]);
    createStarform(s, SRC);
    s = playRuby(s, 'k');
    expect(s.gemStarThisTurn, 'the relay to the hand did not count as a second Ruby').toBe(1);
  });
  it('an empty hand: nothing; a Ruby cast at End of Turn relays too', () => {
    let s = run([card(KOBOLD.id, 'k')], ['rune_keepsake_gem']);
    s = playRuby(s, 'k');
    expect(stats(s, 'k')).toEqual([3, 3]);
    const e = run([card(EOT_RUBY.id, 'e'), card(KOBOLD.id, 'k')], ['rune_keepsake_gem'], [card(HELD.id, 'h')]);
    applyEndOfTurn(e);
    expect(stats(e, 'h')[0]).toBeGreaterThan(1);
  });
});
