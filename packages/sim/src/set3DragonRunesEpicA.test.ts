import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type QuestCombatMods } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNES, RUNE_INDEX, poolFor } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { questCombatMods } from './reducer';
import { makeContext } from './recruit';

/**
 * SET 3 DRAGON RUNES, EPIC A (owner 2026-10-21): the seven easier Epic Dragon runes.
 *
 *  - War Council: "Start of Combat: Cast Runebind on 3 random Dragons."            (R-DRAGONRUNE-A-01)
 *  - Growing Inferno: "Dragon attacks in combat cast Growth."                      (R-DRAGONRUNE-A-02)
 *  - Secret Exchange: "After you cast 3 Whispers from hand, Discover a Shop spell." (R-DRAGONRUNE-A-03)
 *  - Runebound Brood: "Drake Pups you summon cast Runebind on themselves."          (R-DRAGONRUNE-A-04)
 *  - Unbroken Scales: "The first 2 times your Dragons lose Ward each combat, give it +10/+10 and Ward." (R-DRAGONRUNE-A-05)
 *  - Runic Transposition: "Whispers that give a Dragon Health also give it that much Attack." (R-DRAGONRUNE-A-06)
 *  - Wyrm's Hoard: "After you cast 3 Shop spells from hand, permanently improve your Shop spells by +1/+1." (R-DRAGONRUNE-A-03)
 */

const IDS = ['rune_war_council', 'rune_growing_inferno', 'rune_secret_exchange', 'rune_runebound_brood', 'rune_unbroken_scales', 'rune_runic_transposition', 'rune_wyrms_hoard'];

const bc = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
/** Buy a rune through the REAL Runeforge path in a Set 3 Dragon run. */
function withRune(id: string, extra: Partial<RunState> = {}, s0?: RunState): RunState {
  const def = RUNE_INDEX[id]!;
  const s = (s0 ?? {
    ...createRun(3, 'runesmith', 'ascent', undefined, 'set3'),
    tribes: ['kobold', 'dwarf', 'undead', 'spirit', 'dragon'], wave: 7, tier: 6, phase: 'recruit', embers: 40, hand: [], board: [],
    ...extra,
  }) as RunState;
  return act({ ...s, embers: 40, runeforgeOffer: [id], runeforgeEpic: !!def.epic } as RunState, { type: 'buyRune', index: 0 });
}
const play = (s: RunState, uid: string, targetUid?: string): RunState => act(s, { type: 'play', uid, ...(targetUid ? { targetUid } : {}) } as Action);
const tick = (s: RunState, id: string): number => s.runeThresholds!.find((t) => t.sourceId === id)!.tick;

const m = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack: CARD_INDEX[cardId]!.attack, health: CARD_INDEX[cardId]!.health, keywords: [...CARD_INDEX[cardId]!.keywords], ...over } as unknown as BoardMinion);
const wall = (attack = 1): BoardMinion[] => [{ cardId: 'sandbag', attack, health: 5000, keywords: [] } as unknown as BoardMinion];
const fight = (p: BoardMinion[], mods: QuestCombatMods, seed = 5, foe = wall()) =>
  simulate(p, foe, makeRng(seed), CARD_INDEX, combatSide({ tier: 6, questMods: mods }), combatSide({ tier: 6 }));
type Sc = Extract<CombatEvent, { type: 'sc' }>;
type Buff = Extract<CombatEvent, { type: 'buff' }>;
const scs = (events: readonly CombatEvent[], rune: string) => events.filter((e): e is Sc => e.type === 'sc' && e.rune === rune);
const buffs = (events: readonly CombatEvent[], spellId: string) => events.filter((e): e is Buff => e.type === 'buff' && e.spellId === spellId);

describe('the roster', () => {
  it('seven Epic Dragon runes, Set 3 only, Dragon-gated, the draft costs, no em dash, owner texts', () => {
    const want: Record<string, [string, number]> = {
      rune_war_council: ['War Council', 5],
      rune_growing_inferno: ['Growing Inferno', 5],
      rune_secret_exchange: ['Secret Exchange', 4],
      rune_runebound_brood: ['Runebound Brood', 4],
      rune_unbroken_scales: ['Unbroken Scales', 5],
      rune_runic_transposition: ['Runic Transposition', 4],
      rune_wyrms_hoard: ["Wyrm's Hoard", 4],
    };
    for (const id of IDS) {
      const r = RUNE_INDEX[id]!;
      expect(EPIC_RUNES.includes(r), `${id} is Epic by array`).toBe(true);
      expect(RUNES.includes(r)).toBe(false);
      expect(r.epic).toBe(true);
      expect([r.name, r.cost]).toEqual(want[id]);
      expect(r.sets).toEqual(['set3']);
      expect(r.tribes).toEqual(['dragon']);
      expect(/—|--/.test(r.text), r.text).toBe(false);
    }
    // No name collision with any other rune (the quest "War Council" is a Set 2 Dwarf QUEST, a different kind).
    const names = [...RUNES, ...EPIC_RUNES].map((r) => r.name);
    for (const id of IDS) expect(names.filter((n) => n === RUNE_INDEX[id]!.name)).toHaveLength(1);
    // The named cards resolve, and Growth is a Set 3 Shop spell.
    for (const id of ['w4_runebind', 'growth', 'd3_drakepup']) expect(CARD_INDEX[id], id).toBeDefined();
    expect(poolFor('set3').spells.some((c) => c.id === 'growth')).toBe(true);
  });

  it('buying a flag rune arms the run flag and the combat mods carry it', () => {
    for (const [id, flag] of [['rune_war_council', 'runeWarCouncil'], ['rune_growing_inferno', 'runeGrowingInferno'], ['rune_runebound_brood', 'runeRuneboundBrood'], ['rune_unbroken_scales', 'runeUnbrokenScales'], ['rune_runic_transposition', 'runeRunicTransposition']] as const) {
      const s = withRune(id);
      expect(s.questFlags?.[flag], id).toBe(true);
      expect(questCombatMods(s)[flag], id).toBe(true);
    }
  });
});

describe('R-DRAGONRUNE-A-01: Rune of the War Council', () => {
  const dragons = (n: number) => Array.from({ length: n }, () => m('d4_galas', { attack: 0, health: 50 }));
  it('Start of Combat: Runebind on 3 DIFFERENT random Dragons, each a real counted cast that improves the next', () => {
    const r = fight([...dragons(5), m('venom', { attack: 0, health: 50 })], { runeWarCouncil: true }, 5, wall(0));
    const casts = scs(r.events, 'rune_war_council');
    expect(casts).toHaveLength(3);
    const targets = casts.map((c) => c.target);
    expect(new Set(targets).size).toBe(3);
    const dragonUids = r.initial.player.filter((x) => x.cardId === 'd4_galas').map((x) => x.uid);
    for (const t of targets) expect(dragonUids).toContain(t);
    expect(buffs(r.events, 'w4_runebind').map((b) => b.attack)).toEqual([2, 4, 6]);
    expect(r.playerShoutCarry?.whisperImprove).toEqual({ w4_runebind: 6 });
    expect(r.playerSpellsCast).toBe(3);
  });

  it('fewer than 3 Dragons: every Dragon once; no Dragons: nothing', () => {
    expect(scs(fight(dragons(2), { runeWarCouncil: true }, 5, wall(0)).events, 'rune_war_council')).toHaveLength(2);
    expect(scs(fight([m('venom', { attack: 0, health: 50 })], { runeWarCouncil: true }, 5, wall(0)).events, 'rune_war_council')).toHaveLength(0);
  });

  it('two copies: two rounds of 3; same seed, same picks (deterministic)', () => {
    const a = fight(dragons(5), { runeWarCouncil: true, flagCopies: { runeWarCouncil: 2 } }, 9, wall(0));
    const b = fight(dragons(5), { runeWarCouncil: true, flagCopies: { runeWarCouncil: 2 } }, 9, wall(0));
    expect(scs(a.events, 'rune_war_council')).toHaveLength(6);
    expect(scs(a.events, 'rune_war_council').map((c) => c.target)).toEqual(scs(b.events, 'rune_war_council').map((c) => c.target));
  });
});

describe('R-DRAGONRUNE-A-02: Rune of the Growing Inferno', () => {
  it('every friendly Dragon attack casts Growth (+2/+2 to your minions, combat-only); a non-Dragon attack does not', () => {
    const r = fight([m('d4_galas', { attack: 1, health: 200 })], { runeGrowingInferno: true }, 5, wall(0));
    const swings = r.events.filter((e) => e.type === 'attack' && r.initial.player.some((p) => p.uid === (e as { attacker: string }).attacker)).length;
    expect(swings).toBeGreaterThan(0);
    expect(scs(r.events, 'rune_growing_inferno')).toHaveLength(swings);
    expect(r.playerSpellsCast).toBe(swings);
    expect(buffs(r.events, 'growth')[0]).toMatchObject({ attack: 2, health: 2 });
    const plain = fight([m('venom', { attack: 1, health: 200 })], { runeGrowingInferno: true }, 5, wall(0));
    expect(scs(plain.events, 'rune_growing_inferno')).toHaveLength(0);
  });
});

describe('R-DRAGONRUNE-A-03: Rune of the Secret Exchange', () => {
  it('every 3rd Whisper cast FROM HAND opens a Shop-spell Discover; the remainder banks across turns', () => {
    let s = withRune('rune_secret_exchange', { board: [bc('d', 'd4_galas')] });
    s = { ...s, hand: [bc('w1', 'w4_runebind'), bc('w2', 'w4_runebind'), bc('w3', 'w4_runebind'), bc('w4', 'w4_runebind')] };
    s = play(s, 'w1', 'd'); s = play(s, 'w2', 'd');
    expect(tick(s, 'rune_secret_exchange')).toBe(2);
    expect(s.discover).toBeFalsy();
    s = play(s, 'w3', 'd');
    expect(tick(s, 'rune_secret_exchange')).toBe(0);
    expect(s.discover, 'a Discover opened').toBeTruthy();
    for (const o of s.discover!) expect(CARD_INDEX[o]?.spell && !CARD_INDEX[o]?.whisper, `${o} is a Shop spell`).toBe(true);
  });

  it('a Whisp echo and a Shop spell are not Whispers cast from hand', () => {
    let s = withRune('rune_secret_exchange', { board: [bc('d', 'd4_galas'), bc('wh', 'd4_whisp')] });
    s = { ...s, hand: [bc('w1', 'w4_runebind'), bc('g', 'growth')] };
    s = play(s, 'w1', 'd'); // Whisp also casts it on itself: one tick, not two
    expect(tick(s, 'rune_secret_exchange')).toBe(1);
    s = play(s, 'g');
    expect(tick(s, 'rune_secret_exchange')).toBe(1);
  });
});

describe('R-DRAGONRUNE-A-04: Rune of the Runebound Brood', () => {
  it('combat: a Drake Pup a Seed Echo summons casts Runebind on itself', () => {
    const r = fight([m('venom', { attack: 1, health: 1, seedEchoes: 1 } as Partial<BoardMinion>), m('d4_galas', { attack: 0, health: 100 })], { runeRuneboundBrood: true }, 5, wall(5));
    const pup = r.events.find((e): e is Extract<CombatEvent, { type: 'summon' }> => e.type === 'summon' && e.minion.cardId === 'd3_drakepup');
    expect(pup, 'a Pup was summoned').toBeDefined();
    const casts = scs(r.events, 'rune_runebound_brood');
    expect(casts).toHaveLength(1);
    expect(casts[0]!.target).toBe(pup!.minion.uid); // on itself
    expect(casts[0]!.source).toBe(pup!.minion.uid);
    expect(r.playerShoutCarry?.whisperImprove).toEqual({ w4_runebind: 2 });
  });

  it('combat: without the rune, the Pup casts nothing', () => {
    const r = fight([m('venom', { attack: 1, health: 1, seedEchoes: 1 } as Partial<BoardMinion>)], {}, 5, wall(5));
    expect(buffs(r.events, 'w4_runebind')).toHaveLength(0);
  });

  it('Shop: a Pup summoned in the Shop casts Runebind on itself (a counted cast; temporary like every Whisper grant)', () => {
    const s = withRune('rune_runebound_brood', { board: [bc('x', 'venom')] });
    const before = s.spellsCast;
    const pup = makeContext(s).summon(CARD_INDEX['d3_drakepup']!, 'x')!;
    expect([pup.attack, pup.health]).toEqual([5, 5]); // 3/3 + Runebind +2/+2
    expect(pup.whisperBuffs?.[0]).toMatchObject({ attack: 2, health: 2 });
    expect(s.spellsCast).toBe(before + 1);
    expect(s.whisperImprove?.['w4_runebind']).toBe(2);
    // A non-Pup summon casts nothing.
    const other = makeContext(s).summon(CARD_INDEX['venom']!, 'x')!;
    expect(other.whisperBuffs).toBeUndefined();
  });
});

describe('R-DRAGONRUNE-A-05: Rune of Unbroken Scales', () => {
  const KEY = 'rune:runeUnbrokenScales';
  const reforms = (events: readonly CombatEvent[]) => events.filter((e) => e.type === 'shieldUp' && e.key === KEY);
  it('the first 2 Dragon Ward losses (side-wide) each give +10/+10 then Ward; the third does not', () => {
    const r = fight([m('d4_galas', { attack: 0, health: 200, keywords: ['DS'] })], { runeUnbrokenScales: true }, 5, wall(1));
    const g = r.initial.player[0]!.uid;
    const breaks = r.events.filter((e) => e.type === 'shield' && e.target === g);
    expect(breaks).toHaveLength(3); // break, re-form, break, re-form, break (budget spent)
    expect(reforms(r.events)).toHaveLength(2);
    const runeBuffs = r.events.filter((e): e is Buff => e.type === 'buff' && e.target === g && e.source === 'Unbroken Scales');
    expect(runeBuffs.map((b) => [b.attack, b.health])).toEqual([[10, 10], [10, 10]]);
    // Order inside each fire: the break, then the buff, then the Ward back.
    const i = r.events.indexOf(breaks[0]!), j = r.events.indexOf(runeBuffs[0]!), k = r.events.indexOf(reforms(r.events)[0]!);
    expect(i < j && j < k).toBe(true);
  });

  it('side-wide: two Warded Dragons share the 2; a non-Dragon\'s Ward is not counted', () => {
    const r = fight([m('d4_galas', { attack: 0, health: 200, keywords: ['DS'] }), m('d4_galas', { attack: 0, health: 200, keywords: ['DS'] }), m('venom', { attack: 0, health: 200, keywords: ['DS'] })], { runeUnbrokenScales: true }, 5, wall(1));
    expect(reforms(r.events)).toHaveLength(2);
    const venom = r.initial.player[2]!.uid;
    expect(reforms(r.events).some((e) => (e as { target: string }).target === venom)).toBe(false);
  });

  it('two copies: still 2 fires, each +20/+20', () => {
    const r = fight([m('d4_galas', { attack: 0, health: 200, keywords: ['DS'] })], { runeUnbrokenScales: true, flagCopies: { runeUnbrokenScales: 2 } }, 5, wall(1));
    expect(reforms(r.events)).toHaveLength(2);
    expect(r.events.filter((e): e is Buff => e.type === 'buff' && e.source === 'Unbroken Scales').map((b) => b.attack)).toEqual([20, 20]);
  });
});

describe('R-DRAGONRUNE-A-06: Rune of Runic Transposition', () => {
  it('Shop: a Whisper on a Dragon adds its Health as Attack on top of its own Attack (Bait +3/+5 -> +8/+5), temporary with it', () => {
    let s = withRune('rune_runic_transposition', { board: [bc('d', 'd4_galas'), bc('v', 'venom')] });
    const [da, dh] = [at(s, 'd').attack, at(s, 'd').health];
    s = { ...s, hand: [bc('b1', 'w3_bait'), bc('b2', 'w3_bait')] };
    s = play(s, 'b1', 'd');
    expect([at(s, 'd').attack - da, at(s, 'd').health - dh]).toEqual([8, 5]);
    expect(at(s, 'd').whisperBuffs?.[0]).toMatchObject({ attack: 8, health: 5 }); // one temporary grant: expires together
    const [va, vh] = [at(s, 'v').attack, at(s, 'v').health];
    s = play(s, 'b2', 'v'); // not a Dragon
    expect([at(s, 'v').attack - va, at(s, 'v').health - vh]).toEqual([3, 5]);
  });

  it('combat: a Runebind on a Dragon (+2/+2) lands +4/+2; two copies +6/+2', () => {
    const one = fight([m('d4_galas', { attack: 0, health: 50 })], { runeWarCouncil: true, runeRunicTransposition: true }, 5, wall(0));
    expect(buffs(one.events, 'w4_runebind').map((b) => [b.attack, b.health])).toEqual([[4, 2]]);
    const two = fight([m('d4_galas', { attack: 0, health: 50 })], { runeWarCouncil: true, runeRunicTransposition: true, flagCopies: { runeRunicTransposition: 2 } }, 5, wall(0));
    expect(buffs(two.events, 'w4_runebind').map((b) => [b.attack, b.health])).toEqual([[6, 2]]);
  });
});

describe("R-DRAGONRUNE-A-03: Rune of the Wyrm's Hoard", () => {
  it('every 3rd Shop spell cast FROM HAND raises spell power +1/+1; Whispers do not count', () => {
    let s = withRune('rune_wyrms_hoard', { board: [bc('d', 'd4_galas')] });
    const sb = (): [number, number] => [s.spellBonus?.attack ?? 0, s.spellBonus?.health ?? 0];
    const base = sb();
    s = { ...s, hand: [bc('g1', 'growth'), bc('g2', 'growth'), bc('w', 'w4_runebind'), bc('g3', 'growth')] };
    s = play(s, 'g1'); s = play(s, 'g2'); s = play(s, 'w', 'd');
    expect(tick(s, 'rune_wyrms_hoard')).toBe(2);
    expect(sb()).toEqual(base);
    s = play(s, 'g3');
    expect(tick(s, 'rune_wyrms_hoard')).toBe(0);
    expect(sb()).toEqual([base[0] + 1, base[1] + 1]);
  });
});
