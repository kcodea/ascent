/**
 * DOC BOT TRIPWIRE 10 — the combat presence differential. Doctrine + the staged fight live in
 * `combatScan.ts`; this file pins the dispositions.
 *
 * 170 combat-effect cards as of 2026-08-26: 116 verified ACTIVE (their presence changes the staged fight),
 * 54 scenario-conditional (INERT queue — the fight doesn't stage their trigger: Ryme needs adjacent
 * Battlecries, Dawnclaw needs adjacent Echoes, Moe needs its own kills…), 27 GOLDEN-FLAT (the effect acted
 * but gilding changed nothing about it in this fight).
 *
 * The queues are two-sided ratchets: shrinking means you verified/fixed members (bank it by lowering the
 * pin); growing means a NEW card's combat effect didn't act — the author must make it act in the staged
 * fight, or consciously raise the pin in review with the condition named. Either way the decision happens at
 * authoring time, which is the entire point (Conductor shipped because nothing forced that decision).
 *
 * Sabotage-proofed: neutering `deathrattleSummon` moved 12 named echo-summoners into the inert queue
 * (54 → 66) and restoring moved them back.
 */
import { describe, expect, it } from 'vitest';
import { combatScan, combatWorklist } from './combatScan';

describe('Doc Bot — combat presence differential', () => {
  const scan = combatScan();

  it('covers the real surface (170 combat-effect cards as of 2026-08-26)', () => {
    expect(combatWorklist().length).toBeGreaterThanOrEqual(160); // a worklist collapse must fail loudly
  });

  it('a healthy majority of combat effects verify ACTIVE in the staged fight (floor 110)', () => {
    // If this drops sharply the SCAN broke (fixture, masking, control) — the instrument check, not a card check.
    expect(scan.activeCount).toBeGreaterThanOrEqual(110);
  });

  it('the scenario-conditional INERT queue is pinned (54 as of 2026-08-26)', () => {
    const PIN = 54;
    expect(scan.inert.length, `${scan.inert.length} combat-effect card(s) changed NOTHING about the staged fight (pin ${PIN}):\n  ${scan.inert.join(', ')}\nAbove the pin: a new card's combat effect never acted — stage its trigger, fix the effect, or raise the pin consciously in review with the condition named.`).toBeLessThanOrEqual(PIN);
    expect(scan.inert.length, `only ${scan.inert.length} inert now (pin ${PIN}) — you verified some; lower the pin.`).toBeGreaterThanOrEqual(PIN);
  });

  it('the GOLDEN-FLAT queue is pinned (27 as of 2026-08-26)', () => {
    const PIN = 27;
    expect(scan.goldenFlat.length, `${scan.goldenFlat.length} card(s) whose golden combat behaviour equals plain (pin ${PIN}): ${scan.goldenFlat.join(', ')}`).toBeLessThanOrEqual(PIN);
    expect(scan.goldenFlat.length, `only ${scan.goldenFlat.length} golden-flat now (pin ${PIN}) — lower the pin.`).toBeGreaterThanOrEqual(PIN);
  });
});
