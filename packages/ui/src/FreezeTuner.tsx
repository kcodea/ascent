import { useState } from 'react';
import {
  FRZ_NUM_KEYS,
  FRZ_RANGES,
  FRZ_DESC,
  getFreezeConfig,
  resetFreezeConfig,
  setFreezeValue,
  type FreezeConfig,
} from './freezeConfig';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only tuner for the FREEZE button's placement (`freezeConfig.ts` / `FreezeButton.tsx`).
 *
 * Position + scale only, on purpose: the freeze ART isn't in yet, so glow/sheen/press dials would have
 * nothing to act on. It grows to match the 🔄 Refresh tuner once the art lands.
 *
 * Values persist to localStorage (dev only); "Copy values" grabs the JSON to bake into DEFAULTS + the
 * styles.css fallbacks. Opened from the Dev Tuning Menu; dev-only, so it's stripped from production.
 */
const LABELS: Record<keyof FreezeConfig, string> = {
  x: 'position · x',
  y: 'position · y',
  scale: 'scale',
};

export function FreezeTuner() {
  const [cfg, setCfg] = useState<FreezeConfig>(getFreezeConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('freezebtn');

  const set = (k: keyof FreezeConfig, v: number): void => {
    setFreezeValue(k, v);
    setCfg({ ...getFreezeConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getFreezeConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetFreezeConfig(); setCfg({ ...getFreezeConfig() }); };

  return (
    <div className="sfxmix lunge flip" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Freeze <span>dev · live · drag</span></div>
      <div className="sfxmix-sub">Placement only — art pending</div>
      {FRZ_NUM_KEYS.map((k) => {
        const [min, max, step] = FRZ_RANGES[k];
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name" title={FRZ_DESC[k]}>{LABELS[k]}</span>
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
