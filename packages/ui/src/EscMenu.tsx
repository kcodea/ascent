/** Pause / settings overlay (Esc). Trimmed to what players actually need: audio (master volume + mute), the
 *  local-data resets (captured boards + career), Quit back to the main menu, and — in the Electron shell only
 *  — a fullscreen toggle + Quit game (see `desktop.ts`; the web build has no shell to close). Resolution, board picker, board
 *  dimming, and combat speed were removed (2026-07-14) — the game now fills the window at a fixed 16:9 with one
 *  board, and combat runs at a single speed. The HUD's quick-mute sits behind the enemy frame, so the dependable
 *  audio controls live here, in a modal nothing can obscure. */

import { useState } from 'react';
import { BOARDS, getBoard, setBoard, type BoardId } from './boardConfig';
import { isDesktop, quitGame, toggleFullscreen } from './desktop';
import { getVolume, isMuted, setVolume, sfx, toggleMute } from './sfx';
import { useGame } from './store';

export function EscMenu({ onClose }: { onClose: () => void }) {
  const openTitle = useGame((s) => s.openTitle);
  // Audio is owned by sfx.ts (persisted to localStorage); mirror it into local state so the slider +
  // mute button re-render as they change. Dragging the slider previews the level on release.
  const [vol, setVol] = useState(getVolume());
  const [muted, setMuted] = useState(isMuted());
  // Arena board pick (display-only, persisted in localStorage) — swaps the `--board` backdrop live.
  const [board, setBoardSel] = useState<BoardId>(getBoard());
  const pickBoard = (id: BoardId): void => { setBoard(id); setBoardSel(id); sfx.pulse(); };
  // Combat pacing — how fast the combat replay animates (owner moved this here from the in-combat HUD
  // 2026-08-11). Live store value; the arena's beat clock + CSS read it.
  const combatSpeed = useGame((s) => s.combatSpeed);
  const setCombatSpeed = useGame((s) => s.setCombatSpeed);
  const combatRampUp = useGame((s) => s.combatRampUp);
  const setCombatRampUp = useGame((s) => s.setCombatRampUp);
  // Desktop only (see desktop.ts): the browser build has no shell to close. Two-tap confirm —
  // closing the app mid-run is the most destructive button in here.
  const [confirmQuit, setConfirmQuit] = useState(false);

  return (
    <div className="escov" onPointerDown={onClose}>
      <div className="escpanel" onPointerDown={(e) => e.stopPropagation()}>
        <div className="esch disp">Settings</div>
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
        <div className="escsec">Board</div>
        <div className="escboardpick">
          {BOARDS.map((b) => (
            <button
              key={b.id}
              className={`escbtn pressable${board === b.id ? ' on' : ''}`}
              onPointerDown={() => pickBoard(b.id)}
              aria-pressed={board === b.id}
            >
              <span className="ebl">{b.label}{board === b.id ? ' ✓' : ''}</span>
              <span className="ebs">{b.blurb}</span>
            </button>
          ))}
        </div>
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
        <div className="escsec">Run</div>
        {/* Back to the main menu — the run stays saved (Continue resumes it); it does NOT abandon the run. */}
        <button
          className="escbtn pressable"
          onPointerDown={() => { openTitle(); onClose(); }}
        >
          <span className="ebl">Quit back to main menu</span>
          <span className="ebs">Your run stays saved — Continue resumes it</span>
        </button>
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
