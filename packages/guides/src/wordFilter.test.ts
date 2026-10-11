import { describe, expect, it } from 'vitest';
import { CARD_INDEX, EPIC_RUNES, RUNES } from '@game/content';
import { guideTextProblem, isBlockedText, isReservedByline } from './wordFilter';
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
});

describe('isReservedByline', () => {
  it('reserves Team Ascent and its lookalikes, and staff words', () => {
    for (const s of ['Team Ascent', 'team  ascent', 'T3am Asc3nt', 'TeamAscent', 'Ascent Team', 'Ascent Official', 'xX Team Ascent Xx', 'Admin', 'the moderator', 'Developer', 'Official']) expect(isReservedByline(s), s).toBe(true);
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
