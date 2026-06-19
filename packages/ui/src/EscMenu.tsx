/** Pause / settings overlay (Esc). Houses the display resolution scaler (pick a fixed 16:9 / 21:9
 *  box the game letterboxes into, or fill the window — the choice persists) and Start Over. */

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
  return (
    <div className="escov" onPointerDown={onClose}>
      <div className="escpanel" onPointerDown={(e) => e.stopPropagation()}>
        <div className="esch disp">Settings</div>
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
