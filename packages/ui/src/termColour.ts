/**
 * Term colouring for rendered rules text (owner ask 2026-09-18: "make sure that every tribe name or mechanic name
 * in card text is coloured appropriately").
 *
 * Until now a tribe / mechanic word was coloured ONLY when the card data happened to wrap it in `**…**` — the
 * `.desc b` rule paints bold in the card's tribe colour. A term the author left plain ("summon a random Spirit
 * from your hand" on Seedling Spirit) rendered as body text. This pass runs AFTER the bold + marker passes and
 * wraps every remaining tribe name (singular + plural) and glossary term in `<b class="term">`, so it takes the
 * same tribe colour the bolded terms already do — on every surface that renders rules HTML (card body, combat
 * unit, Compendium, hover previews, rune tips, hero-power text), because they all go through `mdBold`.
 *
 * Depth-aware: text already inside ANY element (`<b>`, `.descup`, `.descrune`, `.descboth`, …) is left alone,
 * so an already-coloured term is never double-wrapped and a marker span keeps its own colour. Idempotent.
 */
import { KEYWORD_GLOSSARY } from './keywordGlossary';

/** Every tribe's displayed name + plural (matches `TRIBE_LABEL` in Card.tsx). Case-sensitive on purpose — the
 *  card vocabulary capitalises tribe names, and "spirit" / "mech" as common lowercase words must not colour. */
const TRIBE_TERMS: readonly string[] = [
  'Beast', 'Beasts', 'Dragon', 'Dragons', 'Mech', 'Mechs', 'Undead', 'Demon', 'Demons', 'Neutral', 'Neutrals',
  'Kobold', 'Kobolds', 'Dwarf', 'Dwarves', 'Dwarfs', 'Celestial', 'Celestials', 'Spirit', 'Spirits',
];

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The full coloured vocabulary: tribes + every glossary name/alias (`keywordGlossary.ts` is the one list of
 *  mechanic terms — a term coloured here always has a definition there). A `detectRe` phrase ("permanently",
 *  "summon … from your hand") raises a pill but is body text, so it is NOT coloured. Exported for the sweep test. */
export const COLOURED_TERMS: readonly string[] = Array.from(new Set([
  ...TRIBE_TERMS,
  ...KEYWORD_GLOSSARY.flatMap((d) => [d.name, ...d.aliases]),
]));

// Longest first so "Start of Combat" beats "Combat"-like prefixes and "Dwarven Ale" beats "Ale". The optional
// trailing `s` covers the plural of any single-word term the glossary lists only in the singular (Shouts, Wards).
const TERM_RE = new RegExp(
  `(?<![A-Za-z])(?:${[...COLOURED_TERMS].sort((a, b) => b.length - a.length).map(esc).join('|')})s?(?![A-Za-z])`,
  'g',
);
const TAG_RE = /<[^>]+>/g;

const isTribeTerm = (t: string): boolean => TRIBE_TERMS.includes(t) || TRIBE_TERMS.includes(t.replace(/s$/, ''));

/** Wrap every depth-0 term in `html` in `<b class="term">` (tribes also get `data-tribe`). */
export function colourTerms(html: string): string {
  if (!html) return html;
  let out = '';
  let depth = 0;
  let last = 0;
  TAG_RE.lastIndex = 0;
  const flush = (text: string): void => {
    out += depth === 0 ? text.replace(TERM_RE, (m) => (isTribeTerm(m) ? `<b class="term tribe">${m}</b>` : `<b class="term">${m}</b>`)) : text;
  };
  for (let m = TAG_RE.exec(html); m; m = TAG_RE.exec(html)) {
    flush(html.slice(last, m.index));
    const tag = m[0];
    if (tag.startsWith('</')) depth = Math.max(0, depth - 1);
    else if (!tag.endsWith('/>') && !/^<(?:br|img|hr|input)\b/i.test(tag)) depth += 1;
    out += tag;
    last = m.index + tag.length;
  }
  flush(html.slice(last));
  return out;
}

/** The terms in `html` that are NOT inside any element — i.e. would render uncoloured. Used by the sweep test
 *  (and the diagnostic that produced the "previously uncoloured" list). */
export function uncolouredTerms(html: string): string[] {
  const hits: string[] = [];
  let depth = 0;
  let last = 0;
  TAG_RE.lastIndex = 0;
  const scan = (text: string): void => {
    if (depth !== 0) return;
    for (const m of text.matchAll(TERM_RE)) hits.push(m[0]);
  };
  for (let m = TAG_RE.exec(html); m; m = TAG_RE.exec(html)) {
    scan(html.slice(last, m.index));
    const tag = m[0];
    if (tag.startsWith('</')) depth = Math.max(0, depth - 1);
    else if (!tag.endsWith('/>') && !/^<(?:br|img|hr|input)\b/i.test(tag)) depth += 1;
    last = m.index + tag.length;
  }
  scan(html.slice(last));
  return hits;
}
