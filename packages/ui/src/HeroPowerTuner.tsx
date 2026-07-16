import { useEffect, useState } from 'react';
import {
  HPB_NUM_KEYS,
  HPB_COLOR_KEYS,
  HPB_RANGES,
  HPB_DESC,
  getHeroPowerBtnConfig,
  resetHeroPowerBtnConfig,
  setHeroPowerBtnValue,
  type HeroPowerBtnConfig,
} from './heroPowerBtnConfig';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only floating tuner for the HERO POWER diamond (`heroPowerBtnConfig.ts` / StatusBar's `.heropanel`) —
 * the middle-left mirror of the End Turn diamond's 💎 tuner. Dials position + scale and the face-hugging
 * glow (offset/fit alignment, blur / opacity / stack / breathing / colour). Values persist to localStorage
 * (dev-only) and apply LIVE via `--hpb-*` vars. "Glow always on" pins the hover/ready glow so its sliders
 * can be dialed without holding hover or waiting on a usable power. "Copy" grabs the JSON to paste back as
 * the shipped defaults in `heroPowerBtnConfig.ts` (mirror position/scale/glow into the styles.css
 * `var(--hpb-*, …)` fallbacks). Panel-only: opened from the Dev Tuning Menu; dev-only, stripped from prod.
 */
const LABELS: Record<keyof HeroPowerBtnConfig, string> = {
  x: 'position · x',
  y: 'position · y',
  scale: 'scale',
  glowX: 'glow · offset x',
  glowY: 'glow · offset y',
  glowW: 'glow · width fit',
  glowH: 'glow · height fit',
  glowBlur: 'glow · blur',
  glowAlpha: 'glow · opacity',
  glowStrength: 'glow · strength',
  glowPulse: 'glow · pulse speed',
  glowPulseDepth: 'glow · pulse depth',
  glowColor: 'glow · colour',
};

export function HeroPowerTuner() {
  const [cfg, setCfg] = useState<HeroPowerBtnConfig>(getHeroPowerBtnConfig());
  const [copied, setCopied] = useState(false);
  const [glowPreview, setGlowPreview] = useState(true);
  // Pin the hover/ready glow on so its sliders can be dialed regardless of power state.
  useEffect(() => {
    document.body.classList.toggle('hpb-glow-preview', glowPreview);
    return () => document.body.classList.remove('hpb-glow-preview');
  }, [glowPreview]);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('heropowerbtn');

  const set = (k: keyof HeroPowerBtnConfig, v: number | string): void => {
    setHeroPowerBtnValue(k, v);
    setCfg({ ...getHeroPowerBtnConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getHeroPowerBtnConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetHeroPowerBtnConfig(); setCfg({ ...getHeroPowerBtnConfig() }); };

  return (
    <div className="sfxmix lunge flip" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Hero Power Button <span>dev · live · recruit phase</span></div>
      <div className="sfxmix-row">
        <span className="sfxmix-name" title="Pin the hover/ready glow on so its sliders can be tuned in any power state.">glow always on</span>
        <input type="checkbox" checked={glowPreview} onChange={(e) => setGlowPreview(e.target.checked)} />
        <span className="sfxmix-val">{glowPreview ? 'on' : 'off'}</span>
      </div>
      {HPB_NUM_KEYS.map((k) => {
        const [min, max, step] = HPB_RANGES[k];
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name" title={HPB_DESC[k]}>{LABELS[k]}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k]} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{cfg[k]}</span>
          </div>
        );
      })}
      {HPB_COLOR_KEYS.map((k) => (
        <div className="sfxmix-row" key={k}>
          <span className="sfxmix-name" title={HPB_DESC[k]}>{LABELS[k]}</span>
          <input type="color" value={cfg[k]} onChange={(e) => set(k, e.target.value)} />
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
