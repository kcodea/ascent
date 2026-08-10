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
  const verifyEmailCode = useGame((s) => s.verifyEmailCode);
  const signOutAccount = useGame((s) => s.signOutAccount);
  // Only ever over the Title — never over gameplay (same defensive gate as AvatarPicker).
  const onTitle = useGame((s) => s.showTitle);

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  // 'idle' → 'sending' → 'sent' (enter the code) → 'verifying'. On success the account flips to signed-in via
  // the identity onChange subscription, so this component just re-renders into the signed-in branch.
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'verifying'>('idle');
  const [error, setError] = useState<string | null>(null);

  if (!open || !onTitle) return null;

  const signedIn = !account.anonymous && !!account.email;

  const send = async (): Promise<void> => {
    if (status === 'sending') return;
    setError(null);
    setStatus('sending');
    const res = await sendMagicLink(email);
    if (res.ok) { setStatus('sent'); setCode(''); }
    else { setStatus('idle'); setError(res.error ?? 'Something went wrong. Try again.'); }
  };

  const verify = async (): Promise<void> => {
    if (status === 'verifying' || !code.trim()) return;
    setError(null);
    setStatus('verifying');
    const res = await verifyEmailCode(email, code);
    // On success we stay in 'sent'/'verifying' until onChange flips `account` to signed-in and re-renders us
    // into that branch; only surface an error on failure.
    if (!res.ok) { setStatus('sent'); setError(res.error ?? 'That code didn’t work. Try again.'); }
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
        ) : status === 'sent' || status === 'verifying' ? (
          <div className="acctpanel-body">
            <p className="acctpanel-lead">Enter your code.</p>
            <p className="acctpanel-note">
              We emailed a code to <b>{email}</b>. Type it below to finish — your current progress upgrades to
              that account, nothing is lost. (On the web you can click the link in the email instead.)
            </p>
            <input
              className="acctinput acctpanel-input acctpanel-code"
              type="text"
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              // Supabase's email OTP length is configurable (6–10 digits) — don't cap at 6, or a longer code
              // gets silently truncated and can never match (owner hit an 8-digit code, 2026-08-10).
              maxLength={10}
              placeholder="Your code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter') void verify(); }}
            />
            {error && <p className="acctpanel-error" role="alert">{error}</p>}
            <button
              className="acctpanel-btn primary pressable"
              onClick={() => void verify()}
              disabled={status === 'verifying' || code.length < 6}
            >
              {status === 'verifying' ? 'Verifying…' : 'Verify & sign in'}
            </button>
            <button className="acctpanel-btn ghost pressable" onClick={() => { setStatus('idle'); setError(null); setCode(''); }}>
              Use a different email
            </button>
          </div>
        ) : (
          <div className="acctpanel-body">
            <p className="acctpanel-lead">Save your progress.</p>
            <p className="acctpanel-note">
              Right now your run history and rating live only on this device — clearing data or switching
              machines loses them. Add your email and we’ll send a one-time code; no password needed.
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
              onKeyDown={(e) => { if (e.key === 'Enter') void send(); }}
            />
            {error && <p className="acctpanel-error" role="alert">{error}</p>}
            <button
              className="acctpanel-btn primary pressable"
              onClick={() => void send()}
              disabled={status === 'sending' || !email.trim()}
            >
              {status === 'sending' ? 'Sending…' : 'Email me a code'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
