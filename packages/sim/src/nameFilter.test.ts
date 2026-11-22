import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NAME_BLOCKED_TEXT, isBlockedName, nameKey, nameVerdict } from './nameFilter';

/**
 * THE NAME FILTER (R-NAME-FILTER-01): a slur is blocked, the broader list is flagged for review, ordinary names pass.
 * The SQL mirror is checked against these same cases in apps/dash/src/server/moderation.db.test.ts.
 */
const repo = (p: string): string => readFileSync(fileURLToPath(new URL(`../../../${p}`, import.meta.url)), 'utf8');
/** The quoted words of `const <name> ... = [ ... ];` in a source file. */
const listOf = (src: string, name: string): string[] => {
  const m = new RegExp(`const ${name}[^=]*=\\s*\\[([\\s\\S]*?)\\]`).exec(src);
  if (!m) throw new Error(`no list ${name}`);
  return [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
};

describe('nameVerdict', () => {
  it.each([
    ['N1gg3r', 'nigger'], ['n i g g e r', 'nigger'], ['Niiiigger', 'nigger'], ['xXFagXx', 'fag'], ['Fag1', 'fag'],
    ['FagLord', 'fag'], ['spics', 'spic'], ['Retarded', 'retarded'], ['F4gg0t', 'faggot'], ['tr@nny', 'tranny'],
    ['Grammar Nazi', 'nazi'], ['H1tler', 'hitler'], ['Rapist', 'rapist'], ['rape', 'rape'],
  ])('blocks %s (%s)', (name, term) => {
    expect(nameVerdict(name)).toEqual({ verdict: 'block', term });
    expect(isBlockedName(name)).toBe(true);
  });

  it.each([
    ['FuckFace', 'fuck'], ['Sh!t', 'shit'], ['Scunthorpe', 'cunt'], ['Team Ascent', 'teamascent'],
    ['Admin', 'admin'], ['Ádmin', 'admin'], ['Moderat0r', 'moderator'], ['sexy', 'sex'], ['Moby Dick', 'dick'],
  ])('flags %s (%s)', (name, term) => {
    expect(nameVerdict(name)).toEqual({ verdict: 'flag', term });
    expect(isBlockedName(name)).toBe(false);
  });

  it.each(['Player', 'IronFox87', 'KevinTheGreat', 'Niger', 'Spicy', 'Raccoon', 'Assassin', 'Hancock', 'Peacock', 'Dickens',
    'Therapist', 'Cassandra', 'Mike', 'Classy', 'Shrek4', 'Grape', 'Draper', 'Cocktail Hour', '', '   ', '1234'])('passes %s', (name) => {
    expect(nameVerdict(name)).toEqual({ verdict: 'ok', term: null });
  });

  it('every word of the guides filter and the DM filter is caught for a name', () => {
    const guides = repo('packages/guides/src/wordFilter.ts');
    const dm = repo('packages/ui/src/friends/dm/profanity.ts');
    const words = [...listOf(guides, 'WORDS'), ...listOf(guides, 'STEMS'), ...listOf(dm, 'STEMS'), ...listOf(dm, 'WORDS')];
    expect(words.length).toBeGreaterThan(50);
    for (const w of words) expect(nameVerdict(w).verdict, w).not.toBe('ok');
  });

  it('the reset key ignores case, spacing, look-alikes and stretched letters', () => {
    expect(nameKey('Bad Name')).toBe(nameKey('baaad_n4me'));
    expect(nameKey('Player')).toBe('player');
  });

  it('the refusal reads as plain player text (no dashes)', () => {
    expect(NAME_BLOCKED_TEXT).not.toMatch(/[–—]|--/);
  });
});
