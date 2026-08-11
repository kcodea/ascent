import { describe, it, expect } from 'vitest';
import { friendlyAuthError } from './remoteBoards';

/**
 * The "{}" braces bug (Mike's OTP failure, 2026-08-11). @supabase/auth-js builds an error message from
 * `JSON.stringify(body)` when the error response has no readable field — an EMPTY body yields the literal
 * string "{}", which `friendlyAuthError` used to surface verbatim, so the account panel showed two red braces.
 * Any opaque, non-human message must map to a calm generic instead.
 */
describe('friendlyAuthError — never surfaces opaque server noise', () => {
  it('turns the empty-body "{}" into a human message', () => {
    const out = friendlyAuthError('{}');
    expect(out).not.toContain('{');
    expect(out).not.toContain('}');
    expect(out.toLowerCase()).toContain('try again');
  });

  it.each(['', '   ', '[object Object]', '{"code":500}', '[]'])(
    'sanitizes other opaque messages: %j',
    (msg) => {
      const out = friendlyAuthError(msg);
      expect(out).not.toMatch(/^[[{]/); // never starts with a brace/bracket
      expect(out.length).toBeGreaterThan(10);
    },
  );

  it('still maps the known human cases', () => {
    expect(friendlyAuthError('Email rate limit exceeded').toLowerCase()).toContain('too many');
    expect(friendlyAuthError('Signups not allowed for otp').toLowerCase()).toContain('enabled');
    expect(friendlyAuthError('Unable to validate email address: invalid format').toLowerCase()).toContain('valid');
  });

  it('passes a genuine unknown prose message through unchanged (never hide a real signal)', () => {
    const real = 'Token has expired or is invalid';
    expect(friendlyAuthError(real)).toBe(real);
  });
});
