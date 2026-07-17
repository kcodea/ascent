import { useState } from 'react';
import {
  AIMFX_KEYS, AIMFX_COLOR_KEYS, AIMFX_RANGES, getAimFxConfig, resetAimFxConfig, setAimFxValue, type AimFxConfig,
} from './aimFxConfig';
import { useDraggablePanel } from './useDraggablePanel';
import { testAimBurst } from './fxTestFire';

/**
 * DEV-only "Hero Aim FX" tuner — the living targeting line (`pixiFx.setAimLine`) + the activation spark
 * burst (`pixiFx.heroPowerBurst`). The LINE re-reads the config every frame, so dials apply while you're
 * aiming (arm a targeted power — Soren/Darah — and drag to judge); each new aim rolls a fresh random arch.
 * ▶ Test fires the burst at the power diamond. "Copy" grabs the JSON to bake back as the shipped defaults;
 * "Reset" clears. Dev-only — stripped from production.
 */
const AIM_LABELS: Partial<Record<keyof AimFxConfig, string>> = {
  coreWidth: 'line width',
  coreAlpha: 'line α',
  glowWidth: 'aura width',
  glowAlpha: 'aura α',
  curve: 'arch',
  curveVar: 'arch randomness',
  wobbleAmp: 'wobble px',
  wobbleSpeed: 'wobble speed',
  breathe: 'aura breathe',
  dotSize: 'cursor dot px',
  colorCore: 'line',
  colorGlow: 'aura',
  burstCount: 'burst sparks',
  burstSpeed: 'burst speed',
  burstSize: 'spark px',
  burstLife: 'spark life ms',
  colorBurst: 'burst',
};

export function AimFxTuner() {
  const [cfg, setCfg] = useState<AimFxConfig>(getAimFxConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('aimfx');

  const set = (k: keyof AimFxConfig, v: number | string): void => { setAimFxValue(k, v); setCfg({ ...getAimFxConfig() }); };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getAimFxConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetAimFxConfig(); setCfg({ ...getAimFxConfig() }); };

  const sliderKeys = AIMFX_KEYS.filter((k) => !AIMFX_COLOR_KEYS.includes(k));

  return (
    <div className="sfxmix lunge" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Hero Aim FX <span>dev · live line · drag</span></div>
      {sliderKeys.map((k) => {
        const [min, max, step] = AIMFX_RANGES[k]!;
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name">{AIM_LABELS[k] ?? k}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k] as number} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{cfg[k]}</span>
          </div>
        );
      })}
      {AIMFX_COLOR_KEYS.map((k) => (
        <div className="sfxmix-row" key={k}>
          <span className="sfxmix-name">{AIM_LABELS[k] ?? k}</span>
          <input type="color" value={cfg[k] as string} onChange={(e) => set(k, e.target.value)} />
          <span className="sfxmix-val">{cfg[k]}</span>
        </div>
      ))}
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={testAimBurst} title="Fire the activation spark burst at the hero-power diamond">▶ Test burst</button>
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
