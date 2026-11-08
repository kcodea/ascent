/**
 * R-PH-FRIENDS-BADGE-01 (owner 2026-11-08): the top nav Friends button glows green while any friend is online, and
 * unread direct messages show a green bubble with the total count.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { LivePeer } from '../../friends/dm/dmStore';
import { onlineFriendCount, unreadLabel, unreadTotal } from './friendsBadge';

const peer = (userId: string, online: boolean): LivePeer =>
  ({ userId, presence: online ? { status: 'online' } : null, at: 0, seenAt: 0 }) as unknown as LivePeer;
const src = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('Friends button badge', () => {
  it('counts only friends with a presence as online', () => {
    expect(onlineFriendCount({})).toBe(0);
    expect(onlineFriendCount({ a: peer('a', false), b: peer('b', true), c: peer('c', true) })).toBe(2);
  });
  it('sums unread across conversations and caps the label at 99+', () => {
    expect(unreadTotal({})).toBe(0);
    expect(unreadTotal({ a: 2, b: 5, c: 0 })).toBe(7);
    expect(unreadLabel(7)).toBe('7');
    expect(unreadLabel(120)).toBe('99+');
  });
  it('the top nav wires the glow class and the bubble to the Friends button', () => {
    const nav = src('./PhTopNav.tsx');
    expect(nav).toMatch(/ph-friendsbtn[^`]*f-online/);
    expect(nav).toMatch(/friendsBadge\.unread > 0 && <span className="ph-funread"/);
    const css = src('./shell.css');
    expect(css).toMatch(/\.ph-friendsbtn\.f-online \.ph-navicon \{ filter: drop-shadow/);
    expect(css).toMatch(/\.ph-funread \{/);
  });
});
