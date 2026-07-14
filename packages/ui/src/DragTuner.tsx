import { useEffect, useState } from 'react';
import { DRAG_KEYS, DRAG_RANGES, DRAG_DESC, getDragFeel, resetDragFeel, setDragValue, type DragFeel } from './dragFeel';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only floating tuner for the weighted card-drag feel (`dragFeel.ts`). Drag the sliders to dial the
 * lag (`follow` — lower = heavier), the tilt lean (`tiltPerPx`), the tilt cap (`tiltMax`), and the 3D
 * `perspective` by eye while dragging a card — values persist to localStorage and apply live (the drag rAF
 * reads them every frame). "Copy" grabs the JSON to paste back as the shipped defaults in `dragFeel.ts`;
 * "Reset" clears to defaults. Panel-only: opened from the Dev Tuning Menu (DevMenu.tsx); dev-only, so
 * it's stripped from production.
 */
const LABELS: Record<keyof DragFeel, string> = {
  follow: 'lag (lower=heavier)',
  tiltPerPx: 'tilt lean',
  tiltMax: 'tilt cap',
  hLean: 'horiz lean (±flip)',
  vLean: 'vert lean (±flip)',
  perspective: 'perspective',
  scale: 'hold scale',
  staticRotate: 'static angle',
  threshold: 'drag threshold',
  recenter: 'recenter speed',
  recenterAfter: 'recenter after px',
  snapMs: 'snap-back ms',
  magSlideMs: 'magnet-slide ms',
  collapseY: 'row collapse px',
  handFloor: 'hand pop floor',
  shGrow: 'drag shadow · grow',
  shLift: 'drag shadow · lift',
  shBlur: 'drag shadow · blur',
  shFade: 'drag shadow · fade',
};

export function DragTuner() {
  const [cfg, setCfg] = useState<DragFeel>(getDragFeel());
  const [copied, setCopied] = useState(false);
  // Preview pins the "drag shadow" onto every RESTING card (`body.dsh-preview`), so the shGrow/shLift/shBlur/shFade
  // sliders can be dialed live without holding a card down (one pointer can't drag a card AND a slider).
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    document.body.classList.toggle('dsh-preview', preview);
    return () => document.body.classList.remove('dsh-preview');
  }, [preview]);
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
    <div className="sfxmix lunge dragfeel" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Drag Feel <span>dev · live · drag a card</span></div>
      <div className="sfxmix-row">
        <span className="sfxmix-name" title="Pin the drag shadow onto every resting card so the 4 'drag shadow' sliders can be tuned live (you can't hold a card and a slider at once).">preview drag shadow</span>
        <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} />
        <span className="sfxmix-val">{preview ? 'on' : 'off'}</span>
      </div>
      {DRAG_KEYS.map((k) => {
        const range = DRAG_RANGES[k];
        if (!range) return null; // guard a transient HMR desync (keys vs ranges) so it can't blank the app
        const [min, max, step] = range;
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
  );
}
