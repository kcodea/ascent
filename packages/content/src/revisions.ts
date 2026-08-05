import type { CardDef } from '@game/core';
import { ALL_CARDS } from './index';
import { RUNES, EPIC_RUNES, ARCHIVED_RUNES } from './runes';
import { QUEST_DEFS } from './quests';

/**
 * CARD REVISIONS — a content-hash identity for every card, so balance data can never blend a card's
 * before-and-after (Codex telemetry spec, 2026-08-05: "Never combine different card revisions").
 *
 * Why the existing `patch` string ("0.1.0+<sha>") is not enough, in both directions:
 *  - TOO COARSE: every card's samples reset on every build, so a card nobody touched for ten patches can
 *    never accumulate the 100 acquisitions a confident balance read needs. A revision that only moves when
 *    the CARD moves lets untouched cards pool their samples across patches — which is the difference between
 *    "we can measure this card" and "we never will at friend scale".
 *  - TOO BLUNT: it can't tell you WHICH cards changed, so a report can't grey out just the ones that did.
 *
 * And a correctness reason beyond the guardrail: our telemetry is RECONSTRUCTED by replaying a run's action
 * log through the reducer. Replay an old log against changed card definitions and the run DIVERGES — the
 * 2026-08-04 balance batch moved 16 cards, so runs recorded the day before are no longer faithfully
 * replayable against today's build. Stamping the content revision on the run is what makes that detectable
 * instead of silent: a derivation can refuse (or flag) a replay whose content moved under it.
 *
 * The hash covers the WHOLE definition — stats, tier, keywords, effects AND printed text. Text is included
 * deliberately: it changes what a player believes the card does, so it changes pick rate, which is exactly
 * what the demand half of the report measures. Art is not part of the def and so never bumps a revision.
 *
 * Pure + dependency-free (FNV-1a over a canonical serialization): identical in the browser, in Node, and in
 * a test, which it must be — the client stamps it and the analyzer compares against it.
 */

/** Canonical JSON: object keys sorted at every depth, so a property REORDER can never look like a change. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined) // an absent key and an explicit undefined are the same card
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

/** FNV-1a (32-bit) → 8 lowercase hex chars. Not cryptographic; it only has to be stable and collision-shy
 *  across a few hundred short strings, which this comfortably is. */
function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** This card's revision — changes if and only if any part of its definition changes. */
export function cardRevision(def: CardDef): string {
  return hash(canonical(def));
}

/**
 * EVERYTHING BELOW IS LAZY, and must stay that way. This module reads `ALL_CARDS` from `./index`, which
 * re-exports this module — a cycle. Computing at module scope worked under Vitest but threw
 * "Cannot access 'ALL_CARDS' before initialization" under plain Node ESM (caught by `npm run harness`,
 * 2026-08-05), because the evaluation order differs. Memoised accessors sidestep initialisation order
 * entirely: nothing is computed until someone asks, by which point every module is live.
 */
let cardRevs: Record<string, string> | null = null;

/** cardId → revision, for every card that exists (archived cards included: an old run may hold one). */
export function cardRevisions(): Record<string, string> {
  if (!cardRevs) cardRevs = Object.fromEntries(ALL_CARDS.map((c) => [c.id, cardRevision(c)]));
  return cardRevs;
}

/** The revision of a card id, or `'unknown'` for an id this build has never heard of (a replay from a build
 *  that had a card we since deleted outright). Never throws — telemetry must not be able to break a run. */
export const revisionOf = (cardId: string): string => cardRevisions()[cardId] ?? 'unknown';

/**
 * The RUN-level content revision: one hash over every card, rune and quest definition. Stamped on each
 * uploaded run so a later derivation knows exactly which content the run was played against — and can tell
 * "these two runs are comparable" from "these two runs are not" without diffing every card itself.
 *
 * Runes and quests are folded in because they change how runs play just as much as cards do; a rune's cost
 * moving (five moved on 2026-08-04) reshapes the whole economy the report measures.
 */
let contentRev: string | null = null;
export function contentRevision(): string {
  if (!contentRev) {
    contentRev = hash(
      [
        ...ALL_CARDS.map((c) => `${c.id}:${cardRevision(c)}`).sort(),
        ...[...RUNES, ...EPIC_RUNES, ...ARCHIVED_RUNES].map((r) => `${r.id}:${hash(canonical(r))}`).sort(),
        ...QUEST_DEFS.map((q) => `${q.id}:${hash(canonical(q))}`).sort(),
      ].join('|'),
    );
  }
  return contentRev;
}
