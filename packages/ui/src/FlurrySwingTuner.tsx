import { useState } from 'react';
import {
  FSW_NUM_KEYS, FSW_COLOR_KEYS, FSW_RANGES, FSW_DESC,
  getFlurrySwingConfig, resetFlurrySwingConfig, setFlurrySwingValue, type FlurrySwingConfig,
} from './flurrySwingConfig';
import { useDraggablePanel } from './useDraggablePanel';
import { pixiFx } from './pixiFx';

/**
 * DEV-only "Flurry Swing FX" tuner — the one-shot wind-slash sparkle a Flurry (W) minion fires on its extra
 * swing (`flurrySwingConfig` → `pixiFx.windSlash`): crescent wind-blades, a sparkle cone, and a soft glow.
 * Slider dials + colour pickers persist to localStorage and apply to the NEXT swing. **Test** fires it at
 * screen centre so it can be dialed without a real Flurry fight. "Copy" grabs the JSON to bake as the shipped
 * defaults; "Reset" clears. Dev-only — stripped from production.
 */
const LABELS: Record<keyof FlurrySwingConfig, string> = {
  power: 'power',
  slashCount: 'blade count',
  slashSize: 'blade size',
  slashLife: 'blade life ms',
  slashSpeed: 'blade speed',
  slashSpread: 'blade spread°',
  slashColor: 'blade colour',
  sparkCount: 'spark count',
  sparkSpeed: 'spark speed',
  sparkLife: 'spark life ms',
  sparkSize: 'spark size',
  sparkSpread: 'spark spread°',
  sparkColor: 'spark colour',
  glowSize: 'glow size',
  glowAlpha: 'glow α',
  glowColor: 'glow colour',
};

export function FlurrySwingTuner() {
  const [cfg, setCfg] = useState<FlurrySwingConfig>(getFlurrySwingConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('flurryswing');

  const set = (k: keyof FlurrySwingConfig, v: number | string): void => { setFlurrySwingValue(k, v); setCfg({ ...getFlurrySwingConfig() }); };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getFlurrySwingConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetFlurrySwingConfig(); setCfg({ ...getFlurrySwingConfig() }); };

  return (
    <div className="sfxmix lunge" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Flurry Swing FX <span>dev · next swing · drag</span></div>
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={() => pixiFx.testFlurry()}>🌬️ Test</button>
      </div>
      {FSW_NUM_KEYS.map((k) => {
        const [min, max, step] = FSW_RANGES[k];
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name" title={FSW_DESC[k]}>{LABELS[k]}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k] as number} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{cfg[k]}</span>
          </div>
        );
      })}
      {FSW_COLOR_KEYS.map((k) => (
        <div className="sfxmix-row" key={k}>
          <span className="sfxmix-name" title={FSW_DESC[k]}>{LABELS[k]}</span>
          <input type="color" value={cfg[k] as string} onChange={(e) => set(k, e.target.value)} />
          <span className="sfxmix-val">{cfg[k]}</span>
        </div>
      ))}
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
