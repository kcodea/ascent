/** Pause / settings overlay (Esc). Houses audio (master volume + mute), the display resolution scaler
 *  (pick a fixed 16:9 / 21:9 box the game letterboxes into, or fill the window — the choice persists)
 *  and Start Over. The HUD's quick-mute button sits behind the enemy frame, so the dependable audio
 *  controls live here, in a modal nothing can obscure. */

import { useState } from 'react';
import { clearStoredBoards, loadStoredBoards } from './boardLibrary';
import { getVolume, isMuted, setVolume, sfx, toggleMute } from './sfx';
import { useGame } from './store';

export const RES_OPTIONS: { id: string; label: string; sub: string }[] = [
  { id: 'fit', label: 'Fit to Window', sub: 'Fill the screen' },
  { id: 'r1920', label: '1920 × 1080', sub: '16:9' },
  { id: 'r2560', label: '2560 × 1440', sub: '16:9' },
  { id: 'r3440', label: '3440 × 1440', sub: '21:9 ultrawide' },
];

export function EscMenu({
  res, onRes, scrim, onScrim, onClose,
}: {
  res: string;
  onRes: (r: string) => void;
  scrim: number;
  onScrim: (s: number) => void;
  onClose: () => void;
}) {
  const startHeroSelect = useGame((s) => s.startHeroSelect);
  const combatSpeed = useGame((s) => s.combatSpeed);
  const setCombatSpeed = useGame((s) => s.setCombatSpeed);
  // Audio is owned by sfx.ts (persisted to localStorage); mirror it into local state so the slider +
  // mute button re-render as they change. Dragging the slider previews the level on release.
  const [vol, setVol] = useState(getVolume());
  const [muted, setMuted] = useState(isMuted());
  // This browser's captured finished-run boards (boardLibrary, localStorage). Wipe them when they go stale
  // (e.g. after a balance patch). Two-tap confirm so it can't be a misclick. Doesn't touch the live shared
  // pool or the leaderboard — only this machine's local captures.
  const [boardCount, setBoardCount] = useState(() => loadStoredBoards().length);
  const [boardMsg, setBoardMsg] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const clearBoards = (): void => {
    if (!boardCount) { setBoardMsg('No boards to clear.'); return; }
    if (!confirmClear) { setConfirmClear(true); setBoardMsg(`Clear all ${boardCount} captured boards? Tap again to confirm.`); return; }
    clearStoredBoards();
    setBoardCount(0);
    setConfirmClear(false);
    setBoardMsg('Cleared your captured boards.');
  };

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
          className={`escbtn${muted ? ' on' : ''}`}
          onPointerDown={() => setMuted(toggleMute())}
        >
          <span className="ebl">{muted ? 'Muted' : 'Sound on'}</span>
          <span className="ebs">{muted ? 'All audio is off' : 'Tap to mute everything'}</span>
        </button>
        <div className="escsec">Gameplay</div>
        <div className="escvol">
          <span className="evl">Combat speed</span>
          <input
            type="range"
            min={0.5}
            max={5}
            step={0.1}
            value={combatSpeed}
            aria-label="Combat speed"
            onChange={(e) => setCombatSpeed(Number(e.target.value))}
          />
          <span className="evv">{combatSpeed.toFixed(1)}×</span>
        </div>
        <div className="escsec">Display Resolution</div>
        <div className="escres">
          {RES_OPTIONS.map((o) => (
            <button
              key={o.id}
              className={`escbtn${res === o.id ? ' on' : ''}`}
              onPointerDown={() => onRes(o.id)}
            >
              <span className="ebl">{o.label}</span>
              <span className="ebs">{o.sub}</span>
            </button>
          ))}
        </div>
        <div className="escsec">Board</div>
        <div className="escvol">
          <span className="evl">Board dimming</span>
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.05}
            value={scrim}
            aria-label="Board dimming"
            onChange={(e) => onScrim(Number(e.target.value))}
          />
          <span className="evv">{Math.round(scrim * 100)}%</span>
        </div>
        <div className="escsec">Saved Boards</div>
        <div className="escboards">
          <button className={`escbtn${confirmClear ? ' danger' : ''}`} onPointerDown={clearBoards}>
            <span className="ebl">{confirmClear ? 'Tap again to clear' : 'Clear my boards'}</span>
            <span className="ebs">{confirmClear ? `Wipes all ${boardCount} captures` : `${boardCount} saved · wipe stale captures`}</span>
          </button>
          {boardMsg && <div className="escboards-msg">{boardMsg}</div>}
        </div>
        <div className="escsec">Run</div>
        <button
          className="escbtn danger"
          onPointerDown={() => { startHeroSelect(); onClose(); }}
        >
          <span className="ebl">Start Over</span>
          <span className="ebs">Abandon this run + pick a new hero</span>
        </button>
        <button className="escclose" onPointerDown={onClose}>Resume</button>
      </div>
    </div>
  );
}
