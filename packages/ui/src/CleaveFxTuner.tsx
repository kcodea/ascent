import { useState } from 'react';
import {
  CLEAVEFX_COLOR_KEYS, CLEAVEFX_KEYS, CLEAVEFX_RANGES,
  getCleaveFxConfig, resetCleaveFxConfig, setCleaveFxValue, type CleaveFxConfig,
} from './cleaveFxConfig';
import { pixiFx } from './pixiFx';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only "Cleave Gash FX" tuner — the hit-stop + red gash a Cleave attacker plays on connection
 * (`cleaveFxConfig` → the lunge's `hitStopMs` hold + `pixiFx.cleaveGash`). Drag the sliders to tune by eye;
 * values persist to localStorage and apply to the NEXT cleave. "Test" fires a gash in the middle of the
 * screen so the look can be dialled without hunting for a Cleave attacker in a live fight — note the
 * **hit-stop can only be felt in a real fight**, since it lives in the lunge timeline, not the FX. "Copy"
 * grabs the JSON to paste back as the shipped defaults; "Reset" restores them.
 *
 * Panel-only: opened from the Dev Tuning Menu, so it's stripped from production — and the saved config is
 * DEV-gated in `cleaveFxConfig`, so nothing dialled here can leak into a prod build.
 */
const LABELS: Partial<Record<keyof CleaveFxConfig, string>> = {
  hitStopMs: 'HIT-STOP ms',
  offsetX: 'offset X',
  offsetY: 'offset Y',
  scale: 'overall scale',
  arcCount: 'arc count',
  arcRadius: 'arc radius',
  arcSweep: 'arc sweep°',
  arcWidth: 'arc width',
  arcTaper: 'arc taper',
  arcAngle: 'arc angle°',
  arcJitter: 'angle jitter°',
  arcSpacing: 'arc spacing',
  arcStagger: 'arc stagger ms',
  sweepMs: 'sweep-on ms',
  holdMs: 'hold ms',
  fadeMs: 'fade ms',
  arcGrow: 'grow on fade ×',
  coreAlpha: 'core alpha',
  glowWidth: 'glow width ×',
  glowAlpha: 'glow alpha',
  flashSize: 'contact flash',
  flashAlpha: 'flash alpha',
  flashMs: 'flash ms',
  shardCount: 'shard count',
  shardSpeed: 'shard speed',
  shardSpread: 'shard spread°',
  shardLife: 'shard life ms',
  shardSize: 'shard size',
  shardGravity: 'shard gravity',
};

const COLOR_LABELS: Partial<Record<keyof CleaveFxConfig, string>> = {
  colorCore: 'core (hot)',
  colorGlow: 'gash (red)',
  colorFlash: 'contact flash',
  colorShard: 'shards',
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
  // Fire a gash at screen centre, swinging left→right (the common attack direction).
  const test = (): void => {
    pixiFx.cleaveGash(window.innerWidth / 2, window.innerHeight / 2, 1, 0);
  };

  return (
    <div className="sfxmix lunge" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Cleave Gash FX <span>dev · next cleave · drag</span></div>
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
