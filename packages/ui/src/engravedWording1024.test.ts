import { describe, it, expect } from 'vitest';
import { GLOSSARY_BY_ID } from './keywordGlossary';

// Owner 2026-10-24 (R-ENGRAVE-04): "change engraved keyword to say Keeps all stats and effects gained during combat."
describe('Engraved keyword wording (owner 2026-10-24)', () => {
  it('the keyword tooltip reads the owner wording exactly, no em dash', () => {
    const def = GLOSSARY_BY_ID['engraved']!.def;
    expect(def).toBe('Keeps all stats and effects gained during combat.');
    expect(def).not.toMatch(/—|--/);
  });
});
