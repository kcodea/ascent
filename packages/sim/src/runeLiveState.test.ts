import { describe, expect, it } from 'vitest';
import type { CombatEvent, CombatResult } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun, type BoardCard, type RunState } from './state';
import { reduce } from './reducer';
import { snapshotBoard } from './snapshot';
import { parseRuneLiveState, runeLiveStateInCombat, runeLiveStateOfCarries, runeLiveStateOfRun, runeLiveStateOfSnapshot, type RuneCombatProgress } from './runeLiveState';

/**
 * R-RUNE-LIVE-TEXT-01 (owner 2026-10-16, Rune of the Wild Hunt: "this rune should show the current value in real
 * time"). The state the live rune text reads must equal what the engine will really pay, before, during and after a
 * fight, and the fight's growth must carry back to the run ("improve this by 2 permanently").
 */
const bc = (uid: string, cardId: string, a = 3, h = 30): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack: a, health: h, keywords: [], golden: false });
const withRune = (id: string, extra: Partial<RunState> = {}): RunState =>
  reduce({ ...createRun(3, 'runesmith'), wave: 7, tier: 6, phase: 'recruit', embers: 40, runeforgeOffer: [id], ...extra } as RunState, { type: 'buyRune', index: 0 }) as RunState;
/** One full turn — face the foe, resolve (settle + advance) — on a run that cannot lose. */
const fight = (s: RunState): RunState => {
  const safe = { ...s, resolve: 999, maxResolve: 999, armor: 999 } as RunState;
  return reduce(safe, { type: 'faceOmen' }) as RunState;
};
/** Every player trigger of the fight by flag, as the replay folds them (`choreo/triggerCounts` runeProgress), plus the friendly deaths. */
const progressOf = (r: CombatResult): RuneCombatProgress => {
  const triggers: Record<string, number> = {};
  for (const e of r.events as CombatEvent[]) {
    if (e.type !== 'questTrigger' || e.side !== 'player') continue;
    triggers[e.flag] = (triggers[e.flag] ?? 0) + 1;
  }
  const deaths = (r.playerQuestEvents ?? []).filter((q) => q.kind === 'friendlyDeath').length;
  return { triggers, deaths };
};
const beasts = (): BoardCard[] => [0, 1, 2].map((i) => bc(`b${i}`, 'pack'));

describe('Rune of the Wild Hunt: the live value (R-RUNE-LIVE-TEXT-01)', () => {
  it('reads the printed base (+2) at zero improvements', () => {
    const s = withRune('rune_wild_hunt');
    expect(s.questFlags?.runeWildHunt).toBe(2);
    expect(runeLiveStateOfRun(s).wildHunt).toBe(2);
  });

  it('reads base + 2 per improvement after N Beast attacks', () => {
    const s = withRune('rune_wild_hunt');
    // simulate: `grown += step; buff(attacker, grown)` — after 3 attacks grown = 6, the next attack grants 8.
    expect(runeLiveStateOfRun({ ...s, runeWildHuntGrown: 6 } as RunState).wildHunt).toBe(8);
  });

  it('ticks mid-fight by +2 per Wild Hunt trigger replayed so far', () => {
    const base = runeLiveStateOfRun({ ...withRune('rune_wild_hunt'), runeWildHuntGrown: 4 } as RunState);
    expect(base.wildHunt).toBe(6);
    expect(runeLiveStateInCombat(base, { triggers: {}, deaths: 0 }).wildHunt).toBe(6);
    expect(runeLiveStateInCombat(base, { triggers: { runeWildHunt: 1 }, deaths: 0 }).wildHunt).toBe(8);
    expect(runeLiveStateInCombat(base, { triggers: { runeWildHunt: 3 }, deaths: 0 }).wildHunt).toBe(12);
  });

  it("the fight's growth carries back to the run, and the mid-fight value at the last beat equals the settled one", () => {
    const before = { ...withRune('rune_wild_hunt'), board: beasts(), hand: [] } as RunState;
    const after = fight(before);
    const r = after.lastCombat!;
    const fires = progressOf(r).triggers['runeWildHunt'] ?? 0;
    expect(fires, 'the Beasts really attacked (the fixture must exercise the rune)').toBeGreaterThan(0);
    // The engine's buffs: the k-th Beast attack gained 2k Attack.
    const grants = r.events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.source === 'Rune of the Wild Hunt').map((e) => e.attack);
    expect(grants).toEqual(Array.from({ length: fires }, (_, k) => 2 * (k + 1)));
    // Settled: the run banks the growth ("permanently").
    const settled = reduce(after, { type: 'settleCombat' }) as RunState;
    expect(settled.runeWildHuntGrown).toBe(2 * fires);
    // Live during the replay's last beat == the settled run's value == what the next attack will grant.
    const live = runeLiveStateInCombat(runeLiveStateOfRun(before), progressOf(r)).wildHunt;
    expect(live).toBe(runeLiveStateOfRun(settled).wildHunt);
    expect(live).toBe(2 * fires + 2);
    // …and the next fight resumes from it.
    const next = fight(reduce(settled, { type: 'resolveCombat' }) as RunState);
    const first = next.lastCombat!.events.find((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.source === 'Rune of the Wild Hunt');
    if (first) expect(first.attack).toBe(live);
  });

  it('a captured board carries the value to opponents, spectators, Career and match details', () => {
    const s = { ...withRune('rune_wild_hunt'), board: beasts(), runeWildHuntGrown: 10 } as RunState;
    const snap = snapshotBoard(s);
    expect(runeLiveStateOfSnapshot(snap).wildHunt).toBe(12);
    // A stored record round-trips through the untrusted parser.
    expect(parseRuneLiveState(JSON.parse(JSON.stringify(runeLiveStateOfSnapshot(snap))))?.wildHunt).toBe(12);
    expect(parseRuneLiveState({ wildHunt: 'x', packcraft: { attack: -1, health: 2 } })).toBeUndefined();
    // A fight-only record (Versus match stats) folds the fights before the round.
    expect(runeLiveStateOfCarries([{ wildHuntGrown: 4 }, {}, { wildHuntGrown: 8 }]).wildHunt).toBe(10);
  });

  it('two copies (Rune of Duplication) print per copy, against the printed step', () => {
    const s = { ...withRune('rune_wild_hunt'), questFlags: { runeWildHunt: 4 }, flagCopies: { runeWildHunt: 2 }, runeWildHuntGrown: 8 } as unknown as RunState;
    // Next attack grants 8 + 4 = 12 in total = 6 per copy; each fire adds +2 per copy.
    expect(runeLiveStateOfRun(s).wildHunt).toBe(6);
    expect(runeLiveStateInCombat(runeLiveStateOfRun(s), { triggers: { runeWildHunt: 1 }, deaths: 0 }).wildHunt).toBe(8);
  });
});

describe('the other self-improving runes read their current value (R-RUNE-LIVE-TEXT-01)', () => {
  it('Packcraft: the run-persisted level, growing +2/+1 per combat summon mid-fight', () => {
    const s = withRune('rune_packcraft');
    expect(runeLiveStateOfRun(s).packcraft).toEqual({ attack: 2, health: 1 });
    const grown = { ...s, packcraftLevel: { attack: 6, health: 3 } } as RunState;
    expect(runeLiveStateOfRun(grown).packcraft).toEqual({ attack: 6, health: 3 });
    expect(runeLiveStateInCombat(runeLiveStateOfRun(grown), { triggers: { runePackcraft: 2 }, deaths: 0 }).packcraft).toEqual({ attack: 10, health: 5 });
  });

  it('Beastial Swarm: the per-death level, +2 every second friendly death mid-fight', () => {
    const s = { ...withRune('rune_beastial_swarm', { setId: 'set2' }), beastialSwarmLevel: 6 } as RunState;
    expect(runeLiveStateOfRun(s).beastialSwarm).toBe(6);
    expect(runeLiveStateInCombat(runeLiveStateOfRun(s), { triggers: {}, deaths: 3 }).beastialSwarm).toBe(8);
    expect(runeLiveStateInCombat(runeLiveStateOfRun(s), { triggers: {}, deaths: 4 }).beastialSwarm).toBe(10);
  });

  it('Seasoned Ledger, Compounding Wages, the Wheel and the Baller read their run meters', () => {
    const ledger = { ...withRune('rune_seasoned_ledger'), runeSeasonedLedger: { attack: 3, health: 3, per: 5, played: 11 } } as RunState;
    expect(runeLiveStateOfRun(ledger).seasonedLedger).toEqual({ attack: 3, health: 3 });
    const wages = withRune('rune_compounding_wages', { setId: 'set2' });
    expect(runeLiveStateOfRun(wages).compoundingWages).toEqual({ attack: 2, health: 2 });
    const wheel = { ...withRune('rune_wheel'), shopAuraGrow: { step: 2, per: 4, tick: 1, grown: 4 } } as RunState;
    expect(runeLiveStateOfRun(wheel).wheel).toEqual({ attack: 6, health: 6 });
    const baller = { ...withRune('rune_baller'), runeBaller: { step: 1, sales: 3 } } as RunState;
    // Sale 4 is the second Health payout: 1 × ceil(4/2) = +2 Health.
    expect(runeLiveStateOfRun(baller).baller).toEqual({ amount: 2, stat: 'Health' });
  });
});

