/**
 * DOC BOT LANE `combatModLane` — the quest/rune COMBAT-MOD lane. Doctrine + the staged fight live in
 * `combatModScan.ts`. Born from retro-validation: three of seven reinjected historical bugs (#941 #832 #932)
 * lived in the 135-key `QuestCombatMods` surface, which no lane exercised at all.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aftershocksRider, combatModScan, undertowRider } from './combatModScan';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** The mod keys, parsed from the interface source — the worklist re-derives per run. */
function modKeys(): string[] {
  const src = readFileSync(join(ROOT, 'packages/core/src/types.ts'), 'utf8');
  const i = src.indexOf('interface QuestCombatMods');
  const j = src.indexOf('\n}', i);
  return [...src.slice(i, j).matchAll(/\n {2}([a-zA-Z0-9]+)\??:/g)].map((m) => m[1]!);
}

describe('Doc Bot — combat-mod lane', () => {
  const keys = modKeys();
  const scan = combatModScan(keys);

  it('covers the real surface (135 mod keys as of 2026-08-26)', () => {
    expect(keys.length).toBeGreaterThanOrEqual(125);
  });

  it('no mod ERRORS when armed (a crash on arming is a shape drift between content and simulate)', () => {
    expect(scan.errored, scan.errored.join(', ')).toEqual([]);
  });

  it('a majority of mods verify ACTIVE in the staged fight (floor 65)', () => {
    expect(scan.changed.length).toBeGreaterThanOrEqual(65);
  });

  it('the scenario-conditional INERT queue is pinned (60 as of 2026-08-26)', () => {
    const PIN = 72; // 63 → 70 on 2026-09-25 (Set 3 rune batch 3: 7 runes/ticks), +1 → 71 the same day: ancientWar (Ancients PoC) needs a GILDED body beside a dying friend, which the staged fight lacks; pinned in sim/src/ancients.test.ts (WAR combat). +1 → 72 on 2026-09-26: ancientBonds (Warden × Bonds) needs a WARDED body gaining stats beside another Warded friend; pinned in core/src/combat/resilientWard.test.ts (BONDS).
    expect(scan.inert.length, `${scan.inert.length} mod(s) changed NOTHING in the staged fight (pin ${PIN}):\n  ${scan.inert.join(', ')}\nAbove the pin: a NEW mod never acted — stage its trigger or raise the pin consciously in review. (Soulbind sat exactly here for five days as a shipped no-op, #832.)`).toBeLessThanOrEqual(PIN);
    expect(scan.inert.length, `only ${scan.inert.length} inert now (pin ${PIN}) — you staged some; lower the pin.`).toBeGreaterThanOrEqual(PIN);
  });

  it('RIDER — Undertow wards at most its cap (#932: it shipped unbounded)', () => {
    const { warded, cap } = undertowRider();
    expect(warded, 'the rider must actually reach the cap to be measuring anything').toBeGreaterThanOrEqual(1);
    expect(warded, `Undertow warded ${warded} bodies; the cap is ${cap}`).toBeLessThanOrEqual(cap);
  });

  it('RIDER — Aftershocks pays per Echo TRIGGER, never per rattle-watcher (#941)', () => {
    const { survivorAttackDelta } = aftershocksRider();
    expect(survivorAttackDelta, 'a plain body died among LIVING rattle-bodies: their Echoes did not trigger, so Aftershocks must pay ZERO — a nonzero delta is the per-watcher over-fire (#941: N rattle-bodies meant N board buffs per death)').toBe(0);
  });
});
