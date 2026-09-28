/**
 * THE RULES WIKI's guard rails (spec docs/superpowers/specs/2026-09-28-rules-wiki-design.md):
 *   1. integrity: unique slug ids, known topics, real See-also links, player-level voice;
 *   2. the TRIPWIRE: every `covers` entry names a live approved rule / glossary keyword whose text still
 *      fingerprints the same as when the answer was checked. A changed rule reddens here, naming the answer
 *      to re-read and the new fingerprint to paste once it's right;
 *   3. the keyword RATCHET: every glossary keyword is covered by some answer or listed in UNCOVERED_KEYWORDS,
 *      and that list may only shrink.
 */
import { describe, expect, it } from 'vitest';
import { allRules } from '@game/rules';
import { KEYWORD_GLOSSARY } from './keywordGlossary';
import { WIKI_BY_ID, WIKI_ENTRIES, WIKI_TOPICS } from './rulesWiki';
import { fingerprint } from './rulesWiki/fingerprint';
import { UNCOVERED_KEYWORDS } from './rulesWiki/uncoveredKeywords';

/** Implementation words that have no place in a player-facing answer (owner 2026-09-28). */
const BANNED = /\b(seed(ed)?|rng|reducer|simulate|event log|deterministic|determinism)\b/i;

const LIVE_RULES = new Map(
  allRules().filter((r) => r.effective === 'approved' || r.effective === 'revised').map((r) => [r.id, r.statement]),
);
const KEYWORDS = new Map(KEYWORD_GLOSSARY.map((k) => [k.id, k.def]));

describe('rules wiki: integrity', () => {
  it('ids are unique kebab slugs', () => {
    const ids = WIKI_ENTRIES.map((e) => e.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    expect(ids.filter((id) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id))).toEqual([]);
  });

  it('every entry has a known topic, a question, and a jargon-free answer', () => {
    const topics = new Set(WIKI_TOPICS.map((t) => t.id));
    const bad = WIKI_ENTRIES.flatMap((e) => [
      ...(topics.has(e.topic) ? [] : [`${e.id}: unknown topic ${e.topic}`]),
      ...(e.q.trim().endsWith('?') ? [] : [`${e.id}: question should end with "?"`]),
      ...(e.a.trim() ? [] : [`${e.id}: empty answer`]),
      ...(BANNED.test(e.a) || BANNED.test(e.q) ? [`${e.id}: dev jargon (${(BANNED.exec(e.a) ?? BANNED.exec(e.q))![0]})`] : []),
      // Owner writing rule 2026-09-21 (noEmDashPlayerText.test.ts): no em dash or double hyphen as a separator.
      ...(/—| -- /.test(e.a + e.q) ? [`${e.id}: em dash / double hyphen (house style: short plain sentences)`] : []),
    ]);
    expect(bad).toEqual([]);
  });

  it('See-also links point at real, other entries', () => {
    const bad = WIKI_ENTRIES.flatMap((e) => (e.seeAlso ?? []).filter((id) => !WIKI_BY_ID[id] || id === e.id).map((id) => `${e.id} → ${id}`));
    expect(bad).toEqual([]);
  });
});

describe('rules wiki: tripwire', () => {
  it('every covered rule / keyword still exists and still reads the same', () => {
    const problems: string[] = [];
    for (const e of WIKI_ENTRIES) {
      for (const c of e.covers ?? []) {
        if ('rule' in c) {
          const stmt = LIVE_RULES.get(c.rule);
          if (stmt === undefined) problems.push(`"${e.id}" covers rule ${c.rule}, which is not an approved rule (removed or renamed?). Re-check the answer.`);
          else if (fingerprint(stmt) !== c.fp) problems.push(`"${e.id}": rule ${c.rule} changed. Re-check the answer, then set fp to '${fingerprint(stmt)}'.`);
        } else {
          const def = KEYWORDS.get(c.keyword);
          if (def === undefined) problems.push(`"${e.id}" covers keyword ${c.keyword}, which is not in the glossary. Re-check the answer.`);
          else if (fingerprint(def) !== c.fp) problems.push(`"${e.id}": keyword ${c.keyword}'s definition changed. Re-check the answer, then set fp to '${fingerprint(def)}'.`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('rules wiki: keyword coverage ratchet', () => {
  const covered = new Set(WIKI_ENTRIES.flatMap((e) => (e.covers ?? []).flatMap((c) => ('keyword' in c ? [c.keyword] : []))));
  const listed = new Set(UNCOVERED_KEYWORDS);

  it('every glossary keyword has a wiki answer (or is still on the shrinking to-do list)', () => {
    expect([...KEYWORDS.keys()].filter((k) => !covered.has(k) && !listed.has(k))).toEqual([]);
  });

  it('UNCOVERED_KEYWORDS only lists real, still-uncovered keywords (delete ids as answers land)', () => {
    expect([...listed].filter((k) => !KEYWORDS.has(k) || covered.has(k))).toEqual([]);
  });
});
