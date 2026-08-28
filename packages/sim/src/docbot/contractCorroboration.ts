/**
 * DOC BOT 2.0 — triangle screening over the extracted contracts (WP B; owner-review-pipeline.md §2).
 *
 * For each contract, checks the triangle legs the EXISTING oracles already cover — per-aspect, honestly:
 *
 *  · 'phase-reachability' — the intent claim "this fires in phase X" vs the phase registry
 *    (TRIGGER_PHASES + PHASE_EXCUSED, gated by the factoryPhase lane in npm test). A needs-triage excuse is
 *    a live DISAGREEMENT: the trigger dispatches somewhere the factory does nothing and nobody has ruled.
 *  · 'text-stat-amounts' — the displayed-text leg vs the extracted params, through the text-oracle T1
 *    grammar (parseFirstStatBuff). Compared only when attribution is UNAMBIGUOUS (exactly one effect
 *    carries an attack/health const pair); everything else is visibly 'uncovered', never assumed.
 *  · 'text-summons' — the T2 grammar (parsePrintedSummon) vs the extracted summon claims (token id + count).
 *  · 'runtime-play' — the play/cast differential (playScan): a card whose play is indistinguishable from a
 *    vanilla body while its contract claims a play/cast effect DISAGREES with the engine; excused/refused
 *    entries are 'uncovered' with the excuse cited.
 *
 * A contract is 'corroborated' (DERIVED, never stored — friction item 10) only on the aspects actually
 * covered: `deriveContractStatus` folds the verdicts, and every report prints the per-aspect totals so
 * partial coverage can never masquerade as full agreement (§4.3).
 *
 * Sabotage injectability (§4.5): every leg's source is injectable through `CorroborationSources`, so the
 * honesty tests can doctor a runtime observation or a printed parse and prove the aspect flips to
 * 'disagree' without the comparator being consulted twice.
 */
import { CARD_INDEX } from '@game/content';
import {
  deriveContractStatus,
  type ContentContract, type ContractAspectVerdict, type DerivedContractStatus, type ContractReviewStatus,
} from '@game/rules/contracts/schema';
import { PARKED_REASON } from '@game/rules/parked';
import { PHASE_EXCUSED } from './phaseRegistry';
import { playScan, type PlayScanResult } from './playScan';
import { PLAY_EXCUSED, WATCHER_EXCUSED } from './historyRegistry';
import { parseFirstStatBuff, type PrintedBuff } from './textOracle';
import { parsePrintedSummon, type PrintedSummon } from './textOracleSummons';

export type CorroborationAspect = 'phase-reachability' | 'text-stat-amounts' | 'text-summons' | 'runtime-play';

export const CORROBORATION_ASPECTS: readonly CorroborationAspect[] = [
  'phase-reachability', 'text-stat-amounts', 'text-summons', 'runtime-play',
];

export interface CorroborationSources {
  /** The play/cast differential result (defaults to running the real scan once). */
  playScanResult?: PlayScanResult;
  /** Printed-text stat-buff parse (defaults to the T1 grammar). Injectable for sabotage. */
  printedBuffOf?: (contentId: string, text: string) => PrintedBuff | null;
  /** Printed-text summon parse (defaults to the T2 grammar). Injectable for sabotage. */
  printedSummonOf?: (contentId: string, text: string) => PrintedSummon | null;
}

export interface ContractCorroborationRow {
  contractId: string;
  stored: ContractReviewStatus;
  derived: DerivedContractStatus;
  aspects: ContractAspectVerdict[];
}

export interface CorroborationDisagreement {
  contractId: string;
  aspect: CorroborationAspect;
  detail: string;
}

export interface CorroborationReport {
  rows: ContractCorroborationRow[];
  disagreements: CorroborationDisagreement[];
  /** Per-aspect coverage honesty: how many contracts each aspect agreed / disagreed / could not cover. */
  aspectTotals: Record<CorroborationAspect, { agree: number; disagree: number; uncovered: number }>;
  /** Derived-status counts (the report's headline: corroborated is DERIVED, never merged into approved). */
  statusTotals: Record<DerivedContractStatus, number>;
  /** Owner-parked WIP contracts per class id, and how many verdicts were downgraded on their account.
   *  Parked rows are still MEASURED and still counted — the lane simply stops asserting intent (2026-08-28). */
  parked: { byClass: Record<string, number>; downgraded: number };
}

const CARD_TYPES = new Set(['minion', 'spell', 'token', 'gift', 'henchman']);

/** The attack/health const pair of one effect's extracted amount — ONLY when the amount is EXACTLY that
 *  shape ({attack, health}, nothing else). Composite params (base+step pairs, per-gold scalers) make the
 *  first-buff grammar's attribution unsafe: Patch Job prints its base +1/+1 first while the params also
 *  carry the +2/+2 step — a naive compare mis-reads that as a text defect (caught on this lane's first
 *  run), so composite shapes are 'uncovered', never 'disagree'. */
function attackHealthOf(e: NonNullable<ContentContract['effects']>[number]): { attack: number; health: number } | null {
  if (e.amount?.kind !== 'const' || typeof e.amount.plain !== 'object' || e.amount.plain === null || Array.isArray(e.amount.plain)) return null;
  const o = e.amount.plain as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  if (keys.length !== 2 || keys[0] !== 'attack' || keys[1] !== 'health') return null;
  if (typeof o.attack === 'number' && typeof o.health === 'number') return { attack: o.attack, health: o.health };
  return null;
}

function phaseAspect(c: ContentContract): ContractAspectVerdict {
  if (!CARD_TYPES.has(c.contentType)) {
    return { aspect: 'phase-reachability', verdict: 'uncovered', detail: 'phase registry substrate is card-factory-scoped; rune/quest/hero reachability rides other lanes' };
  }
  for (const e of c.effects ?? []) {
    const excuse = PHASE_EXCUSED[e.kind];
    if (excuse?.kind === 'needs-triage') {
      return { aspect: 'phase-reachability', verdict: 'disagree', detail: `factory '${e.kind}' is silent in the ${excuse.phase} phase with only a needs-triage excuse — reachability unruled (${excuse.why})` };
    }
  }
  const derived = (c.triggers ?? []).filter((t) => t.phaseBasis === 'derived:phaseRegistry');
  if (derived.length === 0) {
    return { aspect: 'phase-reachability', verdict: 'uncovered', detail: 'no phaseRegistry-derived trigger claims (vanilla body, or hand-authored phases)' };
  }
  return { aspect: 'phase-reachability', verdict: 'agree', detail: 'derived from TRIGGER_PHASES/PHASE_EXCUSED; the factoryPhase lane gates every pair in npm test' };
}

function textStatAspect(c: ContentContract, sources: CorroborationSources): ContractAspectVerdict {
  const aspect = 'text-stat-amounts';
  if (!CARD_TYPES.has(c.contentType)) return { aspect, verdict: 'uncovered', detail: 'T1 grammar covers card text only' };
  const def = CARD_INDEX[c.contentId];
  if (!def?.text) return { aspect, verdict: 'uncovered', detail: 'no printed text in CARD_INDEX' };
  const printed = sources.printedBuffOf ? sources.printedBuffOf(c.contentId, def.text) : parseFirstStatBuff(def.text);
  if (!printed) return { aspect, verdict: 'uncovered', detail: 'text prints no stat buff (not a T1 subject)' };
  const effs = c.effects ?? [];
  // Attribution safety: the T1 grammar reads the FIRST printed buff; only a single-effect card whose one
  // amount is exactly {attack, health} lets us attach that printed pair to the params honestly. A card
  // with a second effect (Chef Raag: an unparsed aura-derived grant BEFORE the +2/+2 imp improve) or a
  // composite amount would compare the wrong numbers — 'uncovered', never a fabricated disagreement.
  if (effs.length !== 1) {
    return { aspect, verdict: 'uncovered', detail: `multi-effect card (${effs.length}) — first-buff attribution unsafe` };
  }
  const p = attackHealthOf(effs[0]!);
  if (!p) return { aspect, verdict: 'uncovered', detail: 'no exact {attack, health} const amount to compare (formula, composite, or other param keys)' };
  if (p.attack === printed.attack && p.health === printed.health) {
    return { aspect, verdict: 'agree', detail: `printed +${printed.attack}/+${printed.health} ≡ extracted params` };
  }
  return { aspect, verdict: 'disagree', detail: `text prints +${printed.attack}/+${printed.health} but the extracted params say +${p.attack}/+${p.health}` };
}

function textSummonAspect(c: ContentContract, sources: CorroborationSources): ContractAspectVerdict {
  const aspect = 'text-summons';
  if (!CARD_TYPES.has(c.contentType)) return { aspect, verdict: 'uncovered', detail: 'T2 grammar covers card text only' };
  const def = CARD_INDEX[c.contentId];
  if (!def?.text) return { aspect, verdict: 'uncovered', detail: 'no printed text in CARD_INDEX' };
  const printed = sources.printedSummonOf ? sources.printedSummonOf(c.contentId, def.text) : parsePrintedSummon(def.text);
  if (!printed) return { aspect, verdict: 'uncovered', detail: 'text promises no summon (not a T2 subject)' };
  const summons = (c.effects ?? []).map((e) => e.summons).filter((s): s is NonNullable<typeof s> => !!s);
  if (summons.length === 0) return { aspect, verdict: 'uncovered', detail: 'text promises a summon but the extractor parsed no summon claim from the params — a visible extraction gap, not a pass' };
  if (printed.token.kind !== 'named') return { aspect, verdict: 'uncovered', detail: `printed token is ${printed.token.kind} — id comparison needs a named, resolved token` };
  const match = summons.find((s) => s.cardId === (printed.token as { cardId: string }).cardId);
  if (!match) {
    return { aspect, verdict: 'disagree', detail: `text names '${(printed.token as { cardId: string }).cardId}' but the extracted summon claims [${summons.map((s) => s.cardId).join(', ')}]` };
  }
  if (match.count.plain !== printed.count) {
    return { aspect, verdict: 'disagree', detail: `text promises ${printed.count} × '${match.cardId}' but the extracted count is ${match.count.plain}` };
  }
  return { aspect, verdict: 'agree', detail: `printed summon ${printed.count} × '${match.cardId}' ≡ extracted params` };
}

function runtimeAspect(c: ContentContract, scan: PlayScanResult): ContractAspectVerdict {
  const aspect = 'runtime-play';
  if (!CARD_TYPES.has(c.contentType)) return { aspect, verdict: 'uncovered', detail: 'the play differential drives cards only' };
  const id = c.contentId;
  if (scan.refusedSpells.includes(id)) return { aspect, verdict: 'uncovered', detail: 'pinned refused-spell queue (#847 rule) — the fixture cannot cast it' };
  if (scan.silentWatchers.includes(id)) {
    const excuse = WATCHER_EXCUSED[id];
    return excuse
      ? { aspect, verdict: 'uncovered', detail: `silent watcher with an owner-ruled reading: ${excuse}` }
      : { aspect, verdict: 'disagree', detail: 'silent watcher with NO excuse — reacts to nothing played past it' };
  }
  if (scan.inertMinions.includes(id) || scan.inertSpells.includes(id)) {
    const excuse = PLAY_EXCUSED[id];
    return excuse
      ? { aspect, verdict: 'uncovered', detail: `inert under the fixture, excused: ${excuse}` }
      : { aspect, verdict: 'disagree', detail: 'contract claims a play/cast effect but the play differential found it indistinguishable from a vanilla body' };
  }
  const claimsPlay = (c.triggers ?? []).some((t) => t.event === 'onPlay' || t.event === 'cast');
  if (!claimsPlay) return { aspect, verdict: 'uncovered', detail: 'no onPlay/cast claim — outside the play differential\'s surface' };
  return { aspect, verdict: 'agree', detail: 'the play/cast differential proved the effect acts (playDifferential gates in npm test)' };
}

export function corroborateContracts(
  contracts: readonly ContentContract[],
  sources: CorroborationSources = {},
): CorroborationReport {
  const scan = sources.playScanResult ?? playScan();
  const rows: ContractCorroborationRow[] = [];
  const disagreements: CorroborationDisagreement[] = [];
  const aspectTotals = Object.fromEntries(
    CORROBORATION_ASPECTS.map((a) => [a, { agree: 0, disagree: 0, uncovered: 0 }]),
  ) as CorroborationReport['aspectTotals'];
  const statusTotals: Record<string, number> = {};
  const parkedByClass: Record<string, number> = {};
  let parkedDowngraded = 0;

  for (const c of contracts) {
    let aspects: ContractAspectVerdict[] = [
      phaseAspect(c),
      textStatAspect(c, sources),
      textSummonAspect(c, sources),
      runtimeAspect(c, scan),
    ];
    if (c.parked) {
      // KEEP VERIFYING, STOP ASSERTING INTENT (owner parking, 2026-08-28): every aspect is still measured
      // above — a genuine mismatch is still visible in the row's detail — but a 'disagree' is a claim about
      // INTENT, and the owner has said this surface has none yet. Downgrade to 'uncovered', citing why.
      const p = c.parked;
      parkedByClass[p.classId] = (parkedByClass[p.classId] ?? 0) + 1;
      aspects = aspects.map((a) => {
        if (a.verdict !== 'disagree') return a;
        parkedDowngraded += 1;
        return {
          aspect: a.aspect,
          verdict: 'uncovered' as const,
          detail: `${PARKED_REASON} (${p.classId}): measured but not asserted — ${p.why} · measurement was: ${a.detail ?? '(no detail)'}`,
        };
      });
    }
    for (const a of aspects) {
      aspectTotals[a.aspect as CorroborationAspect][a.verdict] += 1;
      if (a.verdict === 'disagree') disagreements.push({ contractId: c.contentId, aspect: a.aspect as CorroborationAspect, detail: a.detail ?? '' });
    }
    const derived = deriveContractStatus(c.reviewStatus, aspects);
    statusTotals[derived] = (statusTotals[derived] ?? 0) + 1;
    rows.push({ contractId: c.contentId, stored: c.reviewStatus, derived, aspects });
  }

  return {
    rows,
    disagreements,
    aspectTotals,
    statusTotals: statusTotals as CorroborationReport['statusTotals'],
    parked: { byClass: parkedByClass, downgraded: parkedDowngraded },
  };
}
