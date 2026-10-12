import { describe, expect, it } from 'vitest';
import { cleanText, draftToSqlDoc, validateGuideDraft, validateReport } from './validate';
import { GUIDE_LIMITS, REPORT_REASONS } from './types';

const good = {
  byline: 'Mike', sets: ['set2'], tribes: ['beast'], pairsWith: [], iconCard: 'b2_sunmane', title: 'My Sunmane',
  tagline: 'Rally it.', body: 'Stack the rally.', core: ['b2_sunmane', 'b2_solaris'], enablers: ['b2_sunmane'], mentions: [], aliases: {},
};
const bad = (patch: Record<string, unknown>, opts?: { requireSlug?: boolean }): string => {
  const r = validateGuideDraft({ ...good, ...patch }, opts);
  return r.ok ? 'ok' : r.field;
};

describe('cleanText', () => {
  it('collapses whitespace, trims, and strips zero-width and bidi control characters', () => {
    expect(cleanText('  a \n\t b  ')).toBe('a b');
    expect(cleanText('a\u200Bb\u202Ec\uFEFF')).toBe('abc');
    expect(cleanText('a\u2066b\u061Cc')).toBe('abc');
    expect(cleanText(42)).toBe('');
  });
});

describe('validateGuideDraft', () => {
  it('accepts a good draft and normalises it (a new guide has no id and no revision)', () => {
    const r = validateGuideDraft({ ...good, title: '  My   Sunmane ' });
    expect(r).toMatchObject({ ok: true, draft: { id: null, revision: null, slug: null, official: false, title: 'My Sunmane', forkedFrom: null } });
  });
  it('a card may sit in both Core and Enablers (Sunmane does), but not twice in one row', () => {
    expect(bad({})).toBe('ok');
    expect(bad({ core: ['b2_sunmane', 'b2_sunmane'] })).toBe('core');
  });
  it('enforces every limit at its edge', () => {
    expect(bad({ title: 'x'.repeat(40) })).toBe('ok');
    expect(bad({ title: 'x'.repeat(41) })).toBe('title');
    expect(bad({ tagline: '' })).toBe('ok');
    expect(bad({ tagline: 'x'.repeat(81) })).toBe('tagline');
    expect(bad({ body: 'x'.repeat(1200) })).toBe('ok');
    expect(bad({ body: 'x'.repeat(1201) })).toBe('body');
    expect(bad({ body: '' })).toBe('body');
    expect(bad({ byline: 'x'.repeat(25) })).toBe('byline');
    expect(bad({ byline: '' })).toBe('byline');
    expect(bad({ core: [] })).toBe('core');
    expect(bad({ core: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })).toBe('core');
    expect(bad({ enablers: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })).toBe('enablers');
    expect(bad({ tribes: ['beast', 'dragon', 'demon'] })).toBe('tribes');
    expect(bad({ pairsWith: ['dwarf', 'kobold'] })).toBe('pairsWith');
    expect(bad({ sets: [] })).toBe('sets');
  });
  it('a title of only invisible characters is refused, and length counts code points', () => {
    expect(bad({ title: '\u200B\u200B\u202E' })).toBe('title');
    expect(bad({ title: '\u2066\u2069' })).toBe('title');
    expect(bad({ title: '\u061C' })).toBe('title');
    expect(bad({ title: '\u00AD' })).toBe('title');
    expect(bad({ title: '\u3164' })).toBe('title');
    expect(bad({ title: '\u2800' })).toBe('title');
    expect(bad({ title: '   ' })).toBe('title');
    expect(bad({ title: '🐉'.repeat(40) })).toBe('ok');
    expect(bad({ title: '🐉'.repeat(41) })).toBe('title');
  });
  it('a title of only Hangul or Khmer blank fillers is refused', () => {
    expect(bad({ title: '\u115F' })).toBe('title');
    expect(bad({ title: '\u1160' })).toBe('title');
    expect(bad({ title: '\u17B4' })).toBe('title');
    expect(bad({ title: '\u17B5' })).toBe('title');
  });
  it('refuses the three names every plain object answers to, as a card id and as a nickname', () => {
    for (const id of ['__proto__', 'constructor', 'prototype']) {
      expect(bad({ iconCard: id }), id).toBe('iconCard');
      expect(bad({ core: ['b2_sunmane', id] }), id).toBe('core');
      expect(bad({ enablers: [id] }), id).toBe('enablers');
      expect(bad({ mentions: [id] }), id).toBe('mentions');
      expect(bad({ aliases: { sunny: id } }), id).toBe('aliases'); // a nickname's target
    }
    expect(bad({ aliases: { constructor: 'b2_sunmane' } })).toBe('aliases');
    expect(bad({ aliases: { prototype: 'b2_sunmane' } })).toBe('aliases');
    // An object literal's `__proto__:` sets the prototype; JSON.parse makes it an own key, as a request body would.
    const protoWord = JSON.parse('{"__proto__":"b2_sunmane"}') as Record<string, unknown>;
    expect(Object.keys(protoWord)).toEqual(['__proto__']);
    expect(bad({ aliases: protoWord })).toBe('aliases');
  });
  it('refuses ids, tribes and sets that are not the right shape', () => {
    expect(bad({ iconCard: 'Not An Id' })).toBe('iconCard');
    expect(bad({ core: ['ok', 'NOT OK'] })).toBe('core');
    expect(bad({ tribes: ['Beast!'] })).toBe('tribes');
    expect(bad({ sets: ['two'] })).toBe('sets');
    expect(bad({ id: 'nope', revision: 1 })).toBe('id');
    expect(bad({ id: '11111111-1111-4111-8111-111111111111' })).toBe('revision');
    expect(bad({ forkedFrom: 'nope' })).toBe('forkedFrom');
  });
  it('a nickname must point at a card the guide lists', () => {
    expect(bad({ aliases: { sunny: 'b2_sunmane' } })).toBe('ok');
    expect(bad({ aliases: { sunny: 'grim' } })).toBe('aliases');
    expect(bad({ aliases: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`w${i}`, 'b2_sunmane'])) })).toBe('aliases');
  });
  it('an official guide needs no byline (the server writes Team Ascent)', () => {
    expect(bad({ official: true, byline: '' })).toBe('ok');
  });
  it('an import requires a slug; a normal save ignores one', () => {
    expect(bad({ official: true, slug: 'set2-beast-sunmane' }, { requireSlug: true })).toBe('ok');
    expect(bad({ official: true }, { requireSlug: true })).toBe('slug');
    expect(validateGuideDraft({ ...good, slug: 'set2-x' })).toMatchObject({ ok: true, draft: { slug: null } });
  });
  it('anything that is not an object is refused', () => {
    expect(validateGuideDraft(null)).toEqual({ ok: false, error: 'bad_guide', field: 'guide' });
    expect(validateGuideDraft('x')).toEqual({ ok: false, error: 'bad_guide', field: 'guide' });
  });
});

describe('draftToSqlDoc', () => {
  it('writes the snake_case document the SQL functions read', () => {
    const r = validateGuideDraft({ ...good, pairsWith: ['dwarf'], forkedFrom: '11111111-1111-4111-8111-111111111111' });
    if (!r.ok) throw new Error('expected ok');
    expect(draftToSqlDoc(r.draft)).toMatchObject({ icon_card: 'b2_sunmane', pairs_with: ['dwarf'], forked_from: '11111111-1111-4111-8111-111111111111', official: false });
  });
});

describe('saveId (a retried save is told apart from a new one)', () => {
  const SAVE = '22222222-2222-4222-8222-222222222222';
  it('is optional and null when absent', () => {
    const v = validateGuideDraft(good);
    expect(v.ok && v.draft.saveId).toBeNull();
  });
  it('accepts a uuid and puts it in the SQL document as save_id', () => {
    const v = validateGuideDraft({ ...good, saveId: SAVE });
    expect(v.ok && v.draft.saveId).toBe(SAVE);
    expect(v.ok && draftToSqlDoc(v.draft).save_id).toBe(SAVE);
  });
  it('refuses anything that is not a uuid, naming the field', () => {
    for (const bad of ['nope', 7, {}, '']) {
      expect(validateGuideDraft({ ...good, saveId: bad })).toEqual({ ok: false, error: 'bad_guide', field: 'saveId' });
    }
  });
  it('a document with no save id carries save_id null', () => {
    const v = validateGuideDraft(good);
    expect(v.ok && draftToSqlDoc(v.draft).save_id).toBeNull();
  });
});

describe('validateReport', () => {
  it('accepts each reason, with or without a note', () => {
    for (const reason of REPORT_REASONS) {
      expect(validateReport({ reason })).toEqual({ ok: true, reason, note: '' });
      expect(validateReport({ reason, note: '  It copies  my guide. ' })).toEqual({ ok: true, reason, note: 'It copies my guide.' });
    }
  });
  it('refuses an unknown or missing reason, naming the field', () => {
    for (const reason of ['rude', '', 7, null, undefined, ['spam']]) {
      expect(validateReport({ reason })).toEqual({ ok: false, error: 'bad_report', field: 'reason' });
    }
  });
  it('a note is limited to 300 characters after cleaning, counted in characters', () => {
    expect(validateReport({ reason: 'spam', note: 'x'.repeat(GUIDE_LIMITS.reportNote) }).ok).toBe(true);
    expect(validateReport({ reason: 'spam', note: 'x'.repeat(GUIDE_LIMITS.reportNote + 1) })).toEqual({ ok: false, error: 'bad_report', field: 'note' });
    expect(validateReport({ reason: 'spam', note: 7 })).toEqual({ ok: false, error: 'bad_report', field: 'note' });
  });
  it('a note of only spaces or invisible characters is an empty note, not a refusal', () => {
    const invisible = String.fromCharCode(0x200b, 0x200d, 0x2060) + '   ';
    expect(validateReport({ reason: 'other', note: invisible })).toEqual({ ok: true, reason: 'other', note: '' });
  });
  it('refuses anything that is not an object', () => {
    for (const v of [null, 'spam', 7, []]) expect(validateReport(v)).toEqual({ ok: false, error: 'bad_report', field: 'report' });
  });
});
