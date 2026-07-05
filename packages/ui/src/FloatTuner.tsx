import { useState } from 'react';
import { FLOAT_KEYS, FLOAT_RANGES, getFloatConfig, resetFloatConfig, setFloatValue, type FloatConfig } from './floatConfig';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only floating tuner for the combat DAMAGE-number floats (the −N pills that pop over a struck unit).
 * Drag the sliders to dial size / pop punch / rise / entry by eye — values write to CSS variables live, so the
 * NEXT float shows the change (start a fight to watch). "Copy" grabs the JSON; to SHIP a look, paste the values
 * back as the CSS fallbacks in styles.css (`.float`, `.float.dmg`, `@keyframes floatup`). "Reset" clears to
 * defaults. Opened from the Dev Tuning Menu (DevMenu.tsx); dev-only, so it's stripped from production.
 */
const LABELS: Record<keyof FloatConfig, string> = {
  size: 'base size',
  dmgSize: 'damage size',
  durMs: 'duration',
  pop: 'pop overshoot',
  rise: 'rise (0=stuck)',
  inScale: 'entry scale',
  inY: 'entry drop',
};

export function FloatTuner() {
  const [cfg, setCfg] = useState<FloatConfig>(getFloatConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('float');

  const set = (k: keyof FloatConfig, v: number): void => {
    setFloatValue(k, v); // writes CSS vars live
    setCfg({ ...getFloatConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getFloatConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetFloatConfig(); setCfg({ ...getFloatConfig() }); };

  return (
    <div className="sfxmix lunge float-tuner" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Damage Float <span>dev · next float · drag</span></div>
      {FLOAT_KEYS.map((k) => {
        const [min, max, step] = FLOAT_RANGES[k];
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name">{LABELS[k]}</span>
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
