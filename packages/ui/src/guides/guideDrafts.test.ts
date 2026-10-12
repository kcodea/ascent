import { describe, expect, it } from 'vitest';
import { CARD_INDEX, SETS, poolFor } from '@game/content';
import { GUIDE_LIMITS, validateGuideDraft } from '@game/guides';
import { BUNDLED_GUIDE_DATA } from './guides.bundled';
import { GUIDES, type Guide } from './guides';
import {
  builtInImportPayload, draftFromGuide, draftProblems, duplicateDraft, emptyDraft, mentionsFor, missingIn, sameDraft, toWire,
} from './guideDrafts';

const REGEX_SPECIAL: ReadonlySet<string> = new Set('.*+?^${}()|[]' + String.fromCharCode(92));
const name = (id: string): string => CARD_INDEX[id]!.name;
const inSet2 = new Set(poolFor('set2').all.map((c) => c.id));
const archived = Object.values(CARD_INDEX).find((c) => !inSet2.has(c.id) && !c.spell && !c.token)!;
const sunmane = GUIDES.find((g) => g.id === 'set2-beast-sunmane')!;
const oona = GUIDES.find((g) => g.id === 'set2-beast-oona')!;
const serverGuide = (g: Guide, patch: Partial<Guide> = {}): Guide => ({ ...g, rowId: '11111111-1111-4111-8111-111111111111', revision: 4, ...patch });

describe('mentionsFor: the cards a write-up names', () => {
  it('finds a card of the set by its name, whatever the capitals, once', () => {
    const body = `Play ${name('grim').toUpperCase()} early, then ${name('grim')} again.`;
    expect(mentionsFor(body, 'set2', [])).toEqual(['grim']);
  });
  it('does not repeat a card the guide already lists as Core or Enabler', () => {
    expect(mentionsFor(`Find ${name('grim')}.`, 'set2', ['grim'])).toEqual([]);
  });
  it('the longest name wins when one card name contains another', () => {
    const all = poolFor('set2').all;
    const longer = all.find((a) => all.some((b) => b.id !== a.id && a.name.toLowerCase().includes(b.name.toLowerCase()) && a.name.length > b.name.length));
    if (longer) {
      expect(mentionsFor(`Then ${longer.name}.`, 'set2', [])).toEqual([longer.id]);
    } else {
      // No such pair in this set today: pin the same guarantee on every card instead, so a longer name is never lost to
      // a shorter one that happens to be its prefix or substring.
      for (const c of all) expect(mentionsFor('Then ' + c.name + '.', 'set2', []), c.id).toContain(c.id);
    }
  });
  it('only whole names: a name inside a longer word is not a mention', () => {
    expect(mentionsFor(`x${name('grim')}x and ${name('grim')}s`, 'set2', [])).toEqual([]);
  });
  it('handles a name with punctuation in it', () => {
    const punct = poolFor('set2').all.find((c) => /[^a-zA-Z0-9 ]/.test(c.name))!;
    expect(mentionsFor(`Use ${punct.name}, then pass.`, 'set2', [])).toEqual([punct.id]);
  });
  it('reads a character that means something in a pattern as itself, not as a pattern', () => {
    const special = poolFor('set2').all.find((c) => [...c.name].some((ch) => REGEX_SPECIAL.has(ch)));
    if (special) {
      expect(mentionsFor(`Use (${special.name})? now.`, 'set2', []), special.id).toContain(special.id);
      // The same name with its pattern character swapped for a letter is a different word, not a mention.
      const swapped = [...special.name].map((ch) => (REGEX_SPECIAL.has(ch) ? 'x' : ch)).join('');
      expect(mentionsFor(`Use ${swapped} now.`, 'set2', []), swapped).not.toContain(special.id);
    }
    // And the guard holds for any name wrapped in pattern characters: it finds the card and does not throw.
    const plain = poolFor('set2').all.find((c) => c.id === 'grim')!;
    expect(mentionsFor(`(${plain.name})?`, 'set2', [])).toEqual(['grim']);
  });
  it('a card that is not in this set is not found', () => {
    expect(mentionsFor(`Old ${archived.name}.`, 'set2', [])).toEqual([]);
  });
  it('stops at the limit', () => {
    const many = poolFor('set2').all.slice(0, GUIDE_LIMITS.mentions + 5).map((c) => c.name).join(', ');
    expect(mentionsFor(many, 'set2', []).length).toBeLessThanOrEqual(GUIDE_LIMITS.mentions);
  });
});

describe('drafts from guides', () => {
  it('a new guide starts empty, private, with the player\'s by line', () => {
    expect(emptyDraft('Mike')).toMatchObject({ rowId: null, revision: null, official: false, byline: 'Mike', title: '', body: '', core: [], enablers: [], aliases: [], forkedFrom: null });
  });
  it('editing a guide carries its row, revision and every field; nicknames become rows', () => {
    const d = draftFromGuide(serverGuide(oona));
    expect(d).toMatchObject({ rowId: '11111111-1111-4111-8111-111111111111', revision: 4, official: true, title: oona.title, body: oona.body, core: [...oona.core], enablers: [...oona.enablers] });
    expect(d.aliases).toEqual([{ word: 'oona', card: 'b2_oona' }]);
  });
  it('a duplicate is a NEW private guide under the duplicator\'s name that remembers its source', () => {
    const d = duplicateDraft(serverGuide(sunmane), 'Mike');
    expect(d).toMatchObject({ rowId: null, revision: null, official: false, byline: 'Mike', forkedFrom: '11111111-1111-4111-8111-111111111111', core: [...sunmane.core] });
    expect(d.title).toBe(`${sunmane.title} (copy)`);
  });
  it('a duplicate\'s title is cut to the limit; a copy of a built-in with no server row has no source', () => {
    expect(duplicateDraft(serverGuide(sunmane, { title: 'x'.repeat(40) }), 'Mike').title).toHaveLength(GUIDE_LIMITS.title);
    expect(duplicateDraft(sunmane, 'Mike').forkedFrom).toBeNull();
  });
  it('sameDraft compares by value', () => {
    const a = draftFromGuide(serverGuide(sunmane));
    expect(sameDraft(a, { ...a, core: [...a.core] })).toBe(true);
    expect(sameDraft(a, { ...a, title: `${a.title}!` })).toBe(false);
  });
});

describe('toWire: the document sent to the server', () => {
  it('a built-in guide, unchanged, passes the server\'s own validation and keeps its mentions and sets', () => {
    for (const g of GUIDES) {
      const wire = toWire(draftFromGuide(serverGuide(g)), BUNDLED_GUIDE_DATA.find((b) => b.id === g.id)!.set);
      expect(validateGuideDraft(wire), g.id).toMatchObject({ ok: true });
      expect([...wire.mentions].sort(), g.id).toEqual(expect.arrayContaining([...(g.mentions ?? [])].sort()));
      expect(wire.sets, g.id).toContain(BUNDLED_GUIDE_DATA.find((b) => b.id === g.id)!.set);
    }
  });
  it('an update carries id and revision; a new guide carries neither; a Team Ascent guide says official and wears Team Ascent', () => {
    const upd = toWire(draftFromGuide(serverGuide(sunmane)), 'set2');
    expect(upd).toMatchObject({ id: '11111111-1111-4111-8111-111111111111', revision: 4, official: true, byline: 'Team Ascent' });
    const fresh = toWire({ ...emptyDraft('Mike'), title: 'T', body: 'B', core: ['grim'] }, 'set2');
    expect(fresh).not.toHaveProperty('id');
    expect(fresh).not.toHaveProperty('revision');
    expect(fresh).toMatchObject({ official: false, byline: 'Mike' });
  });
  it('derives the mentions from the write-up, and a nickname\'s card is listed even when its full name is not written', () => {
    const d = { ...emptyDraft('Mike'), title: 'T', body: `Find ${name('grim')} and the king.`, core: ['b2_sunmane'], aliases: [{ word: 'king', card: 'b2_oona' }] };
    const wire = toWire(d, 'set2');
    expect(wire.mentions).toEqual(expect.arrayContaining(['grim', 'b2_oona']));
    expect(wire.aliases).toEqual({ king: 'b2_oona' });
  });
  it('a blank nickname row is dropped; an empty art icon falls back to the first Core card', () => {
    const wire = toWire({ ...emptyDraft('Mike'), title: 'T', body: 'B', core: ['grim'], aliases: [{ word: '  ', card: 'grim' }, { word: 'g', card: '' }] }, 'set2');
    expect(wire.aliases).toEqual({});
    expect(wire.iconCard).toBe('grim');
  });
  it('a nickname\'s card keeps its slot even when the write-up names a full set of other cards', () => {
    const all = poolFor('set2').all;
    const named = all.slice(0, GUIDE_LIMITS.mentions + 5);
    const body = named.map((c) => c.name).join(', ');
    const lower = body.toLowerCase();
    const nick = all.slice(GUIDE_LIMITS.mentions + 5).find((c) => c.id !== 'grim' && !lower.includes(c.name.toLowerCase()))!;
    const d = { ...emptyDraft('Mike'), title: 'T', body, core: ['grim'], aliases: [{ word: 'nick', card: nick.id }] };
    const wire = toWire(d, 'set2');
    expect(wire.mentions.length).toBeLessThanOrEqual(GUIDE_LIMITS.mentions);
    expect(wire.mentions).toContain(nick.id);
    expect(validateGuideDraft(wire)).toMatchObject({ ok: true });
  });
  it('a duplicate sends its source only when it is new', () => {
    expect(toWire({ ...duplicateDraft(serverGuide(sunmane), 'Mike') }, 'set2').forkedFrom).toBe('11111111-1111-4111-8111-111111111111');
    expect(toWire(draftFromGuide(serverGuide(sunmane)), 'set2').forkedFrom ?? null).toBeNull();
  });
});

describe('draftProblems: what stops a save, in the player\'s words', () => {
  const ok = { ...emptyDraft('Mike'), title: 'T', body: 'B', core: ['grim'] };
  it('a complete guide has none', () => {
    expect(draftProblems(ok, 'set2')).toEqual([]);
  });
  it('a missing card is reported first and blocks the save', () => {
    const d = { ...ok, core: ['grim', archived.id], enablers: ['card_that_never_existed'] };
    expect(missingIn(d, 'set2').sort()).toEqual([archived.id, 'card_that_never_existed'].sort());
    expect(draftProblems(d, 'set2')[0]).toMatchObject({ field: 'cards' });
    expect(draftProblems(d, 'set2')[0]!.message).toMatch(/missing or removed/i);
  });
  it('names the field for each limit, with a sentence', () => {
    const field = (patch: Partial<typeof ok>): string => draftProblems({ ...ok, ...patch }, 'set2')[0]?.field ?? 'none';
    expect(field({ title: '' })).toBe('title');
    expect(field({ title: 'x'.repeat(41) })).toBe('title');
    expect(field({ body: '' })).toBe('body');
    expect(field({ byline: '' })).toBe('byline');
    expect(field({ core: [] })).toBe('core');
    expect(field({ tagline: 'x'.repeat(81) })).toBe('tagline');
    for (const p of draftProblems({ ...ok, title: '' }, 'set2')) expect(p.message.includes(String.fromCharCode(0x2014)) || p.message.includes('--')).toBe(false);
  });
  it('a tribe that is not in this set stops the save with a sentence about tribes', () => {
    const offRoster = [...new Set(Object.values(SETS).flatMap((s) => [...s.tribes]))].find((t) => !SETS.set2.tribes.includes(t))!;
    const p = draftProblems({ ...ok, tribes: [offRoster] }, 'set2');
    expect(p[0]).toMatchObject({ field: 'tribes' });
  });
  it('a "pairs with" tribe that is not in this set is reported as pairs with, not as tribes', () => {
    const offRoster = [...new Set(Object.values(SETS).flatMap((s) => [...s.tribes]))].find((t) => !SETS.set2.tribes.includes(t))!;
    expect(draftProblems({ ...ok, pairsWith: [offRoster] }, 'set2')[0]).toMatchObject({ field: 'pairsWith' });
    expect(draftProblems({ ...ok, tribes: [SETS.set2.tribes[0]!], pairsWith: [offRoster] }, 'set2')[0]).toMatchObject({ field: 'pairsWith' });
    expect(draftProblems({ ...ok, tribes: [offRoster] }, 'set2')[0]).toMatchObject({ field: 'tribes' });
  });
  it('a nickname whose card is not in this set is a missing card, never a tribe problem', () => {
    const d = { ...ok, aliases: [{ word: 'old', card: archived.id }] };
    expect(missingIn(d, 'set2')).toContain(archived.id);
    expect(draftProblems(d, 'set2')[0]).toMatchObject({ field: 'cards' });
    expect(draftProblems(d, 'set2')[0]!.message).toMatch(/missing or removed/i);
  });
  it('a nickname row with no card yet is not a missing card', () => {
    const d = { ...ok, aliases: [{ word: 'half', card: '' }] };
    expect(missingIn(d, 'set2')).toEqual([]);
    expect(draftProblems(d, 'set2')).toEqual([]);
  });
});

describe('builtInImportPayload', () => {
  it('is the eleven built-in guides as Team Ascent documents the server accepts, each with its slug', () => {
    const payload = builtInImportPayload();
    expect(payload.map((p) => p.slug)).toEqual(BUNDLED_GUIDE_DATA.map((b) => b.id));
    for (const p of payload) {
      expect(p.official).toBe(true);
      expect(validateGuideDraft(p, { requireSlug: true }), p.slug).toMatchObject({ ok: true });
    }
  });
});
