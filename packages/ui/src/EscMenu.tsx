/** Pause / settings overlay (Esc). Houses audio (master volume + mute), the display resolution scaler
 *  (pick a fixed 16:9 / 21:9 box the game letterboxes into, or fill the window — the choice persists)
 *  and Start Over. The HUD's quick-mute button sits behind the enemy frame, so the dependable audio
 *  controls live here, in a modal nothing can obscure. */

import { useRef, useState, type ChangeEvent } from 'react';
import { exportBoardsJson, importBoardsJson, loadStoredBoards } from './boardLibrary';
import { getVolume, isMuted, setVolume, sfx, toggleMute } from './sfx';
import { useGame } from './store';

export const RES_OPTIONS: { id: string; label: string; sub: string }[] = [
  { id: 'fit', label: 'Fit to Window', sub: 'Fill the screen' },
  { id: 'r1920', label: '1920 × 1080', sub: '16:9' },
  { id: 'r2560', label: '2560 × 1440', sub: '16:9' },
  { id: 'r3440', label: '3440 × 1440', sub: '21:9 ultrawide' },
];

export function EscMenu({
  res, onRes, onClose,
}: {
  res: string;
  onRes: (r: string) => void;
  onClose: () => void;
}) {
  const startHeroSelect = useGame((s) => s.startHeroSelect);
  const compactCards = useGame((s) => s.compactCards);
  const toggleCompact = useGame((s) => s.toggleCompact);
  const playerName = useGame((s) => s.playerName);
  const setPlayerName = useGame((s) => s.setPlayerName);
  // Audio is owned by sfx.ts (persisted to localStorage); mirror it into local state so the slider +
  // mute button re-render as they change. Dragging the slider previews the level on release.
  const [vol, setVol] = useState(getVolume());
  const [muted, setMuted] = useState(isMuted());
  // Shared boards: count of this browser's captured boards + a status line after export/import.
  const fileRef = useRef<HTMLInputElement>(null);
  const [boardCount, setBoardCount] = useState(() => loadStoredBoards().length);
  const [boardMsg, setBoardMsg] = useState<string | null>(null);

  const exportBoards = (): void => {
    if (!boardCount) { setBoardMsg('No boards yet — finish a run first.'); return; }
    const json = exportBoardsJson(playerName);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ascent-boards-${(playerName || 'me').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`;
    // Append before click + revoke on a delay: a detached <a> or an immediately-revoked URL gets the
    // download dropped in some browsers (and in itch's sandboxed iframe).
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    // itch embeds the game in a sandboxed iframe that can silently block file downloads — if we're framed,
    // tell the friend to use itch's fullscreen button (loads first-party, where downloads work).
    const framed = (() => { try { return window.self !== window.top; } catch { return true; } })();
    const sent = `Exported ${boardCount} board${boardCount === 1 ? '' : 's'}`;
    setBoardMsg(framed
      ? `${sent}. If no file downloaded, open the game fullscreen (the ⛶ button on itch) and export again.`
      : `${sent} — send the file to a friend.`);
  };
  const onImportFile = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-importing the same file
    if (!file) return;
    file.text().then((text) => {
      const res = importBoardsJson(text);
      if (res) {
        setBoardCount(res.total);
        setBoardMsg(`Imported ${res.imported} board${res.imported === 1 ? '' : 's'} — you'll face them now.`);
      } else {
        setBoardMsg("Couldn't read that file — is it an Ascent board export?");
      }
    });
  };

  return (
    <div className="escov" onPointerDown={onClose}>
      <div className="escpanel" onPointerDown={(e) => e.stopPropagation()}>
        <div className="esch disp">Settings</div>
        <div className="escsec">Player</div>
        <div className="escvol">
          <span className="evl">Name</span>
          <input
            type="text"
            className="escname"
            value={playerName}
            maxLength={24}
            placeholder="Anonymous"
            aria-label="Player name"
            onChange={(e) => setPlayerName(e.target.value)}
          />
        </div>
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
        <div className="escsec">Cards</div>
        <button
          className={`escbtn${compactCards ? ' on' : ''}`}
          onPointerDown={toggleCompact}
        >
          <span className="ebl">{compactCards ? 'Compact' : 'Full text'}</span>
          <span className="ebs">{compactCards ? 'Art + glyphs · details on hover' : 'Always-on rules text'}</span>
        </button>
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
        <div className="escsec">Shared Boards</div>
        <div className="escboards">
          <button className="escbtn" onPointerDown={exportBoards}>
            <span className="ebl">Export my boards</span>
            <span className="ebs">{boardCount} saved · download a file to share</span>
          </button>
          <button className="escbtn" onPointerDown={() => fileRef.current?.click()}>
            <span className="ebl">Import a friend's boards</span>
            <span className="ebs">Load their file — face their builds</span>
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={onImportFile} />
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
