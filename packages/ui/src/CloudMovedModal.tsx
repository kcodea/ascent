import { useGame } from './store';
import { sfx } from './sfx';
import { Icon } from './Icon';
import './progression/collection.css';

/**
 * CROSS-DEVICE SAVES (owner ask 2026-09-30, R-PERSIST-CLOUD-02): this device's copy of the run is out of date,
 * because the player continued it on another device (or it ended there). The server refused this device's save,
 * so nothing here overwrites the newer progress; the player loads the newer version or goes to the menu.
 * Full-screen and blocking by design: playing on would be playing a copy that can no longer be saved.
 * Reuses the New rewards pop-up shell (`nrw-*`), like the sign-in gates.
 */
export function CloudMovedModal(): JSX.Element | null {
  const moved = useGame((s) => s.cloudMoved);
  const resolve = useGame((s) => s.resolveCloudMoved);
  if (!moved) return null;
  const ended = moved.ended;
  return (
    <div className="nrw-scrim cloudmoved-scrim">
      <section className="nrw-panel pfgate-panel" role="alertdialog" aria-modal="true" aria-labelledby="cloudmoved-title">
        <header className="nrw-head">
          <span className="nrw-title" id="cloudmoved-title"><Icon name="crown" />{ended ? 'This game has ended' : 'Your game moved'}</span>
        </header>
        <div className="pfgate-body">
          <p className="pfgate-lead">
            {ended ? 'This game was finished on another device.' : 'You continued this game on another device.'}
          </p>
          <p className="nrw-note">
            {ended ? 'Its result is already counted.' : 'That copy is newer, so this one was not saved.'}
          </p>
        </div>
        <footer className="nrw-foot pfgate-foot">
          {ended ? (
            <button type="button" className="cv2-btn pressable" onClick={() => { sfx.pulse(); resolve('menu'); }}>Main menu</button>
          ) : (
            <>
              <button type="button" className="colls-quiet pressable quiet" onClick={() => { sfx.tick(); resolve('menu'); }}>Main menu</button>
              <button type="button" className="cv2-btn pressable" onClick={() => { sfx.pulse(); resolve('load'); }}>Load the newer game</button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
