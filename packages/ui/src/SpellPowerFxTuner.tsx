import { useState } from 'react';
import {
  SPELLPOWERFX_KEYS, SPELLPOWERFX_COLOR_KEYS, SPELLPOWERFX_RANGES,
  getSpellPowerFxConfig, resetSpellPowerFxConfig, setSpellPowerFxValue, type SpellPowerFxConfig,
} from './spellPowerFxConfig';
import { useDraggablePanel } from './useDraggablePanel';
import { testSpellPowerFx } from './fxTestFire';

/**
 * DEV-only "Spell Power" tuner — the spell-resolved flourish (`spellPowerFxConfig` → `pixiFx.spellPower` +
 * `floatSpellPowerNumber`): the rising arrow fan, the origin mote blast, and the floating power number.
 * Persists to localStorage; edits apply to the NEXT cast, so ▶ Test fires it over the shop row rather than
 * making you stage a spell. "Copy" grabs the JSON to bake back as the shipped defaults; "Reset" clears.
 * Dev-only — stripped from production.
 */
const SP_LABELS: Partial<Record<keyof SpellPowerFxConfig, string>> = {
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
};

export function SpellPowerFxTuner() {
  const [cfg, setCfg] = useState<SpellPowerFxConfig>(getSpellPowerFxConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('spellpowerfx');

  const set = (k: keyof SpellPowerFxConfig, v: number | string): void => {
    setSpellPowerFxValue(k, v);
    setCfg({ ...getSpellPowerFxConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getSpellPowerFxConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetSpellPowerFxConfig(); setCfg({ ...getSpellPowerFxConfig() }); };

  const sliderKeys = SPELLPOWERFX_KEYS.filter((k) => !SPELLPOWERFX_COLOR_KEYS.includes(k));

  return (
    <div className="sfxmix lunge" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Spell Power <span>dev · next cast · drag</span></div>
      {sliderKeys.map((k) => {
        const [min, max, step] = SPELLPOWERFX_RANGES[k]!;
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name">{SP_LABELS[k] ?? k}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k] as number} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{cfg[k]}</span>
          </div>
        );
      })}
      {SPELLPOWERFX_COLOR_KEYS.map((k) => (
        <div className="sfxmix-row" key={k}>
          <span className="sfxmix-name">{SP_LABELS[k] ?? k}</span>
          <input type="color" value={cfg[k] as string} onChange={(e) => set(k, e.target.value)} />
          <span className="sfxmix-val">{cfg[k]}</span>
        </div>
      ))}
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={testSpellPowerFx} title="Fire the spell-power flourish over the current shop row — no spell needed">▶ Test FX</button>
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
