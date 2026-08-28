/**
 * DOC BOT 2.0 WP F — the ANOMALY ORACLE (blueprint §9.7; work-package-plan.md WP F).
 *
 * Surfaces behaviour that is not proven wrong but is STRUCTURALLY SUSPICIOUS, over the pairwise/triple
 * interaction runs' traces plus the contract registry. §9.7's detector list, realized where substrate
 * exists today:
 *
 *  A. multiplier-factor-divergence   — a multiplier compounds differently than its declared factor on an
 *                                      equivalent trigger (a failed trigger×multiplier diff).
 *  B. irrelevant-change-sensitivity  — permuting inert bystanders changed an unrelated measurement.
 *  C. copied-source-unexpected-state — a copy carries per-instance state the subject's contract does not
 *                                      state as riding.
 *  D. event-without-contract-consequence — a combat factory stamp attributed to a source whose contract
 *                                      states no such effect (confidence 'uncertain': granted/derived
 *                                      effects legitimately stamp this way — below the default floor).
 *  E. extreme-resource-outlier       — a measured resource count beyond any structural bound (board cap).
 *  F. unruled-multiplier-composition — a declared multiplier family whose composition semantics have no
 *                                      owner ruling or pinned matrix row (static, from contracts; the
 *                                      phase-asymmetric-interaction face of §9.7).
 *  G. silently-swallowed-trigger     — a staged pair whose channel emitted nothing observable (confidence
 *                                      'uncertain': many payoff shapes legitimately act without emitting).
 *
 * NON-NEGOTIABLES (§9.7/§4.3): every anomaly is `class: 'questionable-interaction'` with COMPETING
 * INTERPRETATIONS — the helper hardcodes the class, so no caller and no detector can promote an anomaly to
 * a verified grade. Noise control (the WP A requirement): a CONFIDENCE FLOOR drops below-floor detectors
 * into a visible `suppressed` count (never silently), and findings are FINGERPRINT-DEDUPED (structural
 * identity, prose-free) before they ship.
 */
import type { ContentContract } from '@game/rules/contracts/schema';
import { makeFinding, type CompetingInterpretation, type DocbotFinding, type FindingConfidence } from './findings';
import type { InteractionRun } from './interactionSweep';

export const ANOMALY_LANE = 'anomaly-oracle';
const BOARD_CAP = 7;

export type AnomalyDetectorId =
  | 'multiplier-factor-divergence'
  | 'irrelevant-change-sensitivity'
  | 'copied-source-unexpected-state'
  | 'event-without-contract-consequence'
  | 'extreme-resource-outlier'
  | 'unruled-multiplier-composition'
  | 'silently-swallowed-trigger';

/** Multiplier families whose COMPOSITION semantics carry an owner ruling or a pinned matrix row today:
 *  battlecry (interactionFamilyMatrix P1–P3/P9–P10, owner q-interact-combat-shout-multipliers),
 *  deathrattle (P4–P6/P11, owner 2026-07-08 "additive"), rally (P7, simulate.ts playerRallyExtras + the
 *  Uron rally-tally owner report), avenge (R-AVWIN-07: resolution-only, the multiplier-resolution-only
 *  metamorphic law + temporalWindow pins), and — since the owner's Sitting-2 approvals of 2026-08-28
 *  (q-interact2-32aa654f / q-interact2-faeb3c44, endorsing "these families fold like the ruled ones") —
 *  endOfTurn and startOfCombat, now carrying R-MULT-02 and matrix fixtures P12–P13.
 *  Families OUTSIDE this set are detector F's worklist — grow it ONLY when a ruling/pin lands, never to
 *  quiet the detector. */
export const RULED_MULTIPLIER_FAMILIES: ReadonlySet<string> = new Set([
  'battlecry', 'deathrattle', 'rally', 'avenge', 'endOfTurn', 'startOfCombat',
]);

interface AnomalyDraft {
  detector: AnomalyDetectorId;
  confidence: FindingConfidence;
  contentIds: string[];
  title: string;
  summary: string;
  expected: string;
  observed: string;
  interpretations: CompetingInterpretation[];
  contractIds?: string[];
}

export interface AnomalyOracleOptions {
  runs: readonly InteractionRun[];
  contracts: readonly ContentContract[];
  /** Findings below this confidence are SUPPRESSED (counted, never emitted) — the WP A noise floor. */
  confidenceFloor?: FindingConfidence;
  semanticRevision?: string;
}

/** An anomaly finding: a DocbotFinding (fingerprint-identical to the base shape — `detector` is additive
 *  and never hashed) carrying its §9.7 detector id for downstream grouping (the Sitting-2 deck builder). */
export interface AnomalyFinding extends DocbotFinding {
  detector: AnomalyDetectorId;
}

export interface AnomalyOracleReport {
  findings: AnomalyFinding[];
  /** Below-floor drafts, visible as a count per detector (§4.3 — suppression is data, not silence). */
  suppressedByDetector: Record<string, number>;
  suppressedTotal: number;
}

const CONFIDENCE_RANK: Record<FindingConfidence, number> = { proven: 3, strong: 2, uncertain: 1 };

/** The ONE constructor every detector goes through: class is hardcoded 'questionable-interaction' and the
 *  severity 'question' — an anomaly can never leave this function as a verified finding (§9.7/§4.3). */
function makeAnomaly(d: AnomalyDraft, semanticRevision: string): AnomalyFinding {
  if (d.interpretations.length < 2) {
    throw new Error(`anomaly '${d.detector}' has ${d.interpretations.length} interpretation(s) — §12.1 requires competing readings`);
  }
  return {
    detector: d.detector,
    ...makeFinding({
    lane: ANOMALY_LANE,
    severity: 'question',
    confidence: d.confidence,
    status: 'needs-ruling',
    title: d.title,
    summary: d.summary,
    contentIds: d.contentIds,
    ruleIds: [],
    expectationKind: `anomaly:${d.detector}`,
    expected: d.expected,
    observed: d.observed,
    class: 'questionable-interaction',
    competingInterpretations: d.interpretations,
    provenance: { lane: ANOMALY_LANE },
    semanticRevision,
    ...(d.contractIds ? { contractIds: d.contractIds } : {}),
    }),
  };
}

export function runAnomalyOracle(opts: AnomalyOracleOptions): AnomalyOracleReport {
  const floor = CONFIDENCE_RANK[opts.confidenceFloor ?? 'strong'];
  const semanticRevision = opts.semanticRevision ?? 'dev';
  const byId = new Map(opts.contracts.map((c) => [c.contentId, c]));
  const drafts: AnomalyDraft[] = [];

  for (const r of opts.runs) {
    // A — a failed trigger×multiplier diff: the fold deviated from the declared factor.
    if (r.family === 'trigger-x-multiplier' && r.verdict === 'failed' && r.measurement) {
      const { base, variant, expectedFactor } = r.measurement;
      drafts.push({
        detector: 'multiplier-factor-divergence',
        confidence: 'strong',
        contentIds: r.members,
        title: `multiplier fold deviates on ${r.members.join(' + ')}`,
        summary: `${r.evidence}. The measured fold is ${base > 0 ? (variant / base).toFixed(2) : '?'}× against a declared ×${expectedFactor}.`,
        expected: `variant = base × ${expectedFactor}`,
        observed: `base ${base}, variant ${variant}`,
        interpretations: [
          { interpretation: 'the multiplier is dropped on this trigger path (the #897 Echohorn-dropped-Sylus class)', evidence: [r.evidence] },
          { interpretation: 'the multiplier composes under a different law here (stacking/best-of) and the declared factor is the wrong model', evidence: [`declared ×${expectedFactor} from the contract's triggerMultiplier`] },
        ],
        contractIds: r.members.filter((m) => byId.has(m)),
      });
    }

    // B — the inert-bystander reorder probe moved the measurement.
    if (r.trace?.reorderDelta !== undefined && r.trace.reorderDelta !== 0) {
      drafts.push({
        detector: 'irrelevant-change-sensitivity',
        confidence: 'strong',
        contentIds: r.members,
        title: `board-order sensitivity on ${r.members.join(' + ')}`,
        summary: `${r.evidence}. Moving the source across two inert 0-Attack bystanders changed the measurement by ${r.trace.reorderDelta}.`,
        expected: 'reorder delta 0 (an irrelevant change must change nothing)',
        observed: `delta ${r.trace.reorderDelta}`,
        interpretations: [
          { interpretation: 'a positional dependency leaked into an effect whose text states none', evidence: [r.evidence] },
          { interpretation: 'the effect is genuinely positional (leftmost/adjacent) and its contract/text under-states it', evidence: ['the contract states no positional scope'] },
        ],
      });
    }

    // C — the copy probe observed instance state the subject's contract does not state as riding.
    if (r.trace?.copyState && r.members.length >= 2) {
      const subjectId = r.members[1]!;
      const subject = byId.get(subjectId);
      const rides = subject?.copySubject?.rides ?? [];
      // rides strings are freeform vocabulary ('accrued-improve-counters (summonBonus)') — substring
      // matching keeps the detector from re-asking what a contract already states in its own words.
      const stated = (needle: string): boolean => rides.some((x) => x.toLowerCase().includes(needle.toLowerCase()));
      const unexpected: string[] = [];
      if (r.trace.copyState.golden && !stated('gild') && !stated('golden')) unexpected.push('gilding');
      for (const [k, v] of Object.entries(r.trace.copyState.counters ?? {})) {
        if (v > 0 && !stated(k) && !stated('counter')) unexpected.push(`counter:${k}`);
      }
      if (unexpected.length > 0) {
        drafts.push({
          detector: 'copied-source-unexpected-state',
          confidence: 'strong',
          contentIds: r.members,
          title: `copy of ${subjectId} carries unstated instance state`,
          summary: `${r.evidence}. The copy carries [${unexpected.join(', ')}] which ${subjectId}'s contract does not state as riding a copy.`,
          expected: `copySubject.rides ⊇ [${unexpected.join(', ')}]`,
          observed: `rides stated: [${[...rides].join(', ') || 'none'}]`,
          interpretations: [
            { interpretation: 'the copy is over-carrying state (a copy-mode bug)', evidence: [r.evidence] },
            { interpretation: 'the behaviour is intended and the subject contract is incomplete — state the rides', evidence: ['the copier is exact-mode; exact copies may legitimately carry everything'] },
          ],
          contractIds: [subjectId].filter((m) => byId.has(m)),
        });
      }
    }

    // D — a factory stamp attributed to a source whose contract states no such effect. UNCERTAIN by
    // design: granted effects, quest marks, and derived stamps legitimately do this — below the floor.
    for (const [src, kinds] of Object.entries(r.trace?.factoryStamps ?? {})) {
      const contract = byId.get(src);
      if (!contract) continue;
      const stated = new Set((contract.effects ?? []).map((e) => e.kind));
      const orphan = kinds.filter((k) => !stated.has(k));
      if (orphan.length > 0) {
        drafts.push({
          detector: 'event-without-contract-consequence',
          confidence: 'uncertain',
          contentIds: [src],
          title: `${src} emitted effects its contract does not state`,
          summary: `combat log stamps [${orphan.join(', ')}] attributed to ${src}; its contract states [${[...stated].join(', ') || 'none'}] (run: ${r.family}).`,
          expected: `contract effects ⊇ [${orphan.join(', ')}]`,
          observed: `stated [${[...stated].join(', ') || 'none'}]`,
          interpretations: [
            { interpretation: 'the contract is incomplete — the extractor missed an effect', evidence: [`stamps: ${orphan.join(', ')}`] },
            { interpretation: 'a granted/derived effect legitimately stamps this source (no contract gap)', evidence: ['granted effects ride the granter, not the def'] },
          ],
          contractIds: [src],
        });
      }
    }

    // E — a summon count beyond the structural bound.
    for (const [tokenId, n] of Object.entries(r.trace?.summonCounts ?? {})) {
      if (n > BOARD_CAP) {
        drafts.push({
          detector: 'extreme-resource-outlier',
          confidence: 'strong',
          contentIds: r.members,
          title: `summon outlier: ${n} × '${tokenId}' in one fight`,
          summary: `${r.evidence}. ${n} player-side summons of '${tokenId}' exceed the ${BOARD_CAP}-slot board — resolution is looping or the cap is leaking.`,
          expected: `<= ${BOARD_CAP} concurrent summons per fight for this fixture`,
          observed: `${n}`,
          interpretations: [
            { interpretation: 'a summon/death loop is re-arming past the cap (unbounded resolution)', evidence: [r.evidence] },
            { interpretation: 'deaths freed slots mid-fight and the total is legitimate churn', evidence: ['summon events count landings over time, not concurrency'] },
          ],
        });
      }
    }

    // G — the staged channel emitted nothing observable. UNCERTAIN: many payoffs act without emitting.
    if (r.verdict === 'blocked' && r.blockedReason === 'no-observable-emission') {
      drafts.push({
        detector: 'silently-swallowed-trigger',
        confidence: 'uncertain',
        contentIds: r.members,
        title: `${r.family}: staged channel produced no observable emission`,
        summary: r.evidence,
        expected: 'an observable emission for the staged trigger',
        observed: 'nothing attributable surfaced',
        interpretations: [
          { interpretation: 'the trigger was silently swallowed (a real §9.7 swallow)', evidence: [r.evidence] },
          { interpretation: 'the payoff shape acts without emitting an attributable event (an instrumentation gap, WP C work)', evidence: ['combat sources are only 8/26 stamped today (canonical-schemas §4.1)'] },
        ],
      });
    }
  }

  // F — static: declared multiplier families with NO ruled composition (contracts only, no runs needed).
  for (const c of [...opts.contracts].sort((a, b) => (a.contentId < b.contentId ? -1 : 1))) {
    if (!c.multiplier) continue;
    const unruled = c.multiplier.families.filter((f) => !RULED_MULTIPLIER_FAMILIES.has(f)).sort();
    if (unruled.length === 0) continue;
    drafts.push({
      detector: 'unruled-multiplier-composition',
      confidence: 'strong',
      contentIds: [c.contentId],
      title: `${c.contentId} multiplies [${unruled.join(', ')}] with no ruled composition law`,
      summary: `${c.contentId} declares ×(1+${c.multiplier.extra}) on [${unruled.join(', ')}], but no owner ruling or pinned matrix row states how those families compose (cross-card collapse, phase symmetry, stacking) — the interactionFamilyMatrix Q1 class.`,
      expected: `a ruled composition law for [${unruled.join(', ')}] (like battlecry/deathrattle/rally have)`,
      observed: 'no ruling; behaviour pinned only implicitly by shared fold helpers',
      interpretations: [
        { interpretation: 'these families fold like the ruled ones: additive within a family, best-of across non-stacking cards', evidence: ['types.ts extraTriggerFires comment', 'owner ruling 2026-07-08 "additive" (deathrattle)'] },
        { interpretation: 'each family needs its own ruling — the shop/combat phase split or the rune interplay may differ (socTwilightExtraFires stacked by owner REVERSAL, not by the default law)', evidence: ['owner reversal 2026-08-20: Combat Prowess × Twilight STACK', 'docs/rulebook/interaction-ambiguities.md Q1 (Uron + Chronos)'] },
      ],
      contractIds: [c.contentId],
    });
  }

  // Floor + fingerprint dedup (the WP A noise contract).
  const suppressedByDetector: Record<string, number> = {};
  const byFingerprint = new Map<string, AnomalyFinding>();
  let suppressedTotal = 0;
  for (const d of drafts) {
    if (CONFIDENCE_RANK[d.confidence] < floor) {
      suppressedByDetector[d.detector] = (suppressedByDetector[d.detector] ?? 0) + 1;
      suppressedTotal++;
      continue;
    }
    const f = makeAnomaly(d, semanticRevision);
    if (!byFingerprint.has(f.fingerprint)) byFingerprint.set(f.fingerprint, f);
  }
  const findings = [...byFingerprint.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { findings, suppressedByDetector, suppressedTotal };
}
