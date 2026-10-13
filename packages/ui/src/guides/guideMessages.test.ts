import { describe, expect, it } from 'vitest';
import { GUIDE_LIMITS } from '@game/guides';
import { guideErrorMessage, type GuideAction } from './guideMessages';

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
  it('could not reach the server: the delete may have landed, so it says to check again, never that it was not deleted', () => {
    expect(del('offline')).toBe('Could not reach the server. Check again in a moment to see whether it was deleted.');
    expect(del('offline')).not.toContain('not deleted');
  });
  it('a refusal with a more exact sentence keeps it', () => {
    expect(del('not_allowed')).toBe('You cannot change this guide. Duplicate it to make your own.');
    expect(del('not_found')).toBe('This guide no longer exists.');
    expect(del('sign_in_required')).toBe('Sign in to write guides.');
    expect(del('unauthenticated')).toBe('Sign in to write guides.');
  });
  it('an answer that came and could not be read: the delete may have landed too, so it says to check again', () => {
    expect(del('server')).toBe('Something went wrong. Check again in a moment to see whether it was deleted.');
    expect(del('server')).not.toContain('not deleted');
    expect(del('server')).not.toContain('reach the server'); // the server was reached
  });
  it('anything else: it was not deleted', () => {
    for (const c of ['guide_failed', 'something_new', 'rate_limited', 'unavailable', 'conflict', 'too_many_guides', 'blocked_text', 'bad_guide', 'reserved_name']) {
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
  /** Every action the module knows. Typed as a record of them all, so a new action cannot be left out. */
  const EVERY_ACTION: Record<GuideAction, true> = { save: true, delete: true, import: true, publish: true, unpublish: true, bookmark: true, report: true, moderate: true };
  const ACTIONS = Object.keys(EVERY_ACTION) as GuideAction[];
  /** Every code any action has a sentence of its own for, and two it does not know. */
  const ALL_CODES = [...CODES, 'guide_hidden', 'too_many_bookmarks', 'already_reported', 'report_limit', 'bad_report'];
  /** The fields that change a sentence: none, a named part, the nicknames, the "Based on" line, and one not known. */
  const FIELDS = [undefined, 'title', 'aliases', 'forked', 'something_new'];
  it('has no long dash and no double hyphen, never shows the code, and ends as a sentence', () => {
    const seen = new Set<string>();
    for (const action of ACTIONS) for (const kept of [true, false]) for (const c of ALL_CODES) for (const field of FIELDS) {
      const m = guideErrorMessage(c, field, { action, kept });
      const where = `${action} ${c} ${String(field)} ${String(kept)}`;
      expect(m.includes(String.fromCharCode(0x2014)) || m.includes(String.fromCharCode(0x2013)) || m.includes('--'), where).toBe(false);
      expect(m, where).not.toContain(c);
      expect(m.endsWith('.'), where).toBe(true);
      seen.add(`${action}: ${m}`);
    }
    // The loop does reach the sentences of the two newest actions.
    expect(seen.has('report: You already reported this guide.')).toBe(true);
    expect(seen.has('moderate: Only Team Ascent can do that.')).toBe(true);
    expect(seen.has('delete: Something went wrong. Check again in a moment to see whether it was deleted.')).toBe(true);
  });
});

describe('publishing and bookmarking have their own words', () => {
  it('a publish refused for its text says which part, and what to do', () => {
    expect(guideErrorMessage('blocked_text', 'title', { action: 'publish' })).toBe('The title has a word that is not allowed. Edit the guide, then publish it.');
    expect(guideErrorMessage('reserved_name', 'title', { action: 'publish' })).toBe('The title uses a reserved name. Edit the guide, then publish it.');
    expect(guideErrorMessage('reserved_name', 'byline', { action: 'publish' })).toBe('The "by" line uses a reserved name. Edit the guide, then publish it.');
  });
  it('the other publish refusals', () => {
    expect(guideErrorMessage('guide_hidden', undefined, { action: 'publish' })).toBe('Team Ascent has hidden this guide. It cannot be published.');
    expect(guideErrorMessage('conflict', undefined, { action: 'publish' })).toBe('This guide changed while it was being published. Try again.');
    // A publish whose answer is lost may have landed: it never says nothing was changed.
    expect(guideErrorMessage('offline', undefined, { action: 'publish' })).toBe('Could not reach the server. Check again in a moment to see whether it changed.');
    expect(guideErrorMessage('rate_limited', undefined, { action: 'publish' })).toBe('That is a lot of changes. Try again in a little while.');
    expect(guideErrorMessage('not_found', undefined, { action: 'publish' })).toBe('This guide no longer exists.');
    expect(guideErrorMessage('whatever', undefined, { action: 'publish' })).toBe('Something went wrong. Nothing was changed.');
  });
  it('bookmark refusals', () => {
    expect(guideErrorMessage('too_many_bookmarks', undefined, { action: 'bookmark' })).toBe(`You already have ${GUIDE_LIMITS.bookmarksPerPlayer} bookmarks. Remove one to make room.`);
    expect(guideErrorMessage('not_found', undefined, { action: 'bookmark' })).toBe('This guide is no longer available.');
    expect(guideErrorMessage('not_allowed', undefined, { action: 'bookmark' })).toBe('This guide cannot be bookmarked.');
    expect(guideErrorMessage('sign_in_required', undefined, { action: 'bookmark' })).toBe('Sign in to bookmark guides.');
    expect(guideErrorMessage('offline', undefined, { action: 'bookmark' })).toBe('Could not reach the server. Nothing was changed.');
  });
  it('a save refused for a reserved title names the title, and the by line keeps its old sentence', () => {
    expect(guideErrorMessage('reserved_name', 'title')).toBe('The title uses a reserved name. Pick another.');
    expect(guideErrorMessage('reserved_name', 'tagline')).toBe('The tagline uses a reserved name. Pick another.');
    expect(guideErrorMessage('reserved_name', 'byline')).toBe('That "by" line is reserved. Pick another name.');
    expect(guideErrorMessage('reserved_name')).toBe('That "by" line is reserved. Pick another name.');
  });
  it('an unpublish has its own words: nothing was changed, and never "publish it"', () => {
    const un = (code: string, field?: string): string => guideErrorMessage(code, field, { action: 'unpublish' });
    // An unpublish whose answer is lost may have landed too.
    expect(un('offline')).toBe('Could not reach the server. Check again in a moment to see whether it changed.');
    expect(un('not_found')).toBe('This guide no longer exists.');
    expect(un('sign_in_required')).toBe('Sign in to write guides.');
    expect(un('unauthenticated')).toBe('Sign in to write guides.');
    expect(un('not_allowed')).toBe('You cannot change this guide. Duplicate it to make your own.');
    // Codes an unpublish cannot be answered with still read as a plain sentence that asks for nothing.
    for (const c of ['conflict', 'rate_limited', 'blocked_text', 'reserved_name', 'guide_hidden', 'server', 'unavailable', 'something_new']) {
      expect(un(c, 'title'), c).toBe('Something went wrong. Nothing was changed.');
    }
    for (const c of [...CODES, 'guide_hidden', 'too_many_bookmarks']) for (const field of [undefined, 'title', 'byline']) for (const kept of [true, false]) {
      const m = guideErrorMessage(c, field, { action: 'unpublish', kept });
      expect(m, c).not.toMatch(/publish/i);
      expect(m, c).not.toMatch(/sav(e|es|ed|ing)\b|this device|still here/);
      expect(m, c).not.toContain(c);
      expect(m.endsWith('.'), c).toBe(true);
      expect(m.includes(String.fromCharCode(0x2014)) || m.includes(String.fromCharCode(0x2013)) || m.includes('--'), c).toBe(false);
    }
  });
  it('no sentence here has an em dash or a double hyphen', () => {
    const all = ['blocked_text', 'reserved_name', 'guide_hidden', 'conflict', 'offline', 'rate_limited', 'not_found', 'not_allowed', 'too_many_bookmarks', 'sign_in_required', 'x']
      .flatMap((c) => (['publish', 'bookmark'] as const).map((action) => guideErrorMessage(c, 'title', { action })));
    for (const m of all) expect(m.includes(String.fromCharCode(0x2014)) || m.includes('--'), m).toBe(false);
  });
});

describe('reporting and the team actions have their own words', () => {
  it('report refusals', () => {
    expect(guideErrorMessage('already_reported', undefined, { action: 'report' })).toBe('You already reported this guide.');
    expect(guideErrorMessage('report_limit', undefined, { action: 'report' })).toBe('That is a lot of reports. Try again tomorrow.');
    expect(guideErrorMessage('not_found', undefined, { action: 'report' })).toBe('This guide is no longer available.');
    expect(guideErrorMessage('not_allowed', undefined, { action: 'report' })).toBe('This guide cannot be reported.');
    expect(guideErrorMessage('sign_in_required', undefined, { action: 'report' })).toBe('Sign in to report guides.');
    expect(guideErrorMessage('bad_report', 'note', { action: 'report' })).toBe('Check the report.');
    expect(guideErrorMessage('offline', undefined, { action: 'report' })).toBe('Could not reach the server. Try again in a moment; if it says you already reported this guide, it went through.');
    expect(guideErrorMessage('x', undefined, { action: 'report' })).toBe('Something went wrong. The report was not sent.');
  });
  it('team action refusals never claim something changed or did not', () => {
    expect(guideErrorMessage('not_allowed', undefined, { action: 'moderate' })).toBe('Only Team Ascent can do that.');
    expect(guideErrorMessage('not_found', undefined, { action: 'moderate' })).toBe('This guide no longer exists.');
    expect(guideErrorMessage('offline', undefined, { action: 'moderate' })).toBe('Could not reach the server. Check again in a moment to see whether it changed.');
    expect(guideErrorMessage('x', undefined, { action: 'moderate' })).toBe('Something went wrong. Check again in a moment to see whether it changed.');
  });
  it('a publish refused for its "Based on" line says the player cannot fix it', () => {
    expect(guideErrorMessage('blocked_text', 'forked', { action: 'publish' })).toBe('The guide this one is based on has a name that is not allowed, so this copy cannot be published. Write it as a new guide instead.');
  });
  it('too many bookmark changes has its own sentence', () => {
    expect(guideErrorMessage('rate_limited', undefined, { action: 'bookmark' })).toBe('That is a lot of bookmarks. Try again in a little while.');
  });
});
