/** Pause / settings overlay (Esc). Trimmed to what players actually need: audio (master volume + mute), combat
 *  pacing, the local-data resets (captured boards + career), Quit back to the main menu, and — in the Electron
 *  shell only — a fullscreen toggle + Quit game (see `desktop.ts`; the web build has no shell to close).
 *
 *  The ARENA BOARD PICKER is gone (owner ask 2026-08-22). It offered three backdrops; the game ships one, and
 *  `boardConfig.ts` — whose only consumers were this menu and a side-effect import — was retired with it, so
 *  the stylesheet's `--board` is now the single source of the arena art. Resolution and board dimming went the
 *  same way in 2026-07-14. The HUD's quick-mute sits behind the enemy frame, so the dependable audio controls
 *  live here, in a modal nothing can obscure. */

import { useState } from 'react';
import { isDesktop, quitGame, toggleFullscreen } from './desktop';
import { getVolume, isMuted, setVolume, sfx, toggleMute } from './sfx';
import { useGame } from './store';
import { FPS_CAP_OPTIONS, fpsCapLabel } from './fpsCap';
import { perfThresholds } from './perfMonitor';
import { endReplay } from './replay/replayPlayer';

export function EscMenu({ onClose }: { onClose: () => void }) {
  const openTitle = useGame((s) => s.openTitle);
  const replaying = useGame((s) => s.replaying);
  // Audio is owned by sfx.ts (persisted to localStorage); mirror it into local state so the slider +
  // mute button re-render as they change. Dragging the slider previews the level on release.
  const [vol, setVol] = useState(getVolume());
  const [muted, setMuted] = useState(isMuted());
  // Combat pacing — how fast the combat replay animates (owner moved this here from the in-combat HUD
  // 2026-08-11). Live store value; the arena's beat clock + CSS read it.
  const combatSpeed = useGame((s) => s.combatSpeed);
  const setCombatSpeed = useGame((s) => s.setCombatSpeed);
  const combatRampUp = useGame((s) => s.combatRampUp);
  const setCombatRampUp = useGame((s) => s.setCombatRampUp);
  const fpsCap = useGame((s) => s.fpsCap);
  const setFpsCap = useGame((s) => s.setFpsCap);
  const displayHz = perfThresholds().refreshHz;
  // Desktop only (see desktop.ts): the browser build has no shell to close. Two-tap confirm —
  // closing the app mid-run is the most destructive button in here.
  const [confirmQuit, setConfirmQuit] = useState(false);

  return (
    <div className="escov" onPointerDown={onClose}>
      <div className="escpanel" onPointerDown={(e) => e.stopPropagation()}>
        <div className="esch disp">Settings</div>
        <div className="escsec">{replaying ? 'Replay' : 'Run'}</div>
        {/* SAVE & QUIT — promoted to the top and styled as the primary action (owner ask 2026-08-24). The
            run is already saved continuously; this button makes that explicit and one obvious tap. During a
            REPLAY the quit path must END THE PLAYBACK first (owner report 2026-08-19: quitting left the replay
            HUD floating over the title) — endReplay restores the snapshot, then opening the title wins. */}
        {replaying ? (
          <button
            className="escbtn escbtn-primary pressable"
            onPointerDown={() => { endReplay(); openTitle(); onClose(); }}
          >
            <span className="ebl">Leave replay</span>
            <span className="ebs">Back to the main menu — the replay closes</span>
          </button>
        ) : (
          <button
            className="escbtn escbtn-primary pressable"
            onPointerDown={() => { openTitle(); onClose(); }}
          >
            <span className="ebl">Save &amp; Quit</span>
            <span className="ebs">Saves this exact moment and returns to the menu — Continue picks up right here</span>
          </button>
        )}
        <div className="escsec">Audio</div>
        <div className="escvol">
          <span className="evl">Volume</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(vol * 100)}
            disabled={muted}
            aria-label="Master volume"
            onChange={(e) => {
              const v = Number(e.target.value) / 100;
              setVol(v);
              setVolume(v);
            }}
            onPointerUp={() => sfx.buy()}
          />
          <span className="evv">{muted ? 'Off' : `${Math.round(vol * 100)}`}</span>
        </div>
        <button
          className={`escbtn pressable${muted ? ' on' : ''}`}
          onPointerDown={() => setMuted(toggleMute())}
        >
          <span className="ebl">{muted ? 'Muted' : 'Sound on'}</span>
          <span className="ebs">{muted ? 'All audio is off' : 'Tap to mute everything'}</span>
        </button>
        <div className="escsec">Combat</div>
        <div className="escvol">
          <span className="evl">{combatRampUp ? 'Start speed' : 'Speed'}</span>
          <input
            type="range"
            min={0.5}
            max={5}
            step={0.1}
            value={combatSpeed}
            aria-label="Combat replay speed"
            onChange={(e) => setCombatSpeed(Number(e.target.value))}
          />
          <span className="evv">{combatSpeed.toFixed(1)}×</span>
        </div>
        <button
          className={`escbtn pressable${combatRampUp ? ' on' : ''}`}
          onPointerDown={() => { setCombatRampUp(!combatRampUp); sfx.pulse(); }}
          aria-pressed={combatRampUp}
        >
          <span className="ebl">Auto-ramp speed{combatRampUp ? ' ✓' : ''}</span>
          <span className="ebs">Long fights speed up, then ease back down for the finish</span>
        </button>
        <div className="escsec">Performance</div>
        {/* EFFECTS FRAME CAP (owner ask 2026-09-04; relabelled the same day). Caps the Pixi effects + GSAP clocks
            ONLY — CSS (hover, drag, fly-ins, floats, the wipe) runs at the display refresh and the app has no lever
            over it (Electron caps frame rate for offscreen windows only). The owner expected a whole-game 60 fps on a
            360 Hz display and saw no change, hence the note pointing at the GPU driver's per-app limit. An option
            above the display's refresh does nothing — the window is vsynced. "Display" = uncapped. */}
        <div className="escfps" role="radiogroup" aria-label="Effects frame cap">
          {FPS_CAP_OPTIONS.map((cap) => (
            <button
              key={cap}
              className={`escbtn pressable escfpsopt${fpsCap === cap ? ' on' : ''}${cap > 0 && displayHz > 0 && cap > displayHz + 1 ? ' dim' : ''}`}
              onPointerDown={() => { if (fpsCap !== cap) { setFpsCap(cap); sfx.pulse(); } }}
              role="radio"
              aria-checked={fpsCap === cap}
            >
              <span className="ebl">{fpsCapLabel(cap, displayHz)}</span>
            </button>
          ))}
        </div>
        <div className="escnote">Effects frame cap — combat effects and card motion only; the rest of the game runs at your display's refresh. To cap the whole game, use your GPU driver's per-app frame limit. Options above your display's refresh have no effect.</div>
        {/* Desktop shell only. The run is saved continuously, so closing the app loses nothing — but it is
            still the one button that ends the session, hence the confirm. */}
        {isDesktop() && (
          <>
            <div className="escsec">Game</div>
            <button
              className="escbtn pressable"
              onPointerDown={() => { toggleFullscreen(); }}
            >
              <span className="ebl">Toggle fullscreen</span>
              <span className="ebs">Borderless fullscreen by default — F11 does the same</span>
            </button>
            <button
              className={`escbtn pressable${confirmQuit ? ' danger' : ''}`}
              onPointerDown={() => { if (!confirmQuit) { setConfirmQuit(true); return; } quitGame(); }}
            >
              <span className="ebl">{confirmQuit ? 'Tap again to quit' : 'Quit game'}</span>
              <span className="ebs">Closes ASCENT — your run stays saved</span>
            </button>
          </>
        )}
        <button className="escclose pressable" onPointerDown={onClose}>Resume</button>
      </div>
    </div>
  );
}
