import { useState } from 'react';
import {
  GUSTFX_KEYS, GUSTFX_COLOR_KEYS, GUSTFX_RANGES, getGustFxConfig, resetGustFxConfig, setGustFxValue, type GustFxConfig,
} from './gustFxConfig';
import { useDraggablePanel } from './useDraggablePanel';
import { testGustFx } from './fxTestFire';

/**
 * DEV-only "Buff Gust" tuner — the tavern-buffed rush (`gustFxConfig` → `pixiFx.buffGust`): the flank
 * bracket arcs, the speed-line streaks, and the sweep/hold/fade lifecycle. Persists to localStorage; edits
 * apply to the NEXT gust — cast a Staff of Guel, or trigger a Fodder enchant (Ritualist's End of Turn /
 * Rune of Consumption) to judge. "Copy" grabs the JSON to bake back as the shipped defaults; "Reset"
 * clears. Dev-only — stripped from production. Mirrors the buff-gust-preview.html rig 1:1.
 */
const GUST_LABELS: Partial<Record<keyof GustFxConfig, string>> = {
  sweepMs: 'sweep ms',
  staggerMs: 'stagger ms',
  arcMs: 'bracket ms',
  holdMs: 'hold ms',
  fadeMs: 'fade ms',
  streaks: 'streaks/side',
  streakLen: 'streak len',
  streakTravel: 'streak travel',
  streakWidth: 'streak width',
  streakCurve: 'streak curve',
  spreadY: 'fan height',
  arcHeight: 'bracket height ×',
  arcBulge: 'bracket bulge',
  arcWidth: 'bracket width',
  arcTravel: 'bracket drift',
  edgeOut: 'flank push-out',
  washAlpha: 'row wash α',
  washPad: 'wash pad',
  impactSize: 'impact ring',
  impactMs: 'impact ms',
  impactAlpha: 'impact α',
  sparkCount: 'land sparkles',
  sparkSize: 'sparkle px',
  sparkLife: 'sparkle life',
  sparkRise: 'sparkle rise',
  coreAlpha: 'core α',
  glowWidth: 'glow width',
  glowAlpha: 'glow α',
  taper: 'taper (0/1)',
  colorCore: 'core',
  colorGlow: 'glow',
};

export function GustFxTuner() {
  const [cfg, setCfg] = useState<GustFxConfig>(getGustFxConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('gustfx');

  const set = (k: keyof GustFxConfig, v: number | string): void => { setGustFxValue(k, v); setCfg({ ...getGustFxConfig() }); };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getGustFxConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetGustFxConfig(); setCfg({ ...getGustFxConfig() }); };

  const sliderKeys = GUSTFX_KEYS.filter((k) => !GUSTFX_COLOR_KEYS.includes(k));

  return (
    <div className="sfxmix lunge" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Buff Gust <span>dev · next gust · drag</span></div>
      {sliderKeys.map((k) => {
        const [min, max, step] = GUSTFX_RANGES[k]!;
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name">{GUST_LABELS[k] ?? k}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k] as number} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{cfg[k]}</span>
          </div>
        );
      })}
      {GUSTFX_COLOR_KEYS.map((k) => (
        <div className="sfxmix-row" key={k}>
          <span className="sfxmix-name">{GUST_LABELS[k] ?? k}</span>
          <input type="color" value={cfg[k] as string} onChange={(e) => set(k, e.target.value)} />
          <span className="sfxmix-val">{cfg[k]}</span>
        </div>
      ))}
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={testGustFx} title="Fire the gust over the current shop row — no Fodder buff needed">▶ Test FX</button>
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
