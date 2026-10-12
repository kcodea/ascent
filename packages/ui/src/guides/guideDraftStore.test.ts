// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDraft } from './guideDrafts';
import { clearLocalDraft, loadLocalDraft, saveLocalDraft } from './guideDraftStore';

const draft = { ...emptyDraft('Mike'), title: 'Half written', body: 'So far', core: ['grim'], aliases: [{ word: 'g', card: 'grim' }] };

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
  it('is one draft: a second save replaces the first; clear removes it', () => {
    saveLocalDraft('u-1', draft);
    saveLocalDraft('u-1', { ...draft, title: 'Newer' });
    expect(loadLocalDraft('u-1')!.title).toBe('Newer');
    clearLocalDraft();
    expect(loadLocalDraft('u-1')).toBeNull();
  });
  it('junk in storage, or a draft from an older shape, reads as no draft and never throws', () => {
    localStorage.setItem('ascent.guideDraft', 'not json');
    expect(loadLocalDraft('u-1')).toBeNull();
    localStorage.setItem('ascent.guideDraft', JSON.stringify({ userId: 'u-1', draft: { title: 7 } }));
    expect(loadLocalDraft('u-1')).toBeNull();
    localStorage.setItem('ascent.guideDraft', JSON.stringify({ userId: 'u-1' }));
    expect(loadLocalDraft('u-1')).toBeNull();
  });
  it('storage that throws (a private window) is survived on every call', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => saveLocalDraft('u-1', draft)).not.toThrow();
    expect(loadLocalDraft('u-1')).toBeNull();
    expect(() => clearLocalDraft()).not.toThrow();
  });
});
