/**
 * THE NEW-MESSAGE TOAST (R-DM-03): a message arrives while its conversation is not open, so a small panel rises just
 * above the Friends button (bottom left since R-FRIENDS-DOCK-02, clear of the board's middle): the friend's portrait, name and the message.
 * Pressing it opens the conversation; it leaves by itself after 5 s. One at a time (the newest). It only takes the
 * presses that land on it; the game underneath keeps playing. Motion: one-shot transform + opacity.
 */
import { sfx } from '../../sfx';
import { openDm, useFriendsDock } from '../dock/dockStore';
import { useFriendsPrefs } from '../friendsPrefs';
import { FriendPortrait, handleOf } from '../friendBits';
import { useFriends } from '../friendsStore';
import { dismissDmToast, useDm } from './dmStore';
import { maskProfanity } from './profanity';
import './dm.css';

export function DmToast(): JSX.Element | null {
  const toast = useDm((s) => s.toast);
  const friend = useFriends((s) => (toast ? s.list?.friends.find((f) => f.userId.toLowerCase() === toast.from) ?? null : null));
  const open = useFriendsDock((s) => s.phase === 'open' && s.dmWith === toast?.from);
  const filter = useFriendsPrefs((s) => s.filterMessages);
  if (!toast || open || !friend) return null;
  const body = filter ? maskProfanity(toast.body) : toast.body;
  const go = (): void => { sfx.pulse(); dismissDmToast(); openDm(friend.userId); };
  return (
    <div key={toast.id} role="button" tabIndex={0} className="dm-toast vspanel" aria-label={`New message from ${handleOf(friend)}: ${body}. Open the conversation.`}
      onClick={go} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }}>
      <span className="fdock-portrait"><FriendPortrait card={friend} /></span>
      <span className="dm-toast-text">
        <span className="dm-toast-name">{toast.count > 1 ? `${handleOf(friend)} (${toast.count})` : handleOf(friend)}</span>
        <span className="dm-toast-body">{body}</span>
      </span>
    </div>
  );
}
