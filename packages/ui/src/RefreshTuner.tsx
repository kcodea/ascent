import { useEffect, useState } from 'react';
import {
  RFB_NUM_KEYS,
  RFB_COLOR_KEYS,
  RFB_RANGES,
  RFB_DESC,
  getRefreshConfig,
  resetRefreshConfig,
  setRefreshValue,
  type RefreshConfig,
} from './refreshConfig';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only floating tuner for the REFRESH crystal (`refreshConfig.ts` / `RefreshButton.tsx`).
 *
 * Mirrors the 🍺 Tavern Up tuner dial-for-dial (owner request) minus the gem/pip seats, which don't exist
 * on a single-piece art: position/scale, the label pill + cost-coin seats, the hover glow (blur / opacity /
 * stack / breath / fit / colour), the sheen sweep, the press effects (spin / flash / dust / shockwave), and
 * the disabled dim — all live via `--rfb-*` vars.
 *
 * "Glow always on" pins the hover-only glow (`body.rfb-glow-preview`) so its sliders can be dialed without
 * holding hover — one pointer can't do both. Values persist to localStorage (dev only); "Copy values" grabs
 * the JSON to bake into DEFAULTS + the styles.css fallbacks. Opened from the Dev Tuning Menu; dev-only, so
 * it's stripped from production.
 *
 * Click FX are dust + a shine flare only — the press spin and the shockwave rings were dropped 2026-07-21
 * (owner), so those dials are gone rather than left sitting at 0.
 */
const LABELS: Record<keyof RefreshConfig, string> = {
  x: 'position · x',
  y: 'position · y',
  scale: 'scale',
  labelY: 'label pill · y',
  labelS: 'label pill · size',
  costX: 'cost coin · x',
  costY: 'cost coin · y',
  costS: 'cost coin · size',
  costColor: 'cost coin · colour',
  costFreeColor: 'cost coin · FREE colour',
  glowW: 'glow · width fit',
  glowH: 'glow · height fit',
  glowBlur: 'glow · blur',
  glowAlpha: 'glow · opacity',
  glowStrength: 'glow · strength',
  glowPulse: 'glow · breath speed',
  glowPulseDepth: 'glow · breath depth',
  glowColor: 'glow · colour',
  sheenCycle: 'sheen · cycle',
  sheenAlpha: 'sheen · strength',
  shineMs: 'click · shine time',
  shineAlpha: 'click · shine opacity',
  shineSize: 'click · shine spread',
  shineBlur: 'click · shine blur',
  shineColor: 'click · shine colour',
  dustCount: 'click · dust amount',
  dustSize: 'click · dust size',
  dustLife: 'click · dust life',
  blastCount: 'blast · shards',
  blastSpeed: 'blast · speed',
  blastSpread: 'blast · spread (rng)',
  blastLife: 'blast · life',
  blastSize: 'blast · size',
  blastColor: 'blast · colour',
  artDim: 'disabled · art dim',
};

export function RefreshTuner() {
  const [cfg, setCfg] = useState<RefreshConfig>(getRefreshConfig());
  const [copied, setCopied] = useState(false);
  // Pin the hover-only glow onto the resting button so the glow sliders can be dialed live.
  const [glowPreview, setGlowPreview] = useState(false);
  useEffect(() => {
    document.body.classList.toggle('rfb-glow-preview', glowPreview);
    return () => document.body.classList.remove('rfb-glow-preview');
  }, [glowPreview]);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('refreshbtn');

  const set = (k: keyof RefreshConfig, v: number | string): void => {
    setRefreshValue(k, v);
    setCfg({ ...getRefreshConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getRefreshConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetRefreshConfig(); setCfg({ ...getRefreshConfig() }); };

  return (
    <div className="sfxmix lunge flip" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Refresh <span>dev · live · hover/press it</span></div>
      <div className="sfxmix-row">
        <span className="sfxmix-name" title="Pin the hover-only glow onto the resting button so the glow sliders can be dialed without holding hover.">glow always on</span>
        <input type="checkbox" checked={glowPreview} onChange={(e) => setGlowPreview(e.target.checked)} />
        <span className="sfxmix-val">{glowPreview ? 'on' : 'off'}</span>
      </div>
      {RFB_NUM_KEYS.map((k) => {
        const range = RFB_RANGES[k];
        if (!range) return null; // guard a transient HMR desync (keys vs ranges) so it can't blank the app
        const [min, max, step] = range;
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name" title={RFB_DESC[k]}>{LABELS[k]}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k]} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{cfg[k]}</span>
          </div>
        );
      })}
      {RFB_COLOR_KEYS.map((k) => (
        <div className="sfxmix-row" key={k}>
          <span className="sfxmix-name" title={RFB_DESC[k]}>{LABELS[k]}</span>
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
