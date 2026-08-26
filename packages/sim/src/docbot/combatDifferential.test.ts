/**
 * DOC BOT TRIPWIRE 10 — the combat presence differential. Doctrine, the variant matrix, and the two
 * instrument catches (partial-result serialization; uid-keyed masking that never fired on remapped uids)
 * live in `combatScan.ts`.
 *
 * 170 combat-effect cards as of 2026-08-26 (roadmap phases A+B applied): **163 verified ACTIVE** across the
 * seven staged variants, 7 scenario-conditional, 61 golden-flat-in-the-proving-variant.
 *
 * The queues are two-sided ratchets (shrink = bank it by lowering the pin; grow = a NEW card didn't act —
 * make it act, or raise the pin consciously in review with the condition named).
 *
 * Sabotage-proofed on BOTH lanes: neutering `deathrattleSummon` moved 11 named echo-summoners into the inert
 * queue (7 → 18); neutering the arena's golden doubling moved 34 more cards into golden-flat (61 → 95).
 */
import { describe, expect, it } from 'vitest';
import { combatScan, combatWorklist } from './combatScan';

describe('Doc Bot — combat presence differential', () => {
  const scan = combatScan();

  it('covers the real surface (170 combat-effect cards as of 2026-08-26)', () => {
    expect(combatWorklist().length).toBeGreaterThanOrEqual(160); // a worklist collapse must fail loudly
  });

  it('nearly every combat effect verifies ACTIVE across the variant matrix (floor 158)', () => {
    // A sharp drop means the SCAN broke (fixture, masking, control) — the instrument check.
    expect(scan.activeCount).toBeGreaterThanOrEqual(158);
  });

  it('the scenario-conditional INERT queue is pinned (7 as of 2026-08-26)', () => {
    const PIN = 7;
    expect(scan.inert.length, `${scan.inert.length} combat-effect card(s) changed NOTHING in any staged variant (pin ${PIN}):\n  ${scan.inert.join(', ')}\nAbove the pin: a new card's combat effect never acted — stage its trigger (add a variant), fix the effect, or raise the pin consciously in review with the condition named.`).toBeLessThanOrEqual(PIN);
    expect(scan.inert.length, `only ${scan.inert.length} inert now (pin ${PIN}) — you staged or fixed some; lower the pin.`).toBeGreaterThanOrEqual(PIN);
  });

  it('the GOLDEN-FLAT queue is pinned (61 as of 2026-08-26 — the owner triage queue for gild semantics)', () => {
    const PIN = 61;
    expect(scan.goldenFlat.length, `${scan.goldenFlat.length} card(s) whose golden combat behaviour equals plain in their proving variant (pin ${PIN}): ${scan.goldenFlat.join(', ')}`).toBeLessThanOrEqual(PIN);
    expect(scan.goldenFlat.length, `only ${scan.goldenFlat.length} golden-flat now (pin ${PIN}) — lower the pin.`).toBeGreaterThanOrEqual(PIN);
  });
});
