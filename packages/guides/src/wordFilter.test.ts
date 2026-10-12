import { describe, expect, it } from 'vitest';
import { CARD_INDEX, EPIC_RUNES, RUNES } from '@game/content';
import { guideTextProblem, isBlockedText, isReservedByline, isReservedTitle } from './wordFilter';
import { validateGuideDraft } from './validate';

const draft = (patch: Record<string, unknown>) => {
  const r = validateGuideDraft({
    byline: 'Mike', sets: ['set2'], tribes: [], pairsWith: [], iconCard: 'grim', title: 'A title', tagline: 'A tagline',
    body: 'A body.', core: ['grim'], enablers: [], mentions: [], aliases: {}, ...patch,
  });
  if (!r.ok) throw new Error(`bad test draft: ${r.field}`);
  return r.draft;
};

describe('isBlockedText', () => {
  it('blocks a listed word whatever its case, accents, letter swaps or stretched letters', () => {
    for (const s of ['shit', 'SHIT', 'sh1t', '$hit', 'shiiiit', 'shít', 'well shit.']) expect(isBlockedText(s), s).toBe(true);
  });
  it('reads "!" as the letter i inside a word and as punctuation everywhere else', () => {
    for (const s of ['this is shit!', 'bitch!!', 'sh!t', 'shit!?']) expect(isBlockedText(s), s).toBe(true);
  });
  it('blocks the strong stems inside a longer word', () => {
    for (const s of ['fucking', 'motherfucker', 'bullshitter']) expect(isBlockedText(s), s).toBe(true);
  });
  it('matches whole words, so innocent words that contain a listed one pass', () => {
    for (const s of ['Scunthorpe', 'cockatrice', 'grape', 'therapist', 'Niger', 'assassin', 'class', 'Dickens']) expect(isBlockedText(s), s).toBe(false);
  });
  it('passes every card and rune name in the game', () => {
    for (const c of Object.values(CARD_INDEX)) expect(isBlockedText(c.name), c.name).toBe(false);
    for (const r of [...RUNES, ...EPIC_RUNES]) expect(isBlockedText(r.name), r.name).toBe(false);
  });
  it('blocks the doubled-letter stems, and documents the known stretched-vowel gap', () => {
    for (const s of ['nigger', 'faggot', 'bullshit', 'niggger']) expect(isBlockedText(s), s).toBe(true);
    // KNOWN GAP: a stretched vowel inside a doubled-letter stem passes. Closing it by squeezing would block "Niger". For the owner's word review.
    expect(isBlockedText('faggooot')).toBe(false);
  });
});

it('the word list is not part of the package\'s public entry', async () => {
  const entry = await import('./index');
  const keys = Object.keys(entry);
  expect(keys).not.toContain('isBlockedText');
  expect(keys).not.toContain('isReservedByline');
  expect(keys).not.toContain('isReservedTitle');
  expect(keys).not.toContain('guideTextProblem');
});

describe('isReservedByline', () => {
  it('reserves Team Ascent and its lookalikes, and staff words', () => {
    for (const s of ['Team Ascent', 'team  ascent', 'T3am Asc3nt', 'TeamAscent', 'Ascent Team', 'Ascent Official', 'xX Team Ascent Xx', 'Admin', 'the moderator', 'Developer', 'Official', 'Teaam Ascent', 'Teeam  Asscent', 'Aadmin', 'Admiin', 'Ascent Offficial', 'Modderator']) expect(isReservedByline(s), s).toBe(true);
  });
  it('a trailing "!" does not hide a reserved name, and "!" inside a word is still the letter i', () => {
    for (const s of ['Team Ascent!', 'Adm!n']) expect(isReservedByline(s), s).toBe(true);
  });
  it('leaves ordinary names alone', () => {
    for (const s of ['Mike', 'KC', 'Ascendant', 'Teamwork', 'Dev', 'Administrivia']) expect(isReservedByline(s), s).toBe(false);
  });
});

describe('guideTextProblem', () => {
  it('names the FIELD that was refused, never the word', () => {
    expect(guideTextProblem(draft({ title: 'shit build' }))).toEqual({ error: 'blocked_text', field: 'title' });
    expect(guideTextProblem(draft({ tagline: 'so shit' }))).toEqual({ error: 'blocked_text', field: 'tagline' });
    expect(guideTextProblem(draft({ body: 'this is shit' }))).toEqual({ error: 'blocked_text', field: 'body' });
    expect(guideTextProblem(draft({ byline: 'shit' }))).toEqual({ error: 'blocked_text', field: 'byline' });
    expect(guideTextProblem(draft({ aliases: { shit: 'grim' } }))).toEqual({ error: 'blocked_text', field: 'aliases' });
  });
  it('refuses a reserved by line on a player guide, and skips the by line on an official guide', () => {
    expect(guideTextProblem(draft({ byline: 'Team Ascent' }))).toEqual({ error: 'reserved_name', field: 'byline' });
    expect(guideTextProblem(draft({ official: true, byline: 'Team Ascent' }))).toBeNull();
  });
  it('clean text passes', () => {
    expect(guideTextProblem(draft({}))).toBeNull();
  });
});

describe("a player's guide cannot wear the team's name in its title or tagline", () => {
  const player = { official: false, byline: 'Mike' };
  it('refuses the team name or a staff word in the title, naming the field', () => {
    for (const title of ['Team Ascent Dragons', 'team ascent', 'T3am Ascent', 'TEAM   ASCENT picks', 'Teaam Ascent', 'Official Dragon guide', 'The admin build', 'A Moderator special', 'Developer picks']) {
      expect(guideTextProblem(draft({ ...player, title })), title).toEqual({ error: 'reserved_name', field: 'title' });
    }
  });
  it('refuses the same in the tagline', () => {
    expect(guideTextProblem(draft({ ...player, tagline: 'The official way to win' }))).toEqual({ error: 'reserved_name', field: 'tagline' });
  });
  it('lets ordinary titles through, including the game name and words that only contain a reserved one', () => {
    for (const title of ['Best Ascent team comps', 'Ascent team comp for set 2', 'Steam Ascent', 'Dragon ascent', 'Officially fun', 'Unofficial Dragon guide', 'Administer the beatdown', 'Team up with Imps', 'My team, my Ascent', 'Ascent Team picks']) {
      expect(guideTextProblem(draft({ ...player, title })), title).toBeNull();
    }
  });
  it('keeps the strict rule on the by line', () => {
    for (const byline of ['Ascent Team', 'Team Ascent']) {
      expect(guideTextProblem(draft({ ...player, byline })), byline).toEqual({ error: 'reserved_name', field: 'byline' });
    }
  });
  it('does not apply to a Team Ascent guide', () => {
    expect(guideTextProblem(draft({ official: true, byline: 'Team Ascent', title: 'Team Ascent Dragons' }))).toBeNull();
  });
  it('checks blocked words before reserved names', () => {
    expect(guideTextProblem(draft({ ...player, title: 'shit build', byline: 'Team Ascent' }))).toEqual({ error: 'blocked_text', field: 'title' });
    expect(guideTextProblem(draft({ ...player, body: 'this is shit', title: 'Team Ascent Dragons' }))).toEqual({ error: 'blocked_text', field: 'body' });
  });
});

describe('isReservedTitle', () => {
  it('is true for Team Ascent as two adjacent words (however folded or stretched) and for a staff word', () => {
    for (const s of ['T3am  Ascent picks', 'Teaam Ascent', 'the Admin build']) expect(isReservedTitle(s), s).toBe(true);
  });
  it('is false for the game name beside other words, reversed order, and words that only contain a reserved one', () => {
    for (const s of ['Best Ascent team comps', 'Ascent Team picks', 'Administer Steam Ascent']) expect(isReservedTitle(s), s).toBe(false);
  });
});
