import { useEffect, useState } from 'react';
import {
  GLOW_NUM_KEYS,
  GLOW_COLOR_KEYS,
  GLOW_RANGES,
  GLOW_DESC,
  getGlowConfig,
  resetGlowConfig,
  setGlowValue,
  type GlowConfig,
} from './glowConfig';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only floating tuner for the card HOVER / SELECT glow (`glowConfig.ts`). Dials the bright inner line
 * (blur / opacity / colour) and the soft outer bloom (blur / opacity / colour) that ring a card on hover.
 * Values persist to localStorage and apply LIVE via `--hg-*` CSS vars (the `.cglow` filter reads them). The
 * "always on" toggle pins the glow onto every RESTING card (`body.hglow-preview`) so it can be tuned without
 * holding hover (one pointer can't hover a card AND drag a slider). "Copy" grabs the JSON to paste back as the
 * shipped defaults in `glowConfig.ts` (and mirror into the CSS `var(--hg-*, …)` fallbacks). Panel-only: opened
 * from the Dev Tuning Menu (DevMenu.tsx); dev-only, so it's stripped from production.
 */
const LABELS: Record<keyof GlowConfig, string> = {
  width: 'shape · width',
  height: 'shape · height',
  lineBlur: 'line · blur',
  lineAlpha: 'line · opacity',
  lineColor: 'line · colour',
  bloomBlur: 'bloom · blur',
  bloomAlpha: 'bloom · opacity',
  bloomStrength: 'bloom · strength',
  bloomColor: 'bloom · colour',
};

export function GlowTuner() {
  const [cfg, setCfg] = useState<GlowConfig>(getGlowConfig());
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState(true);
  // Pin the glow onto every resting card so the sliders can be dialed without holding hover.
  useEffect(() => {
    document.body.classList.toggle('hglow-preview', preview);
    return () => document.body.classList.remove('hglow-preview');
  }, [preview]);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('glow');

  const set = (k: keyof GlowConfig, v: number | string): void => {
    setGlowValue(k, v);
    setCfg({ ...getGlowConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getGlowConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetGlowConfig(); setCfg({ ...getGlowConfig() }); };

  return (
    <div className="sfxmix lunge flip" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Hover Glow <span>dev · live · hover a card</span></div>
      <div className="sfxmix-row">
        <span className="sfxmix-name" title="Pin the glow onto every resting card so the sliders can be tuned without holding hover.">always on</span>
        <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} />
        <span className="sfxmix-val">{preview ? 'on' : 'off'}</span>
      </div>
      {GLOW_NUM_KEYS.map((k) => {
        const [min, max, step] = GLOW_RANGES[k];
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name" title={GLOW_DESC[k]}>{LABELS[k]}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k]} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{cfg[k]}</span>
          </div>
        );
      })}
      {GLOW_COLOR_KEYS.map((k) => (
        <div className="sfxmix-row" key={k}>
          <span className="sfxmix-name" title={GLOW_DESC[k]}>{LABELS[k]}</span>
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
