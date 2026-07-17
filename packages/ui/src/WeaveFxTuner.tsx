import { useState } from 'react';
import {
  WEAVEFX_KEYS, WEAVEFX_COLOR_KEYS, WEAVEFX_RANGES, getWeaveFxConfig, resetWeaveFxConfig, setWeaveFxValue, type WeaveFxConfig,
} from './weaveFxConfig';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only "Enchant Weave" tuner — the group-buff row glow (`weaveFxConfig` → `pixiFx.enchantWeave`):
 * per-card filament wreaths, card-to-card link arcs, star twinkles, and the ignite/hold/fade lifecycle.
 * Persists to localStorage; edits apply to the NEXT weave — cast a Staff of Guel, or trigger a Fodder
 * enchant (Ritualist's End of Turn / Rune of Consumption) to judge. "Copy" grabs the JSON to bake back as
 * the shipped defaults; "Reset" clears. Dev-only — stripped from production. Mirrors the
 * enchant-weave-preview.html rig 1:1.
 */
const WEAVE_LABELS: Partial<Record<keyof WeaveFxConfig, string>> = {
  igniteMs: 'ignite ms',
  staggerMs: 'stagger ms',
  holdMs: 'hold ms',
  fadeMs: 'fade ms',
  filaments: 'filaments',
  inset: 'inset px',
  writheAmp: 'writhe px',
  writheSpeed: 'writhe speed',
  jag: 'jaggedness',
  coreWidth: 'core width',
  coreAlpha: 'core α',
  glowWidth: 'glow width',
  glowAlpha: 'glow α',
  linkArcs: 'link arcs',
  linkBulge: 'link bulge',
  linkWidth: 'link width',
  sparkleCount: 'twinkles',
  sparkleSize: 'twinkle px',
  sparkleRate: 'twinkle rate',
  colorCore: 'core',
  colorGlow: 'glow',
  colorSparkle: 'twinkle',
};

export function WeaveFxTuner() {
  const [cfg, setCfg] = useState<WeaveFxConfig>(getWeaveFxConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('weavefx');

  const set = (k: keyof WeaveFxConfig, v: number | string): void => { setWeaveFxValue(k, v); setCfg({ ...getWeaveFxConfig() }); };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getWeaveFxConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetWeaveFxConfig(); setCfg({ ...getWeaveFxConfig() }); };

  const sliderKeys = WEAVEFX_KEYS.filter((k) => !WEAVEFX_COLOR_KEYS.includes(k));

  return (
    <div className="sfxmix lunge" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Enchant Weave <span>dev · next weave · drag</span></div>
      {sliderKeys.map((k) => {
        const [min, max, step] = WEAVEFX_RANGES[k]!;
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name">{WEAVE_LABELS[k] ?? k}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k] as number} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{cfg[k]}</span>
          </div>
        );
      })}
      {WEAVEFX_COLOR_KEYS.map((k) => (
        <div className="sfxmix-row" key={k}>
          <span className="sfxmix-name">{WEAVE_LABELS[k] ?? k}</span>
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
