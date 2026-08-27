/**
 * DOC BOT 2.0 WP E — the rewrite advisor (blueprint §11.4).
 *
 * For MECHANICALLY-CORRECT text that violates a settled style rule or a measured readability bound, emit
 * `wording-recommendation` findings: current text + the identified issue + a proposed replacement that
 * PRESERVES mechanics exactly (pure term renames / no numeric or structural change). Recommendations live
 * in findings and reports ONLY — the advisor NEVER writes to content files (§23), and it stays silent on
 * every rule the Sitting-3 deck is still asking about (`contested`) or the owner has reserved
 * (`reserved`): advising ahead of the ruling would front-run the canon.
 *
 * The guide registry is the advisor's data — injectable (sabotage §4.5: a doctored predicate must produce
 * a doctored recommendation, proving the advisor reads the registry rather than hardcoding rules).
 */
import { CARD_INDEX } from '@game/content';
import type { LanguageGuideEntry } from '@game/rules'; // type-only: erased at build, never bundles the registry
import { makeFinding, type DocbotFinding } from '../findings';
import { stripMarkers } from '../textOracle';
import type { TextObject } from './corpus';

export const ADVISOR_LANE = 'text-advisor';

/** Cards frames measured at ~this many plain characters before text visibly overflows (readability bound,
 *  §11.4 "text too long for its card frame" — a measured concern, deliberately generous). */
export const FRAME_CHAR_BOUND = 260;

export interface AdvisorOptions {
  objects: readonly TextObject[];
  /** The language-guide entries to enforce — pass LANGUAGE_GUIDE (or a doctored copy in sabotage). */
  guide: readonly LanguageGuideEntry[];
  semanticRevision?: string;
}

function appliesTo(entry: LanguageGuideEntry, obj: TextObject): boolean {
  if (entry.predicate?.appliesTo !== 'non-stacking-multiplier') return true;
  const def = CARD_INDEX[obj.contentId];
  return !!def?.triggerMultiplier && !def.triggerMultiplier.stacks;
}

export function runRewriteAdvisor(opts: AdvisorOptions): DocbotFinding[] {
  const semanticRevision = opts.semanticRevision ?? 'dev';
  const findings: DocbotFinding[] = [];
  const advise = (obj: TextObject, leg: 'text' | 'goldenText', ruleIds: string[], issue: string, current: string, suggested?: string): void => {
    findings.push(makeFinding({
      lane: ADVISOR_LANE,
      contentIds: [obj.contentId],
      ruleIds,
      expectationKind: `wording:${ruleIds[0] ?? 'readability'}:${leg}`,
      expected: suggested ?? '(shorter/clearer wording)',
      observed: current,
      severity: 'info',
      confidence: 'strong',
      status: 'new',
      title: `wording: ${obj.contentId} · ${issue}`,
      summary: `${issue}. Current ${leg}: "${current}". Mechanics are unchanged by the suggestion — a recommendation only, never auto-applied (§23).`,
      class: 'wording-recommendation',
      provenance: { lane: ADVISOR_LANE },
      semanticRevision,
      ...(suggested !== undefined ? { suggestedText: suggested } : {}),
    }));
  };

  const predicated = opts.guide.filter((e) => e.predicate && !e.reserved && !e.contested);

  for (const obj of opts.objects) {
    const legs: Array<['text' | 'goldenText', string]> = [];
    if (obj.text) legs.push(['text', obj.text]);
    if (obj.goldenText) legs.push(['goldenText', obj.goldenText]);
    for (const [leg, raw] of legs) {
      const plain = stripMarkers(raw);

      // 1. Guide predicates (settled canon only).
      for (const entry of predicated) {
        const re = new RegExp(entry.predicate!.deprecated);
        if (!re.test(plain) || !appliesTo(entry, obj)) continue;
        const suggested = raw.replace(new RegExp(entry.predicate!.deprecated, 'g'), entry.predicate!.canonical);
        advise(obj, leg, [entry.id], `violates ${entry.id} — ${entry.rule.split('.')[0]}`, raw, suggested);
      }

      // 2. Measured readability: frame-length bound (§11.4 — no LG id; a measured concern).
      if (plain.length > FRAME_CHAR_BOUND) {
        advise(obj, leg, [], `text is ${plain.length} plain characters — beyond the ~${FRAME_CHAR_BOUND}-char frame bound`, raw);
      }
    }
  }
  return findings;
}
