import { useState } from 'react';
import {
  SWAPFX_KEYS, SWAPFX_COLOR_KEYS, SWAPFX_RANGES, getSwapFxConfig, resetSwapFxConfig, setSwapFxValue, type SwapFxConfig,
} from './swapFxConfig';
import { useDraggablePanel } from './useDraggablePanel';
import { testSwapFx } from './fxTestFire';

/**
 * DEV-only "Swap FX" tuner — the Displacement circular-exchange arrows (`swapFxConfig` → `pixiFx.swapArc`):
 * the two mirrored arcs (warm arrival, cool departure), their arrowheads, the arrival flash + motes, and the
 * halos held on both cards. Persists to localStorage; edits apply to the NEXT swap — play Darah (or cast the
 * Displacement spell) and use the hero power to judge. "Copy" grabs the JSON to bake back as the shipped
 * defaults; "Reset" clears. Dev-only — stripped from production.
 */
const SWAP_LABELS: Partial<Record<keyof SwapFxConfig, string>> = {
  travelMs: 'travel ms',
  retractMs: 'retract ms',
  curve: 'arc bulge',
  wobbleAmp: 'wobble px',
  wobbleFreq: 'wobble freq',
  baseWidth: 'tail width',
  tipWidth: 'head width',
  coreAlpha: 'core α',
  glowWidth: 'glow width',
  glowAlpha: 'glow α',
  arrowSize: 'arrowhead px',
  flashSize: 'strike flash',
  flashMs: 'flash ms',
  moteCount: 'motes',
  moteSpeed: 'mote speed',
  moteLife: 'mote life ms',
  haloSize: 'card halo px',
  haloAlpha: 'halo α',
  colorInCore: 'arrival core',
  colorInGlow: 'arrival glow',
  colorOutCore: 'departure core',
  colorOutGlow: 'departure glow',
};

export function SwapFxTuner() {
  const [cfg, setCfg] = useState<SwapFxConfig>(getSwapFxConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('swapfx');

  const set = (k: keyof SwapFxConfig, v: number | string): void => { setSwapFxValue(k, v); setCfg({ ...getSwapFxConfig() }); };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getSwapFxConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetSwapFxConfig(); setCfg({ ...getSwapFxConfig() }); };

  const sliderKeys = SWAPFX_KEYS.filter((k) => !SWAPFX_COLOR_KEYS.includes(k));

  return (
    <div className="sfxmix lunge" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Swap FX (Displacement) <span>dev · next swap · drag</span></div>
      {sliderKeys.map((k) => {
        const [min, max, step] = SWAPFX_RANGES[k]!;
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name">{SWAP_LABELS[k] ?? k}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k] as number} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{cfg[k]}</span>
          </div>
        );
      })}
      {SWAPFX_COLOR_KEYS.map((k) => (
        <div className="sfxmix-row" key={k}>
          <span className="sfxmix-name">{SWAP_LABELS[k] ?? k}</span>
          <input type="color" value={cfg[k] as string} onChange={(e) => set(k, e.target.value)} />
          <span className="sfxmix-val">{cfg[k]}</span>
        </div>
      ))}
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={testSwapFx} title="Fire the swap arc between your first board minion (or hero portrait) and the first shop offer — no Darah needed">▶ Test FX</button>
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
