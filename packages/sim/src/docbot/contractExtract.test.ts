/**
 * DOC BOT 2.0 WP B — the contract-extraction + triangle-screening lane (the `contractExtraction`
 * enforcement pin; gates in `npm test`).
 *
 * What it holds:
 *  1. EXTRACTOR DETERMINISM — two sweeps are byte-identical (no dates, no randomness, stable sort).
 *  2. THE INVENTORY GATE (WP B exit) — every active content object (cards incl. tokens/gifts/henchmen,
 *     runes, quests, hero powers) holds a contract in the COMMITTED registry; new content fails here with
 *     "run `npm run contracts:extract`", so the gate stays true forever, not just today.
 *  3. GENERATED ≠ CURATED (§4.6) — the extractor never emits a curated id, the merge law keeps curated on
 *     top even against a sabotaged generated row, and every stored contract passes structural validation
 *     (including the no-stored-'corroborated' rule — friction item 10).
 *  4. CORROBORATION HONESTY (§4.5) — a doctored runtime observation or a doctored text parse flips the
 *     covered aspect to 'disagree' and the derived status to 'needs-review'; the committed registry's
 *     disagreement queue is pinned at its current value (shrink-preferred, grow-loudly).
 *  5. CONVENTION DECK — deterministic, and every card self-contained (format bar re-asserted in
 *     rules.test.ts where the committed deck lives).
 *
 * Runtime budget: ONE playScan() shared across every corroboration call — the whole file must stay well
 * under the 30s PR-gate budget.
 */
import { describe, expect, it } from 'vitest';
import {
  CURATED_CONTRACTS, CURATED_CONTRACT_IDS, EXTRACTED_CONTRACTS, allContracts, contractErrors,
  contractIndex, deriveContractStatus, heroIdOfContentId, isHeroPowerContentId, mergeContracts,
} from '@game/rules/contracts';
import { HEROES } from '../heroes';
import { activeContentIds, extractAllContracts } from './contractExtract';
import { corroborateContracts } from './contractCorroboration';
import { buildConventionQuestions } from './conventionQuestions';
import { playScan } from './playScan';

/** ONE scan for the whole file (the expensive half of the runtime aspect). */
const SCAN = playScan();

describe('contract extraction — determinism + the WP B inventory gate', () => {
  const first = extractAllContracts();

  it('two extraction sweeps are byte-identical', () => {
    const second = extractAllContracts();
    expect(JSON.stringify(second.contracts)).toBe(JSON.stringify(first.contracts));
    expect(second.curatedSkipped).toEqual(first.curatedSkipped);
  });

  it('every active content object holds a contract in the COMMITTED registry (stale registry fails loudly)', () => {
    const committed = contractIndex();
    const missing = activeContentIds().filter((id) => !committed[id]);
    expect(missing, `${missing.length} active object(s) hold no contract — run \`npm run contracts:extract\` and commit the registry: ${missing.slice(0, 10).join(', ')}`).toEqual([]);
  });

  it('the committed extracted registry matches a fresh sweep (drift rail, corpus-digest style)', () => {
    expect(JSON.stringify(EXTRACTED_CONTRACTS)).toBe(JSON.stringify(first.contracts));
  });

  it('every stored contract validates structurally — including no stored corroborated (friction 10)', () => {
    const errors = allContracts().flatMap(contractErrors);
    expect(errors).toEqual([]);
  });

  it('hero powers live in the hero:<id> namespace and resolve to live heroes', () => {
    const heroIds = new Set(HEROES.map((h) => h.id));
    const powers = allContracts().filter((c) => c.contentType === 'hero-power');
    expect(powers.length).toBe(HEROES.length);
    for (const p of powers) {
      expect(isHeroPowerContentId(p.contentId), `${p.contentId} outside the namespace`).toBe(true);
      expect(heroIds.has(heroIdOfContentId(p.contentId)!), `${p.contentId} resolves to no hero`).toBe(true);
    }
  });

  it('extracted drafts are visibly unreviewed with extraction provenance (§4.2)', () => {
    for (const c of EXTRACTED_CONTRACTS) {
      expect(c.reviewStatus, `${c.contentId} generated with status '${c.reviewStatus}'`).toBe('extracted');
      expect(c.extraction?.extractor, `${c.contentId} carries no extractor provenance`).toBeTruthy();
    }
  });
});

describe('generated ≠ curated (§4.6)', () => {
  it('the extractor never emits a curated id', () => {
    const fresh = extractAllContracts();
    for (const c of fresh.contracts) expect(CURATED_CONTRACT_IDS.has(c.contentId), `extractor emitted curated id '${c.contentId}'`).toBe(false);
    expect(fresh.curatedSkipped.length).toBe(CURATED_CONTRACT_IDS.size);
  });

  it('SABOTAGE: a rogue generated row can never shadow a curated contract in the merge', () => {
    const curatedKennel = CURATED_CONTRACTS.find((c) => c.contentId === 'kennel')!;
    const rogue = { ...curatedKennel, revision: 99, reviewStatus: 'extracted' as const, copySubject: undefined, notes: 'ROGUE GENERATED ROW' };
    const merged = mergeContracts(CURATED_CONTRACTS, [rogue]);
    const kennel = merged.filter((c) => c.contentId === 'kennel');
    expect(kennel).toHaveLength(1);
    expect(kennel[0]).toBe(curatedKennel); // the curated object itself, untouched — never the rogue
    expect(kennel[0]!.copySubject, 'the curated subject-side copy claim must survive').toBeTruthy();
  });
});

describe('triangle screening — corroboration honesty (§4.5)', () => {
  const committed = allContracts();
  const real = corroborateContracts(committed, { playScanResult: SCAN });

  it('the committed registry corroborates only where covered, and the disagreement queue is pinned', () => {
    // Pinned at 0 disagreements (2026-08-27): every aspect the existing oracles cover agrees — those
    // oracles gate in npm test, so a covered disagreement here means content moved without its lane.
    // When this grows: triage the queue (a REAL text/param/phase disagreement is Sitting-2 material),
    // don't relax the pin.
    expect(real.disagreements).toEqual([]);
    // Honesty floor: corroboration must never claim the whole registry — uncovered aspects stay visible.
    for (const t of Object.values(real.aspectTotals)) expect(t.agree + t.disagree + t.uncovered).toBe(committed.length);
    expect(real.statusTotals.corroborated ?? 0, 'some contracts must corroborate (the lanes cover real ground)').toBeGreaterThan(200);
    expect(real.statusTotals.extracted ?? 0, 'uncovered contracts must remain visibly extracted, never silently corroborated').toBeGreaterThan(0);
    // 'corroborated' is DERIVED only — the stored registry never holds it (friction 10).
    for (const c of committed) expect(c.reviewStatus).not.toBe('corroborated');
  });

  it('SABOTAGE: a doctored runtime observation flips the aspect to disagreement', () => {
    // Pick a contract the real screen corroborates via the runtime aspect…
    const subject = real.rows.find((r) => r.aspects.some((a) => a.aspect === 'runtime-play' && a.verdict === 'agree'))!;
    expect(subject, 'no runtime-corroborated subject — the sabotage would prove nothing').toBeTruthy();
    // …then doctor the scan to claim its play was indistinguishable from a vanilla body.
    const doctored = { ...SCAN, inertMinions: [...SCAN.inertMinions, subject.contractId] };
    const sabotaged = corroborateContracts(committed.filter((c) => c.contentId === subject.contractId), { playScanResult: doctored });
    const row = sabotaged.rows[0]!;
    expect(row.aspects.find((a) => a.aspect === 'runtime-play')?.verdict).toBe('disagree');
    expect(row.derived).toBe('needs-review');
    expect(sabotaged.disagreements.map((d) => d.contractId)).toContain(subject.contractId);
  });

  it('SABOTAGE: a doctored printed-text parse flips the text aspect to disagreement', () => {
    const subject = real.rows.find((r) => r.aspects.some((a) => a.aspect === 'text-stat-amounts' && a.verdict === 'agree'))!;
    expect(subject).toBeTruthy();
    const sabotaged = corroborateContracts(
      committed.filter((c) => c.contentId === subject.contractId),
      { playScanResult: SCAN, printedBuffOf: () => ({ attack: 98, health: 76 }) },
    );
    const row = sabotaged.rows[0]!;
    expect(row.aspects.find((a) => a.aspect === 'text-stat-amounts')?.verdict).toBe('disagree');
    expect(row.derived).toBe('needs-review');
  });

  it('owner-ruled statuses are never moved by the machine', () => {
    expect(deriveContractStatus('approved', [{ aspect: 'x', verdict: 'disagree' }])).toBe('approved');
    expect(deriveContractStatus('exception', [{ aspect: 'x', verdict: 'agree' }])).toBe('exception');
    expect(deriveContractStatus('extracted', [])).toBe('extracted'); // nothing covered ⇒ no corroboration claim
  });
});

describe('convention deck', () => {
  it('deterministic, family-shaped, and never colliding with curated content contracts', () => {
    const a = buildConventionQuestions();
    const b = buildConventionQuestions();
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.length).toBeGreaterThanOrEqual(60);
    const ids = a.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
