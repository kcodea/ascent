/**
 * THE NEW-MESSAGE TOAST (R-DM-03): a message arrives while its conversation is not open, so a small panel rises just
 * above the Friends button (bottom right since R-FRIENDS-DOCK-05, right-aligned with it, clear of the board's middle):
 * the friend's portrait, name and the message.
 * Pressing it opens the conversation in the chat window (R-DM-CHAT-01); it leaves by itself after 5 s. One at a time (the newest). It only takes the
 * presses that land on it; the game underneath keeps playing. Motion: one-shot transform + opacity.
 */
import { sfx } from '../../sfx';
import { useGame } from '../../store';
import { openDm, useFriendsDock } from '../dock/dockStore';
import { dockCorner } from '../dock/FriendsDock';
import { useFriendsPrefs } from '../friendsPrefs';
import { FriendPortrait, handleOf } from '../friendBits';
import { useFriends } from '../friendsStore';
import { dismissDmToast, useDm } from './dmStore';
import { DmBody } from './DmConversation';
import { dmPlainText } from './chatEmotes';
import { maskProfanity } from './profanity';
import './dm.css';

export function DmToast(): JSX.Element | null {
  const toast = useDm((s) => s.toast);
  const friend = useFriends((s) => (toast ? s.list?.friends.find((f) => f.userId.toLowerCase() === toast.from) ?? null : null));
  // Its conversation is on screen in the chat window (R-DM-CHAT-01): no toast.
  const open = useFriendsDock((s) => !!toast && !!s.dmWith && s.dmWith.toLowerCase() === toast.from);
  const filter = useFriendsPrefs((s) => s.filterMessages);
  // The toast rides above the Friends button, wherever its slot is (FriendsDock `dockCorner`).
  const slot = useGame(dockCorner);
  if (!toast || open || !friend) return null;
  // The label reads each emote by its name; the toast shows it small, as the conversation does (R-DM-EMOTE-01).
  const plain = dmPlainText(toast.body);
  const said = filter ? maskProfanity(plain) : plain;
  const go = (): void => { sfx.pulse(); dismissDmToast(); openDm(friend.userId); };
  return (
    <div key={toast.id} role="button" tabIndex={0} className={`dm-toast vspanel${slot ? ` ${slot}` : ''}`} aria-label={`New message from ${handleOf(friend)}: ${said}. Open the conversation.`}
      onClick={go} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }}>
      <span className="fdock-portrait"><FriendPortrait card={friend} /></span>
      <span className="dm-toast-text">
        <span className="dm-toast-name">{toast.count > 1 ? `${handleOf(friend)} (${toast.count})` : handleOf(friend)}</span>
        <span className="dm-toast-body"><DmBody body={toast.body} filter={filter} /></span>
      </span>
    </div>
  );
}
