import type { WikiEntry, WikiTopic } from './types';

/**
 * Filter + rank wiki entries for the search box. With no query, returns the entries in source order (narrowed to
 * the lit topic chips, if any). With a query, EVERY word must appear somewhere in the question, aliases or answer,
 * and hits are ranked question (3) > alias (2) > answer (1), summed over the words. Ties keep source order.
 */
export function searchWiki(entries: readonly WikiEntry[], query: string, topics: ReadonlySet<WikiTopic>): WikiEntry[] {
  const inTopic = topics.size === 0 ? entries : entries.filter((e) => topics.has(e.topic));
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...inTopic];
  const scored: { e: WikiEntry; score: number }[] = [];
  for (const e of inTopic) {
    const q = e.q.toLowerCase();
    const al = (e.aliases ?? []).join(' \u0000 ').toLowerCase();
    const a = e.a.replace(/\*\*/g, '').toLowerCase();
    let score = 0;
    let all = true;
    for (const w of words) {
      const s = (q.includes(w) ? 3 : 0) + (al.includes(w) ? 2 : 0) + (a.includes(w) ? 1 : 0);
      if (s === 0) { all = false; break; }
      score += s;
    }
    if (all) scored.push({ e, score });
  }
  return scored.sort((x, y) => y.score - x.score).map((x) => x.e); // Array.sort is stable
}
