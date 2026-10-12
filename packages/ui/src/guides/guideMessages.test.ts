import { describe, expect, it } from 'vitest';
import { GUIDE_LIMITS } from '@game/guides';
import { guideErrorMessage } from './guideMessages';

/** Every code a write can answer: the server's own, and the three the seam makes (`offline`, `unavailable`, `server`). */
const CODES = ['blocked_text', 'reserved_name', 'bad_guide', 'sign_in_required', 'unauthenticated', 'not_allowed', 'not_found', 'conflict', 'too_many_guides', 'rate_limited', 'offline', 'unavailable', 'server', 'guide_failed', 'something_new'];
const KEPT = { kept: true };

describe('guideErrorMessage: a save', () => {
  it('names the part of the guide the server refused, in the player\'s words, never the offending word', () => {
    expect(guideErrorMessage('blocked_text', 'title')).toBe('The title has a word that is not allowed.');
    expect(guideErrorMessage('blocked_text', 'body')).toBe('The write-up has a word that is not allowed.');
    expect(guideErrorMessage('blocked_text', 'byline')).toBe('The "by" line has a word that is not allowed.');
    expect(guideErrorMessage('blocked_text', 'aliases')).toBe('The nicknames have a word that is not allowed.');
    expect(guideErrorMessage('bad_guide', 'core')).toBe('Check the Core cards.');
  });
  it('has a plain sentence for every code the save path can answer', () => {
    const codes = ['sign_in_required', 'unauthenticated', 'not_allowed', 'not_found', 'conflict', 'too_many_guides', 'rate_limited', 'reserved_name', 'offline', 'unavailable', 'server'];
    const seen = new Set<string>();
    for (const c of codes) {
      const m = guideErrorMessage(c, undefined, KEPT);
      expect(m.length, c).toBeGreaterThan(10);
      expect(m, c).not.toContain(c);
      seen.add(m);
    }
    expect(seen.size, 'each code reads differently').toBeGreaterThanOrEqual(codes.length - 1); // sign_in_required and unauthenticated share one
  });
  it('quotes the owner\'s 20-guide limit from the shared limits, not a retyped number', () => {
    expect(guideErrorMessage('too_many_guides')).toBe(`You already have ${GUIDE_LIMITS.guidesPerPlayer} guides. Delete one to make room.`);
    expect(guideErrorMessage('too_many_guides')).toBe('You already have 20 guides. Delete one to make room.');
  });
  it('the three sentences pinned by earlier rulings are unchanged', () => {
    expect(guideErrorMessage('not_allowed')).toBe('You cannot change this guide. Duplicate it to make your own.');
    expect(guideErrorMessage('not_allowed', undefined, KEPT)).toBe('You cannot change this guide. Duplicate it to make your own.');
    expect(guideErrorMessage('not_found', undefined, KEPT)).toBe('This guide no longer exists. Your text is kept on this device.');
    expect(guideErrorMessage('conflict')).toBe('Someone else saved this guide while you were editing.');
    expect(guideErrorMessage('conflict', undefined, KEPT)).toBe('Someone else saved this guide while you were editing.');
  });
  it('says the text is kept on this device only when it was', () => {
    // Kept: the draft was written to the device.
    expect(guideErrorMessage('offline', undefined, KEPT)).toBe('Could not reach the server. Your guide is kept on this device.');
    expect(guideErrorMessage('not_found', undefined, KEPT)).toBe('This guide no longer exists. Your text is kept on this device.');
    // Nothing kept (the guide had no unsaved changes): only the untrue clause goes.
    expect(guideErrorMessage('offline', undefined, { kept: false })).toBe('Could not reach the server. Try again.');
    expect(guideErrorMessage('not_found', undefined, { kept: false })).toBe('This guide no longer exists.');
    // Not told: never promise.
    expect(guideErrorMessage('offline')).toBe('Could not reach the server. Try again.');
    expect(guideErrorMessage('not_found')).toBe('This guide no longer exists.');
  });
  it('no sentence mentions the device unless something was kept there', () => {
    for (const c of CODES) {
      expect(guideErrorMessage(c), c).not.toMatch(/this device/);
      expect(guideErrorMessage(c, undefined, { kept: false }), c).not.toMatch(/this device/);
      expect(guideErrorMessage(c, 'body', { kept: false }), c).not.toMatch(/this device/);
    }
  });
  it('the sentences that never spoke of the device read the same whether or not anything was kept', () => {
    for (const c of CODES.filter((x) => x !== 'offline' && x !== 'not_found')) {
      expect(guideErrorMessage(c, 'title', KEPT), c).toBe(guideErrorMessage(c, 'title', { kept: false }));
    }
  });
  it('an unknown code or field still reads as a sentence', () => {
    expect(guideErrorMessage('something_new')).toBe(guideErrorMessage('server'));
    expect(guideErrorMessage('server')).toBe('Something went wrong saving the guide. Your text is still here.');
    expect(guideErrorMessage('bad_guide', 'something_new')).toBe('Check the guide.');
    expect(guideErrorMessage('bad_guide')).toBe('Check the guide.');
  });
  it('save is the action when none is named', () => {
    for (const c of CODES) expect(guideErrorMessage(c, 'title', KEPT), c).toBe(guideErrorMessage(c, 'title', { action: 'save', kept: true }));
  });
});

describe('guideErrorMessage: a delete', () => {
  const del = (code: string, kept = false): string => guideErrorMessage(code, undefined, { action: 'delete', kept });
  it('could not reach the server: the guide was not deleted', () => {
    expect(del('offline')).toBe('Could not reach the server. The guide was not deleted.');
  });
  it('a refusal with a more exact sentence keeps it', () => {
    expect(del('not_allowed')).toBe('You cannot change this guide. Duplicate it to make your own.');
    expect(del('not_found')).toBe('This guide no longer exists.');
    expect(del('sign_in_required')).toBe('Sign in to write guides.');
    expect(del('unauthenticated')).toBe('Sign in to write guides.');
  });
  it('anything else: it was not deleted', () => {
    for (const c of ['server', 'guide_failed', 'something_new', 'rate_limited', 'unavailable', 'conflict', 'too_many_guides', 'blocked_text', 'bad_guide', 'reserved_name']) {
      expect(del(c), c).toBe('Something went wrong deleting the guide. It was not deleted.');
    }
  });
  it('never speaks of saving, or of text kept on the device, whatever it is told', () => {
    for (const c of CODES) for (const kept of [true, false]) {
      expect(del(c, kept), c).not.toMatch(/sav(e|es|ed|ing)\b/);
      expect(del(c, kept), c).not.toMatch(/this device|still here/);
    }
  });
});

describe('guideErrorMessage: the import', () => {
  const imp = (code: string, field?: string): string => guideErrorMessage(code, field, { action: 'import' });
  it('could not reach the server: nothing was imported', () => {
    expect(imp('offline')).toBe('Could not reach the server. Nothing was imported.');
  });
  it('anything else: nothing was imported', () => {
    for (const c of CODES.filter((x) => x !== 'offline')) expect(imp(c, 'body'), c).toBe('Something went wrong importing the guides. Nothing was imported.');
  });
});

describe('every sentence, for every action', () => {
  it('has no long dash and no double hyphen, and never shows the code', () => {
    for (const action of ['save', 'delete', 'import'] as const) for (const kept of [true, false]) for (const c of CODES) for (const field of [undefined, 'title', 'aliases']) {
      const m = guideErrorMessage(c, field, { action, kept });
      const where = `${action} ${c} ${String(field)} ${String(kept)}`;
      expect(m.includes(String.fromCharCode(0x2014)) || m.includes(String.fromCharCode(0x2013)) || m.includes('--'), where).toBe(false);
      expect(m, where).not.toContain(c);
      expect(m.endsWith('.'), where).toBe(true);
    }
  });
});
