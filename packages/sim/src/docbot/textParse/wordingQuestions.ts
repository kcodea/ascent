/**
 * DOC BOT 2.0 WP E — the Sitting-3 WORDING question deck (blueprint §11.3; owner-review-pipeline.md §5).
 *
 * One question per language-guide rule whose corpus usage is measured INCONSISTENT — the owner picks the
 * canon. The deck is DERIVED live from the printed corpus (cards + gilded texts + runes + hero powers):
 * a variant pair only produces a card while BOTH spellings still occur, so the deck self-retires as text
 * becomes consistent; a decided card's decision survives regeneration through the shared seed-hygiene
 * pass (`npm run docbot:text` mirrors `contracts:extract` exactly).
 *
 * Format = the owner's fly-through bar (2026-08-27): one short sentence (≤ 30 words — the rules.test.ts
 * ratchet covers this deck), ONE concrete example with verbatim printed text from EACH side, the compact
 * ✓/✕/✎ micro-tail, and the member counts. "Approve" endorses candidate A (the seeded canon); "revise"
 * lets the owner name a different winner. RESERVED pairs (the owner's own in-flight Rebirth rename)
 * never produce a question.
 *
 * The deck ships DORMANT: cards land as `needs-ruling` through the standard registry mechanism — nothing
 * schedules the sitting; the main session does.
 */
import { ALL_CARDS, ARCHIVED_CARDS, CARD_INDEX, EPIC_RUNES, RUNE_INDEX, RUNES } from '@game/content';
import type { GameRule, RuleEnforcement } from '@game/rules'; // type-only: erased at build, never bundles the registry
import { HEROES } from '../../heroes';
import { stripMarkers } from '../textOracle';
import { TERM_VARIANTS } from './lexicon';

export const WORDING_QUEUE = 'textParse.wording';

/** Every wording card pins to the WP E text lane: an approval's canon is machine-watched by the advisor
 *  predicate that the ruling unlocks (the lane re-alarms when new text uses the rejected spelling). */
const WORDING_ENFORCEMENT: RuleEnforcement = { kind: 'oracle', refs: ['textParse'] };

interface CorpusRow {
  /** Content id ('hero:<id>' for powers — excluded from contentIds, which must resolve in the indexes). */
  id: string;
  text: string;
  /** True when `id` resolves in CARD_INDEX / RUNE_INDEX (usable as a rule contentId). */
  resolvable: boolean;
}

/** The printed corpus, one row per text leg (a card's gilded text is its own row). Deterministic order. */
export function wordingCorpus(): CorpusRow[] {
  const archived = new Set(ARCHIVED_CARDS.map((c) => c.id));
  const rows: CorpusRow[] = [];
  for (const c of [...ALL_CARDS].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (archived.has(c.id)) continue;
    if (c.text) rows.push({ id: c.id, text: stripMarkers(c.text), resolvable: true });
    if (c.goldenText) rows.push({ id: c.id, text: stripMarkers(c.goldenText), resolvable: true });
  }
  for (const r of [...RUNES, ...EPIC_RUNES].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const text = (r as { text?: string }).text;
    if (text) rows.push({ id: r.id, text: stripMarkers(text), resolvable: true });
  }
  for (const h of [...HEROES].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (h.power.text) rows.push({ id: `hero:${h.id}`, text: stripMarkers(h.power.text), resolvable: false });
  }
  return rows;
}

const nameOf = (id: string): string =>
  CARD_INDEX[id]?.name ?? (RUNE_INDEX[id] as { name?: string } | undefined)?.name ?? id;

const exemplar = (rows: CorpusRow[], re: RegExp): CorpusRow | undefined => rows.find((r) => re.test(r.text));

/** The full deterministic Sitting-3 deck (pre-hygiene). */
export function buildWordingQuestions(): GameRule[] {
  const rows = wordingCorpus();
  const out: GameRule[] = [];
  for (const v of TERM_VARIANTS) {
    if (v.reserved) continue; // the owner's own rename — recorded in the guide, never asked
    const hitsA = rows.filter((r) => v.reA.test(r.text));
    const hitsB = rows.filter((r) => v.reB.test(r.text));
    if (hitsA.length === 0 || hitsB.length === 0) continue; // consistent already — the question self-retires
    const exA = exemplar(rows, v.reA)!;
    const exB = exemplar(rows, v.reB)!;
    const memberIds = [...new Set(hitsB.filter((r) => r.resolvable).map((r) => r.id))].sort();
    out.push({
      id: `q-word-${v.lgId.toLowerCase()}`,
      title: `Wording: ${v.label} · ${hitsA.length} vs ${hitsB.length}`,
      statement: `${v.question} — ✓ yes · ✕ no (say why) · ✎ your wording`,
      domain: 'text',
      status: 'needs-ruling',
      currentBehaviour: `Both spellings are live: "${v.a}" in ${hitsA.length} printed texts, "${v.b}" in ${hitsB.length}. Approving picks "${v.a}"; the ${v.lgId} guide predicate then watches new text.`,
      cardText: `"${v.a}" — ${nameOf(exA.id)}: "${exA.text}" · "${v.b}" — ${nameOf(exB.id)}: "${exB.text}"`,
      example: `${nameOf(exB.id)} would be re-worded to the "${v.a}" form; mechanics untouched.`,
      evidence: [
        { kind: 'docbot-scan', ref: `${WORDING_QUEUE} · ${v.lgId} (corpus survey: ${hitsA.length} vs ${hitsB.length})` },
      ],
      sourceQueue: WORDING_QUEUE,
      enforcement: WORDING_ENFORCEMENT,
      ...(memberIds.length ? { contentIds: memberIds } : {}),
    });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** ~seconds-per-card estimate for the sitting report (the owner's own 2-5s fly-through bar). */
export function estimatedSittingMinutes(deckSize: number): number {
  return Math.max(1, Math.ceil((deckSize * 8) / 60));
}
