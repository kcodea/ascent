import { useState } from 'react';
import { DRAG_KEYS, DRAG_RANGES, DRAG_DESC, getDragFeel, resetDragFeel, setDragValue, type DragFeel } from './dragFeel';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only floating tuner for the weighted card-drag feel (`dragFeel.ts`). Drag the sliders to dial the
 * lag (`follow` — lower = heavier), the tilt lean (`tiltPerPx`), the tilt cap (`tiltMax`), and the 3D
 * `perspective` by eye while dragging a card — values persist to localStorage and apply live (the drag rAF
 * reads them every frame). "Copy" grabs the JSON to paste back as the shipped defaults in `dragFeel.ts`;
 * "Reset" clears to defaults. Mounted only in dev (see Game.tsx), so it's stripped from production.
 */
const LABELS: Record<keyof DragFeel, string> = {
  follow: 'lag (lower=heavier)',
  tiltPerPx: 'tilt lean',
  tiltMax: 'tilt cap',
  tiltDir: 'tilt dir (±)',
  perspective: 'perspective',
  scale: 'hold scale',
  staticRotate: 'static angle',
  threshold: 'drag threshold',
  snapMs: 'snap-back ms',
  magSlideMs: 'magnet-slide ms',
};

export function DragTuner() {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState<DragFeel>(getDragFeel());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('dragfeel');

  const set = (k: keyof DragFeel, v: number): void => {
    setDragValue(k, v);
    setCfg({ ...getDragFeel() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getDragFeel(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetDragFeel(); setCfg({ ...getDragFeel() }); };

  return (
    <>
      <button className="dragfeel-btn" onClick={() => setOpen((o) => !o)} title="Card-drag feel tuner (dev)">🎴</button>
      {open && (
        <div className="sfxmix lunge dragfeel" ref={panelRef} style={panelStyle}>
          <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Drag Feel <span>dev · live · drag a card</span></div>
          {DRAG_KEYS.map((k) => {
            const [min, max, step] = DRAG_RANGES[k];
            return (
              <div className="sfxmix-row" key={k}>
                <span className="sfxmix-name" title={DRAG_DESC[k]}>{LABELS[k]}</span>
                <input type="range" min={min} max={max} step={step} value={cfg[k]} onChange={(e) => set(k, Number(e.target.value))} />
                <span className="sfxmix-val">{cfg[k]}</span>
              </div>
            );
          })}
          <div className="lunge-btns">
            <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
            <button className="sfxmix-copy" onClick={reset}>Reset</button>
          </div>
        </div>
      )}
    </>
  );
}
