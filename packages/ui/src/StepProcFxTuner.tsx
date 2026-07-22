import { useState } from 'react';
import {
  STEPPROCFX_KEYS, STEPPROCFX_COLOR_KEYS, STEPPROCFX_RANGES,
  getStepProcFxConfig, resetStepProcFxConfig, setStepProcFxValue, type StepProcFxConfig,
} from './stepProcFxConfig';
import { useDraggablePanel } from './useDraggablePanel';
import { testStepProcFx } from './fxTestFire';

/**
 * DEV-only "Step Proc" tuner — the counter-filled flourish (`stepProcFxConfig` → `pixiFx.spellPower`): the
 * rising arrow fan + origin mote blast that fires FROM a unit's step-counter pill the moment the counter
 * reaches its total (Avenge, Guel, Flowing Monk, Crypt Drake, Bloodbinder, gold/buy meters, cadence cards,
 * Spirit Pup, Tara's ascend). Deliberately SEPARATE from the ✨ Spell Power tuner even though both drive the
 * same primitive, so the counter flourish can be sized/tuned on its own (owner ask).
 *
 * No floating number here (owner call) — a step proc has no natural stat gain to print. Persists to
 * localStorage; edits apply to the NEXT proc, so ▶ Test fires it from a real counter pill on screen (falling
 * back to the shop row) rather than making you stage one. Dev-only — stripped from production.
 */
const ST_LABELS: Partial<Record<keyof StepProcFxConfig, string>> = {
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
  glowAlpha: 'glow α',
  glowWidth: 'glow width',
  colorA: 'pink',
  colorB: 'purple',
  colorC: 'gold',
};

export function StepProcFxTuner() {
  const [cfg, setCfg] = useState<StepProcFxConfig>(getStepProcFxConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('stepprocfx');

  const set = (k: keyof StepProcFxConfig, v: number | string): void => {
    setStepProcFxValue(k, v);
    setCfg({ ...getStepProcFxConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getStepProcFxConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetStepProcFxConfig(); setCfg({ ...getStepProcFxConfig() }); };

  const sliderKeys = STEPPROCFX_KEYS.filter((k) => !STEPPROCFX_COLOR_KEYS.includes(k));

  return (
    <div className="sfxmix lunge" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Step Proc <span>dev · next proc · drag</span></div>
      {sliderKeys.map((k) => {
        const [min, max, step] = STEPPROCFX_RANGES[k]!;
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name">{ST_LABELS[k] ?? k}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k] as number} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{cfg[k]}</span>
          </div>
        );
      })}
      {STEPPROCFX_COLOR_KEYS.map((k) => (
        <div className="sfxmix-row" key={k}>
          <span className="sfxmix-name">{ST_LABELS[k] ?? k}</span>
          <input type="color" value={cfg[k] as string} onChange={(e) => set(k, e.target.value)} />
          <span className="sfxmix-val">{cfg[k]}</span>
        </div>
      ))}
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={testStepProcFx} title="Fire the step-proc flourish from a step counter on screen (falls back to the shop row) — no proc needed">▶ Test FX</button>
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
