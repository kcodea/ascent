import { useState } from 'react';
import { useGame, formatHandle } from './store';

/**
 * ACCOUNTS C2 — the sign-in / account overlay (magic link).
 *
 * Anonymous by default (C1): every install already has a real `user_id`, but it lives only in this browser's
 * storage — clear site data or switch devices and the account, with its boards / runs / rating, is gone. This
 * panel is how a player makes it PERMANENT and PORTABLE: they enter an email, we send a one-time link, and
 * opening that link upgrades the SAME account in place (no password, no new `user_id`). On another device the
 * same email signs back into that one account.
 *
 * Plain by design — the shell is functional and themed off the shared glass vars; PRESENTATION IS MIKE'S SEAM
 * (packages/ui), so this is deliberately minimal for him to restyle. Reachable from the Title account chip.
 */
export function AccountPanel() {
  const open = useGame((s) => s.accountPanelOpen);
  const close = useGame((s) => s.closeAccountPanel);
  const account = useGame((s) => s.account);
  const playerName = useGame((s) => s.playerName);
  const sendMagicLink = useGame((s) => s.sendMagicLink);
  const signOutAccount = useGame((s) => s.signOutAccount);
  // Only ever over the Title — never over gameplay (same defensive gate as AvatarPicker).
  const onTitle = useGame((s) => s.showTitle);

  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  if (!open || !onTitle) return null;

  const signedIn = !account.anonymous && !!account.email;

  const submit = async (): Promise<void> => {
    if (status === 'sending') return;
    setError(null);
    setStatus('sending');
    const res = await sendMagicLink(email);
    if (res.ok) {
      setStatus('sent');
    } else {
      setStatus('idle');
      setError(res.error ?? 'Something went wrong. Try again.');
    }
  };

  return (
    <div className="acctpanel" role="dialog" aria-label="Account" onClick={close}>
      <div className="acctpanel-box" onClick={(e) => e.stopPropagation()}>
        <div className="acctpanel-head">
          <span className="acctpanel-title">Account</span>
          <button className="avatarpick-close pressable" onClick={close} aria-label="Close">✕</button>
        </div>

        {signedIn ? (
          <div className="acctpanel-body">
            <p className="acctpanel-lead">You’re signed in.</p>
            {playerName && account.discriminator && <p className="acctpanel-handle">{formatHandle(playerName, account.discriminator)}</p>}
            <p className="acctpanel-email">{account.email}</p>
            <p className="acctpanel-note">
              Your progress is saved to this account and follows you to any device — just sign in with this
              email there.
            </p>
            <button className="acctpanel-btn ghost pressable" onClick={() => void signOutAccount()}>Sign out</button>
          </div>
        ) : status === 'sent' ? (
          <div className="acctpanel-body">
            <p className="acctpanel-lead">Check your inbox.</p>
            <p className="acctpanel-note">
              We sent a sign-in link to <b>{email}</b>. Open it on this device to finish — your current progress
              upgrades to that account, nothing is lost.
            </p>
            <button className="acctpanel-btn ghost pressable" onClick={() => { setStatus('idle'); setError(null); }}>
              Use a different email
            </button>
          </div>
        ) : (
          <div className="acctpanel-body">
            <p className="acctpanel-lead">Save your progress.</p>
            <p className="acctpanel-note">
              Right now your run history and rating live only in this browser — clearing site data or switching
              devices loses them. Add your email and we’ll send a one-time link; no password needed.
            </p>
            <input
              className="acctinput acctpanel-input"
              type="email"
              autoFocus
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
            />
            {error && <p className="acctpanel-error" role="alert">{error}</p>}
            <button
              className="acctpanel-btn primary pressable"
              onClick={() => void submit()}
              disabled={status === 'sending' || !email.trim()}
            >
              {status === 'sending' ? 'Sending…' : 'Send sign-in link'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
