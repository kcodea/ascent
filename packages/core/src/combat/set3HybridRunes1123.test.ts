import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef, type CombatEvent } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * SET 3 NEW HYBRID RUNES (owner review board 2026-11-23): the COMBAT halves, real `simulate()`. The Shop / End of Turn /
 * settle halves are `packages/sim/src/set3HybridRunes1123.test.ts`.
 *
 *   · Gem Whispers: a combat Whisper cast (Whaloo's Runebind) on a friendly minion also casts a Ruby on it.
 *   · Brewed Whispers: a Dwarven Ale cast in combat gets a random Whisper to hand.
 *   · Haunted Hand: a hand minion gaining stats mid-fight raises the Undead Aura +1 Attack, capped by the turn's uses left.
 */
const probe = (id: string, over: Partial<CardDef>): CardDef => ({ id, name: id, tribe: 'dragon', tier: 1, attack: 1, health: 1, keywords: [], effects: [], text: '', ...over });
const DRAGON = probe('dbg_hy_dragon', { attack: 1, health: 900 });
const ALE_RALLY = probe('dbg_hy_ale', { tribe: 'dwarf', attack: 1, health: 900, keywords: ['RL'], effects: [{ on: 'onAttack', do: 'rallyCastNamedSpell', params: { spellId: 'wo_attack' } }] });
const DIES_UNDEAD = probe('dbg_hy_dies', { tribe: 'undead', attack: 1, health: 1 });
const CARDS: Record<string, CardDef> = { ...CARD_INDEX };
for (const c of [DRAGON, ALE_RALLY, DIES_UNDEAD]) CARDS[c.id] = c;

const bm = (uid: string, cardId: string, over: Partial<BoardMinion> = {}): BoardMinion => {
  const d = CARDS[cardId]!;
  return { uid, sourceUid: uid, cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], ...over } as unknown as BoardMinion;
};
const foe = (uid: string, attack: number, health: number): BoardMinion => ({ ...bm(uid, 'sandbag'), attack, health });
const TRIBES = ['kobold', 'undead', 'dwarf', 'spirit', 'dragon'];
const HAND = [{ uid: 'h1', cardId: 'sandbag', attack: 1, health: 1, keywords: [], golden: false }];
const fight = (mine: BoardMinion[], theirs: BoardMinion[], mods: object = {}, extra: object = {}, seed = 7) =>
  simulate(mine, theirs, makeRng(seed), CARDS, combatSide({ tier: 6, tribes: TRIBES, questMods: mods, handMinions: HAND, ...extra }), combatSide({ tier: 6 }));
const triggers = (evs: readonly CombatEvent[], flag: string) => evs.filter((e) => e.type === 'questTrigger' && e.flag === flag && (e as { side?: string }).side !== 'enemy');
type Buff = Extract<CombatEvent, { type: 'buff' }>;
const rubyBuffsOn = (evs: readonly CombatEvent[], target: string) => evs.filter((e): e is Buff => e.type === 'buff' && e.target === target && !!e.ruby);
const uid = (r: ReturnType<typeof fight>, i: number) => r.initial.player[i]!.uid;

describe('Rune of Gem Whispers: combat', () => {
  const whaloo = () => [bm('w', 'd3_whaloo', { attack: 1, health: 900 }), bm('d', DRAGON.id)];
  it("every combat Whisper cast (Whaloo's 3 Runebinds) also casts a Ruby on its target", () => {
    const r = fight(whaloo(), [foe('f', 0, 5000)], { runeGemWhispers: true });
    const fires = triggers(r.events, 'runeGemWhispers').length;
    expect(fires).toBe(3);
    const rubies = r.initial.player.reduce((n, _m, i) => n + rubyBuffsOn(r.events, uid(r, i)).length, 0);
    expect(rubies, 'one Ruby landing per Whisper cast').toBe(3);
    const off = fight(whaloo(), [foe('f', 0, 5000)], {});
    expect(triggers(off.events, 'runeGemWhispers')).toHaveLength(0);
    expect(off.initial.player.reduce((n, _m, i) => n + rubyBuffsOn(off.events, uid(off, i)).length, 0), 'without the rune: no Ruby').toBe(0);
  });
  it('two copies cast two Rubies per Whisper', () => {
    const r = fight(whaloo(), [foe('f', 0, 5000)], { runeGemWhispers: true, flagCopies: { runeGemWhispers: 2 } });
    const rubies = r.initial.player.reduce((n, _m, i) => n + rubyBuffsOn(r.events, uid(r, i)).length, 0);
    expect(rubies).toBe(6);
  });
  it('is deterministic from the same seed', () => {
    const a = fight(whaloo(), [foe('f', 0, 5000)], { runeGemWhispers: true }, {}, 11);
    const b = fight(whaloo(), [foe('f', 0, 5000)], { runeGemWhispers: true }, {}, 11);
    expect(a.events).toEqual(b.events);
  });
});

describe('Rune of Brewed Whispers: combat', () => {
  it('each Dwarven Ale cast in combat gets one random Whisper to hand', () => {
    const r = fight([bm('a', ALE_RALLY.id)], [foe('f', 1, 3000)], { runeBrewedWhispers: true });
    const fires = triggers(r.events, 'runeBrewedWhispers').length;
    expect(fires).toBeGreaterThan(0);
    const whispers = (r.playerHandGrants ?? []).filter((id) => CARDS[id]?.whisper);
    expect(whispers).toHaveLength(fires);
    const off = fight([bm('a', ALE_RALLY.id)], [foe('f', 1, 3000)], {});
    expect((off.playerHandGrants ?? []).filter((id) => CARDS[id]?.whisper)).toHaveLength(0);
  });
  it('two copies get two Whispers per Ale', () => {
    const r = fight([bm('a', ALE_RALLY.id)], [foe('f', 1, 3000)], { runeBrewedWhispers: true, flagCopies: { runeBrewedWhispers: 2 } });
    const fires = triggers(r.events, 'runeBrewedWhispers').length;
    expect((r.playerHandGrants ?? []).filter((id) => CARDS[id]?.whisper)).toHaveLength(2 * fires);
  });
});

describe('Rune of the Haunted Hand: combat', () => {
  // The Pallbearer is the hand-gain source: every friendly Undead death gives the left-most hand minion +2/+2 (`buffHand`).
  const dying = () => [bm('u1', DIES_UNDEAD.id), bm('u2', DIES_UNDEAD.id), bm('u3', DIES_UNDEAD.id)];
  it('a hand minion gaining stats raises the Undead Aura +1 Attack, carried home', () => {
    const r = fight(dying(), [foe('f', 50, 5000)], { runePallbearer: true, runeHauntedHand: true, hauntedHandLeft: 5 });
    const fires = triggers(r.events, 'runeHauntedHand').length;
    expect(fires).toBe(3);
    expect(r.playerUndeadAuraGain?.attack).toBe(3);
    const off = fight(dying(), [foe('f', 50, 5000)], { runePallbearer: true });
    expect(triggers(off.events, 'runeHauntedHand')).toHaveLength(0);
    expect(off.playerUndeadAuraGain?.attack ?? 0).toBe(0);
  });
  it("stops at the turn's remaining uses (what the Shop left of the 5)", () => {
    const r = fight(dying(), [foe('f', 50, 5000)], { runePallbearer: true, runeHauntedHand: true, hauntedHandLeft: 2 });
    expect(triggers(r.events, 'runeHauntedHand')).toHaveLength(2);
    expect(r.playerUndeadAuraGain?.attack).toBe(2);
    const none = fight(dying(), [foe('f', 50, 5000)], { runePallbearer: true, runeHauntedHand: true, hauntedHandLeft: 0 });
    expect(triggers(none.events, 'runeHauntedHand')).toHaveLength(0);
  });
  it('two copies raise the Aura +2 per paying gain; an empty hand pays nothing', () => {
    const r = fight(dying(), [foe('f', 50, 5000)], { runePallbearer: true, runeHauntedHand: true, hauntedHandLeft: 5, flagCopies: { runeHauntedHand: 2 } });
    expect(r.playerUndeadAuraGain?.attack).toBe(6);
    const empty = fight(dying(), [foe('f', 50, 5000)], { runePallbearer: true, runeHauntedHand: true, hauntedHandLeft: 5 }, { handMinions: [] });
    expect(triggers(empty.events, 'runeHauntedHand')).toHaveLength(0);
  });
});
