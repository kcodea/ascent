/**
 * GLOSSARY ↔ SHIPPED TEXT, both ways (owner ask 2026-09-18, the glossary true-up):
 *
 *   1. FORWARD — every capitalised mechanic term the colouring pass recognises in ANY shipped text (cards,
 *      gilded texts, Choose One branches, runes, Equipment, Gifts, hero powers, quest objective / reward text)
 *      has a glossary definition. `COLOURED_TERMS` is built from the glossary, so this is the tripwire that a
 *      term can never be coloured without being defined.
 *   2. REVERSE — every glossary entry is raised by at least one shipped text (or badge), or is listed below as
 *      deliberately kept. A definition nothing uses is a stale definition.
 *
 * `KEEP` is the deliberately-kept list: `stealth` is a badge keyword no printed card carries yet (the engine
 * supports it); `watcher` is Compendium-only (the reactive family has no text term — `pill: false`).
 */
import { describe, it, expect } from 'vitest';
import { ALL_CARDS, EPIC_RUNES, EQUIPMENT, GIFTS, QUEST_DEFS, RUNES } from '@game/content';
import { HEROES } from '@game/sim';
import type { Keyword } from '@game/core';
import { KEYWORD_GLOSSARY, PILL_GLOSSARY } from './keywordGlossary';
import { detectCardKeywords } from './detectCardKeywords';
import { colourTerms } from './termColour';
import { renameTerms } from './terms';
import { questObjectiveText, questRewardText } from './questText';

const KEEP = new Set(['stealth', 'watcher']);

/** Every shipped rules text, with its owner for the failure message. */
function shippedTexts(): { owner: string; keywords: Keyword[]; text: string }[] {
  const out: { owner: string; keywords: Keyword[]; text: string }[] = [];
  const push = (owner: string, keywords: Keyword[], text: string | undefined): void => { if (text) out.push({ owner, keywords, text }); };
  for (const c of ALL_CARDS) {
    push(c.id, c.keywords, c.text);
    push(`${c.id} (gilded)`, c.keywords, c.goldenText);
    for (const o of c.chooseOne ?? []) { push(`${c.id} option`, c.keywords, o.text); push(`${c.id} option (gilded)`, c.keywords, o.goldenText); }
  }
  for (const r of [...RUNES, ...EPIC_RUNES]) push(`rune ${r.id}`, [], r.text);
  for (const e of EQUIPMENT) { push(`equipment ${e.id}`, [], e.text); push(`equipment ${e.id} (gilded)`, [], e.goldenText); }
  for (const g of GIFTS) { push(`gift ${g.id}`, [], g.text); push(`gift ${g.id} (gilded)`, [], g.goldenText); }
  for (const h of HEROES) push(`hero ${h.id}`, [], h.power.text);
  for (const q of QUEST_DEFS) { push(`quest ${q.id} objective`, [], questObjectiveText(q.objective)); push(`quest ${q.id} reward`, [], questRewardText(q.reward)); }
  return out;
}

const TERM_TAG = /<b class="term">([^<]+)<\/b>/g;

describe('keyword glossary ↔ shipped text', () => {
  const texts = shippedTexts();
  const byWord = new Map<string, string>(); // coloured word (name/alias, optional plural s) → glossary id
  for (const d of KEYWORD_GLOSSARY) for (const w of [d.name, ...d.aliases]) { byWord.set(w, d.id); byWord.set(`${w}s`, d.id); }

  it('walks a real corpus', () => {
    expect(texts.length).toBeGreaterThan(500);
  });

  it('FORWARD: every coloured (non-tribe) term in every shipped text has a glossary definition', () => {
    const missing = new Map<string, string[]>();
    for (const { owner, text } of texts) {
      const html = colourTerms(renameTerms(text).replace(/\*\*/g, ''));
      for (const m of html.matchAll(TERM_TAG)) {
        const word = m[1]!;
        if (!byWord.has(word)) missing.set(word, [...(missing.get(word) ?? []), owner]);
      }
    }
    expect([...missing.entries()].map(([w, o]) => `${w} — ${o.slice(0, 3).join(', ')}`)).toEqual([]);
  });

  it('REVERSE: every glossary entry is raised by at least one shipped text or badge (or is deliberately kept)', () => {
    const seen = new Set<string>();
    for (const t of texts) for (const e of detectCardKeywords({ keywords: t.keywords, text: t.text })) seen.add(e.id);
    const unused = PILL_GLOSSARY.map((e) => e.id).filter((id) => !seen.has(id) && !KEEP.has(id));
    expect(unused).toEqual([]);
    // …and the kept list is honest: a kept term that IS used now should leave the list.
    const staleKeep = [...KEEP].filter((id) => seen.has(id));
    expect(staleKeep).toEqual([]);
  });

  it('every entry sits in a section, links a real mechanic or carries its own icon, and has unique wording', () => {
    const defs = KEYWORD_GLOSSARY.map((d) => d.def);
    expect(new Set(defs).size).toBe(defs.length);
    for (const d of KEYWORD_GLOSSARY) {
      expect(['triggers', 'combat', 'build', 'tokens']).toContain(d.section);
      expect(!!d.mechanic || !!d.icon, `${d.id} needs a mechanic link or an icon`).toBe(true);
    }
  });

  // The three surfaces named in the owner's ask, pinned by text (not by card id, which may rename).
  it('Amplified: the rune, the Grand Workshop, the Calibration Wrench and Calibration Master all raise the pill', () => {
    const owners = texts.filter((t) => detectCardKeywords({ keywords: t.keywords, text: t.text }).some((e) => e.id === 'amplified')).map((t) => t.owner);
    expect(owners).toContain('rune rune_amplification');
    expect(owners).toContain('rune rune_grand_workshop');
    expect(owners.some((o) => o.startsWith('equipment calibration_wrench'))).toBe(true);
    expect(owners.some((o) => /n3_calibration/.test(o))).toBe(true);
    expect(KEYWORD_GLOSSARY.find((d) => d.id === 'amplified')!.def).toBe('An Amplified Equipment will trigger its effect twice for no additional gold.');
    // …and not on unrelated text.
    expect(detectCardKeywords({ keywords: [], text: '**Shout:** give a friendly minion **+2/+2**.' }).map((e) => e.id)).toEqual(['shout']);
  });
});
