// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDraft } from './guideDrafts';
import { clearLocalDraft, loadLocalDraft, saveLocalDraft } from './guideDraftStore';

const draft = { ...emptyDraft('Mike'), title: 'Half written', body: 'So far', core: ['grim'], aliases: [{ word: 'g', card: 'grim' }] };
const other = { ...emptyDraft('Kev'), title: 'Another account wrote this', body: 'Theirs', core: ['b2_sunmane'] };

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('the in-progress guide kept on this device', () => {
  it('comes back as it was saved, for the account that wrote it', () => {
    saveLocalDraft('u-1', draft);
    expect(loadLocalDraft('u-1')).toEqual(draft);
  });
  it('is not offered to a different account on the same device', () => {
    saveLocalDraft('u-1', draft);
    expect(loadLocalDraft('u-2')).toBeNull();
  });
  it('is one draft per account: a second save replaces the first; clear removes it', () => {
    saveLocalDraft('u-1', draft);
    saveLocalDraft('u-1', { ...draft, title: 'Newer' });
    expect(loadLocalDraft('u-1')!.title).toBe('Newer');
    clearLocalDraft('u-1');
    expect(loadLocalDraft('u-1')).toBeNull();
  });
  it('each account has a slot of its own, under its own key', () => {
    saveLocalDraft('u-1', draft);
    expect(Object.keys(localStorage)).toEqual(['ascent.guideDraft:u-1']);
    saveLocalDraft('u-2', other);
    expect(Object.keys(localStorage).sort()).toEqual(['ascent.guideDraft:u-1', 'ascent.guideDraft:u-2']);
  });
  it('a second account saving its draft leaves the first account\'s in place, readable only by the first', () => {
    saveLocalDraft('u-1', draft);
    saveLocalDraft('u-2', other);
    expect(loadLocalDraft('u-1')).toEqual(draft);
    expect(loadLocalDraft('u-2')).toEqual(other);
    saveLocalDraft('u-2', { ...other, title: 'Typed some more' });
    expect(loadLocalDraft('u-1')).toEqual(draft);
    expect(loadLocalDraft('u-3')).toBeNull();
  });
  it('clearing one account\'s draft leaves the other account\'s', () => {
    saveLocalDraft('u-1', draft);
    saveLocalDraft('u-2', other);
    clearLocalDraft('u-2');
    expect(loadLocalDraft('u-2')).toBeNull();
    expect(loadLocalDraft('u-1')).toEqual(draft);
    clearLocalDraft('u-1');
    expect(loadLocalDraft('u-1')).toBeNull();
  });
  it('a slot that is not keyed by account (the shape before accounts had their own) is never read', () => {
    localStorage.setItem('ascent.guideDraft', JSON.stringify({ userId: 'u-1', draft }));
    expect(loadLocalDraft('u-1')).toBeNull();
  });
  it('a draft filed under one account\'s key but written for another is not handed over', () => {
    localStorage.setItem('ascent.guideDraft:u-2', JSON.stringify({ userId: 'u-1', draft }));
    expect(loadLocalDraft('u-2')).toBeNull();
  });
  it('with no account there is no slot: nothing is written, read or cleared', () => {
    saveLocalDraft('', draft);
    expect(localStorage.length).toBe(0);
    expect(loadLocalDraft('')).toBeNull();
    saveLocalDraft('u-1', draft);
    clearLocalDraft('');
    expect(loadLocalDraft('u-1')).toEqual(draft);
  });
  it('junk in storage, or a draft from an older shape, reads as no draft and never throws', () => {
    localStorage.setItem('ascent.guideDraft:u-1', 'not json');
    expect(loadLocalDraft('u-1')).toBeNull();
    localStorage.setItem('ascent.guideDraft:u-1', JSON.stringify({ userId: 'u-1', draft: { title: 7 } }));
    expect(loadLocalDraft('u-1')).toBeNull();
    localStorage.setItem('ascent.guideDraft:u-1', JSON.stringify({ userId: 'u-1' }));
    expect(loadLocalDraft('u-1')).toBeNull();
  });
  it('storage that throws (a private window) is survived on every call', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => saveLocalDraft('u-1', draft)).not.toThrow();
    expect(loadLocalDraft('u-1')).toBeNull();
    expect(() => clearLocalDraft('u-1')).not.toThrow();
  });
});
