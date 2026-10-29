/**
 * THE INVITE NOTICE (owner scope 2026-10-26, R-FRIENDS-04): a friend's invite shows in the game's own dark panel
 * (`.vspanel` + `.vsplate`, the Versus notices' look) in the top-right corner, without a veil: the friend's portrait in
 * their frame, "<Name> invites you to their Versus room", the seconds left, Accept / Decline. It lasts until the invite
 * expires (2 minutes). Only on a menu (never over a game in progress); the newest invite first. Accept joins the room
 * through the existing Versus join. One 1 s timer runs only while a notice is up (the countdown).
 */
import { useEffect, useState } from 'react';
import { sfx } from '../sfx';
import { useGame } from '../store';
import { useVersus } from '../versus/versusStore';
import { answerInvite, openInvites, useFriends } from './friendsStore';
import { FriendPortrait, handleOf } from './friendBits';
import type { FriendInvite } from './friendsRemote';
import '../versus/versus.css';
import './friends.css';

/** The words for an invite. */
export function inviteText(i: Pick<FriendInvite, 'kind' | 'from'>): string {
  const who = handleOf(i.from);
  if (i.kind === 'spectate') return `${who} invites you to watch their game.`;
  return i.kind === 'duos_party' ? `${who} invites you to their Ranked Duos party.` : `${who} invites you to their Versus room.`;
}

/** A notice may show: a menu is up and no game of mine is being played (a Versus room between matches counts). */
export function inviteNoticeAllowed(st: { showTitle: boolean; practiceSetupOpen: boolean; replaying: boolean }, inVersusMatch: boolean): boolean {
  return (st.showTitle || st.practiceSetupOpen) && !st.replaying && !inVersusMatch;
}

export function InviteNotice(): JSX.Element | null {
  const inbox = useFriends((s) => s.inbox);
  const answered = useFriends((s) => s.answered);
  const skew = useFriends((s) => s.skew);
  const allowed = useGame((s) => inviteNoticeAllowed(s, false));
  const inMatch = useVersus((s) => !!s.match && s.match.phase !== 'complete' && s.room?.status === 'in_game');
  const myRoom = useVersus((s) => s.room?.id ?? null);
  const [now, setNow] = useState(() => Date.now());
  const [blocked, setBlocked] = useState<string | null>(null);
  const invite = allowed && !inMatch ? openInvites({ inbox, answered }, now, skew)[0] ?? null : null;
  useEffect(() => {
    if (!invite) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [invite?.id]);
  if (!invite) return null;
  const left = Math.max(0, Math.ceil((Date.parse(invite.expiresAt) - (now + skew)) / 1000));
  if (left <= 0) return null;
  // Already in ANOTHER Versus room: say so instead of answering (the join would be refused).
  const accept = (): void => {
    sfx.pulse();
    if (invite.kind === 'versus_room' && myRoom && myRoom !== invite.target) { setBlocked(invite.id); return; }
    void answerInvite(invite, true);
  };
  return (
    <div className="fr-notice vspanel" role="alertdialog" aria-label="Friend invite">
      <div className="fr-notice-top">
        <FriendPortrait card={invite.from} />
        <div className="fr-notice-text">
          <div className="fr-notice-title">{inviteText(invite)}</div>
          <div className="fr-notice-left">{blocked === invite.id ? 'Leave your Versus room first.' : `${left}s left`}</div>
        </div>
      </div>
      <div className="vspanel-actions">
        <button type="button" className="vsplate vsprimary" onClick={accept}>Accept</button>
        <button type="button" className="vsplate" onClick={() => { sfx.pulse(); void answerInvite(invite, false); }}>Decline</button>
      </div>
    </div>
  );
}
