/**
 * "UPDATE READY" (desktop auto-update, spec 2026-11-04): a small toast shown once the desktop shell has finished
 * downloading an update in the background. Information only: the update installs at the NEXT launch (behind the
 * shell's own "Installing update" screen), never mid-game, so there is no button. It takes no pointer input, fades
 * itself after a while, and does nothing in the browser build.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { onUpdateReady } from './desktop';
import { stageHost } from './stage';
import './updatedPanel.css';

const SHOW_MS = 14000;

export function UpdateReadyNotice() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => onUpdateReady((v) => setVersion(v)), []);
  useEffect(() => {
    if (version === null) return undefined;
    const t = window.setTimeout(() => setVersion(null), SHOW_MS);
    return () => window.clearTimeout(t);
  }, [version]);
  if (version === null) return null;
  return createPortal(
    <div className="updnotice" role="status">Update v{version} downloaded. It installs next time you start Ascent.</div>,
    stageHost(),
  );
}
