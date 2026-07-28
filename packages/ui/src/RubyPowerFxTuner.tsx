import { useState } from 'react';
import {
  RUBYPOWERFX_KEYS, RUBYPOWERFX_COLOR_KEYS, RUBYPOWERFX_RANGES,
  getRubyPowerFxConfig, resetRubyPowerFxConfig, setRubyPowerFxValue, type RubyPowerFxConfig,
} from './rubyPowerFxConfig';
import { useDraggablePanel } from './useDraggablePanel';
import { testRubyPowerFx } from './fxTestFire';

/**
 * DEV-only "Ruby Power" tuner — the Ruby-strength flourish (`rubyPowerFxConfig` → `pixiFx.rubyPower` +
 * `floatRubyPowerNumber`): the rising arrow fan, the origin mote blast, and the floating power number.
 * Persists to localStorage; edits apply to the NEXT cast, so ▶ Test fires it over the shop row rather than
 * making you stage a spell. "Copy" grabs the JSON to bake back as the shipped defaults; "Reset" clears.
 * Dev-only — stripped from production.
 */
const SP_LABELS: Partial<Record<keyof RubyPowerFxConfig, string>> = {
  arrowCount: 'arrows',
  arrowRise: 'rise px',
  arrowSpread: 'fan width',
  arrowLen: 'shaft len',
  arrowWidth: 'shaft width',
  arrowHead: 'head size',
  arrowMs: 'rise ms',
  arrowStagger: 'stagger ms',
  arrowDrift: 'side drift',
  arrowFadeAt: 'fade starts',
  blastCount: 'blast motes',
  blastSpeed: 'blast speed',
  blastSize: 'blast px',
  blastLife: 'blast life',
  blastGravity: 'blast gravity',
  blastSpread: 'spread °',
  blastAngle: 'cone aim °',
  blastDrag: 'drag',
  blastJitter: 'speed jitter',
  blastRise: 'upward kick',
  blastSpin: 'mote spin °/s',
  blastStagger: 'mote stagger',
  blastShrink: 'end scale',
  numShow: 'number (0/1)',
  numSize: 'number px',
  numRise: 'number rise',
  numDelay: 'number delay',
  numHoldMs: 'number hold',
  numFadeMs: 'number fade',
  glowAlpha: 'glow α',
  glowWidth: 'glow width',
  colorA: 'pink',
  colorB: 'purple',
  colorC: 'gold',
  colorText: 'number fill',
  colorOutline: 'number outline',
};

export function RubyPowerFxTuner() {
  const [cfg, setCfg] = useState<RubyPowerFxConfig>(getRubyPowerFxConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('rubypowerfx');

  const set = (k: keyof RubyPowerFxConfig, v: number | string): void => {
    setRubyPowerFxValue(k, v);
    setCfg({ ...getRubyPowerFxConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getRubyPowerFxConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetRubyPowerFxConfig(); setCfg({ ...getRubyPowerFxConfig() }); };

  const sliderKeys = RUBYPOWERFX_KEYS.filter((k) => !RUBYPOWERFX_COLOR_KEYS.includes(k));

  return (
    <div className="sfxmix lunge" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Ruby Power <span>dev · next cast · drag</span></div>
      {sliderKeys.map((k) => {
        const [min, max, step] = RUBYPOWERFX_RANGES[k]!;
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name">{SP_LABELS[k] ?? k}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k] as number} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{cfg[k]}</span>
          </div>
        );
      })}
      {RUBYPOWERFX_COLOR_KEYS.map((k) => (
        <div className="sfxmix-row" key={k}>
          <span className="sfxmix-name">{SP_LABELS[k] ?? k}</span>
          <input type="color" value={cfg[k] as string} onChange={(e) => set(k, e.target.value)} />
          <span className="sfxmix-val">{cfg[k]}</span>
        </div>
      ))}
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={testRubyPowerFx} title="Fire the ruby-power flourish over the current shop row — no Ruby buff needed">▶ Test FX</button>
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
