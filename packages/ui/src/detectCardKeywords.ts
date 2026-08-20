import type { Keyword } from '@game/core';
import { renameTerms } from './terms';
import { KEYWORD_GLOSSARY, type KeywordDef } from './keywordGlossary';

/** The minimal card shape detection needs — a full `CardView` satisfies it structurally. */
export interface DetectableCard {
  keywords: Keyword[];
  text: string;
}

/** Escape a term for use in a RegExp. */
function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Per-entry matcher: true when the entry's name or any alias appears in `text` on word boundaries.
 * Case-sensitive — every glossary term is Capitalised in card text, and this avoids matching common
 * lowercase words (e.g. the verb "rise"). Built once at module load; RegExp is reused across calls.
 */
const MATCHERS: { def: KeywordDef; re: RegExp }[] = KEYWORD_GLOSSARY.map((def) => {
  const terms = [def.name, ...def.aliases].map(esc).join('|');
  return { def, re: new RegExp(`(?<![A-Za-z])(?:${terms})(?![A-Za-z])`) };
});

/**
 * The glossary entries a card references: the UNION of its badge `keywords` and any glossary term named in
 * its displayed text. Deduped, returned in glossary declaration order (stable — never text order), so the
 * panel never reflows. Pure; safe to memoize on `(keywords, text)`.
 */
export function detectCardKeywords(card: DetectableCard): KeywordDef[] {
  const text = renameTerms(card.text ?? '').replace(/\*\*/g, ''); // displayed vocabulary, bold markers stripped
  const badges = new Set<Keyword>(card.keywords ?? []);
  const out: KeywordDef[] = [];
  for (const { def, re } of MATCHERS) {
    const hit = (def.badge !== undefined && badges.has(def.badge)) || re.test(text);
    if (hit) out.push(def);
  }
  return out;
}
