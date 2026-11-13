import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type QuestCombatMods } from '@game/core';
import { CARD_INDEX, RUNE_INDEX, SETS, poolFor } from '@game/content';
import { CONFIG, createRun, reduce, type Action, type BoardCard, type BoardSnapshot, type RunState } from './index';

/**
 * SET 2 RUNE BATCH, COMBINED (2026-11-13). The four slices (Basic neutral, Basic tribal, Epic neutral, Epic tribal)
 * were built in parallel, so no slice could pin how its runes meet another slice's. These are those meetings, each
 * deterministic (fixed seeds). See docs/devlog/2026-11-13-set2-runes-batch.md.
 *
 *  - Bastion (Epic neutral) x Shatterproof (Basic neutral): the re-formed Ward breaks again and pays again.
 *  - Mirror Sheen (Epic neutral) x Shatterproof: the +5/+5 lands first, so the reflected hit carries it.
 *  - Hellfire / Wildfire (Epic tribal) x Pitchforks / Imp Legion (Basic tribal): rune damage is not an attack.
 *  - Big Spender (Epic tribal) x Deep Pockets (Basic tribal): the per-turn Gold window hears each Gold twice.
 *  - Second Opinion (Basic neutral) x Grudge (Epic neutral): the lost-combat Discover offers the extra option.
 */

const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
/** A Set 2 recruit run, each rune bought through the REAL Runeforge path (its own Discover, if any, cleared). */
function withRunes(ids: string[], extra: Partial<RunState> = {}, seed = 3): RunState {
  let s = {
    ...createRun(seed, 'runesmith', 'ascent', CONFIG.defaultLine, 'set2'),
    tribes: [...SETS.set2.tribes], wave: 7, tier: 3, phase: 'recruit', embers: 60, hand: [], board: [], recruitBuffFx: [],
    pool: Object.fromEntries(poolFor('set2').buyable.map((c) => [c.id, 5])),
  } as RunState;
  for (const id of ids) {
    s = act({ ...s, embers: 60, runeforgeOffer: [id], runeforgeEpic: !!RUNE_INDEX[id]!.epic }, { type: 'buyRune', index: 0 });
    s = { ...s, discover: undefined, discoverQueue: undefined };
  }
  return { ...s, hand: [], embers: 60, ...extra };
}

// ── Combat helpers ──────────────────────────────────────────────────────────────────────────────────────────────
const PLAIN = Object.values(CARD_INDEX).filter((c) => !c.spell && !c.token && !c.universalTribe && c.tribe === 'neutral' && !c.tribe2 && c.effects.length === 0 && c.keywords.length === 0)
  .map((c) => c.id).filter((id) => !['sylus', 'chronos', 'yazzus', 'drummer', 'uron', 'zyff'].includes(id) && !id.startsWith('hm_'));
const bm = (uid: string, cardId: string, over: Omit<Partial<BoardMinion>, 'keywords'> & { keywords?: string[] } = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { uid, sourceUid: uid, cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over } as unknown as BoardMinion;
};
/** A plain neutral body (not the Sandbag, which grows when hit). */
const wall = (uid: string, attack = 0, health = 5000, keywords: string[] = []): BoardMinion => bm(uid, PLAIN[0]!, { attack, health, keywords });
const side = (mods: QuestCombatMods) => combatSide({ tier: 6, tribes: [...SETS.set2.tribes], questMods: mods });
const fight = (p: BoardMinion[], e: BoardMinion[], mods: QuestCombatMods, seed = 4, enemyMods: QuestCombatMods = {}) =>
  simulate(p, e, makeRng(seed), CARD_INDEX, side(mods), side(enemyMods));
type Fight = ReturnType<typeof fight>;
type Ev<T extends CombatEvent['type']> = Extract<CombatEvent, { type: T }>;
const of = <T extends CombatEvent['type']>(evs: readonly CombatEvent[], t: T): Ev<T>[] => evs.filter((e): e is Ev<T> => e.type === t);
const triggers = (evs: readonly CombatEvent[], flag: string, s: 'player' | 'enemy' = 'player') =>
  evs.filter((e) => e.type === 'questTrigger' && e.flag === flag && (e as { side?: string }).side === s);
const buffsFrom = (evs: readonly CombatEvent[], source: string) => of(evs, 'buff').filter((e) => e.source === source);
const permaHome = (r: Fight, sourceUid: string) =>
  (r.playerPermaBuffs ?? []).filter((p) => p.sourceUid === sourceUid).reduce((t, p) => [t[0] + p.attack, t[1] + p.health], [0, 0]);

describe('Bastion x Shatterproof', () => {
  it('the Ward Bastion gives back breaks again, and Shatterproof pays for both losses (+10/+10, permanent)', () => {
    const p = [wall('a', 0, 500, ['DS'])];
    const both = fight(p, [wall('e', 4)], { runeBastion: true, runeShatterproof: true });
    const uid = both.initial.player[0]!.uid;
    expect(of(both.events, 'shieldUp').filter((e) => e.target === uid && e.key === 'rune:runeBastion')).toHaveLength(1);
    expect(of(both.events, 'shield').filter((e) => e.target === uid)).toHaveLength(2);
    expect(triggers(both.events, 'runeShatterproof')).toHaveLength(2);
    expect(buffsFrom(both.events, 'Shatterproof').map((b) => [b.attack, b.health])).toEqual([[5, 5], [5, 5]]);
    expect(permaHome(both, 'a')).toEqual([10, 10]);
    // Without Bastion: one loss, one payout.
    const alone = fight(p, [wall('e', 4)], { runeShatterproof: true });
    expect(triggers(alone.events, 'runeShatterproof')).toHaveLength(1);
    expect(permaHome(alone, 'a')).toEqual([5, 5]);
  });
});

describe('Mirror Sheen x Shatterproof', () => {
  it('Shatterproof is heard first, so each reflected hit carries the +5 Attack (7 -> 12, then 17)', () => {
    const p = [wall('a', 7, 500, ['DS'])];
    const foes = () => [wall('e1', 4), wall('e2', 4)];
    const r = fight(p, foes(), { runeMirrorSheen: true, runeShatterproof: true, runeBastion: true });
    const uid = r.initial.player[0]!.uid;
    const mirrorHits = triggers(r.events, 'runeMirrorSheen').map((t) => {
      const at = r.events.indexOf(t);
      return r.events.slice(at + 1).find((e): e is Ev<'dmg'> => e.type === 'dmg' && e.source === uid)!.amount;
    });
    expect(mirrorHits).toEqual([12, 17]);
    // Without Shatterproof the reflection is the printed Attack.
    const plain = fight(p, foes(), { runeMirrorSheen: true, runeBastion: true });
    const pu = plain.initial.player[0]!.uid;
    const plainHits = triggers(plain.events, 'runeMirrorSheen').map((t) =>
      plain.events.slice(plain.events.indexOf(t) + 1).find((e): e is Ev<'dmg'> => e.type === 'dmg' && e.source === pu)!.amount);
    expect(plainHits).toEqual([7, 7]);
  });
});

describe('Hellfire / Wildfire x Pitchforks / Imp Legion', () => {
  // Knocked Imp (a Demon) summons an Imp Scrap when it dies.
  const knocked = () => bm('k', 'dm_knocked', { attack: 0, health: 1 });
  const dummies = (n: number, health: number) => Array.from({ length: n }, (_, i) => bm(`d${i}`, PLAIN[1]!, { attack: 0, health, keywords: [] }));

  it('Hellfire + Pitchforks: the dying Demon\'s Echo summons the Imp (Pitchforks throws first), THEN Hellfire\'s death volley', () => {
    const r = fight([knocked()], [wall('w', 5), ...dummies(2, 50)], { runeHellfire: true, runePitchforks: true });
    expect(triggers(r.events, 'runePitchforks')).toHaveLength(1);
    // Knocked Imp's death, the Imp Scrap's swing, the Imp Scrap's death: three volleys.
    expect(triggers(r.events, 'runeHellfire')).toHaveLength(3);
    const hell = r.events.indexOf(triggers(r.events, 'runeHellfire')[0]!);
    const fork = r.events.indexOf(triggers(r.events, 'runePitchforks')[0]!);
    expect(fork).toBeLessThan(hell); // Echo (and the arrival it causes) resolves before the death half of Hellfire
  });

  it('Wildfire + Pitchforks: an enemy the Pitchforks kill died to non-attack damage, so Wildfire fires', () => {
    const r = fight([knocked()], [wall('w', 5), ...dummies(2, 3)], { runeWildfire: true, runePitchforks: true });
    expect(triggers(r.events, 'runePitchforks')).toHaveLength(1);
    expect(triggers(r.events, 'runeWildfire').length).toBeGreaterThanOrEqual(1);
    expect(triggers(fight([knocked()], [wall('w', 5), ...dummies(2, 3)], { runePitchforks: true }).events, 'runeWildfire')).toHaveLength(0);
  });

  it('Wildfire + Imp Legion: the grafted Echo kill counts as non-attack damage', () => {
    // The Imp Scrap dies to the wall; its Imp Legion Echo hits the lowest-Health enemy (a 3-Health dummy) for 3.
    const r = fight([knocked()], [wall('w', 5, 5000), bm('d', PLAIN[1]!, { attack: 0, health: 3, keywords: [] })], { runeWildfire: true, runeImpLegion: true });
    const low = r.initial.enemy[1]!.uid;
    expect(of(r.events, 'death').some((e) => e.target === low)).toBe(true);
    expect(triggers(r.events, 'runeWildfire').length).toBeGreaterThanOrEqual(1);
  });

  it('Hellfire + Imp Legion: the Imp is a Demon, so its death fires Hellfire AND its Echo', () => {
    const r = fight([knocked()], [wall('w', 5, 5000), ...dummies(1, 500)], { runeHellfire: true, runeImpLegion: true });
    const imp = of(r.events, 'summon').find((e) => e.minion.cardId === 'impscrap')!;
    expect(imp).toBeTruthy();
    // The Knocked Imp's death and the Imp Scrap's death each volley (2+), plus every Demon swing.
    expect(triggers(r.events, 'runeHellfire')).toHaveLength(3);
    // The Imp Legion Echo: a sourceless 3 to the lowest-Health enemy, keyed to the grafted factory, before that death's volley.
    const echo = of(r.events, 'dmg').find((e) => e.amount === 3 && e.key === 'factory:deathrattleDamageLowestEnemy:onDeath');
    expect(echo).toBeTruthy();
    const impDeath = r.events.findIndex((e) => e.type === 'death' && e.target === imp.minion.uid);
    const lastHell = r.events.lastIndexOf(triggers(r.events, 'runeHellfire').at(-1)!);
    expect(impDeath).toBeLessThan(r.events.indexOf(echo!));
    expect(r.events.indexOf(echo!)).toBeLessThan(lastHell);
  });
});

describe('Big Spender x Deep Pockets', () => {
  it('Deep Pockets\' 8-Gold window hears each Gold twice: 4 Gold of Refreshes pays the Dwarf', () => {
    const spend4 = (ids: string[]) => {
      let s = withRunes(ids, { goldSpentThisTurn: 0 });
      // reset the per-turn window the rune purchases themselves may have advanced
      s = { ...s, runeThresholds: (s.runeThresholds ?? []).map((t) => ({ ...t, tick: 0, usedThisTurn: false })) };
      const before = s.embers;
      for (let i = 0; i < 4 && s.embers > 0; i++) s = act(s, { type: 'roll' });
      return { paid: before - s.embers, dwarves: s.hand.filter((c) => CARD_INDEX[c.cardId]?.tribe === 'dwarf').length };
    };
    const alone = spend4(['rune_deep_pockets']);
    const both = spend4(['rune_deep_pockets', 'rune_big_spender']);
    expect(alone.paid).toBe(both.paid);
    expect(alone.paid).toBeGreaterThanOrEqual(4);
    expect(alone.paid).toBeLessThan(8);
    expect(alone.dwarves).toBe(0);
    expect(both.dwarves).toBe(1);
  });
});

describe('Second Opinion x Grudge', () => {
  function settleLoss(ids: string[]): RunState {
    let s = withRunes(ids, { tier: 3, embers: 0, board: [body('a', 'sandbag', { attack: 0, health: 1 })] });
    const foes: BoardSnapshot = { v: 1, wave: s.wave, heroId: 'indy', resolve: 30, tier: 1, triples: 0, tribes: [], threat: 'glass', power: 1,
      minions: [{ cardId: 'sandbag', attack: 5, health: 500, keywords: [] }], seed: 1, origin: 'self' };
    s = act({ ...s, servedBoards: { [s.wave]: foes } }, { type: 'faceOmen' });
    expect(s.lastCombat?.result).toBe('lose');
    return act(s, { type: 'resolveCombat' });
  }
  /** The Grudge Discover once it opens (it may queue behind another Start of Turn modal). */
  function grudgeOffer(s: RunState): string[] {
    let t = s;
    for (let i = 0; i < 4 && !(t.discover ?? []).every((id) => CARD_INDEX[id]!.tier === s.tier + 1); i++) {
      if (!t.discover) break;
      t = act(t, { type: 'discover', index: 0 });
    }
    return t.discover ?? [];
  }
  it('the lost-combat Discover from the Tier above offers 4 options with Second Opinion, 3 without', () => {
    const plain = grudgeOffer(settleLoss(['rune_grudge']));
    const wide = grudgeOffer(settleLoss(['rune_grudge', 'rune_second_opinion']));
    expect(plain).toHaveLength(3);
    expect(wide).toHaveLength(4);
    for (const id of wide) expect(CARD_INDEX[id]!.tier).toBe(4);
  });
});
