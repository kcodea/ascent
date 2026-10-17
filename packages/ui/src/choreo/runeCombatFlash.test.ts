import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNES, badgeIdsForCombatFlag } from '@game/content';
import type { QuestReward } from '@game/core';
import { badgePulsesFromProgress, runeProgress, triggerCounts } from './triggerCounts';
import { bookBurst } from '../runeTriggerFx';

/**
 * R-RUNE-COMBAT-FLASH-01 (owner 2026-10-16, "look into this"): a rune's badge bounces the moment its effect fires in
 * combat, for EVERY rune (Basic and Epic) and for BOTH sides, and rapid repeats coalesce.
 *
 * The defect: `questFlags.ts` built its flag → badge map from the BASIC rune list only, so every Epic rune's
 * `questTrigger` (the Wild Hunt and ~50 more) resolved to no badge and its badge never moved in combat, though the
 * engine logged each fire. The foe's rune badges had no pulse wiring at all.
 */

/** Every flag a reward arms, the way the content derives them (combatFlag, Bone Throne, multi). */
function flagsOf(reward: QuestReward): string[] {
  if (reward.kind === 'combatFlag') return [reward.flag];
  if (reward.kind === 'boneThrone') return ['boneThroneStep'];
  if (reward.kind === 'multi') return reward.rewards.flatMap(flagsOf);
  return [];
}

describe('R-RUNE-COMBAT-FLASH-01 — every rune flag resolves to its badge', () => {
  it('every Basic AND Epic rune that arms a combat flag maps that flag to its own badge', () => {
    const missing: string[] = [];
    for (const r of [...RUNES, ...EPIC_RUNES]) {
      for (const flag of flagsOf(r.reward)) if (!badgeIdsForCombatFlag(flag).includes(r.id)) missing.push(`${r.id} (${flag})`);
    }
    expect(missing).toEqual([]);
    // Guard a vacuous pass: the Epic list really arms flags.
    expect(EPIC_RUNES.filter((r) => flagsOf(r.reward).length > 0).length).toBeGreaterThan(40);
  });

  it('the Wild Hunt resolves (it was one of the ~54 Epic flags that resolved to nothing)', () => {
    expect(badgeIdsForCombatFlag('runeWildHunt')).toEqual(['rune_wild_hunt']);
  });

  it('a SHARED flag pulses every rune that arms it (Crowded Crypt and Overflow both arm runeOverflow)', () => {
    expect([...badgeIdsForCombatFlag('runeOverflow')].sort()).toEqual(['rune_crowded_crypt', 'rune_overflow']);
  });

  it('runes whose reward kind is its own primitive still resolve (Enchantment, Held Strength, Last Tool, Five Banners, Ancestral Roar)', () => {
    for (const [flag, id] of [['runeEnchantment', 'rune_enchantment'], ['runeHeldStrength', 'rune_held_strength'], ['runeLastTool', 'rune_last_tool'], ['runeFiveBanners', 'rune_five_banners'], ['runeAncestralRoar', 'rune_ancestral_roar']] as const) {
      expect(badgeIdsForCombatFlag(flag)).toContain(id);
    }
  });
});

// A real `simulate()`: Beasts on BOTH sides, both holding the Wild Hunt, so every Beast attack fires it.
const beasts = (p: string): BoardMinion[] => [0, 1, 2].map((i) => ({ cardId: 'alley', attack: 3, health: 30, keywords: [], sourceUid: `${p}${i}` }) as BoardMinion);
const huntSide = () => combatSide({ tier: 6, tribes: ['beast'], questMods: { runeWildHunt: 2 } });
const fight = simulate(beasts('P'), beasts('E'), makeRng(5), CARD_INDEX, huntSide(), huntSide());
const events = fight.events as readonly CombatEvent[];
type QT = Extract<CombatEvent, { type: 'questTrigger' }>;
const huntFires = (side: 'player' | 'enemy') => events.map((e, i) => [e, i] as const).filter(([e]) => e.type === 'questTrigger' && (e as QT).flag === 'runeWildHunt' && (e as QT).side === side);
/** The replay's `processedEnd` for the beat that shows event `i`, and for the beat before its step. */
const beatOf = (i: number) => i + 1;
const beforeStep = (i: number) => events.findIndex((e) => (e.step ?? 0) === (events[i]!.step ?? 0));

describe('R-RUNE-COMBAT-FLASH-01 — the Wild Hunt flashes on its trigger beat, on both sides', () => {
  it('the fixture really fires the rune on both sides (guards a vacuous pass)', () => {
    expect(huntFires('player').length).toBeGreaterThan(1);
    expect(huntFires('enemy').length).toBeGreaterThan(1);
  });

  it("the fire lands on the attacking Beast's own step (real-time: the attack's beat, not settle)", () => {
    for (const [e, i] of [...huntFires('player'), ...huntFires('enemy')]) {
      const attack = [...events.slice(0, i)].reverse().find((x) => x.type === 'attack');
      expect(attack?.step, `fire #${i}`).toBe(e.step);
    }
  });

  it('PLAYER badge: 0 before the step, +1 on the beat that shows the fire', () => {
    const [, i] = huntFires('player')[0]!;
    expect(triggerCounts(events, beforeStep(i), false).rune_wild_hunt ?? 0).toBe(0);
    expect(triggerCounts(events, beatOf(i), false).rune_wild_hunt).toBe(1);
    // …and it counts on with each later fire (each bump remounts the badge and restarts the bounce).
    const all = huntFires('player');
    expect(triggerCounts(events, events.length, false).rune_wild_hunt).toBe(all.length);
  });

  it("FOE badge: the same, folded from the foe's rune progress (R-SYMMETRY-01)", () => {
    const [, i] = huntFires('enemy')[0]!;
    const at = (end: number) => badgePulsesFromProgress(runeProgress(events, end, false, 'enemy', undefined)).rune_wild_hunt ?? 0;
    expect(at(beforeStep(i))).toBe(0);
    expect(at(beatOf(i))).toBe(1);
    expect(at(events.length)).toBe(huntFires('enemy').length);
    // The two sides never bleed into each other.
    expect(triggerCounts(events, events.length, false, 'enemy').rune_wild_hunt).toBe(huntFires('enemy').length);
    expect(badgePulsesFromProgress(null)).toEqual({});
  });
});

describe('R-RUNE-COMBAT-FLASH-01 — rapid repeats coalesce', () => {
  it('two fires in one commit still read as two (Void Cubs), a third is folded in', () => {
    const free = new Map<string, number>();
    expect(bookBurst(free, 'r#0', 1000)).toBe(0);
    expect(bookBurst(free, 'r#0', 1000)).toBe(300);
    expect(bookBurst(free, 'r#0', 1000), 'already flashing with one queued').toBeNull();
    expect(bookBurst(free, 'other#0', 1000), 'per badge, not global').toBe(0);
  });

  it('a rune firing every 50 ms for 3 s books at most ~one burst per 300 ms, never a pile-up', () => {
    const free = new Map<string, number>();
    let booked = 0;
    let maxAhead = 0;
    for (let t = 0; t <= 3000; t += 50) {
      const d = bookBurst(free, 'hunt#0', t);
      if (d !== null) { booked += 1; maxAhead = Math.max(maxAhead, d); }
    }
    expect(booked).toBeLessThanOrEqual(12); // one per 300 ms over 3 s, plus the first, plus the one queued at the end
    expect(booked).toBeGreaterThanOrEqual(9);
    expect(maxAhead).toBeLessThanOrEqual(300);
  });

  it('the badge bounce is ONE-SHOT and compositor-only: transform/opacity, never filter or box-shadow', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    const kf = (name: string) => css.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
    for (const name of ['questbounce', 'questflash', 'questpulse']) {
      const body = kf(name);
      expect(body, name).not.toBe('');
      expect(body, name).not.toMatch(/filter|box-shadow|background|border-radius/);
    }
    expect(css).toMatch(/\.questbadge-inner\[data-pulse\]:not\(\[data-pulse="0"\]\) \{ animation: questbounce [^;]* both; \}/);
    expect(css).not.toMatch(/animation: quest(bounce|flash|pulse)[^;]*infinite/);
  });
});
