// @vitest-environment jsdom
/**
 * SUPABASE CLEANUP P1.1 (2026-10-28): the login startup work runs once per ACCOUNT, never per auth event.
 *
 *  - `createAccountStartupGate` lets a report through only when the user id, the anonymous flag or the email
 *    changes (or the session ends), and counts both (the DEV `window.__ascentAuthStartup` counter);
 *  - a realistic day (boot restore + INITIAL_SESSION + hourly token refreshes + tab refocuses) used to run the
 *    whole fan-out on every fire; it now runs it once;
 *  - `claimHandle` skips its `profiles` UPDATE when the row already has this name + a tag and this device last
 *    wrote this email for the user.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { accountKey, createAccountStartupGate } from './identityGate';

const anon = { userId: 'u-1', anonymous: true, email: null };
const upgraded = { userId: 'u-1', anonymous: false, email: 'a@b.c' };

describe('accountStartupGate', () => {
  it('a day of token refreshes and tab refocuses runs the startup work ONCE (was once per event)', () => {
    const gate = createAccountStartupGate();
    const events = [anon /* boot restore */, anon /* INITIAL_SESSION */];
    for (let h = 0; h < 8; h++) events.push(anon); // TOKEN_REFRESHED, about hourly over an 8-hour session
    for (let r = 0; r < 40; r++) events.push(anon); // tab refocus re-fires
    const ran = events.filter((e) => gate.claim(e)).length;
    expect(ran).toBe(1);
    expect(gate.counters).toEqual({ authEvents: 50, startups: 1, skipped: 49 });
  });

  it('runs again on a real account change: the email upgrade, a different user, a sign-out and back', () => {
    const gate = createAccountStartupGate();
    expect(gate.claim(anon)).toBe(true);
    expect(gate.claim(upgraded)).toBe(true); // anonymous -> email account (same user id)
    expect(gate.claim(upgraded)).toBe(false);
    expect(gate.claim({ ...upgraded, email: 'new@b.c' })).toBe(true); // email changed
    expect(gate.claim(null)).toBe(true); // signed out: the guides clear
    expect(gate.claim(null)).toBe(false);
    expect(gate.claim({ userId: 'u-2', anonymous: true, email: null })).toBe(true); // another account
  });

  it('keys on user id, anonymous flag and email only', () => {
    expect(accountKey(null)).toBe('none');
    expect(accountKey(anon)).not.toBe(accountKey(upgraded));
    expect(accountKey({ ...anon })).toBe(accountKey(anon));
  });
});

// ── claimHandle writes only when something changed ────────────────────────────────────────────────────────
interface Q { table: string; op: 'select' | 'update'; cols?: string; patch?: unknown }
const qs: Q[] = [];
let row: { discriminator: string | null; author: string | null } | null = { discriminator: '4821', author: 'Kevin' };
let email: string | null = null;

vi.stubEnv('VITE_SUPABASE_URL', 'http://test.local');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key');
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const chain = {
        select: (cols: string) => { qs.push({ table, op: 'select', cols }); return chain; },
        update: (patch: unknown) => { qs.push({ table, op: 'update', patch }); return { eq: () => ({ select: () => Promise.resolve({ data: [{ user_id: 'u-1' }], error: null }) }) }; },
        eq: () => chain,
        limit: () => Promise.resolve({ data: row ? [row] : [], error: null }),
      };
      return chain;
    },
  }),
}));
vi.mock('./identity', () => ({
  currentUserId: () => 'u-1',
  currentIdentity: () => ({ userId: 'u-1', displayName: '', anonymous: email === null, email }),
  setIdentity: () => {},
}));
vi.setConfig({ testTimeout: 30000 });

describe('claimHandle', () => {
  beforeEach(() => { qs.length = 0; row = { discriminator: '4821', author: 'Kevin' }; email = null; localStorage.clear(); });
  const updates = () => qs.filter((q) => q.op === 'update').length;

  it('writes once, then skips the UPDATE while the name, tag and email are unchanged', async () => {
    const { claimHandle } = await import('./remoteBoards');
    expect(await claimHandle('Kevin')).toEqual({ author: 'Kevin', discriminator: '4821' });
    expect(updates()).toBe(1); // first claim on this device: no memo of the email written yet
    for (let i = 0; i < 5; i++) expect(await claimHandle('Kevin')).toEqual({ author: 'Kevin', discriminator: '4821' });
    expect(updates()).toBe(1);
  });

  it('writes again when the name or the email changes', async () => {
    const { claimHandle } = await import('./remoteBoards');
    await claimHandle('Kevin');
    await claimHandle('Kevin2'); // the server row still says Kevin
    expect(updates()).toBe(2);
    row = { discriminator: '4821', author: 'Kevin2' };
    email = 'a@b.c'; // the account upgrade lands an email
    await claimHandle('Kevin2');
    expect(updates()).toBe(3);
    await claimHandle('Kevin2');
    expect(updates()).toBe(3);
  });

  it('still never creates a row (no profile yet = no write)', async () => {
    row = null;
    const { claimHandle } = await import('./remoteBoards');
    expect(await claimHandle('Kevin')).toBeNull();
    expect(updates()).toBe(0);
  });
});
