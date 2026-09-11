/**
 * DOC BOT LANE `playDifferential` — play/cast/watch differentials: every effect ACTS when exercised through the real
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
import { CONTROL_KEY_WHITELIST, VANILLA_CONTROL_ID, playFixture, playScan, spellCastReadsInert } from './playScan';
import type { RunState } from '../state';
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

  it('every castable spell changes something beyond cast bookkeeping (staged conditions included)', () => {
    expect(scan.inertSpells, `Inert spell(s): ${scan.inertSpells.join(', ')} — a real no-op, or a condition the fixture does not carry: fix it or stage it in SPELL_STAGERS with the condition.`).toEqual([]);
    expect(scan.staleStagers, `Stale spell stager(s): ${scan.staleStagers.join(', ')} — the spell acts without its staged condition; delete the entry.`).toEqual([]);
  });

  // INSTRUMENT SABOTAGE (2026-09-11): this gate was VACUOUSLY green from the day it shipped — `reduce` zero-
  // initialises ~11 fields and bumps `cardsPlayedTotal` on every play, so post-cast never equalled the pre-reduce
  // baseline and the four targeted Gifts no-oped for a month under a green lane (found by #1428's entry-path
  // lane). The projection is pure now; these three pairs prove it reads a no-op as inert and one point of change
  // as effectful — the old projection read ALL of them as effectful.
  it('SABOTAGE — the spell projection calls a bookkeeping-only cast inert, and Gold / hand changes effectful', () => {
    const { state: base } = playFixture();
    const before = { ...base, embers: 60 } as RunState;
    // The exact shape of a NO-OP cast after `reduce`: card gone from hand, price paid, counters bumped, zero-inits.
    const noop = {
      ...before, embers: 58, hand: before.hand, spellsCast: 1, spellsThisTurn: 1, cardsPlayedTotal: 1,
      lastSpellCastId: 'x', playedThisTurn: ['x'], lastShoutFires: 0, fodderEaten: [], gainCardFiredUids: [],
    } as unknown as RunState;
    expect(spellCastReadsInert(before, noop, 2)).toBe(true);
    expect(spellCastReadsInert(before, { ...noop, embers: 59 } as RunState, 2)).toBe(false); // a Gold gain shows
    const buffed = { ...noop, hand: before.hand.map((c, i) => (i === 0 ? { ...c, attack: c.attack + 8, health: c.health + 8 } : c)) } as RunState;
    expect(spellCastReadsInert(before, buffed, 2)).toBe(false); // a hand buff shows
    expect(spellCastReadsInert(before, { ...noop, freeRolls: 2 } as RunState, 2)).toBe(false); // a non-zero init shows
  });

  it('refused spells are a pinned queue, not a silent skip (19 as of 2026-09-10)', () => {
    // 14 → 19 on 2026-09-10: five Set 3 spells the fixture cannot cast — Aspect's Blessing, Rush Order and Split
    // Decision (Choose One, like Apples / Crest of the Climb), Star Crash (needs a Celestial target) and Crescendo
    // (needs a Spirit played this turn). Each is driven by its own scenario lane (set3Spells.test.ts).
    const PIN = 19;
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
