/** Pause / settings overlay (Esc). Trimmed to what players actually need: audio (master volume + mute), the
 *  local-data resets (captured boards + career), and Quit back to the main menu. Resolution, board picker, board
 *  dimming, and combat speed were removed (2026-07-14) — the game now fills the window at a fixed 16:9 with one
 *  board, and combat runs at a single speed. The HUD's quick-mute sits behind the enemy frame, so the dependable
 *  audio controls live here, in a modal nothing can obscure. */

import { useState } from 'react';
import { clearStoredBoards, loadStoredBoards } from './boardLibrary';
import { loadRunHistory } from './runHistory';
import { getVolume, isMuted, setVolume, sfx, toggleMute } from './sfx';
import { useGame } from './store';

export function EscMenu({ onClose }: { onClose: () => void }) {
  const openTitle = useGame((s) => s.openTitle);
  const profile = useGame((s) => s.profile);
  const resetCareer = useGame((s) => s.resetCareer);
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
  // Reset the local career: rating (→ 0 / Line 7) + match history. Two-tap confirm — it can't be undone.
  // Doesn't touch captured boards or the shared pool/leaderboard (those are separate resets).
  const [runCount, setRunCount] = useState(() => loadRunHistory().length);
  const [careerMsg, setCareerMsg] = useState<string | null>(null);
  const [confirmCareer, setConfirmCareer] = useState(false);
  const doResetCareer = (): void => {
    if (!confirmCareer) { setConfirmCareer(true); setCareerMsg('Wipe rating, match history, insights + hero stats? Tap again to confirm.'); return; }
    resetCareer();
    setRunCount(0);
    setConfirmCareer(false);
    setCareerMsg('Career reset — rating, past games + all stats cleared.');
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
        <div className="escsec">Saved Boards</div>
        <div className="escboards">
          <button className={`escbtn${confirmClear ? ' danger' : ''}`} onPointerDown={clearBoards}>
            <span className="ebl">{confirmClear ? 'Tap again to clear' : 'Clear my boards'}</span>
            <span className="ebs">{confirmClear ? `Wipes all ${boardCount} captures` : `${boardCount} saved · wipe stale captures`}</span>
          </button>
          {boardMsg && <div className="escboards-msg">{boardMsg}</div>}
        </div>
        <div className="escsec">Career</div>
        <div className="escboards">
          <button className={`escbtn${confirmCareer ? ' danger' : ''}`} onPointerDown={doResetCareer}>
            <span className="ebl">{confirmCareer ? 'Tap again to reset' : 'Reset my career'}</span>
            <span className="ebs">{confirmCareer ? 'Wipes rating + past games + all stats' : `Rating ${profile.rating} · ${runCount} run${runCount === 1 ? '' : 's'} · wipes history + stats`}</span>
          </button>
          {careerMsg && <div className="escboards-msg">{careerMsg}</div>}
        </div>
        <div className="escsec">Run</div>
        {/* Back to the main menu — the run stays saved (Continue resumes it); it does NOT abandon the run. */}
        <button
          className="escbtn"
          onPointerDown={() => { openTitle(); onClose(); }}
        >
          <span className="ebl">Quit back to main menu</span>
          <span className="ebs">Your run stays saved — Continue resumes it</span>
        </button>
        <button className="escclose" onPointerDown={onClose}>Resume</button>
      </div>
    </div>
  );
}
