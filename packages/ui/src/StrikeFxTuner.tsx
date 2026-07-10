import { useState } from 'react';
import { STRIKEFX_KEYS, STRIKEFX_RANGES, getStrikeFxConfig, resetStrikeFxConfig, setStrikeFxValue, type StrikeFxConfig } from './strikeFxConfig';
import { SMOKE_RANGES, getSmokeConfig, setSmokeValue, type SmokeConfig } from './smokeConfig';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only "Lunge Strike Effects" tuner — the whole combat strike-impact package in one panel: the strike
 * point (center ↔ corner), the melee flash / shockwave / heavy ring / sparks (`strikeFxConfig` → `pixiFx.impact`),
 * plus the impact smoke + dust billow + energy pulse (which live in `smokeConfig` alongside the card-drop dust,
 * surfaced here so it's all dialed together). Drag the sliders to tune by eye — values persist to localStorage
 * and apply to the NEXT strike (watch a fight to judge). "Copy" grabs the merged JSON to paste back as the
 * shipped defaults; "Reset" clears the strike-FX config (the smoke/dust keys reset from the Smoke tuner). Panel-
 * only: opened from the Dev Tuning Menu; dev-only, so it's stripped from production.
 */
const STRIKE_LABELS: Record<keyof StrikeFxConfig, string> = {
  strikePoint: 'corner depth',
  flashSize: 'flash size',
  shockwaveSize: 'shockwave size',
  ringScale: 'heavy ring',
  sparkCount: 'spark count',
  sparkSpeed: 'spark speed',
  sparkSpread: 'spark spread°',
  sparkSize: 'spark size',
};

// The smoke / dust billow / energy pulse of a strike live in smokeConfig (shared with the card-drop dust);
// surface just the strike-relevant keys here so the whole package tunes in one panel.
const SMOKE_SUBSET: { key: keyof SmokeConfig; label: string }[] = [
  { key: 'smokeCount', label: 'smoke count' },
  { key: 'smokeRise', label: 'smoke rise' },
  { key: 'smokeDrift', label: 'smoke drift' },
  { key: 'smokeLife', label: 'smoke life ms' },
  { key: 'smokeGrow', label: 'smoke grow' },
  { key: 'smokeAlpha', label: 'smoke alpha' },
  { key: 'impDustCount', label: 'dust count' },
  { key: 'impDustSpeed', label: 'dust speed' },
  { key: 'impDustLife', label: 'dust life ms' },
  { key: 'impDustSize', label: 'dust size' },
  { key: 'impPulseRadius', label: 'pulse radius' },
  { key: 'impPulseDur', label: 'pulse time ms' },
  { key: 'impPulseRings', label: 'pulse rings' },
];

export function StrikeFxTuner() {
  const [sfxCfg, setSfxCfg] = useState<StrikeFxConfig>(getStrikeFxConfig());
  const [smCfg, setSmCfg] = useState<SmokeConfig>(getSmokeConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('strikefx');

  const setStrike = (k: keyof StrikeFxConfig, v: number): void => { setStrikeFxValue(k, v); setSfxCfg({ ...getStrikeFxConfig() }); };
  const setSmoke = (k: keyof SmokeConfig, v: number): void => { setSmokeValue(k, v); setSmCfg({ ...getSmokeConfig() }); };
  const copy = (): void => {
    const smoke = Object.fromEntries(SMOKE_SUBSET.map(({ key }) => [key, getSmokeConfig()[key]]));
    void navigator.clipboard?.writeText(JSON.stringify({ ...getStrikeFxConfig(), ...smoke }, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetStrikeFxConfig(); setSfxCfg({ ...getStrikeFxConfig() }); };

  return (
    <div className="sfxmix lunge" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Lunge Strike Effects <span>dev · next strike · drag</span></div>
      {STRIKEFX_KEYS.map((k) => {
        const [min, max, step] = STRIKEFX_RANGES[k];
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name">{STRIKE_LABELS[k]}</span>
            <input type="range" min={min} max={max} step={step} value={sfxCfg[k]} onChange={(e) => setStrike(k, Number(e.target.value))} />
            <span className="sfxmix-val">{sfxCfg[k]}</span>
          </div>
        );
      })}
      {SMOKE_SUBSET.map(({ key, label }) => {
        const [min, max, step] = SMOKE_RANGES[key];
        return (
          <div className="sfxmix-row" key={key}>
            <span className="sfxmix-name">{label}</span>
            <input type="range" min={min} max={max} step={step} value={smCfg[key]} onChange={(e) => setSmoke(key, Number(e.target.value))} />
            <span className="sfxmix-val">{smCfg[key]}</span>
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
