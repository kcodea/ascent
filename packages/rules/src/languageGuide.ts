/**
 * LANGUAGE GUIDE — schema v0 (Doc Bot 2.0 WP B; blueprint §11.3).
 *
 * The versioned registry of STYLE rules for printed card/rune/power text — how things are WORDED, as
 * distinct from what they DO (that is the rulebook + contracts). WP E's text parser and rewrite advisor
 * consume this registry to turn wording drift into `wording-recommendation` findings; until then it is a
 * small, hand-maintained seed of the wording rules the owner has already ruled.
 *
 * Doctrine, mirrored from the rulebook:
 *  · 'seeded' entries are Claude-recorded readings of an owner statement, cited verbatim in evidence;
 *    'approved' requires an explicit owner decision on the guide entry itself (none yet — the wording
 *    sitting is WP E's).
 *  · Ids are stable (`LG-<TOPIC>-<NN>`) and never recycled.
 *  · Content only grows in WP E; this file stays minimal by design.
 */
import type { RuleEvidence } from './schema';

export const LANGUAGE_GUIDE_VERSION = 0;

export type LanguageGuideTopic =
  | 'multiplier-wording' // how extra fires are printed
  | 'copy-wording' // plain vs exact copies
  | 'counter-wording' // live values + countdowns (the CLAUDE.md live-text rule's wording half)
  | 'keyword-wording' // keyword display names + phrasing
  | 'general';

export interface LanguageGuideEntry {
  /** Stable, never recycled: `LG-<TOPIC>-<NN>`. */
  id: string;
  topic: LanguageGuideTopic;
  /** The style rule, stated so a parser can test text against it and an advisor can cite it. */
  rule: string;
  /** One concrete compliant example (and, where useful, the non-compliant shape it replaces). */
  example?: string;
  evidence: RuleEvidence[];
  status: 'seeded' | 'approved';
}

export const LANGUAGE_GUIDE: LanguageGuideEntry[] = [
  {
    id: 'LG-TWICE-01',
    topic: 'multiplier-wording',
    rule: 'A NON-STACKING effect that fires something one extra time prints "Twice" / "twice" — never "an additional time", which reads as if copies stack. Stacking multipliers may print "+1 more time" per copy.',
    example: 'Rune of Fury: "Your Avenge effects trigger twice." (compliant). Zyff: "Your Battlecries and Deathrattles trigger an additional time." (the flagged non-stacker shape — the wording-recommendation exemplar).',
    evidence: [
      { kind: 'owner-chat', ref: 'docs/docbot2/vertical-slice-report.md', quote: 'owner flag: non-stackers should say "Twice"' },
      { kind: 'docbot-scan', ref: 'verticalSlice wording-recommendation finding (zyff)' },
    ],
    status: 'seeded',
  },
  {
    id: 'LG-COPY-01',
    topic: 'copy-wording',
    rule: 'An unmarked "copy" means a PLAIN copy (base card: no buffs, counters, or gilding — R-COPY-01). Text for an effect that copies the full instance (stats, buffs, gilding, accrued counters — R-COPY-02) must say "exact copy". A copy effect whose printed text says only "a copy" while behaving exact is a text defect.',
    example: 'Bellringer: "get a plain copy of the minion to the left" (compliant). Xerox\'s "Summon a copy of a friendly minion" while the ruled behaviour is exact — the slice\'s verified-text-defect exemplar.',
    evidence: [
      { kind: 'owner-handoff', ref: 'R-COPY-01 / R-COPY-02 (registry/approved.ts)' },
      { kind: 'docbot-scan', ref: 'verticalSlice verified-text-defect finding (hero:xerox)' },
    ],
    status: 'seeded',
  },
];

export const LANGUAGE_GUIDE_INDEX: Readonly<Record<string, LanguageGuideEntry>> =
  Object.fromEntries(LANGUAGE_GUIDE.map((e) => [e.id, e]));
