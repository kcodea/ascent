/**
 * Pure matcher for `npm run sfx:import`. No fs / no `@game/*` imports — every function is pure over plain
 * inputs, so the tests run on fixtures. The runner (`sfx-import.ts`) feeds `buildIndex` the real card/hero
 * data and does the file moving.
 */

export type Variant = 'play' | 'death' | 'effect' | 'select' | 'power';

/** Minimal shape the matcher needs from a CardDef / HeroDef. */
export interface MatchCard { id: string; name: string; effects: { on?: string }[] }
export interface MatchHero { id: string; name: string }

export interface ImportIndex {
  cardIds: Set<string>;
  heroIds: Set<string>;
  effectCardIds: Set<string>;             // cards with any effect trigger → eligible for a .effect clip
  nameToCard: Map<string, string>;        // slug(displayName) → cardId
  nameToHero: Map<string, string>;        // slug(displayName) → heroId
  cardEntries: { slug: string; id: string }[]; // id-slug + name-slug per card, for fuzzy
  heroEntries: { slug: string; id: string }[];
}

export interface Resolved { id: string; kind: 'card' | 'hero'; confidence: 'exact' | 'fuzzy' }
export type MatchOk = { ok: true; target: string; id: string; kind: 'card' | 'hero'; variant: Variant; confidence: 'exact' | 'fuzzy' };
export type MatchNo = { ok: false; reason: string; suggestions: string[] };

/** Lowercase alphanumerics only — the join key for ids and display names. */
export function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');
}

const SEP = /[\s._\-]+/;
const VARIANT: Record<string, Variant> = {
  death: 'death',
  effect: 'effect', battlecry: 'effect', deathrattle: 'effect', shout: 'effect', echo: 'effect',
  power: 'power', heropower: 'power',
  select: 'select', pick: 'select', choose: 'select',
  play: 'play', cast: 'play',
};

/** Split a filename into a trailing variant word (if any) + the remaining name/id phrase (slugged). */
export function parseName(basename: string): { variant: Variant | null; phraseSlug: string } {
  const stem = basename.replace(/\.[a-z0-9]+$/i, '');
  const tokens = stem.split(SEP).filter(Boolean).map((t) => t.toLowerCase());
  let variant: Variant | null = null;
  if (tokens.length > 1 && VARIANT[tokens[tokens.length - 1]]) {
    variant = VARIANT[tokens.pop() as string];
  }
  return { variant, phraseSlug: slugify(tokens.join('')) };
}

export function buildIndex(cards: MatchCard[], heroes: MatchHero[]): ImportIndex {
  return {
    cardIds: new Set(cards.map((c) => c.id)),
    heroIds: new Set(heroes.map((h) => h.id)),
    effectCardIds: new Set(cards.filter((c) => c.effects.some((e) => e.on)).map((c) => c.id)),
    nameToCard: new Map(cards.map((c) => [slugify(c.name), c.id])),
    nameToHero: new Map(heroes.map((h) => [slugify(h.name), h.id])),
    cardEntries: cards.flatMap((c) => [{ slug: c.id, id: c.id }, { slug: slugify(c.name), id: c.id }]),
    heroEntries: heroes.flatMap((h) => [{ slug: h.id, id: h.id }, { slug: slugify(h.name), id: h.id }]),
  };
}

/** Classic Levenshtein edit distance. */
export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

/** Resolve a name/id phrase to a card or hero: exact id → exact display name → conservative fuzzy. */
export function resolveId(phraseSlug: string, index: ImportIndex): Resolved | { suggestions: string[] } {
  if (!phraseSlug) return { suggestions: [] };
  const c = index.cardIds.has(phraseSlug) ? phraseSlug : index.nameToCard.get(phraseSlug);
  if (c) return { id: c, kind: 'card', confidence: 'exact' };
  const h = index.heroIds.has(phraseSlug) ? phraseSlug : index.nameToHero.get(phraseSlug);
  if (h) return { id: h, kind: 'hero', confidence: 'exact' };
  const all = [
    ...index.cardEntries.map((e) => ({ ...e, kind: 'card' as const })),
    ...index.heroEntries.map((e) => ({ ...e, kind: 'hero' as const })),
  ];
  let best: (typeof all)[number] | null = null, bestD = Infinity, second = Infinity;
  for (const e of all) {
    const d = levenshtein(phraseSlug, e.slug);
    if (d < bestD) { second = bestD; bestD = d; best = e; }
    else if (d < second) second = d;
  }
  const thr = phraseSlug.length >= 4 ? 2 : 1;             // conservative: short strings must be near-exact
  if (best && bestD <= thr && bestD < second) return { id: best.id, kind: best.kind, confidence: 'fuzzy' };
  const suggestions = [...new Set(
    all.map((e) => ({ id: e.id, d: levenshtein(phraseSlug, e.slug) })).sort((a, b) => a.d - b.d).map((x) => x.id),
  )].slice(0, 3);
  return { suggestions };
}

/** Resolve one dropped filename to a concrete target path (or an explained non-match). */
export function matchFile(basename: string, index: ImportIndex): MatchOk | MatchNo {
  const { variant, phraseSlug } = parseName(basename);
  const r = resolveId(phraseSlug, index);
  if (!('id' in r)) return { ok: false, reason: `couldn't match "${phraseSlug || basename}"`, suggestions: r.suggestions };
  const v: Variant = variant ?? (r.kind === 'hero' ? 'select' : 'play');
  if ((v === 'power' || v === 'select') && r.kind === 'card')
    return { ok: false, reason: `"${v}" is a hero sound but ${r.id} is a minion`, suggestions: [] };
  if ((v === 'death' || v === 'effect' || v === 'play') && r.kind === 'hero')
    return { ok: false, reason: `"${v}" is a minion sound but ${r.id} is a hero`, suggestions: [] };
  let target: string;
  if (r.kind === 'hero') target = v === 'power' ? `heroes/${r.id}.power.mp3` : `heroes/${r.id}.mp3`;
  else if (v === 'death') target = `cards/${r.id}.death.mp3`;
  else if (v === 'effect') {
    if (!index.effectCardIds.has(r.id)) return { ok: false, reason: `${r.id} has no effect to voice (vanilla minion)`, suggestions: [] };
    target = `cards/${r.id}.effect.mp3`;
  } else target = `cards/${r.id}.mp3`;
  return { ok: true, target, id: r.id, kind: r.kind, variant: v, confidence: r.confidence };
}
