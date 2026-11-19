/**
 * ADD FRIEND in another player's Career header (owner 2026-11-18: "add an add friend button up here for a 1 click add
 * friend"; R-CAREER-ADD-FRIEND-01). One press sends the request by player id through the friends store, the same call
 * the Versus room uses. It then reads Request sent; a player who already asked you shows Accept friend; a friend shows
 * Friends. Hidden on yourself, for a guest, on a blocked player and with no backend (`useAddFriend`, R-FRIENDS-01).
 * A refused request (limit reached, offline) says why beside the button, since the Friends panel may be closed.
 */
import { useEffect, useState } from 'react';
import { sfx } from '../../../sfx';
import { useAddFriend } from '../../../friends/AddFriendButton';
import { acceptRequest, addFriend, useFriends } from '../../../friends/friendsStore';
import { PhButton } from '../../kit';

/** How long a refusal stays beside the button (the friends flash lasts as long). */
const ERROR_MS = 3500;

export function PhAddFriend({ userId }: { userId: string | null | undefined }) {
  const { show, rel, busy } = useAddFriend(userId);
  // The press went through: hold "Request sent" until the refreshed list says the same (or says Friends).
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setSent(false); setError(null); }, [userId]);
  useEffect(() => {
    if (!error) return undefined;
    const t = window.setTimeout(() => setError(null), ERROR_MS);
    return () => window.clearTimeout(t);
  }, [error]);
  if (!show || !userId) return null;
  const run = (send: () => Promise<unknown>, marksSent: boolean) => {
    sfx.pulse();
    setError(null);
    // A refused action resolves null (accept) or false (add) and leaves its reason in the friends flash.
    void send().then((r) => {
      if (r !== null && r !== false) { if (marksSent) setSent(true); } else setError(useFriends.getState().flash);
    });
  };
  const state = rel === 'friend' ? 'friend' : rel === 'incoming' ? 'incoming' : rel === 'outgoing' || sent ? 'outgoing' : 'none';
  return (
    <span className="phc-addfriend" data-state={state}>
      {error && <span className="phc-addfriend-err" role="status">{error}</span>}
      {state === 'friend' ? <PhButton size="s" variant="ghost" disabled>Friends</PhButton>
        : state === 'outgoing' ? <PhButton size="s" disabled>Request sent</PhButton>
        : state === 'incoming' ? <PhButton size="s" variant="primary" disabled={busy} onClick={() => run(() => acceptRequest(userId), false)}>Accept friend</PhButton>
        : <PhButton size="s" variant="primary" disabled={busy} onClick={() => run(() => addFriend(userId), true)}>Add friend</PhButton>}
    </span>
  );
}
