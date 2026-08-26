/**
 * DOC BOT TRIPWIRE 9 — play/cast/watch differentials: every effect ACTS when exercised through the real
 * reducer. Doctrine, fixture, normalization and the control-body saga live in `playScan.ts`.
 *
 * Lanes and their dispositions (2026-08-26 baselines):
 *   · SELF-PLAY (`onPlay`) vs vanilla control      → hard gate, 0 inert.
 *   · GOLDEN self-play vs plain                    → hard gate, 0 flat (a gild that multiplies nothing).
 *   · SPELL cast beyond bookkeeping                → hard gate, 0 inert.
 *   · REFUSED spells (fixture can't cast them)     → pinned queue of 14 — surfaced, never silently skipped.
 *   · SILENT WATCHERS (`onSummon`)                 → pinned queue of 1 (gravebody: its "when summoned" means
 *                                                    ITSELF, so watching others is correctly nothing).
 *
 * STATED BLIND SPOT (undercount, never overcount): the watcher lane's control differs from the subject in
 * DEF tribe (no clean control exists in every tribe — the full sweep found zero clean non-token minions), so
 * an effect that def-reads the watcher's tribe can mask a genuinely silent watcher as "reacted". A silent
 * verdict is therefore reliable; a reacted verdict is probable. The control-body saga (Drakko, then Sylus)
 * is recorded in `playScan.ts` — `effects: []` does NOT mean inert, which is why the control is DECLARED and
 * validated here rather than guessed.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_INDEX } from '@game/content';
import { CONTROL_KEY_WHITELIST, VANILLA_CONTROL_ID, playScan } from './playScan';
import { PLAY_EXCUSED, WATCHER_EXCUSED } from './historyRegistry';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

describe('Doc Bot — play differential', () => {
  it('the declared control body is still clean (whitelisted keys, no effects, no engine ID references)', () => {
    const def = CARD_INDEX[VANILLA_CONTROL_ID] as unknown as Record<string, unknown> | undefined;
    expect(def, `control '${VANILLA_CONTROL_ID}' no longer exists — pick a new one (see playScan.ts)`).toBeTruthy();
    expect(Object.keys(def!).filter((k) => !CONTROL_KEY_WHITELIST.has(k)),
      `control '${VANILLA_CONTROL_ID}' grew non-whitelisted def key(s) — a behaviour channel (the Drakko trap). Pick a new control.`).toEqual([]);
    expect((def!.effects as unknown[]).length).toBe(0);
    expect((def!.keywords as unknown[]).length).toBe(0);
    for (const f of ['packages/sim/src/recruit.ts', 'packages/sim/src/reducer.ts', 'packages/core/src/combat/simulate.ts', 'packages/core/src/effects/factories.ts', 'packages/core/src/effects/arena.ts']) {
      expect(readFileSync(join(ROOT, f), 'utf8').includes(`'${VANILLA_CONTROL_ID}'`),
        `control '${VANILLA_CONTROL_ID}' is ID-hardcoded in ${f} (the yazzus/beatboxer trap) — pick a new control.`).toBe(false);
    }
  });

  const scan = playScan();

  it('every onPlay minion DOES something when played (vs the vanilla control), or carries a condition excuse', () => {
    const inert = scan.inertMinions.filter((id) => !PLAY_EXCUSED[id]);
    expect(inert, `Inert onPlay minion(s) — played, and indistinguishable from a vanilla body: ${inert.join(', ')} — a real no-op, or a condition the fixture does not stage: fix it, enrich playFixture, or excuse in historyRegistry.ts with the condition.`).toEqual([]);
    const stale = Object.keys(PLAY_EXCUSED).filter((id) => !scan.inertMinions.includes(id));
    expect(stale, `Stale play excuse(s): ${stale.join(', ')} — the card now acts under the fixture; delete the entry.`).toEqual([]);
  });

  it('every effectful GOLDEN play differs from its plain play (the gild must multiply something)', () => {
    expect(scan.goldenFlat, `Golden-flat minion(s): ${scan.goldenFlat.join(', ')} — gilding changed nothing about the play effect.`).toEqual([]);
  });

  it('every castable spell changes something beyond cast bookkeeping', () => {
    expect(scan.inertSpells, `Inert spell(s): ${scan.inertSpells.join(', ')}`).toEqual([]);
  });

  it('refused spells are a pinned queue, not a silent skip (14 as of 2026-08-26)', () => {
    const PIN = 14;
    expect(scan.refusedSpells.length, `${scan.refusedSpells.length} spell(s) the fixture cannot cast (pin ${PIN}): ${scan.refusedSpells.join(', ')} — above the pin: a NEW spell the differential can't reach; extend playFixture so it can, or the spell ships untested by this lane.`).toBeLessThanOrEqual(PIN);
    expect(scan.refusedSpells.length, `only ${scan.refusedSpells.length} refused now (pin ${PIN}) — the fixture improved; lower the pin.`).toBeGreaterThanOrEqual(PIN);
  });

  it('every silent onSummon watcher carries a reading that explains the silence', () => {
    const unexplained = scan.silentWatchers.filter((id) => !WATCHER_EXCUSED[id]);
    expect(unexplained, `Watcher(s) that reacted to NO tribe subject in the shop, with no registered reading: ${unexplained.join(', ')} — combat-only semantics (note it in WATCHER_EXCUSED) or a real shop no-op (fix it).`).toEqual([]);
    const stale = Object.keys(WATCHER_EXCUSED).filter((id) => !scan.silentWatchers.includes(id));
    expect(stale, `Stale watcher excuse(s): ${stale.join(', ')}`).toEqual([]);
  });
});
