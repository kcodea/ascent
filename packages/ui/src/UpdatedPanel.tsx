/**
 * "UPDATED TO vX" (desktop auto-update, spec 2026-11-04): the first time the title shows after the desktop app moved
 * to a new version, a panel over the title lists what shipped since the build the player last saw, with a Continue
 * that marks it seen. Desktop only (`shouldShowUpdated`). The very first desktop launch shows nothing and just records
 * the build, so the NEXT version shows the panel. Portaled into the scaled stage.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { isDesktop } from './desktop';
import { retryImport } from './retryImport';
import { sfx } from './sfx';
import { stageHost } from './stage';
import { readUpdateSeen, shouldShowUpdated, writeUpdateSeen } from './updateNotes';
import './updatedPanel.css';

const UpdatedNotes = lazy(() => retryImport(() => import('./UpdatedNotes')));

const currentBuild = () => ({ version: __APP_VERSION__, buildDate: __BUILD_DATE__.slice(0, 10) });

export function UpdatedPanel() {
  const [seen] = useState(readUpdateSeen);
  const [open, setOpen] = useState(() => shouldShowUpdated(seen, __APP_VERSION__));

  const dismiss = (): void => { sfx.tick(); writeUpdateSeen(currentBuild()); setOpen(false); };

  // First ever desktop launch: nothing stored yet, so remember this build and show nothing.
  useEffect(() => { if (seen === null && isDesktop()) writeUpdateSeen(currentBuild()); }, [seen]);

  useEffect(() => {
    if (!open) return undefined;
    // Capture phase + stopImmediatePropagation: Game.tsx's own window Escape listener (opens Settings) must not also see it.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); e.stopImmediatePropagation(); dismiss();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="updpanel-scrim">
      <div className="updpanel" role="dialog" aria-modal="true" aria-label={`Updated to v${__APP_VERSION__}`}>
        <h2 className="updpanel-title">Updated to v{__APP_VERSION__}</h2>
        <p className="updpanel-sub">Here is what changed since you last played.</p>
        <div className="updpanel-notes">
          <Suspense fallback={null}>
            <UpdatedNotes since={seen?.buildDate ?? null} />
          </Suspense>
        </div>
        <button type="button" className="updpanel-go" onClick={dismiss}>Continue</button>
      </div>
    </div>,
    stageHost(),
  );
}
