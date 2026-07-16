import { useEffect, useState } from 'react';
import {
  TVB_NUM_KEYS,
  TVB_COLOR_KEYS,
  TVB_RANGES,
  TVB_DESC,
  getTavernUpConfig,
  resetTavernUpConfig,
  setTavernUpValue,
  type TavernUpConfig,
} from './tavernUpConfig';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only floating tuner for the TAVERN UP stone button (`tavernUpConfig.ts` / `TavernUpButton.tsx`).
 * Dials position/scale, the gem + tier-pip + cost-coin seats, the hover glow (blur/opacity/stack/breath/
 * fit/colour), the sheen sweep, the press effects (flash/dust/shockwave), and the disabled dim — all live
 * via `--tvb-*` vars. "Glow always on" pins the hover-only glow (`body.tvb-glow-preview`) so its sliders
 * can be dialed without holding hover (one pointer can't do both). Values persist to localStorage (dev
 * only); "Copy" grabs the JSON to bake into DEFAULTS + the styles.css fallbacks. Panel-only: opened from
 * the Dev Tuning Menu (DevMenu.tsx); dev-only, so it's stripped from production.
 */
const LABELS: Record<keyof TavernUpConfig, string> = {
  x: 'position · x',
  y: 'position · y',
  scale: 'scale',
  gemX: 'gem · x',
  gemY: 'gem · y',
  gemS: 'gem · size',
  pipX: 'pips · x',
  pipY: 'pips · y',
  pipS: 'pips · size',
  costX: 'cost coin · x',
  costY: 'cost coin · y',
  costS: 'cost coin · size',
  glowX: 'glow · x',
  glowY: 'glow · y',
  glowW: 'glow · width fit',
  glowH: 'glow · height fit',
  glowBlur: 'glow · blur',
  glowAlpha: 'glow · opacity',
  glowStrength: 'glow · strength',
  glowPulse: 'glow · pulse s',
  glowPulseDepth: 'glow · pulse depth',
  glowColor: 'glow · colour',
  sheenCycle: 'sheen · cycle s',
  sheenAlpha: 'sheen · strength',
  flashMs: 'press · flash ms',
  dustCount: 'press · dust amount',
  dustSize: 'press · dust size',
  dustLife: 'press · dust life',
  rings: 'press · rings',
  ringRadius: 'press · ring radius',
  ringLife: 'press · ring life',
  artDim: 'disabled · art dim',
};

export function TavernUpTuner() {
  const [cfg, setCfg] = useState<TavernUpConfig>(getTavernUpConfig());
  const [copied, setCopied] = useState(false);
  // Pin the hover-only glow onto the resting button so the glow sliders can be dialed live.
  const [glowPreview, setGlowPreview] = useState(false);
  useEffect(() => {
    document.body.classList.toggle('tvb-glow-preview', glowPreview);
    return () => document.body.classList.remove('tvb-glow-preview');
  }, [glowPreview]);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('tavernup');

  const set = (k: keyof TavernUpConfig, v: number | string): void => {
    setTavernUpValue(k, v);
    setCfg({ ...getTavernUpConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getTavernUpConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetTavernUpConfig(); setCfg({ ...getTavernUpConfig() }); };

  return (
    <div className="sfxmix lunge flip" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Tavern Up <span>dev · live · hover/press it</span></div>
      <div className="sfxmix-row">
        <span className="sfxmix-name" title="Pin the hover-only glow onto the resting button so the glow sliders can be dialed without holding hover.">glow always on</span>
        <input type="checkbox" checked={glowPreview} onChange={(e) => setGlowPreview(e.target.checked)} />
        <span className="sfxmix-val">{glowPreview ? 'on' : 'off'}</span>
      </div>
      {TVB_NUM_KEYS.map((k) => {
        const range = TVB_RANGES[k];
        if (!range) return null; // guard a transient HMR desync (keys vs ranges) so it can't blank the app
        const [min, max, step] = range;
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name" title={TVB_DESC[k]}>{LABELS[k]}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k]} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{cfg[k]}</span>
          </div>
        );
      })}
      {TVB_COLOR_KEYS.map((k) => (
        <div className="sfxmix-row" key={k}>
          <span className="sfxmix-name" title={TVB_DESC[k]}>{LABELS[k]}</span>
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
