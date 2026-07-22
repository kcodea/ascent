import { useState } from 'react';
import {
  CLEAVEFX_COLOR_KEYS, CLEAVEFX_KEYS, CLEAVEFX_RANGES,
  getCleaveFxConfig, resetCleaveFxConfig, setCleaveFxValue, type CleaveFxConfig,
} from './cleaveFxConfig';
import { pixiFx } from './pixiFx';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only "Cleave Slash FX" tuner — the claw-slash volley a Cleave attacker rakes across every unit it
 * strikes in one clash (`cleaveFxConfig` → `pixiFx.cleaveSlash`). Drag the sliders to tune by eye; values
 * persist to localStorage and apply to the NEXT cleave. "Test" fires a volley across the middle of the
 * screen so the look can be dialled without hunting for a Cleave attacker in a live fight. "Copy" grabs the
 * JSON to paste back as the shipped defaults; "Reset" restores them.
 *
 * Panel-only: opened from the Dev Tuning Menu, so it's stripped from production — and the saved config is
 * DEV-gated in `cleaveFxConfig`, so nothing dialled here can leak into a prod build.
 */
const LABELS: Partial<Record<keyof CleaveFxConfig, string>> = {
  offsetX: 'offset X',
  offsetY: 'offset Y',
  scale: 'overall scale',
  slashCount: 'slash count',
  slashLen: 'slash length ×',
  slashWidth: 'slash width',
  slashAngle: 'rake angle°',
  slashSpread: 'slash spacing',
  slashJitter: 'angle jitter°',
  slashStagger: 'stagger ms',
  drawMs: 'draw-on ms',
  holdMs: 'hold ms',
  fadeMs: 'fade ms',
  coreAlpha: 'core alpha',
  glowWidth: 'glow width ×',
  glowAlpha: 'glow alpha',
  taper: 'taper',
  emberCount: 'ember count',
  emberSpeed: 'ember speed',
  emberLife: 'ember life ms',
  emberSize: 'ember size',
  flashSize: 'unit flash',
  flashAlpha: 'flash alpha',
  flashMs: 'flash ms',
  pad: 'group padding',
};

const COLOR_LABELS: Partial<Record<keyof CleaveFxConfig, string>> = {
  colorCore: 'core',
  colorGlow: 'glow',
  colorEmber: 'ember',
};

export function CleaveFxTuner() {
  const [cfg, setCfg] = useState<CleaveFxConfig>(getCleaveFxConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('cleavefx');

  const set = (k: keyof CleaveFxConfig, v: number | string): void => {
    setCleaveFxValue(k, v);
    setCfg({ ...getCleaveFxConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getCleaveFxConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetCleaveFxConfig(); setCfg({ ...getCleaveFxConfig() }); };
  // Fire a sample volley across three imaginary cards in the middle of the viewport.
  const test = (): void => {
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    const step = 190, w = 150, h = 210;
    const pts = [-1, 0, 1].map((i) => ({ x: cx + i * step, y: cy }));
    pixiFx.cleaveSlash(pts, { x: cx - step - w / 2, y: cy - h / 2, w: step * 2 + w, h });
  };

  return (
    <div className="sfxmix lunge" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Cleave Slash FX <span>dev · next cleave · drag</span></div>
      {CLEAVEFX_KEYS.map((k) => {
        const [min, max, step] = CLEAVEFX_RANGES[k as string]!;
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name">{LABELS[k] ?? k}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k] as number} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{cfg[k]}</span>
          </div>
        );
      })}
      {CLEAVEFX_COLOR_KEYS.map((k) => (
        <div className="sfxmix-row" key={k}>
          <span className="sfxmix-name">{COLOR_LABELS[k] ?? k}</span>
          <input type="color" value={cfg[k] as string} onChange={(e) => set(k, e.target.value)} />
          <span className="sfxmix-val">{cfg[k]}</span>
        </div>
      ))}
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={test}>Test</button>
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
