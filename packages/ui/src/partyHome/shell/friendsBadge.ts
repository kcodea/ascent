/**
 * The top nav Friends button's two live signals (owner 2026-11-08, R-PH-FRIENDS-BADGE-01), read from the direct-message
 * hub that runs from boot for a signed-in account:
 *  - any friend online → the medallion glows green;
 *  - unread messages → a green bubble with the total count.
 */
import { useDm, type LivePeer } from '../../friends/dm/dmStore';

/** Friends the hub reports online (presence null = offline). */
export function onlineFriendCount(peers: Record<string, LivePeer>): number {
  let n = 0;
  for (const p of Object.values(peers)) if (p.presence) n++;
  return n;
}

/** Every unread message across all conversations. */
export function unreadTotal(unread: Record<string, number>): number {
  let n = 0;
  for (const v of Object.values(unread)) if (v > 0) n += v;
  return n;
}

/** What the bubble prints: the count, capped at 99+. */
export function unreadLabel(n: number): string {
  return n > 99 ? '99+' : String(n);
}

export function useFriendsBadge(): { online: boolean; unread: number } {
  const online = useDm((s) => onlineFriendCount(s.peers) > 0);
  const unread = useDm((s) => unreadTotal(s.unread));
  return { online, unread };
}
