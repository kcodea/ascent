import { useState } from 'react';
import {
  GROWTHFX_COLOR_KEYS, GROWTHFX_KEYS, GROWTHFX_RANGES,
  getGrowthFxConfig, resetGrowthFxConfig, setGrowthFxValue, type GrowthFxConfig,
} from './growthFxConfig';
import { pixiFx } from './pixiFx';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only "Growth Bloom FX" tuner — the tendril sweep played wherever **Growth** is cast, in the shop or
 * in combat (`growthFxConfig` → `pixiFx.growthBloom`). Tendrils run out from the board's CENTRE to both
 * ends; the placement block up top (offset X/Y, width/height ×, overall scale) sits the sweep on the board.
 * Drag the sliders to tune by eye; values persist to localStorage and apply to the NEXT cast. "Test" sweeps
 * a board-sized region so the look can be dialled without casting Growth. "Copy" grabs the JSON to paste
 * back as the shipped defaults; "Reset" restores them.
 *
 * Panel-only: opened from the Dev Tuning Menu, so it's stripped from production — and the saved config is
 * DEV-gated in `growthFxConfig`, so nothing dialled here can leak into a prod build.
 */
const LABELS: Partial<Record<keyof GrowthFxConfig, string>> = {
  offsetX: 'offset X',
  offsetY: 'offset Y',
  widthScale: 'width ×',
  heightScale: 'height ×',
  scale: 'overall scale',
  tendrilCount: 'tendrils / side',
  reach: 'reach ×',
  tendrilWidth: 'tendril width',
  waviness: 'waviness',
  waveFreq: 'wave cycles',
  spreadY: 'vertical spread',
  splayY: 'tip splay',
  frontMs: 'centre→ends ms',
  holdMs: 'hold ms',
  fadeMs: 'fade ms',
  tendrilAlpha: 'tendril alpha',
  glowWidth: 'glow width ×',
  glowAlpha: 'glow alpha',
  leafCount: 'leaf count',
  leafSize: 'leaf size',
  leafLife: 'leaf life ms',
  leafRise: 'leaf rise',
  leafDrift: 'leaf drift',
  leafSpin: 'leaf spin',
  petalCount: 'petal count',
  petalSize: 'petal size',
  petalLife: 'petal life ms',
  sparkCount: 'sparkle count',
  sparkSize: 'sparkle size',
  sparkLife: 'sparkle life ms',
  sparkRise: 'sparkle rise',
  washAlpha: 'wash alpha',
  washPad: 'wash padding',
};

const COLOR_LABELS: Partial<Record<keyof GrowthFxConfig, string>> = {
  colorVine: 'vine',
  colorVineGlow: 'vine glow',
  colorLeaf: 'leaf',
  colorPetal: 'petal',
  colorSpark: 'sparkle',
};

export function GrowthFxTuner() {
  const [cfg, setCfg] = useState<GrowthFxConfig>(getGrowthFxConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('growthfx');

  const set = (k: keyof GrowthFxConfig, v: number | string): void => {
    setGrowthFxValue(k, v);
    setCfg({ ...getGrowthFxConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getGrowthFxConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetGrowthFxConfig(); setCfg({ ...getGrowthFxConfig() }); };
  // Sweep across a board-sized region in the middle of the viewport.
  const test = (): void => {
    const w = Math.min(1100, window.innerWidth * 0.7), h = 210;
    pixiFx.growthBloom({ x: (window.innerWidth - w) / 2, y: (window.innerHeight - h) / 2, w, h });
  };

  return (
    <div className="sfxmix lunge" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Growth Bloom FX <span>dev · next cast · drag</span></div>
      {GROWTHFX_KEYS.map((k) => {
        const [min, max, step] = GROWTHFX_RANGES[k as string]!;
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name">{LABELS[k] ?? k}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k] as number} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{cfg[k]}</span>
          </div>
        );
      })}
      {GROWTHFX_COLOR_KEYS.map((k) => (
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
