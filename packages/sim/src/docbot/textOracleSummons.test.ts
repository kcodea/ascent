/**
 * DOC BOT — text as oracle tranche 2: the PRINTED summon clause is the MEASURED summon (handoff §7.1).
 *
 * Doctrine, parsing, lanes and the excuse registry live in `textOracleSummons.ts`; this file is the gate.
 * The summon FAMILY derives from the two factory maps' source (tranche 1's extractFactoryEntries +
 * SUMMON_CALL_RE), the SUBJECTS from intersecting that family with drivable triggers and a parseable printed
 * clause — so a new summoner, or a count/token/keyword rebalance that edits params without text (or text
 * without params), is caught the day it lands, with both sides named.
 *
 * Verify-before-alarm (owner-mandated): a mismatch is an ALWAYS-RIGHT alarm only after investigation — rule
 * out an instrument blind spot first (wrong fixture, unarmed trigger, snapshot ordering), then excuse with
 * the measured outcome, or ship a VERIFIED bug as 'confirmed-bug-pending-fix' with the fix PR cut.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_INDEX } from '@game/content';
import { stripComments } from './textOracle';
import {
  SUMMON_CALL_RE, SUMMON_EXCUSED, extractEntriesByLine, parsePrintedSummon, reconcileSummons,
  resolveTokenName, runSummonSubject, summonSubjects,
} from './textOracleSummons';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** The summon family, derived from the two factory maps' SOURCE — never hand-listed. */
function summonFamily(): Set<string> {
  const maps: Array<[string, string]> = [
    ['packages/sim/src/recruit.ts', 'const RECRUIT_FACTORIES'],
    ['packages/core/src/effects/factories.ts', 'export const FACTORIES'],
  ];
  const family = new Set<string>();
  for (const [file, anchor] of maps) {
    const entries = extractEntriesByLine(readFileSync(join(ROOT, file), 'utf8'), anchor);
    for (const [id, body] of Object.entries(entries)) {
      if (SUMMON_CALL_RE.test(stripComments(body))) family.add(id);
    }
  }
  return family;
}

describe('Doc Bot — text as oracle tranche 2 (printed summons)', () => {
  const family = summonFamily();
  const subjects = summonSubjects(family);
  const excusedIds = new Set(Object.keys(SUMMON_EXCUSED));

  it('the parser reads the summon grammar (unit pins)', () => {
    expect(parsePrintedSummon('**Deathrattle:** summon two 1/1 Pups.')).toEqual({
      count: 2, token: { kind: 'named', name: 'Pups', cardId: 'pup' }, goldenToken: false,
      stats: { attack: 1, health: 1 }, keywords: [],
    });
    const golems = parsePrintedSummon('**Taunt.** **Echo:** summon **two** 1/1 **Gemheart Golems** with **Taunt**, and play a **Ruby** on them.');
    expect(golems?.count).toBe(2);
    expect(golems?.stats).toEqual({ attack: 1, health: 1 });
    expect(golems?.keywords).toEqual(['T']);
    const gilded = parsePrintedSummon('**Avenge (4):** summon a **Gilded Armadiyo**.');
    expect(gilded?.goldenToken).toBe(true);
    expect(gilded?.token).toEqual({ kind: 'named', name: 'Armadiyo', cardId: 'b2_armadiyo' });
    // Watcher texts are NOT summon promises — the "you summon" guard.
    expect(parsePrintedSummon('When you summon a Beast, give it **+3/+3**.')).toBeNull();
    expect(parsePrintedSummon('**Taunt. Echo:** give the next **Beast** you summon **+2/+4**.')).toBeNull();
    // Plural resolution.
    expect(resolveTokenName('Crypt Wolves')).toBe('cryptwolf');
    expect(resolveTokenName('Footmen')).toBe('footman');
  });

  it('the instrument sees its surface (family + subjects floors — a collapse means the scanner broke)', () => {
    // 27 family factories / 31 subjects as of 2026-08-27. Floors sit below the live counts so ordinary
    // content churn doesn't trip them; a big drop means SUMMON_CALL_RE, extractEntriesByLine or the lane
    // table broke — fix the instrument, don't lower these casually.
    expect(family.size, 'summon-family factories derived from source').toBeGreaterThanOrEqual(22);
    expect(subjects.length, 'summon subjects (family × drivable trigger × parseable clause)').toBeGreaterThanOrEqual(20);
  });

  it('every subject reconciles: count, token id, gilding, stats and granted keywords match the printed clause', () => {
    const failures: string[] = [];
    for (const s of subjects) {
      if (excusedIds.has(s.cardId)) continue;
      for (const golden of [false, true] as const) {
        if (golden && (s.lane === 'spell' || !s.printedGolden)) continue; // spells never gild; no goldenText → skipped, pinned below
        const r = runSummonSubject(s, golden);
        if (r.outcome === 'reconciled') continue;
        const detail = r.outcome === 'mismatch' ? ` — ${r.problems.join('; ')} (observed ${JSON.stringify(r.observed.map((o) => `${o.cardId}${o.golden ? '*' : ''} ${o.attack}/${o.health} [${o.keywords.join(',')}]`))})` : '';
        failures.push(`${s.cardId}${golden ? ' (golden)' : ''} [${s.on} → ${s.do}, ${s.lane} lane] ${r.outcome}${detail} — "${CARD_INDEX[s.cardId]?.text}"`);
      }
    }
    expect(failures, `Printed-vs-measured summon disagreement(s). INVESTIGATE before excusing (verify-before-alarm); a VERIFIED bug ships as 'confirmed-bug-pending-fix' + a fix PR:\n  ${failures.join('\n  ')}`).toEqual([]);
  });

  it('golden coverage does not silently erode (subjects without a parseable goldenText, pinned)', () => {
    const noGolden = subjects.filter((s) => s.lane !== 'spell' && !s.printedGolden).map((s) => s.cardId);
    expect(noGolden.length, `minion summon subjects with no parseable goldenText (each skips its golden run): ${noGolden.join(', ')}`).toBeLessThanOrEqual(4);
  });

  it('excuses are real, and both ratchets hold', () => {
    const subjectIds = new Set(subjects.map((s) => s.cardId));
    const stale = Object.keys(SUMMON_EXCUSED).filter((id) => !subjectIds.has(id))
      .map((id) => `${id}: excused but no longer a subject (text, effects or family changed) — delete the entry`);
    expect(stale, `Stale excuse entr(ies):\n  ${stale.join('\n  ')}`).toEqual([]);
    const triage = Object.values(SUMMON_EXCUSED).filter((e) => e.kind === 'needs-triage').length;
    // 1 as of 2026-08-27: dw_exgalloper — the copy-summon factories disagree on the Gilded badge (see the
    // entry's owner question). May only shrink; adding one needs a NEW owner question, not a bigger number.
    expect(triage, 'needs-triage may only shrink; adding one needs an owner ruling').toBeLessThanOrEqual(1);
    const bugs = Object.entries(SUMMON_EXCUSED).filter(([, e]) => e.kind === 'confirmed-bug-pending-fix');
    expect(bugs.map(([id]) => id), 'confirmed bugs are temporary passengers — each rides only until its fix PR lands (none open as of 2026-08-27)').toEqual([]);
    expect(Object.keys(SUMMON_EXCUSED).length, 'the excuse list is a ceiling, not a dumping ground').toBeLessThanOrEqual(8);
  });

  it('SABOTAGE — a doctored printed clause alarms on every axis (the instrument cannot be soothed)', () => {
    // Unit level: each axis rejects a near-miss.
    const self = { cardId: 'x', attack: 3, health: 3, golden: false };
    const base = { count: 2, token: { kind: 'named', name: 'Pup', cardId: 'pup' } as const, goldenToken: false, keywords: [] as string[] };
    const twoPups = [
      { cardId: 'pup', golden: false, attack: 1, health: 1, keywords: [] },
      { cardId: 'pup', golden: false, attack: 1, health: 1, keywords: [] },
    ];
    expect(reconcileSummons({ ...base }, twoPups, self, false)).toEqual([]);
    expect(reconcileSummons({ ...base, count: 3 }, twoPups, self, false).length, 'wrong count alarms').toBeGreaterThan(0);
    expect(reconcileSummons({ ...base, token: { kind: 'named', name: 'Stray', cardId: 'stray' } }, twoPups, self, false).length, 'wrong token id alarms').toBeGreaterThan(0);
    expect(reconcileSummons({ ...base, goldenToken: true }, twoPups, self, false).length, 'plain-vs-gilded alarms').toBeGreaterThan(0);
    expect(reconcileSummons({ ...base, stats: { attack: 2, health: 1 } }, twoPups, self, false).length, 'wrong printed stats alarm').toBeGreaterThan(0);
    expect(reconcileSummons({ ...base, keywords: ['T'] }, twoPups, self, false).length, 'a promised keyword missing on the body alarms').toBeGreaterThan(0);
    // End to end: take a real reconciling subject per lane class, doctor its printed count by +1 — the lane
    // must come back non-reconciled, proving a summon-shape bug (or stale text) cannot pass.
    for (const lane of ['shout', 'combat'] as const) {
      const s = subjects.find((x) => x.lane === lane && !excusedIds.has(x.cardId) && runSummonSubject(x, false).outcome === 'reconciled');
      expect(s, `a reconciling ${lane}-lane subject exists to sabotage`).toBeDefined();
      const wrong = { ...s!, printed: { ...s!.printed, count: s!.printed.count + 1 } };
      const r = runSummonSubject(wrong, false);
      expect(r.outcome, `${s!.cardId} (${lane} lane) must ALARM on a +1-off printed count, got '${r.outcome}'`).not.toBe('reconciled');
    }
  });
});
