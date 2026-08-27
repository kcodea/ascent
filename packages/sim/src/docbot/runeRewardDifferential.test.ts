/**
 * DOC BOT TRIPWIRE 7 — every rune's reward DOES something, and does MORE when you hold two.
 *
 * History, the largest silent-no-op incident in the repo: #900 "Rune of Duplication was a no-op on 41 of 72
 * Epic runes", refined by the reducer's own `combatFlag` comment — 23 Epic runes swallowed a second copy
 * because applying the same flag twice wrote the same value over itself. The owner held two Rune of the
 * Procession and saw one trigger. The fix made amounts accumulate and booleans record `flagCopies`; nothing
 * has guarded that promise for runes added since.
 *
 * Guarded by DIFFERENTIAL through the real `buyRune` action — the scan itself (fixture, bookkeeping strip,
 * the order-insensitive stringify whose absence made the first cut vacuously green, the amount-flag rule that
 * defeats `flagCopies` masking) lives in `runeSwallowScan.ts`, shared with the `npm run docbot` CLI so the
 * gate and the report can never disagree.
 *
 * FIRST copy is a hard gate: a reward that changes nothing is #900's shape. SECOND copy is a RATCHETED
 * BACKLOG: the forge pool never excludes `ownedRunes` and Duplication doubles any Epic, so all of these are
 * REACHABLE purchases that pay nothing — but whether each should stack, record a copy, or be ruled
 * deliberately idempotent is a per-rune owner decision (the blueprint's `duplicatePolicy`). The pin may only
 * shrink; a NEW rune that swallows trips it at authoring time.
 */
import { describe, expect, it } from 'vitest';
import { runeSwallowScan } from './runeSwallowScan';

describe('Doc Bot — rune reward differential (the #900 class)', () => {
  const { firstNoops, secondSwallowed, refused } = runeSwallowScan();

  it('every rune PURCHASE goes through under the fixture (a refused buy would blind both differentials)', () => {
    expect(refused, `buyRune returned the same object for: ${refused.join(', ')} — fix the fixture (gold? phase?) so the scan actually exercises them.`).toEqual([]);
  });

  it('every rune reward changes the state on FIRST purchase (beyond the receipt)', () => {
    expect(firstNoops, `Rune(s) whose reward is a SILENT NO-OP under the differential fixture:
  ${firstNoops.join(', ')}
Either the reward applier misses their kind/flag (#900's shape), or the fixture lacks their subject — fix the applier, enrich the fixture in runeSwallowScan.ts, or excuse with a ruling in historyRegistry.ts.`).toEqual([]);
  });

  it('the swallowed-second-copy backlog can only shrink (ratchet: 0 as of 2026-08-27 — the duplicate-stacking rulings drained all 80)', () => {
    const PIN = 0;
    expect(secondSwallowed.length, `${secondSwallowed.length} rune(s) swallow a second copy (pin ${PIN}): ${secondSwallowed.join(', ')} — above the pin means a NEW rune swallows: make its second copy accumulate (amounts) or record flagCopies (booleans), or get an owner ruling and excuse it in historyRegistry.ts.`).toBeLessThanOrEqual(PIN);
    expect(secondSwallowed.length, `only ${secondSwallowed.length} rune(s) swallow now (pin ${PIN}) — you fixed some; lower the PIN so the progress cannot be silently re-spent.`).toBeGreaterThanOrEqual(PIN);
  });
});
