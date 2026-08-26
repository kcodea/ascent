/**
 * SHOP→COMBAT SHOUT CARRY-OVER (owner ruling 2026-08-26): "rune of the war drum should have a 1/1 use, and
 * that use resets at start of turn, therefore if it is not used in shop, then the first shout triggered in
 * combat should work." Same logic extends to Warm Embers' legacy `shoutDoubleCharges`: unspent charges apply
 * to the next N combat-triggered Shouts (each fires twice).
 *
 * Threading: `questCombatMods` emits `warDrumExtra` (only while the per-turn charge is UNSPENT) and
 * `shoutDoubleCharges`; `simulate()` consumes them per combat-triggered Shout in `replayCombatBattlecry`
 * (via ctx.shoutCarryExtras). The fixture: Ryme dying re-fires BOTH neighbours' Battlecries — two tanky
 * Pennycats (`alley`, Battlecry: summon a Stray) — so one death yields TWO distinct combat Shout triggers,
 * which is what separates "first Shout only" (War Drum) from "next N Shouts" (Warm Embers).
 */
import { describe, expect, it } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type QuestCombatMods } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun } from './state';
import { questCombatMods } from './reducer';
import type { RunState } from './state';

const bm = (cardId: string, uid: string, attack: number, health: number, keywords: string[] = []): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords } as unknown as BoardMinion);

/** Two Pennycats flank a fragile Ryme: Ryme dies to the enemy swing, its Echo re-fires both neighbours'
 *  Battlecries — two combat Shout triggers, each summoning a Stray per fire. Returns the Stray count. */
function straysSummoned(mods: QuestCombatMods): number {
  const ryme = CARD_INDEX['ryme']!;
  const player = [bm('alley', 'p0', 1, 30), bm(ryme.id, 'p1', 1, 1, [...ryme.keywords]), bm('alley', 'p2', 1, 30)];
  const enemy = [bm('cryptwolf', 'e0', 5, 60)];
  const r = simulate(player, enemy, makeRng(0xd0c5), CARD_INDEX,
    combatSide({ tier: 3, questMods: mods }), combatSide({ tier: 3 }));
  return r.events.filter((e) => {
    const ev = e as { type?: string; minion?: { cardId?: string } };
    return ev.type === 'summon' && ev.minion?.cardId === 'stray';
  }).length;
}

describe('War Drum / Warm Embers — unspent Shout charges carry into combat', () => {
  const base = straysSummoned({}); // two triggers, one fire each

  it('the fixture stages exactly two combat Shout triggers (the baseline the deltas read against)', () => {
    expect(base).toBe(2);
  });

  it('an unspent War Drum charge boosts ONLY the first combat Shout, by its full multiplier', () => {
    // First trigger: 1 + 2 fires; second trigger: 1 (the charge is 1/1 per the ruling, already spent).
    expect(straysSummoned({ warDrumExtra: 2 })).toBe(base + 2);
  });

  it('each Warm Embers charge doubles ONE of the next combat Shouts', () => {
    expect(straysSummoned({ shoutDoubleCharges: 1 })).toBe(base + 1); // first trigger doubles, second plain
    expect(straysSummoned({ shoutDoubleCharges: 2 })).toBe(base + 2); // both triggers double
    expect(straysSummoned({ shoutDoubleCharges: 9 })).toBe(base + 2); // charges beyond the triggers keep
  });

  it('the two STACK on the first Shout (War Drum is its own latch, mirroring the recruit counter)', () => {
    // First trigger: 1 + 1 (drum) + 1 (double); second: 1 + 1 (second double charge). Magnitudes kept small
    // on purpose: 2 Pennycats + 5 Strays exactly fill the 7-slot board — a bigger drum would overflow the
    // cap and silently swallow the sixth Stray (which is correct combat behaviour, but not this test's).
    expect(straysSummoned({ warDrumExtra: 1, shoutDoubleCharges: 2 })).toBe(base + 3);
  });

  it('replays reproduce: the same seed and mods give the same fight (determinism)', () => {
    expect(straysSummoned({ warDrumExtra: 2, shoutDoubleCharges: 1 })).toBe(straysSummoned({ warDrumExtra: 2, shoutDoubleCharges: 1 }));
  });
});

describe('questCombatMods — the reducer half of the bridge', () => {
  const armed = (patch: Partial<RunState>): RunState => ({ ...createRun(3, 'drakko'), ...patch } as RunState);

  it('an UNSPENT War Drum charge threads its multiplier; a spent one threads nothing', () => {
    expect(questCombatMods(armed({ runeWarDrum: 2 })).warDrumExtra, 'unspent → carried').toBe(2);
    expect(questCombatMods(armed({ runeWarDrum: 2, runeWarDrumUsedThisTurn: true })).warDrumExtra, 'spent in shop → combat unaffected').toBeUndefined();
    expect(questCombatMods(armed({})).warDrumExtra, 'no rune → nothing').toBeUndefined();
  });

  it('remaining Warm Embers charges thread through; zero threads nothing', () => {
    expect(questCombatMods(armed({ shoutDoubleCharges: 3 })).shoutDoubleCharges).toBe(3);
    expect(questCombatMods(armed({ shoutDoubleCharges: 0 })).shoutDoubleCharges).toBeUndefined();
  });
});
