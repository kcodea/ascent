import { describe, it, expect, beforeEach } from 'vitest';
import {
  currentIdentity, currentUserId, initIdentity, resetIdentityForTests, setIdentity,
  type AuthProvider, type Identity,
} from './identity';

/**
 * ACCOUNTS C1 — the identity seam.
 *
 * The contract that matters: a session is established ONCE, it never throws, and a failure degrades to "no
 * identity" rather than to a crash — because every upload path keys off `currentUserId()` and must skip
 * rather than write an unowned row.
 */

const id = (userId: string, displayName = '', anonymous = true): Identity => ({ userId, displayName, anonymous });

const provider = (restore: () => Promise<Identity | null>): AuthProvider => ({
  restore,
  setDisplayName: async (name) => {
    const cur = currentIdentity();
    if (!cur) return null;
    const next = { ...cur, displayName: name };
    setIdentity(next);
    return next;
  },
  signOut: async () => setIdentity(null),
});

beforeEach(() => resetIdentityForTests());

describe('establishing the session', () => {
  it('exposes the user id once restored', async () => {
    await initIdentity(provider(async () => id('u-1')), 'Kevin');
    expect(currentUserId()).toBe('u-1');
    expect(currentIdentity()?.anonymous).toBe(true);
  });

  it('carries the local display name onto a fresh anonymous session', async () => {
    await initIdentity(provider(async () => id('u-1')), 'Kevin');
    expect(currentIdentity()?.displayName).toBe('Kevin');
  });

  it('a server-supplied display name WINS over the local one', async () => {
    // C2 will return a real handle from the account; it must not be overwritten by the local string.
    await initIdentity(provider(async () => id('u-1', 'ServerName')), 'LocalName');
    expect(currentIdentity()?.displayName).toBe('ServerName');
  });

  it('runs the provider only ONCE however many callers ask', async () => {
    let calls = 0;
    const p = provider(async () => { calls += 1; return id('u-1'); });
    await Promise.all([initIdentity(p, 'K'), initIdentity(p, 'K'), initIdentity(p, 'K')]);
    expect(calls, 'a second call must reuse the in-flight promise, not mint a second session').toBe(1);
  });
});

describe('degrading safely', () => {
  it('a provider that REJECTS leaves no identity and does not throw', async () => {
    await expect(initIdentity(provider(async () => { throw new Error('network down'); }), 'K')).resolves.toBeNull();
    expect(currentUserId(), 'uploads must skip rather than write an unowned row').toBeNull();
  });

  it('a provider that returns null (anonymous sign-in disabled) leaves no identity', async () => {
    await initIdentity(provider(async () => null), 'K');
    expect(currentUserId()).toBeNull();
  });
});

describe('rename + sign out', () => {
  it('rename updates the live identity without changing the user id', async () => {
    const p = provider(async () => id('u-1', 'Old'));
    await initIdentity(p, 'Old');
    await p.setDisplayName('New');
    expect(currentIdentity()).toMatchObject({ userId: 'u-1', displayName: 'New' });
  });

  it('sign out clears the identity', async () => {
    const p = provider(async () => id('u-1'));
    await initIdentity(p, 'K');
    await p.signOut();
    expect(currentUserId()).toBeNull();
  });
});
