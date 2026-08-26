/**
 * DOC BOT TRIPWIRE 6 — every turn-scoped RunState field is actually reset somewhere in the reducer.
 *
 * History: #1f6c "Layaway keep is shop-phase only (cleared at combat)", #517 "Funeral loan expires next
 * turn", #77f6 "Rune of Resonance — missing per-turn reset". The naming convention (`fooThisTurn`,
 * `barBonusTurn`, `bazNextTurn`) makes the promise machine-readable: a field so named that no reducer line
 * ever resets is a "this turn" that quietly means "forever" — the same promise-shaped hole as the Merchant's
 * Chorus class, from the other side.
 *
 * Heuristic by design (a reset ANYWHERE in reducer.ts counts; it does not prove the reset is at the right
 * boundary) — but the failure it hunts is the field with NO reset at all, which is exactly how the shipped
 * bugs looked. Excuses live in `historyRegistry.ts` (`TURN_RESET_EXCUSED`), currently empty: all 39 fields
 * pass today.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TURN_RESET_EXCUSED } from './historyRegistry';

const SIM = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('Doc Bot — turn-scoped fields reset', () => {
  const stateSrc = readFileSync(join(SIM, 'state.ts'), 'utf8');
  const reducerSrc = readFileSync(join(SIM, 'reducer.ts'), 'utf8');
  const fields = [...new Set([...stateSrc.matchAll(/^  ([a-zA-Z]+(?:ThisTurn|OffTurn|BonusTurn|NextTurn))\??:/gm)].map((m) => m[1]!))];

  it('found the real surface (39 turn-suffixed fields as of 2026-08-26)', () => {
    expect(fields.length).toBeGreaterThanOrEqual(35); // a naming refactor must fail loudly, not blind the scan
  });

  it('every turn-suffixed field has a reset assignment in the reducer, or a registered excuse', () => {
    const never = fields.filter((f) => !TURN_RESET_EXCUSED[f]
      && !new RegExp(String.raw`\.${f} = (undefined|0|false|\[\]|\{)`).test(reducerSrc)
      && !new RegExp(String.raw`\.${f} = null`).test(reducerSrc));
    expect(never.map((f) => `${f}: declared turn-scoped in state.ts but NEVER reset in reducer.ts — "this turn" currently means "forever". Reset it at the rollover, or excuse it in historyRegistry.ts with the reason.`)).toEqual([]);
  });
});
