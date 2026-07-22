import { useState } from 'react';
import {
  GROWTHFX_COLOR_KEYS, GROWTHFX_KEYS, GROWTHFX_RANGES,
  getGrowthFxConfig, resetGrowthFxConfig, setGrowthFxValue, type GrowthFxConfig,
} from './growthFxConfig';
import { pixiFx } from './pixiFx';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only "Growth Bloom FX" tuner — the vine-and-blossom bloom played wherever **Growth** is cast, in the
 * shop or in combat (`growthFxConfig` → `pixiFx.growthBloom`). Drag the sliders to tune by eye; values
 * persist to localStorage and apply to the NEXT cast. "Test" blooms over three imaginary cards so the look
 * can be dialled without casting Growth. "Copy" grabs the JSON to paste back as the shipped defaults;
 * "Reset" restores them.
 *
 * Panel-only: opened from the Dev Tuning Menu, so it's stripped from production — and the saved config is
 * DEV-gated in `growthFxConfig`, so nothing dialled here can leak into a prod build.
 */
const LABELS: Partial<Record<keyof GrowthFxConfig, string>> = {
  vineCount: 'vines / unit',
  vineLen: 'vine length',
  vineWidth: 'vine width',
  vineCurve: 'vine curl',
  vineWobble: 'vine wobble',
  vineSpread: 'vine spread°',
  growMs: 'grow-on ms',
  unitStagger: 'unit stagger ms',
  holdMs: 'hold ms',
  fadeMs: 'fade ms',
  vineAlpha: 'vine alpha',
  vineGlowWidth: 'vine glow ×',
  vineGlowAlpha: 'vine glow alpha',
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
  // Bloom over three imaginary cards in the middle of the viewport.
  const test = (): void => {
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    const step = 190, w = 150, h = 210;
    const pts = [-1, 0, 1].map((i) => ({ x: cx + i * step, y: cy }));
    pixiFx.growthBloom(pts, { x: cx - step - w / 2, y: cy - h / 2, w: step * 2 + w, h });
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
