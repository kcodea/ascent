import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { badgeIdForCombatFlag, QuestCombatFlagSchema } from '@game/content';

/**
 * BADGE-COVERAGE CONTRACT (2026-07-18 pacing audit): every combat flag that HAS a badge mapping
 * (`badgeIdForCombatFlag`) must either fire its badge in the sim (`fireTrigger('<flag>'` /
 * `withBeat('<flag>'` in simulate.ts) or be EXPLICITLY listed here as intentionally silent — so a new
 * badge-mapped flag can never ship dark by accident (the audit found ~20 that had).
 *
 * When you add a combat flag: give it a badge + fire it via `withBeat(flag, side, effect)`, or add it
 * below WITH a reason. Deleting a flag from this list without wiring its trigger fails this test.
 */
const INTENTIONALLY_SILENT: Record<string, string> = {
  // Passive rule-changers with no discrete "moment" to pulse on (they'd fire every swing / always):
  lawOfTeeth: 'a doubler on every Beast Slaughter — pulsing each one would spam',
  oldHunt: 'per-Beast-attack aura pump — fires constantly',
  feedingLine: 'chain-attack rule — the granted attack IS the visible payoff',
  crateringMissive: 'a filter tweak on Hulk overflow — the Engrave is the visible payoff',
  runeFury: 'Avenge doubler — the doubled Avenge is the visible payoff',
  runeForthcoming: 'initiative rule — no in-fight moment (applies before the first swing)',
  runeRebirth: 'modifies every Rise — the reborn event is the visible payoff',
  runeAftershocks: 'modifies every Echo summon — the buffed summon is the visible payoff',
  runeUndertow: 'modifies every Echo summon — the immediate strike is the visible payoff',
  runePackcraft: 'per-summon aura pump — fires constantly',
  runeInheritance: 'the stat transfer buff is the visible payoff (candidate for a badge later)',
  runeSalvage: 'pays off in the NEXT shop (hand grant at settle), not in-fight',
  runeSlaying: 'banks Gold at settle — no in-fight moment',
  runeTrophy: 'records silently; the copy arrives next shop',
  bloodTrail: 'an SoC mark; the on-kill Beast grant is the visible payoff',
  deepHunger: 'an SoC mark; the on-kill Fodder queue pays off next shop',
  runeBroodpit: 'fires via runeAvenge (dynamic flag name) — covered by its own tests',
  runeSpearline: 'fires via runeAvenge (dynamic flag name) — covered by its own tests',
  runeAppraisal: 'fires via runeAvenge (dynamic flag name) — covered by its own tests',
  runeSoulTaxes: 'fires via runeAvenge (dynamic flag name) — covered by its own tests',
};

/** Every QuestCombatFlag value, derived from the content schema so the list can't go stale. */
const ALL_FLAGS: string[] = [...QuestCombatFlagSchema.options];

describe('badge coverage — every badge-mapped combat flag fires or is explicitly silent', () => {
  const simSrc = readFileSync(join(__dirname, 'simulate.ts'), 'utf-8');
  const fires = (flag: string): boolean =>
    simSrc.includes(`fireTrigger('${flag}'`) || simSrc.includes(`withBeat('${flag}'`);

  it('the flag list resolved from the schema', () => {
    expect(ALL_FLAGS.length).toBeGreaterThan(20);
  });

  for (const flag of ALL_FLAGS) {
    it(`${flag}: badge-mapped → fired or allowlisted`, () => {
      const badge = badgeIdForCombatFlag(flag);
      if (!badge) return; // no badge → nothing to pulse
      const ok = fires(flag) || flag in INTENTIONALLY_SILENT;
      expect(ok, `combat flag '${flag}' has badge '${badge}' but simulate.ts never fires it — wire it via withBeat('${flag}', side, effect) or add it to INTENTIONALLY_SILENT with a reason`).toBe(true);
    });
  }

  it('the allowlist carries no stale entries (flag removed or now fired)', () => {
    for (const flag of Object.keys(INTENTIONALLY_SILENT)) {
      expect(ALL_FLAGS.includes(flag), `allowlisted '${flag}' is not a QuestCombatFlag anymore — remove it`).toBe(true);
      expect(fires(flag), `allowlisted '${flag}' now fires in simulate.ts — remove it from INTENTIONALLY_SILENT`).toBe(false);
    }
  });
});
