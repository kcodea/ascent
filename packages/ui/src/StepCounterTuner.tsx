import { useState } from 'react';
import { SC_KEYS, SC_RANGES, getStepCounterConfig, resetStepCounterConfig, setStepCounterValue, type StepCounterConfig } from './stepCounterConfig';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only tuner for the STEP COUNTER — the white "X/N" numbers under a step-scaler card (Guel, Tara, Avenge
 * units, …). Drag the sliders to dial the number SIZE and its X / Y placement below the card; values write to CSS
 * variables live, so any on-board counter updates immediately (put an Avenge unit / Guel on your board to watch).
 * "Copy" grabs the JSON; to SHIP a look, paste the values back as the CSS fallbacks in styles.css (`.stepcounter`
 * `font-size` / `left` / `bottom`). "Reset" clears to defaults. Opened from the Dev Tuning Menu; dev-only.
 */
const LABELS: Record<keyof StepCounterConfig, string> = {
  size: 'text size (px)',
  x: 'x offset (px)',
  y: 'y / below (px)',
};

export function StepCounterTuner() {
  const [cfg, setCfg] = useState<StepCounterConfig>(getStepCounterConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('stepcounter');

  const set = (k: keyof StepCounterConfig, v: number): void => {
    setStepCounterValue(k, v); // writes CSS vars live
    setCfg({ ...getStepCounterConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getStepCounterConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetStepCounterConfig(); setCfg({ ...getStepCounterConfig() }); };

  return (
    <div className="sfxmix lunge float-tuner" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Step Counter <span>dev · live · drag</span></div>
      {SC_KEYS.map((k) => {
        const [min, max, step] = SC_RANGES[k];
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
