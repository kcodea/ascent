/**
 * R-RUNE-SPIKE-FX-01 (owner 2026-11-13: "for pitchforks and other similar runes/effects, use the fel spikes
 * animation"). Each Set 2 effect-damage rune's hits, driven through the REAL engine, resolve to the `fel-spike` def,
 * from the right body, at exactly the units the rune struck, on a beat of their own.
 */
import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type QuestCombatMods } from '@game/core';
import { CARD_INDEX, SETS } from '@game/content';
import { compileMoments } from '../compile';
import { bindingFor } from '../bindings';
import { runeHitsIn, runeOfHit, type RuneHitGroup } from './runeHits';
import { boundRuneVolleys, runeSpikeLead } from '../../useCombatReplay';

const bm = (uid: string, cardId: string, over: Partial<BoardMinion> = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { sourceUid: uid, cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over } as BoardMinion;
};
// A plain neutral body (no effects), so no victim reaction splits a hit off; `sandbag` (gains Attack when damaged) is
// used on purpose where a reacting victim is the point.
const PLAIN = Object.values(CARD_INDEX).filter((c) => !c.spell && !c.token && !c.universalTribe && c.tribe === 'neutral' && !c.tribe2 && c.effects.length === 0 && c.keywords.length === 0)
  .map((c) => c.id).filter((id) => !['sylus', 'chronos', 'yazzus', 'drummer', 'uron', 'zyff'].includes(id));
const wall = (uid: string, attack = 0, health = 5000): BoardMinion => bm(uid, PLAIN[1]!, { attack, health, keywords: [] });
const bag = (uid: string, attack = 0, health = 5000): BoardMinion => bm(uid, 'sandbag', { attack, health, keywords: [] });
const fight = (p: BoardMinion[], e: BoardMinion[], pm: QuestCombatMods, em: QuestCombatMods = {}, seed = 4) =>
  simulate(p, e, makeRng(seed), CARD_INDEX, combatSide({ tier: 6, tribes: [...SETS.set2.tribes], questMods: pm }), combatSide({ tier: 6, tribes: [...SETS.set2.tribes], questMods: em }));
type Fight = ReturnType<typeof fight>;
const uidOf = (r: Fight, side: 'player' | 'enemy', i: number): string => r.initial[side][i]!.uid;

/** Every rune volley in the fight, moment by moment, with the moment it lives in. */
function volleys(events: CombatEvent[]): Array<RuneHitGroup & { moment: number }> {
  return compileMoments(events).flatMap((m, i) => runeHitsIn(m, events).map((g) => ({ ...g, moment: i })));
}
/** The uids a rune's raw hit events name, in log order. */
const rawHits = (events: CombatEvent[], runeId: string): string[] =>
  events.filter((e) => runeOfHit(e) === runeId).map((e) => (e as { target: string }).target);

describe('rune hits resolve to the fel spike', () => {
  it('all five runes bind fel-spike at `damage`, launched early (the Fel Spikes contract)', () => {
    for (const id of ['rune_pitchforks', 'rune_imp_legion', 'rune_hellfire', 'rune_wildfire', 'rune_mirror_sheen']) {
      expect(bindingFor(id, 'damage'), id).toMatchObject({ def: 'fel-spike', fanOut: 'struck', launchOnDeath: true });
    }
  });

  it('Pitchforks: the summoned Imp throws at the 2 enemies it hit, on a beat after its trigger', () => {
    const r = fight([bm('k', 'dm_knocked', { attack: 0, health: 1 })], [wall('w1', 5), wall('w2'), wall('w3')], { runePitchforks: true });
    const imp = r.events.find((x): x is Extract<CombatEvent, { type: 'summon' }> => x.type === 'summon' && x.minion.cardId === 'impscrap')!;
    const v = volleys(r.events).filter((g) => g.runeId === 'rune_pitchforks');
    expect(v).toHaveLength(1);
    expect(v[0]!.from).toBe(imp.minion.uid);
    expect(v[0]!.targets).toHaveLength(2);
    expect(v[0]!.targets).toEqual(rawHits(r.events, 'rune_pitchforks'));
    // The trigger names the Imp and sits OUTSIDE the hit beat, so the spike has a beat to fly in.
    const moments = compileMoments(r.events);
    const hitMoment = moments[v[0]!.moment]!;
    expect(r.events.slice(hitMoment.start, hitMoment.end).some((e) => e.type === 'questTrigger')).toBe(false);
    expect(r.events.find((e) => e.type === 'questTrigger' && e.flag === 'runePitchforks')).toMatchObject({ from: imp.minion.uid });
    expect(runeSpikeLead(hitMoment, r.events)).toBeGreaterThan(0);
  });

  it('Imp Legion: the dying Imp throws at the lowest-Health enemy, split off its death by the rune trigger', () => {
    const r = fight([bm('k', 'dm_knocked', { attack: 0, health: 1 })], [wall('big', 5, 500), wall('low', 0, 40)], { runeImpLegion: true });
    const imp = r.events.find((x): x is Extract<CombatEvent, { type: 'summon' }> => x.type === 'summon' && x.minion.cardId === 'impscrap')!;
    const low = r.initial.enemy.find((m) => m.health === 40)!.uid;
    const v = volleys(r.events).filter((g) => g.runeId === 'rune_imp_legion');
    expect(v.length).toBeGreaterThan(0);
    expect(v[0]).toMatchObject({ from: imp.minion.uid, targets: [low] });
    const hitMoment = compileMoments(r.events)[v[0]!.moment]!;
    expect(r.events.slice(hitMoment.start, hitMoment.end).some((e) => e.type === 'death' && e.target === imp.minion.uid)).toBe(false);
  });

  it('Hellfire: an attacking Demon sprays every enemy as ONE volley from the Demon', () => {
    const r = fight([bm('d', 'dm_knocked', { attack: 1, health: 5000, keywords: [] })], [wall('w'), wall('e1'), wall('e2')], { runeHellfire: true });
    const demon = uidOf(r, 'player', 0);
    const v = volleys(r.events).filter((g) => g.runeId === 'rune_hellfire');
    expect(v.length).toBeGreaterThan(1); // one per swing
    const enemies = r.initial.enemy.map((m) => m.uid);
    for (const g of v) {
      expect(g.from).toBe(demon);
      expect([...g.targets].sort()).toEqual([...enemies].sort());
    }
    // One group per moment: a volley is never split into a stutter of separate plays.
    expect(new Set(v.map((g) => g.moment)).size).toBe(v.length);
  });

  it('Hellfire / Wildfire: a volley is ONE beat even when every victim reacts to the hit (a wave, like a Fel Spikes pass)', () => {
    const r = fight([bm('d', 'dm_knocked', { attack: 1, health: 5000, keywords: [] })], [bag('w'), bag('e1'), bag('e2')], { runeHellfire: true });
    const v = volleys(r.events).filter((g) => g.runeId === 'rune_hellfire');
    expect(v.length).toBeGreaterThan(0);
    for (const g of v) expect(g.targets).toHaveLength(3);
    // The swing's own strike is NOT in the volley's beat: the attacker parks while the volley plays.
    const moments = compileMoments(r.events);
    const first = moments[v[0]!.moment]!;
    const attacker = uidOf(r, 'player', 0);
    expect(r.events.slice(first.start, first.end).some((e) => e.type === 'dmg' && e.wave === undefined && e.source === attacker)).toBe(false);
    // Hellfire is the Demon's own damage (#2693): every volley hit names it, and the spike leaves it.
    expect(r.events.slice(first.start, first.end).filter((e) => runeOfHit(e) === 'rune_hellfire').every((e) => e.type !== 'dmg' || e.source === attacker)).toBe(true);
  });

  it('Pitchforks: a hit a reaction splits off still gets its own launch + hold, each number on its own spike', () => {
    const r = fight([bm('k', 'dm_knocked', { attack: 0, health: 1 })], [bag('w1', 5), bag('w2'), bag('w3')], { runePitchforks: true });
    const moments = compileMoments(r.events);
    const v = volleys(r.events).filter((g) => g.runeId === 'rune_pitchforks');
    expect(v.reduce((n, g) => n + g.targets.length, 0)).toBe(2);
    for (const g of v) expect(runeSpikeLead(moments[g.moment]!, r.events)).toBeGreaterThan(0);
  });

  it('Hellfire: a dying Demon sprays from its own body', () => {
    const r = fight([bm('d', 'dm_hank', { attack: 0, health: 1 })], [wall('w', 5), wall('e1', 0, 50)], { runeHellfire: true });
    const demon = uidOf(r, 'player', 0);
    const v = volleys(r.events).filter((g) => g.runeId === 'rune_hellfire');
    expect(v).toHaveLength(1);
    expect(v[0]!.from).toBe(demon);
  });

  it('Wildfire: the enemy one of your minions killed flings its Attack out of its own body at ONE random enemy', () => {
    // The 5/5 attacks into a wall and dies to the retaliation (a kill by one of your minions); Wildfire then deals 5 to
    // one random enemy minion, sourceless, so the spike leaves the dead enemy.
    const r = fight([wall('w', 10)], [bm('x', PLAIN[1]!, { attack: 5, health: 5, keywords: [] }), wall('a', 0, 50), wall('b', 0, 50)], { runeWildfire: true });
    const killed = r.initial.enemy.find((m) => m.attack === 5)!.uid;
    const v = volleys(r.events).filter((g) => g.runeId === 'rune_wildfire');
    expect(v.length).toBeGreaterThan(0);
    expect(v[0]!.from).toBe(killed);
    expect(v[0]!.targets).toHaveLength(1);
    expect(v[0]!.targets).not.toContain(killed);
  });

  it('Mirror Sheen: the minion that lost its Ward throws at its random enemy', () => {
    const r = fight([bm('s', 'sandbag', { attack: 4, health: 5000, keywords: ['DS'] })], [wall('w', 3), wall('e1')], { runeMirrorSheen: true });
    const sheen = uidOf(r, 'player', 0);
    const v = volleys(r.events).filter((g) => g.runeId === 'rune_mirror_sheen');
    expect(v).toHaveLength(1);
    expect(v[0]!.from).toBe(sheen);
    expect(v[0]!.targets).toHaveLength(1);
  });

  it('ordinary hits are never mistaken for a rune hit (no rune, no volley, no hold)', () => {
    const r = fight([bm('d', 'dm_knocked', { attack: 1, health: 5000, keywords: [] })], [wall('w'), wall('e1')], {});
    expect(volleys(r.events)).toEqual([]);
    for (const m of compileMoments(r.events)) {
      expect(boundRuneVolleys(m, r.events)).toEqual([]);
      expect(runeSpikeLead(m, r.events)).toBe(0);
    }
  });
});
