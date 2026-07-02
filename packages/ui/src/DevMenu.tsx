import { useState } from 'react';
import { SfxMixer } from './SfxMixer';
import { LungeTuner } from './LungeTuner';
import { TauntTuner } from './TauntTuner';
import { DragTuner } from './DragTuner';
import { FlipTuner } from './FlipTuner';
import { ShieldTuner } from './ShieldTuner';
import { TrailTuner } from './TrailTuner';
import { pixiFx } from './pixiFx';

/**
 * DEV-only Dev Tuning Menu — the single 🛠️ button that replaces the old row of floating tuner buttons.
 * Opens a compact list; each entry toggles one tuner panel (the panels themselves are unchanged: draggable,
 * localStorage-backed). "Test FX" stays a one-shot action. Mounted only in dev (see Game.tsx), so the whole
 * menu — and every tuner — is stripped from production.
 */
const TUNERS = [
  { key: 'sfx', label: '🔊 SFX Mixer', C: SfxMixer },
  { key: 'lunge', label: '🗡️ Lunge', C: LungeTuner },
  { key: 'taunt', label: '🛡️ Taunt', C: TauntTuner },
  { key: 'drag', label: '🎴 Drag Feel', C: DragTuner },
  { key: 'flip', label: '🔀 Reposition', C: FlipTuner },
  { key: 'shield', label: '🛡 Shield Place', C: ShieldTuner },
  { key: 'trail', label: '💨 Trail', C: TrailTuner },
] as const;

export function DevMenu() {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<Set<string>>(new Set());

  const toggle = (key: string): void =>
    setShown((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <>
      <button className="devmenu-btn" onClick={() => setOpen((o) => !o)} title="Dev tuning menu">🛠️</button>
      {open && (
        <div className="devmenu">
          <div className="devmenu-h">Dev Tuning</div>
          {TUNERS.map(({ key, label }) => (
            <button key={key} className={`devmenu-item${shown.has(key) ? ' on' : ''}`} onClick={() => toggle(key)}>
              {label} <span>{shown.has(key) ? '✓' : ''}</span>
            </button>
          ))}
          <button className="devmenu-item" onClick={() => pixiFx.test()}>✨ Test FX <span>▸</span></button>
        </div>
      )}
      {TUNERS.map(({ key, C }) => (shown.has(key) ? <C key={key} /> : null))}
    </>
  );
}
