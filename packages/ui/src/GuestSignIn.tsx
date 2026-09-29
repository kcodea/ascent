import { useEffect, useRef } from 'react';
import { useGame } from './store';
import { sfx } from './sfx';
import { Icon } from './Icon';
import { remoteEnabled } from './remoteBoards';
import './progression/collection.css';

/**
 * GUEST SIGN-IN (owner ask 2026-09-29: "add a "sign in!" button that slow flashes/blinks in the top right to the left
 * of the player icon/name. don't let non-signed in players change the portrait either, they need to sign in for
 * that."). Friends-and-family testing: the goal is getting guests to make an account so progression sticks.
 *
 * Two pieces, both client-side only (owner: no server checks for this):
 *  - `GuestSignInButton`: the slow-blinking "Sign in!" button seated left of the title's account corner. Guests only;
 *    it disappears the moment the account stops being anonymous (the identity change lands in the store, no reload).
 *  - `PortraitSignInGate`: what a guest's click on their portrait opens instead of the avatar picker.
 *
 * "Accounts available" = an account backend is configured AND this device holds a session (a user id). Without one
 * the account panel cannot work, so the button hides and the gate says accounts are unavailable (the crate sign-in
 * gate's rule).
 */
export function accountsAvailable(userId: string | null): boolean {
  return remoteEnabled() && !!userId;
}

/** The blinking "Sign in!" button. A real `.guestsignin-glow` element carries a STATIC glow whose OPACITY breathes
 *  (compositor-only, the `kwglow` recipe); the button itself never animates a paint property. */
export function GuestSignInButton(): JSX.Element | null {
  const anonymous = useGame((s) => s.account.anonymous);
  const userId = useGame((s) => s.account.userId);
  const openAccountPanel = useGame((s) => s.openAccountPanel);
  if (!anonymous || !accountsAvailable(userId)) return null;
  return (
    <div className="guestsignin-seat">
      <button
        type="button"
        className="guestsignin"
        aria-label="Sign in to save your progress"
        onClick={() => { sfx.pulse(); openAccountPanel(); }}
      >
        <span className="guestsignin-glow" aria-hidden="true" />
        <span className="guestsignin-txt">Sign in!</span>
      </button>
    </div>
  );
}

/**
 * The portrait sign-in gate: a guest who clicks their portrait lands here, never in the avatar picker. Create account
 * closes this and opens the account panel (which upgrades the guest in place); Not now, Esc and a click outside
 * close it. Once the account is real this closes itself and the portrait opens the picker as normal.
 * Styling reuses the New rewards pop-up's shell (`nrw-*`), the same family as the crate sign-in gate.
 */
export function PortraitSignInGate({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const anonymous = useGame((s) => s.account.anonymous);
  const userId = useGame((s) => s.account.userId);
  const openAccountPanel = useGame((s) => s.openAccountPanel);
  const primaryRef = useRef<HTMLButtonElement>(null);

  // The guest became a real account while this was up: nothing left to ask.
  useEffect(() => { if (open && !anonymous) onClose(); }, [open, anonymous, onClose]);

  useEffect(() => {
    if (!open) return;
    primaryRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      sfx.tick();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open || !anonymous) return null;

  const available = accountsAvailable(userId);
  const create = (): void => { sfx.pulse(); onClose(); openAccountPanel(); };
  const notNow = (): void => { sfx.tick(); onClose(); };

  return (
    <div className="nrw-scrim" onPointerDown={notNow}>
      <section className="nrw-panel pfgate-panel" role="dialog" aria-modal="true" aria-labelledby="pfgate-title" onPointerDown={(e) => e.stopPropagation()}>
        <header className="nrw-head">
          <span className="nrw-title" id="pfgate-title"><Icon name="crown" />{available ? 'Sign in to change your portrait' : 'Accounts are unavailable'}</span>
        </header>
        {available ? (
          <div className="pfgate-body">
            <p className="pfgate-lead">Picking a portrait is part of your free account.</p>
            <p className="nrw-note">It is free and takes a minute. You only need an email.</p>
          </div>
        ) : (
          <div className="pfgate-body">
            <p className="pfgate-lead">You need an account to change your portrait, and accounts cannot be reached right now.</p>
            <p className="nrw-note">Try again later.</p>
          </div>
        )}
        <footer className="nrw-foot pfgate-foot">
          {available ? (
            <>
              <button type="button" className="colls-quiet pressable quiet" onClick={notNow}>Not now</button>
              <button ref={primaryRef} type="button" className="cv2-btn pressable" onClick={create}>Create account</button>
            </>
          ) : (
            <button ref={primaryRef} type="button" className="cv2-btn pressable" onClick={notNow}>OK</button>
          )}
        </footer>
      </section>
    </div>
  );
}
