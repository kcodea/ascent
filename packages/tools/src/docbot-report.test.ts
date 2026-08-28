/**
 * DOC BOT 2.0 WP H — the DOC-DRIFT RAIL for `docs/docbot2/final-report.md`.
 *
 * The final report is the document a future session will trust about what this platform can and cannot
 * prove. A hand-maintained number in it would rot within a wave (the CONTENT.md lesson), so this lane
 * re-derives every headline figure from the live registries on every PR and fails when the document has
 * drifted — with the exact command to fix it.
 *
 * It also pins the generator's own honesty rules: ratios carry their denominators, the blind-spot list is
 * never empty, and the four §12.1 finding classes are all present as keys (a class silently disappearing
 * from the roll-up would read as "we found none of those", which is not the same thing).
 *
 * Runtime: the whole file is one `buildFinalReport()` (~0.3s — no playScan/combatScan by design), so the
 * §17.1 PR-gate budget is untouched.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPORT_COMMAND, buildFinalReport, docClaimErrors, headlineNumbers } from './docbot-report.lib';

const DOC = join('docs', 'docbot2', 'final-report.md');
const report = buildFinalReport({ commit: 'test' });

describe('docbot:report — the generator', () => {
  it('is deterministic for a fixed commit', () => {
    const again = buildFinalReport({ commit: 'test' });
    expect(JSON.stringify(again)).toBe(JSON.stringify(report));
  });

  it('reports every ratio with its denominator (§4.3 — no bare percentages)', () => {
    for (const r of [report.contracts.withContract, report.contracts.withDirectExecution,
      report.text.classified, report.interactions.familiesWithCoverage, report.oracles.withSabotageEvidence]) {
      expect(r.total).toBeGreaterThan(0);
      expect(r.of).toBeLessThanOrEqual(r.total);
      expect(r.pct).toBeCloseTo((100 * r.of) / r.total, 0);
    }
  });

  it('carries all five §12.1 finding classes as keys, present even at zero', () => {
    for (const c of ['verified-mechanical-bug', 'verified-text-defect', 'wording-recommendation',
      'questionable-interaction', 'coverage-gap'] as const) {
      expect(report.findings[c]).toBeTypeOf('number');
    }
  });

  it('states a non-empty blind-spot list, each entry naming what it cannot prove', () => {
    expect(report.blindSpots.length).toBeGreaterThan(5);
    for (const b of report.blindSpots) expect(b.what.length).toBeGreaterThan(20);
  });

  it('stamps the §16 semantic revision (build.content.rules.schema)', () => {
    expect(report.semanticRevision.split('.').length).toBeGreaterThanOrEqual(7); // schemaRev is itself dotted
    expect(report.semanticRevision.startsWith('test.')).toBe(true);
  });

  it('covers every active content object with a contract — the WP B gate, restated as a metric', () => {
    expect(report.contracts.withContract.of).toBe(report.contracts.withContract.total);
    expect(report.text.classified.of).toBe(report.text.classified.total);
  });
});

describe('docs/docbot2/final-report.md — the doc-drift rail', () => {
  const markdown = readFileSync(DOC, 'utf8');

  it('states every headline number the generator derives', () => {
    const errors = docClaimErrors(markdown, report);
    expect(errors, `the final report has drifted — run \`${REPORT_COMMAND} -- --check\`:\n  ${errors.join('\n  ')}`).toEqual([]);
  });

  it('cites the generating command and a commit, so a reader can re-derive it', () => {
    expect(markdown).toContain(REPORT_COMMAND);
    expect(markdown).toMatch(/commit\s*[`:]/i);
  });

  it('checks a meaningful number of headlines (a gutted contract must fail loudly)', () => {
    expect(Object.keys(headlineNumbers(report)).length).toBeGreaterThanOrEqual(20);
  });

  it('SABOTAGE — a doctored number in the doc is caught', () => {
    // split/join, not replace: `replace` swaps only the FIRST occurrence, and a headline number appears
    // many times in the prose — the containment check would still find one and the sabotage would pass.
    const doctored = markdown.split(String(report.contracts.total)).join('99999');
    expect(docClaimErrors(doctored, report).map((e) => e.split(' ')[0]))
      .toContain('contracts.total');
  });

  it('SABOTAGE — a doc that drops the generator citation is caught', () => {
    expect(docClaimErrors(markdown.split(REPORT_COMMAND).join('the report tool'), report))
      .toContain(`the document must cite its generator (\`${REPORT_COMMAND}\`)`);
  });
});
