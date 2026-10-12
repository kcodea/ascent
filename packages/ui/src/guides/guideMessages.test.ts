import { describe, expect, it } from 'vitest';
import { GUIDE_LIMITS } from '@game/guides';
import { guideErrorMessage } from './guideMessages';

describe('guideErrorMessage', () => {
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
      const m = guideErrorMessage(c);
      expect(m.length, c).toBeGreaterThan(10);
      expect(m.includes(String.fromCharCode(0x2014)) || m.includes('--'), c).toBe(false);
      expect(m, c).not.toContain(c);
      seen.add(m);
    }
    expect(seen.size, 'each code reads differently').toBeGreaterThanOrEqual(codes.length - 1); // sign_in_required and unauthenticated share one
  });
  it('quotes the owner\'s 20-guide limit from the shared limits, not a retyped number', () => {
    expect(guideErrorMessage('too_many_guides')).toContain(String(GUIDE_LIMITS.guidesPerPlayer));
  });
  it('tells the author their text is safe when the server could not be reached', () => {
    expect(guideErrorMessage('offline')).toContain('kept on this device');
  });
  it('a refusal the player can do something about says what', () => {
    expect(guideErrorMessage('not_allowed')).toBe('You cannot change this guide. Duplicate it to make your own.');
    expect(guideErrorMessage('not_found')).toBe('This guide no longer exists. Your text is kept on this device.');
    expect(guideErrorMessage('conflict')).toBe('Someone else saved this guide while you were editing.');
  });
  it('an unknown code or field still reads as a sentence', () => {
    expect(guideErrorMessage('something_new')).toBe(guideErrorMessage('server'));
    expect(guideErrorMessage('bad_guide', 'something_new')).toBe('Check the guide.');
    expect(guideErrorMessage('bad_guide')).toBe('Check the guide.');
  });
});
