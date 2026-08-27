/**
 * DOC BOT — the RUN-STATE CARRY-OVER lane (recruit→combat bridge). See carryOverScan.ts for the doctrine.
 *
 * The question, per per-turn RunState field: does its UNSPENT value reach the combat that ends the turn?
 * Subject list DERIVED from the reducer's fenced PER-TURN-RESET block (read from source at test time, so any
 * new per-turn field is auto-swept), plus the charge-pool carry channels in EXTRA_CARRY_SUBJECTS. Identical
 * armed/unarmed fights need an excuse in CARRY_OVER_EXCUSED; stale excuses fail; needs-triage is ratcheted.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { combatSide, makeRng, simulate, type BoardMinion, type QuestCombatMods } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { CARRY_OVER_EXCUSED, EXTRA_CARRY_SUBJECTS, carryOverScan, parseResetFields, resetRegion } from './carryOverScan';

const SIM = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('Doc Bot — run-state carry-over (recruit→combat bridge)', () => {
  const reducerSrc = readFileSync(join(SIM, 'reducer.ts'), 'utf8');
  const derived = parseResetFields(resetRegion(reducerSrc));
  const fields = [...derived, ...EXTRA_CARRY_SUBJECTS];
  const scan = carryOverScan(fields);

  it('the derived subject list found the real surface (a marker refactor must fail loudly, not blind the scan)', () => {
    expect(derived.length).toBeGreaterThanOrEqual(45);
    expect(derived).toContain('runeWarDrumUsedThisTurn');
  });

  it('War Drum + Warm Embers DIFFER — the owner-ruled carries prove the scan sees the bridge', () => {
    // Base fixture arms runeWarDrum with its charge unspent; arming the LATCH removes the first-combat-Shout
    // carry, so the fight must change. shoutDoubleCharges armed = the next combat Shouts fire twice.
    expect(scan.differing).toContain('runeWarDrumUsedThisTurn');
    expect(scan.differing).toContain('shoutDoubleCharges');
  });

  it('every identical field carries a verifiable excuse (or is counted as needs-triage below)', () => {
    const naked = scan.identical.filter((f) => !CARRY_OVER_EXCUSED[f]);
    expect(naked.map((f) => `${f}: cleared at the turn rollover but its armed value changes NO combat — either thread it (the War Drum bug shape) or excuse it in CARRY_OVER_EXCUSED with the reason it has no combat meaning.`)).toEqual([]);
  });

  it('stale excuses: an excused field that now DIFFERS must lose its entry (the threading wins)', () => {
    const stale = [
      ...scan.differing.filter((f) => CARRY_OVER_EXCUSED[f]).map((f) => `${f}: excused as inert but its armed value now CHANGES the fight — delete the excuse`),
      ...Object.keys(CARRY_OVER_EXCUSED).filter((f) => !fields.includes(f)).map((f) => `${f}: excused but no longer in the derived subject list — delete the entry`),
    ];
    expect(stale).toEqual([]);
  });

  it('every errored field carries an excuse too (a sentinel the resolve refuses — e.g. a modal flag — still needs its reason on record)', () => {
    const naked = scan.errored.filter((f) => !CARRY_OVER_EXCUSED[f]);
    expect(naked.map((f) => `${f}: arming its sentinel broke faceOmen — add a type-correct value to SENTINELS, or excuse it in CARRY_OVER_EXCUSED with why the resolve refuses it`)).toEqual([]);
  });

  it('the needs-triage backlog can only shrink (ratchet: 2 as of 2026-08-26)', () => {
    const triage = Object.entries(CARRY_OVER_EXCUSED).filter(([, e]) => e.kind === 'needs-triage');
    expect(triage.length, `needs-triage entries: ${triage.map(([f]) => f).join(', ')} — resolving one? lower this ratchet. Adding one? that needs an owner ruling, not a bigger number.`).toBeLessThanOrEqual(2);
  });

  // ── the sabotage guard: if the Part-A threading were removed (simulate called WITHOUT the mods), this
  //    armed/unarmed diff at the simulate boundary is exactly the difference the scan keys on. It failing
  //    while the scan passes would mean the scan went vacuous. ──
  it('warDrumExtra / shoutDoubleCharges change the fight at the simulate() boundary itself', () => {
    const bm = (cardId: string, uid: string, attack: number, health: number, keywords: string[] = []): BoardMinion =>
      ({ cardId, attack, health, sourceUid: uid, keywords } as unknown as BoardMinion);
    const fight = (mods: QuestCombatMods): string => {
      const ryme = CARD_INDEX['ryme']!;
      // Pennycat is TANKY (1/30) so it is still alive when Ryme's Echo re-fires its Battlecry — a dead
      // neighbour would leave nothing for the carry to consume (the first cut died to the counter-hit).
      const player = [bm('alley', 'p0', 1, 30), bm(ryme.id, 'p1', 1, 1, [...ryme.keywords])];
      const enemy = [bm('cryptwolf', 'e0', 5, 30)];
      const r = simulate(player, enemy, makeRng(0xd0c5), CARD_INDEX,
        combatSide({ tier: 3, questMods: mods }), combatSide({ tier: 3 }));
      return JSON.stringify({ events: r.events, result: r.result, playerDamage: r.playerDamage });
    };
    expect(fight({ warDrumExtra: 2 })).not.toBe(fight({}));
    expect(fight({ shoutDoubleCharges: 2 })).not.toBe(fight({}));
  });
});
