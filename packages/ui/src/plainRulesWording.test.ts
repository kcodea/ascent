import { describe, it, expect } from 'vitest';
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import { KEYWORD_GLOSSARY, GLOSSARY_BY_ID } from './keywordGlossary';
import { WIKI_ENTRIES } from './rulesWiki';

// R-TEXT-PRINTED-01 (owner 2026-10-08): "find any place the game says 'printed stats' and fix the wording. make
// rise say 'Returns once when destroyed with 1 health.'" Designer jargon ("printed stats", "printed Attack",
// "the printed card", "as printed" for a body) never reaches the player; say what happens instead ("a fresh
// copy", "its original Attack"). Plain uses of the verb ("a tribe printed on the card") are fine and not flagged.

const JARGON = /\bprinted\s+(?:stats|attack|health|card|body|copy)\b|\b(?:card|copy|body|minion)\s+as\s+printed\b/i;

describe('player-facing rules text says what happens, not "printed stats"', () => {
  it('Rise reads exactly as the owner worded it', () => {
    expect(GLOSSARY_BY_ID.rise?.def).toBe('Returns once when destroyed with 1 health.');
    expect(WIKI_ENTRIES.find((e) => e.id === 'rise')?.a.startsWith('Returns once when destroyed with 1 health.')).toBe(true);
  });

  it('no keyword pill / glossary definition uses the jargon', () => {
    const hits = KEYWORD_GLOSSARY.filter((d) => JARGON.test(d.def)).map((d) => `${d.id}: ${d.def}`);
    expect(hits).toEqual([]);
  });

  it('no Rules wiki question or answer uses the jargon', () => {
    const hits = WIKI_ENTRIES.filter((e) => JARGON.test(e.q) || JARGON.test(e.a)).map((e) => e.id);
    expect(hits).toEqual([]);
  });

  it('no card, spell or token text uses the jargon', () => {
    const hits = Object.values(CARD_INDEX)
      .filter((c) => JARGON.test(c.text ?? '') || JARGON.test(c.goldenText ?? ''))
      .map((c) => c.id);
    expect(hits).toEqual([]);
  });

  it('no rune text uses the jargon', () => {
    const hits = Object.values(RUNE_INDEX).filter((r) => JARGON.test(r.text ?? '')).map((r) => r.id);
    expect(hits).toEqual([]);
  });
});
