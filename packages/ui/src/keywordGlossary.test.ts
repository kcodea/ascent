import { describe, it, expect } from 'vitest';
import type { Keyword } from '@game/core';
import { KEYWORD_GLOSSARY } from './keywordGlossary';

const ALL_BADGES: Keyword[] = ['T', 'DS', 'V', 'W', 'R', 'C', 'M', 'SC', 'CN', 'FD', 'IMM', 'ST', 'RL', 'SL', 'CR', 'EG'];

describe('KEYWORD_GLOSSARY', () => {
  it('has unique ids', () => {
    const ids = KEYWORD_GLOSSARY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every entry a non-empty name and definition', () => {
    for (const e of KEYWORD_GLOSSARY) {
      expect(e.name.length).toBeGreaterThan(0);
      expect(e.def.length).toBeGreaterThan(0);
    }
  });

  it('maps all 16 badge codes exactly once', () => {
    const badges = KEYWORD_GLOSSARY.map((e) => e.badge).filter(Boolean) as Keyword[];
    expect(new Set(badges).size).toBe(badges.length);          // no badge used twice
    for (const b of ALL_BADGES) expect(badges).toContain(b);   // all covered
    expect(badges.length).toBe(ALL_BADGES.length);             // no extras
  });
});
