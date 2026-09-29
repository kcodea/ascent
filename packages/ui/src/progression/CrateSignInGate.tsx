import { useEffect, useRef } from 'react';
import { useGame } from '../store';
import { sfx } from '../sfx';
import { Icon } from '../Icon';
import { remoteEnabled } from '../remoteBoards';
import './collection.css';

/**
 * THE CRATE SIGN-IN GATE (owner ask 2026-09-29: "ask players not signed in to sign in when they try to open a
 * crate? we'd like players to create sign ins for account progression"; the owner chose a HARD gate).
 *
 * A guest (anonymous account) still EARNS crates and sees them sealed in the Collection, but every Open (the crate
 * bay's Open / Open all, the New rewards pop-up's Open) lands here instead of the crate theatre. The two ways out:
 * Create account (closes this, opens the existing account panel, which upgrades the guest IN PLACE so the crates
 * carry over) and Not now. Esc and a click outside close it too.
 *
 * The moment the account stops being a guest (the auth change lands) this closes itself, and the next Open goes
 * straight through: the caller reads `anonymous` fresh on every click, so there is no reload.
 *
 * No backend (an offline build, or the session could not be made): creating an account cannot work, so this says
 * accounts are unavailable right now instead of opening a panel that would only fail.
 *
 * Styling reuses the New rewards pop-up's shell (`nrw-*`) so the two read as one family.
 */
export function CrateSignInGate({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
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

  const available = remoteEnabled() && !!userId;
  const create = (): void => { sfx.pulse(); onClose(); openAccountPanel(); };
  const notNow = (): void => { sfx.tick(); onClose(); };

  return (
    <div className="nrw-scrim" onPointerDown={notNow}>
      <section className="nrw-panel crgate-panel" role="dialog" aria-modal="true" aria-labelledby="crgate-title" onPointerDown={(e) => e.stopPropagation()}>
        <header className="nrw-head">
          <span className="nrw-title" id="crgate-title"><Icon name="gift" />{available ? 'Create an account to open crates' : 'Accounts are unavailable'}</span>
        </header>
        {available ? (
          <div className="crgate-body">
            <p className="crgate-lead">Your crates, level and collection are saved to your account.</p>
            <p className="nrw-note">It is free and takes a minute. You only need an email.</p>
            <p className="crgate-warn">Already have an account? Signing in switches to it. Crates earned as a guest stay on this guest.</p>
          </div>
        ) : (
          <div className="crgate-body">
            <p className="crgate-lead">You need an account to open crates, and accounts cannot be reached right now.</p>
            <p className="nrw-note">Your crates stay sealed. Try again later.</p>
          </div>
        )}
        <footer className="nrw-foot crgate-foot">
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
