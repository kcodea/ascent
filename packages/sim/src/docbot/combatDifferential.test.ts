/**
 * DOC BOT LANE `combatDifferential` — the combat presence differential. Doctrine + the variant matrix live in
 * `combatScan.ts`.
 *
 * OWNER AUDIT 2026-08-26 reshaped this lane. The first cut queued 7 inert cards and 61 "golden-flat" ones;
 * the owner called it ("really stupid and bad findings — echohorn seems to be one of the most correctly
 * founded cards in the game") and the audit proved him right: SIX of seven inerts were instrument blind
 * spots (alignment never stamped — and stamped 'eclipsed' where the literal is 'eclipse'; the echoer dead
 * before the Rally; the stored side-spell never armed; a shop passive double-counted), and the golden-flat
 * lane compared golden-vs-plain in fights where the effect never fired at all (Beardsley and Imp King
 * verified doubling +3→+6 when it does). The fixes live in the scan; the lane's residue is DOC BOT'S OWN
 * verification backlog, not owner questions.
 */
import { describe, expect, it } from 'vitest';
import { combatScan, combatWorklist } from './combatScan';

describe('Doc Bot — combat presence differential', () => {
  const scan = combatScan();

  it('covers the real surface (169 combat-effect cards as of 2026-08-26)', () => {
    expect(combatWorklist().length).toBeGreaterThanOrEqual(160);
  });

  it('nearly every combat effect verifies ACTIVE across the variant matrix (floor 160)', () => {
    expect(scan.activeCount).toBeGreaterThanOrEqual(160);
  });

  it('the unstageable residue is pinned (1 as of 2026-08-26: Reflector — needs a targeted combat cast)', () => {
    const PIN = 1;
    expect(scan.inert.length, `${scan.inert.length} combat-effect card(s) changed NOTHING in any staged variant (pin ${PIN}): ${scan.inert.join(', ')} — a NEW card here means its effect never acted: stage its trigger (add a variant) or fix the effect. This is Doc Bot's staging backlog, not an owner queue.`).toBeLessThanOrEqual(PIN);
    expect(scan.inert.length, `only ${scan.inert.length} inert now (pin ${PIN}) — you staged or fixed some; lower the pin.`).toBeGreaterThanOrEqual(PIN);
  });
});
