import { useState } from 'react';
import {
  AURAFX_KEYS, AURAFX_RANGES, getAuraFxConfig, resetAuraFxConfig, setAuraFxValue, type AuraFxConfig,
} from './auraFxConfig';
import { useDraggablePanel } from './useDraggablePanel';
import { testAuraFx, type AuraTestTribe } from './fxTestFire';

/**
 * DEV-only "Aura Wash" tuner — the run-wide tribe-aura bloom (`auraFxConfig` → `pixiFx.auraWash`): the
 * per-card rising sweep, fill glow, motes, landing ring, and the lift & settle. Persists to localStorage;
 * edits apply to the NEXT wash — cast a Lantern of Souls / play an Imp Overseer / an Attachment Mechanic
 * to judge, or ▶ Test with a tribe. Colors are NOT dials: the wash reads the tribe's BUFF_PRESETS palette
 * at fire time, so it always matches that tribe's tendril look. Dev-only — stripped from production.
 */
const AURA_LABELS: Partial<Record<keyof AuraFxConfig, string>> = {
  riseMs: 'sweep ms',
  holdMs: 'hold ms',
  fadeMs: 'fade ms',
  staggerMs: 'card stagger',
  fillAlpha: 'fill α',
  padPx: 'fill pad',
  sweepAlpha: 'band α',
  sweepFrac: 'band height ×',
  moteCount: 'motes/card',
  moteSize: 'mote px',
  moteLife: 'mote life',
  moteRise: 'mote rise',
  ringSize: 'land ring',
  ringMs: 'ring ms',
  ringAlpha: 'ring α',
  liftPx: 'card lift px',
  liftMs: 'lift ms',
};

const TEST_TRIBES: AuraTestTribe[] = ['undead', 'demon', 'mech', 'beast'];

export function AuraFxTuner() {
  const [cfg, setCfg] = useState<AuraFxConfig>(getAuraFxConfig());
  const [copied, setCopied] = useState(false);
  const [tribe, setTribe] = useState<AuraTestTribe>('undead');
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('aurafx');

  const set = (k: keyof AuraFxConfig, v: number): void => { setAuraFxValue(k, v); setCfg({ ...getAuraFxConfig() }); };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getAuraFxConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetAuraFxConfig(); setCfg({ ...getAuraFxConfig() }); };

  return (
    <div className="sfxmix lunge" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Aura Wash <span>dev · next wash · drag</span></div>
      {AURAFX_KEYS.map((k) => {
        const [min, max, step] = AURAFX_RANGES[k]!;
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name">{AURA_LABELS[k] ?? k}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k]} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{cfg[k]}</span>
          </div>
        );
      })}
      <div className="lunge-btns">
        {TEST_TRIBES.map((t) => (
          <button key={t} className="sfxmix-copy" style={tribe === t ? { outline: '1px solid currentColor' } : undefined} onClick={() => setTribe(t)}>{t}</button>
        ))}
      </div>
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={() => testAuraFx(tribe)} title="Wash the current board + shop cards in the picked tribe's colors — no aura source needed">▶ Test FX</button>
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
