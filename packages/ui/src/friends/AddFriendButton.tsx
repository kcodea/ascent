/**
 * ADD FRIEND on another player's surface (owner scope 2026-10-26, R-FRIENDS-01): their Career page (where a Leaderboard
 * row, a Recent Games row and a match's players lead) and the Versus room's invite panel (the players you are playing
 * with). Shows the relationship once the friends list is known: Add friend / Request sent / Accept / Friends. Hidden on
 * yourself, for a guest, on a blocked player and with no backend. The first one mounted in a session asks for the list
 * ONCE (no loop) so it never offers "Add friend" for someone who already is one.
 */
import { useEffect } from 'react';
import { sfx } from '../sfx';
import { useGame } from '../store';
import { acceptRequest, addFriend, friendsAccount, refreshFriendsList, relationOf, useFriends, type Relation } from './friendsStore';
import './friends.css';

let askedOnce = false;

/** What an Add friend control shows for a player: nothing (`show` false: yourself, a guest, a blocked player, no backend)
 *  or the relationship. Shared by the classic button below and the party home Career header (`PhAddFriend`). */
export function useAddFriend(userId: string | null | undefined): { show: boolean; rel: Relation; busy: boolean } {
  const account = useGame((s) => s.account);
  const rel = useFriends((s) => (userId ? relationOf(userId, s) : 'self'));
  const busy = useFriends((s) => !!userId && !!s.busy[userId]);
  const deployed = useFriends((s) => s.deployed);
  const known = useFriends((s) => !!s.list);
  const on = !!userId && !!account.userId && !account.anonymous && deployed && friendsAccount();
  useEffect(() => {
    if (!on || known || askedOnce) return;
    askedOnce = true;
    void refreshFriendsList();
  }, [on, known]);
  return { show: on && rel !== 'self' && rel !== 'blocked', rel, busy };
}

export function AddFriendButton({ userId, className = '' }: { userId: string | null | undefined; className?: string }) {
  const { show, rel, busy } = useAddFriend(userId);
  if (!show || !userId) return null;
  if (rel === 'friend') return <span className={`fr-chip ${className}`}>Friends</span>;
  if (rel === 'outgoing') return <span className={`fr-chip ${className}`}>Request sent</span>;
  if (rel === 'incoming') {
    return (
      <button type="button" className={`lb-btn pressable fr-addbtn ${className}`} disabled={busy}
        onClick={(e) => { e.stopPropagation(); sfx.pulse(); void acceptRequest(userId); }}>Accept friend</button>
    );
  }
  return (
    <button type="button" className={`lb-btn lb-btn-ghost pressable fr-addbtn ${className}`} disabled={busy}
      onClick={(e) => { e.stopPropagation(); sfx.pulse(); void addFriend(userId); }}>Add friend</button>
  );
}

/** Tests only. */
export const __resetAddFriendAsk = (): void => { askedOnce = false; };
