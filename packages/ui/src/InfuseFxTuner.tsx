import { useState } from 'react';
import {
  INFUSEFX_KEYS, INFUSEFX_COLOR_KEYS, INFUSEFX_RANGES, getInfuseFxConfig, resetInfuseFxConfig, setInfuseFxValue, type InfuseFxConfig,
} from './infuseFxConfig';
import { useDraggablePanel } from './useDraggablePanel';
import { testInfuseFx } from './fxTestFire';

/**
 * DEV-only "Fodder Infusion" tuner — the send-Fodder-to-the-shop tendrils (`infuseFxConfig` →
 * `pixiFx.buffTendril` fan-out in Recruit): count/spread/stagger of the branches, the per-ribbon look,
 * the strike flash + motes, and the source pulse. Persists to localStorage; edits apply to the NEXT
 * infusion — play a Godfodder (Fodder pick) or Soulfeeder, or end a turn with Maw of the Pit, to judge.
 * "Copy" grabs the JSON to bake back as the shipped defaults; "Reset" clears. Dev-only.
 */
const INFUSE_LABELS: Partial<Record<keyof InfuseFxConfig, string>> = {
  count: 'tendrils',
  spreadFrac: 'spread (row ×)',
  staggerMs: 'stagger ms',
  endYOff: 'strike y-off',
  travelMs: 'travel ms',
  retractMs: 'retract ms',
  curve: 'curve',
  wobbleAmp: 'wobble px',
  wobbleFreq: 'wobble freq',
  baseWidth: 'base width',
  tipWidth: 'tip width',
  coreAlpha: 'core α',
  glowWidth: 'glow width',
  glowAlpha: 'glow α',
  flashSize: 'strike flash',
  flashMs: 'flash ms',
  moteCount: 'motes',
  moteSpeed: 'mote speed',
  moteLife: 'mote life ms',
  pulseSize: 'source pulse',
  pulseAlpha: 'pulse α',
  pulseMs: 'pulse ms',
  colorCore: 'core',
  colorGlow: 'glow',
};

export function InfuseFxTuner() {
  const [cfg, setCfg] = useState<InfuseFxConfig>(getInfuseFxConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('infusefx');

  const set = (k: keyof InfuseFxConfig, v: number | string): void => { setInfuseFxValue(k, v); setCfg({ ...getInfuseFxConfig() }); };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getInfuseFxConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetInfuseFxConfig(); setCfg({ ...getInfuseFxConfig() }); };

  const sliderKeys = INFUSEFX_KEYS.filter((k) => !INFUSEFX_COLOR_KEYS.includes(k));

  return (
    <div className="sfxmix lunge" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Fodder Infusion <span>dev · next infusion · drag</span></div>
      {sliderKeys.map((k) => {
        const [min, max, step] = INFUSEFX_RANGES[k]!;
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name">{INFUSE_LABELS[k] ?? k}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k] as number} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{cfg[k]}</span>
          </div>
        );
      })}
      {INFUSEFX_COLOR_KEYS.map((k) => (
        <div className="sfxmix-row" key={k}>
          <span className="sfxmix-name">{INFUSE_LABELS[k] ?? k}</span>
          <input type="color" value={cfg[k] as string} onChange={(e) => set(k, e.target.value)} />
          <span className="sfxmix-val">{cfg[k]}</span>
        </div>
      ))}
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={testInfuseFx} title="Fire the tendrils from your first board minion (or hero portrait) to the shop line — no Godfodder needed">▶ Test FX</button>
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
