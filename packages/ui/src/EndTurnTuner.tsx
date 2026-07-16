import { useEffect, useState } from 'react';
import {
  ETB_NUM_KEYS,
  ETB_COLOR_KEYS,
  ETB_RANGES,
  ETB_DESC,
  getEndTurnConfig,
  resetEndTurnConfig,
  setEndTurnValue,
  type EndTurnConfig,
} from './endTurnConfig';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only floating tuner for the standalone END TURN diamond (`endTurnConfig.ts` / `EndTurnButton.tsx`).
 * Dials position + scale, the diamond-silhouette glow (blur / opacity / stack / breathing / colour) and the
 * edge-lightning arcs (rate / length / jitter / width / life / opacity / colour). Values persist to
 * localStorage (dev-only) and apply LIVE — position/scale/glow via `--etb-*` vars, lightning read per-frame
 * by the canvas loop. "Preview pressed" flips the art to the dulled gem via a body class so the pressed look
 * can be checked without ending a turn. "Copy" grabs the JSON to paste back as the shipped defaults in
 * `endTurnConfig.ts` (mirror position/scale/glow into the styles.css `var(--etb-*, …)` fallbacks). Panel-only:
 * opened from the Dev Tuning Menu (DevMenu.tsx); dev-only, so it's stripped from production.
 */
const LABELS: Record<keyof EndTurnConfig, string> = {
  x: 'position · x',
  y: 'position · y',
  scale: 'scale',
  glowBlur: 'glow · blur',
  glowAlpha: 'glow · opacity',
  glowStrength: 'glow · strength',
  glowPulse: 'glow · pulse speed',
  glowPulseDepth: 'glow · pulse depth',
  sheenCycle: 'sheen · cycle',
  sheenAlpha: 'sheen · strength',
  glowX: 'glow · offset x',
  glowY: 'glow · offset y',
  glowW: 'glow · width fit',
  glowH: 'glow · height fit',
  glowColor: 'glow · colour',
  boltRate: 'lightning · rate',
  boltScale: 'lightning · length',
  boltMag: 'lightning · magnitude',
  boltWidth: 'lightning · width',
  boltLife: 'lightning · life',
  boltAlpha: 'lightning · opacity',
  boltColor: 'lightning · colour',
  strikeBolts: 'strike · bolts',
  strikeFlash: 'strike · flash',
  strikeDustCount: 'strike · dust amount',
  strikeDustSize: 'strike · dust size',
  strikeDustLife: 'strike · dust life',
  strikeRings: 'strike · ripple rings',
  strikeRingRadius: 'strike · ripple size',
  strikeRingLife: 'strike · ripple life',
  pressedVariant: 'pressed art · cracked gem',
};

export function EndTurnTuner() {
  const [cfg, setCfg] = useState<EndTurnConfig>(getEndTurnConfig());
  const [copied, setCopied] = useState(false);
  const [pressedPreview, setPressedPreview] = useState(false);
  const [glowPreview, setGlowPreview] = useState(true);
  // Flip the live button to its pressed (dim gem) art without ending the turn.
  useEffect(() => {
    document.body.classList.toggle('etb-pressed-preview', pressedPreview);
    return () => document.body.classList.remove('etb-pressed-preview');
  }, [pressedPreview]);
  // Pin the hover-only glow on so its sliders can be dialed without holding hover.
  useEffect(() => {
    document.body.classList.toggle('etb-glow-preview', glowPreview);
    return () => document.body.classList.remove('etb-glow-preview');
  }, [glowPreview]);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('endturnbtn');

  const set = (k: keyof EndTurnConfig, v: number | string): void => {
    setEndTurnValue(k, v);
    setCfg({ ...getEndTurnConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getEndTurnConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetEndTurnConfig(); setCfg({ ...getEndTurnConfig() }); };

  return (
    <div className="sfxmix lunge flip" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>End Turn Button <span>dev · live · recruit phase</span></div>
      <div className="sfxmix-row">
        <span className="sfxmix-name" title="Show the pressed (dim gem) art without ending the turn.">preview pressed</span>
        <input type="checkbox" checked={pressedPreview} onChange={(e) => setPressedPreview(e.target.checked)} />
        <span className="sfxmix-val">{pressedPreview ? 'on' : 'off'}</span>
      </div>
      <div className="sfxmix-row">
        <span className="sfxmix-name" title="Pin the hover-only glow on so its sliders can be tuned without holding hover.">glow always on</span>
        <input type="checkbox" checked={glowPreview} onChange={(e) => setGlowPreview(e.target.checked)} />
        <span className="sfxmix-val">{glowPreview ? 'on' : 'off'}</span>
      </div>
      <div className="sfxmix-row">
        <span className="sfxmix-name" title={ETB_DESC.pressedVariant}>{LABELS.pressedVariant}</span>
        <input type="checkbox" checked={cfg.pressedVariant >= 3} onChange={(e) => set('pressedVariant', e.target.checked ? 3 : 2)} />
        <span className="sfxmix-val">{cfg.pressedVariant >= 3 ? 'pressed3' : 'pressed2'}</span>
      </div>
      {ETB_NUM_KEYS.map((k) => {
        const [min, max, step] = ETB_RANGES[k];
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name" title={ETB_DESC[k]}>{LABELS[k]}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k]} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{cfg[k]}</span>
          </div>
        );
      })}
      {ETB_COLOR_KEYS.map((k) => (
        <div className="sfxmix-row" key={k}>
          <span className="sfxmix-name" title={ETB_DESC[k]}>{LABELS[k]}</span>
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
