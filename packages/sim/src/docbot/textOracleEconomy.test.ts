/**
 * DOC BOT — text as oracle tranche 3: the PRINTED Gold number is the MEASURED Gold delta (handoff §7.2).
 *
 * Doctrine, the axis grammar, lanes and the excuse registry live in `textOracleEconomy.ts`; this file is the
 * gate. Three derived worklists: cards (economy factory family × drivable trigger × parseable axis, plus
 * every "Sells for N Gold" print), runes (gold-paying reward trees), hero powers (unconditional parseable
 * promises). Each reconciles printed numbers against real reducer deltas — the economyScan probe patterns,
 * never a second ledger.
 *
 * Verify-before-alarm: a mismatch here stands only after investigation; a VERIFIED bug ships as
 * 'confirmed-bug-pending-fix' with the fix PR cut, never as a red suite.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_INDEX, RUNES, EPIC_RUNES } from '@game/content';
import { stripComments } from './textOracle';
import { extractEntriesByLine } from './textOracleSummons';
import {
  ECON_CALL_RE, ECONOMY_EXCUSED, economySubjects, heroEconomySubjects, parsePrintedEconomy,
  reconcileEconomy, runEconomySubject, runHeroEconomySubject, runRuneEconomySubject, runeEconomySubjects,
} from './textOracleEconomy';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** The economy family, derived from the two factory maps' SOURCE — never hand-listed. */
function econFamily(): Set<string> {
  const maps: Array<[string, string]> = [
    ['packages/sim/src/recruit.ts', 'const RECRUIT_FACTORIES'],
    ['packages/core/src/effects/factories.ts', 'export const FACTORIES'],
  ];
  const family = new Set<string>();
  for (const [file, anchor] of maps) {
    const entries = extractEntriesByLine(readFileSync(join(ROOT, file), 'utf8'), anchor);
    for (const [id, body] of Object.entries(entries)) {
      if (ECON_CALL_RE.test(stripComments(body))) family.add(id);
    }
  }
  return family;
}

describe('Doc Bot — text as oracle tranche 3 (printed economy)', () => {
  const family = econFamily();
  const subjects = economySubjects(family);
  const excusedIds = new Set(Object.keys(ECONOMY_EXCUSED));

  it('the axis grammar reads the printed shapes and rejects the rates (unit pins)', () => {
    expect(parsePrintedEconomy('Gain **2 Gold**.')).toEqual({ immediate: 2 });
    expect(parsePrintedEconomy('Gain **2 Gold** next turn.')).toEqual({ future: 2 });
    expect(parsePrintedEconomy('**Shout:** gain **1 Gold** next turn.')).toEqual({ future: 1 });
    expect(parsePrintedEconomy('**Battlecry:** get **1** extra Gold next turn. Sells for **2 Gold**.')).toEqual({ future: 1, sellsFor: 2 });
    expect(parsePrintedEconomy('Gain **+1 max Gold** permanently.')).toEqual({ maxGold: 1 });
    expect(parsePrintedEconomy('**Avenge (4):** raise your maximum Gold by **1**.')).toEqual({ maxGold: 1 });
    expect(parsePrintedEconomy('**Sell:** get **6 Gold**. **End of Turn:** get a random Tier 1 Spell or Minion.')).toEqual({ sellGet: 6 });
    // Rates, thresholds and schedules never become axes (§7.5).
    expect(parsePrintedEconomy('Give a minion **+1/+1**, plus **+2/+2** for every **6 Gold** spent this turn.')).toBeNull();
    expect(parsePrintedEconomy('When you spend **10 Gold**, get a **Dwarven Ale**.')).toBeNull();
    expect(parsePrintedEconomy('Has **+1/+1** for every **3 Gold** you have spent this run.')).toBeNull();
    expect(parsePrintedEconomy('Sell your **entire board**. Gain **3 Gold** for each minion sold.')).toBeNull();
  });

  it('the instrument sees its surface (family + subject floors)', () => {
    // Live counts as of 2026-08-27 are named beside each floor; a collapse below means ECON_CALL_RE,
    // extractEntriesByLine or the axis grammar broke — fix the instrument, don't lower these casually.
    expect(family.size, 'economy-family factories derived from source (8 live)').toBeGreaterThanOrEqual(6);
    expect(subjects.length, 'card subjects (family × drivable trigger × parseable axis, + sellsFor prints)').toBeGreaterThanOrEqual(6);
    expect(runeEconomySubjects().length, 'rune subjects (gold-paying reward trees with parseable text)').toBeGreaterThanOrEqual(2);
    expect(heroEconomySubjects().length, 'hero subjects (unconditional parseable promises)').toBeGreaterThanOrEqual(1);
  });

  it('every card subject reconciles: the printed Gold number lands in the printed bank, exactly', () => {
    const failures: string[] = [];
    for (const s of subjects) {
      if (excusedIds.has(s.cardId)) continue;
      for (const golden of [false, true] as const) {
        if (golden && (s.lane === 'spell' || !s.printedGolden)) continue;
        const r = runEconomySubject(s, golden);
        if (r.outcome === 'reconciled') continue;
        const detail = r.outcome === 'mismatch' ? ` — ${r.problems.join('; ')}` : '';
        failures.push(`${s.cardId}${golden ? ' (golden)' : ''} [${s.on ?? 'sellValueOf'} lane ${s.lane}] ${r.outcome}${detail} — "${CARD_INDEX[s.cardId]?.text}"`);
      }
    }
    expect(failures, `Printed-vs-measured Gold disagreement(s). INVESTIGATE before excusing (verify-before-alarm):\n  ${failures.join('\n  ')}`).toEqual([]);
  });

  it('every gold-paying rune reconciles: printed number AND printed timing (now vs next turn) match the reward engine', () => {
    const failures: string[] = [];
    const skipped: string[] = [];
    for (const rune of [...RUNES, ...EPIC_RUNES]) {
      const withGold = runeEconomySubjects().find((s) => s.runeId === rune.id);
      if (!withGold) {
        if (/\b(?:[Gg]ain|[Gg]et)s? \d+ Gold\b/.test(rune.text.replace(/\*\*/g, ''))) skipped.push(rune.id);
        continue;
      }
      const r = runRuneEconomySubject(withGold);
      if (r.outcome !== 'reconciled') {
        failures.push(`${rune.id}: ${'problems' in r ? r.problems.join('; ') : r.outcome} — text "${rune.text}" vs params ${JSON.stringify(withGold.params)}`);
      }
    }
    expect(failures, `Rune text-vs-engine disagreement(s):\n  ${failures.join('\n  ')}`).toEqual([]);
    // Gold-mentioning runes OUT of the oracle, typed (§7.5/§7.6) — 7 as of 2026-08-27, each for a named
    // shape: blood_and_coin (Avenge threshold), vault (tier threshold), altar (per-each), treasure_map
    // (schedule — "In 2 turns"), gem_dividend (Ruby threshold), ashen_payroll (per-each in combat),
    // ornate_clock (its 2 Gold lives inside a rune-specific reward kind, not a gainGold leaf — checkable in
    // principle; graduate it by teaching runeEconomySubjects that kind rather than raising this pin).
    expect(skipped.length, `runes mentioning a flat Gold gain that the grammar did not parse: ${skipped.join(', ')}`).toBeLessThanOrEqual(7);
  });

  it('every parseable hero-power promise reconciles through the real action', () => {
    const failures: string[] = [];
    for (const s of heroEconomySubjects()) {
      const r = runHeroEconomySubject(s);
      if (r.outcome !== 'reconciled') failures.push(`${s.heroId} [${s.kind}, ${s.axis}] ${'problems' in r ? r.problems.join('; ') : r.outcome}`);
    }
    expect(failures, `Hero-power text-vs-engine disagreement(s):\n  ${failures.join('\n  ')}`).toEqual([]);
  });

  it('excuses are real, and both ratchets hold', () => {
    const subjectIds = new Set(subjects.map((s) => s.cardId));
    const stale = Object.keys(ECONOMY_EXCUSED).filter((id) => !subjectIds.has(id))
      .map((id) => `${id}: excused but no longer a subject — delete the entry`);
    expect(stale, stale.join('\n')).toEqual([]);
    const triage = Object.values(ECONOMY_EXCUSED).filter((e) => e.kind === 'needs-triage').length;
    expect(triage, 'needs-triage may only shrink; adding one needs an owner ruling').toBeLessThanOrEqual(0);
    const bugs = Object.entries(ECONOMY_EXCUSED).filter(([, e]) => e.kind === 'confirmed-bug-pending-fix');
    // c3_herald as of 2026-08-27 — the archived Herald's `gold:`-vs-`amount:` param divergence (see the
    // registry entry's repro). Each entry rides only until its fix PR lands; the fix deletes it here.
    expect(bugs.map(([id]) => id), 'confirmed bugs are temporary passengers — each rides only until its fix PR lands').toEqual(['c3_herald']);
    expect(Object.keys(ECONOMY_EXCUSED).length, 'the excuse list is a ceiling, not a dumping ground').toBeLessThanOrEqual(6);
  });

  it('SABOTAGE — a doctored printed Gold number alarms in every bank (the instrument cannot be soothed)', () => {
    // Unit level: each axis rejects a near-miss, and the right bank is checked (an immediate promise paid
    // into the future bank alarms — the future-vs-immediate distinction is load-bearing, §7.2).
    expect(reconcileEconomy({ immediate: 2 }, { embers: 2, future: 0, maxGold: 0 })).toEqual([]);
    expect(reconcileEconomy({ immediate: 3 }, { embers: 2, future: 0, maxGold: 0 }).length, 'wrong amount alarms').toBeGreaterThan(0);
    expect(reconcileEconomy({ immediate: 2 }, { embers: 0, future: 2, maxGold: 0 }).length, 'paid into the WRONG bank alarms').toBeGreaterThan(0);
    expect(reconcileEconomy({ future: 2 }, { embers: 2, future: 0, maxGold: 0 }).length, 'future promise paid now alarms').toBeGreaterThan(0);
    expect(reconcileEconomy({ maxGold: 1 }, { embers: 1, future: 0, maxGold: 0 }).length, 'max-Gold promise that moved no max alarms').toBeGreaterThan(0);
    // End to end: take a reconciling card subject, doctor its printed amount by +1 — the lane must alarm.
    const s = subjects.find((x) => !excusedIds.has(x.cardId) && runEconomySubject(x, false).outcome === 'reconciled');
    expect(s, 'a reconciling economy subject exists to sabotage').toBeDefined();
    const bump = (p: NonNullable<typeof s>['printed']): typeof p => ({
      ...p,
      immediate: p.immediate !== undefined ? p.immediate + 1 : undefined,
      future: p.future !== undefined ? p.future + 1 : undefined,
      maxGold: p.maxGold !== undefined ? p.maxGold + 1 : undefined,
      sellsFor: p.sellsFor !== undefined ? p.sellsFor + 1 : undefined,
      sellGet: p.sellGet !== undefined ? p.sellGet + 1 : undefined,
    });
    const r = runEconomySubject({ ...s!, printed: bump(s!.printed) }, false);
    expect(r.outcome, `${s!.cardId} must ALARM on a +1-off printed Gold number, got '${r.outcome}'`).not.toBe('reconciled');
    // And a rune subject with a doctored expectation alarms too.
    const rune = runeEconomySubjects().find((x) => runRuneEconomySubject(x).outcome === 'reconciled');
    expect(rune, 'a reconciling rune subject exists to sabotage').toBeDefined();
    const rr = runRuneEconomySubject({ ...rune!, printed: bump(rune!.printed) });
    expect(rr.outcome, `${rune!.runeId} must ALARM on a +1-off printed Gold number`).not.toBe('reconciled');
  });
});
