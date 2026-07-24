import { useState } from 'react';
import {
  SBF_NUM_KEYS, SBF_COLOR_KEYS, SBF_RANGES, SBF_DESC,
  getSpellBuffFxConfig, resetSpellBuffFxConfig, setSpellBuffFxValue, type SpellBuffFxConfig,
} from './spellBuffFxConfig';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only "Spell Buff FX" tuner — the cue a hand SPELL or Ruby plays when its printed value goes UP
 * (`spellBuffFxConfig` → `Card`'s `.spellbuff` wiggle + `.sbspark` motes): a wiggle + grow/shrink pop and a
 * burst of pink/gold/purple sparks that rise off the card. Slider dials + colour pickers persist to
 * localStorage and apply to the NEXT burst. **Test** fires it on every spell/Ruby currently in hand so it can
 * be dialed without waiting for a real buff. "Copy" grabs the JSON to bake as the shipped defaults; "Reset"
 * clears. Dev-only — stripped from production.
 */
const LABELS: Record<keyof SpellBuffFxConfig, string> = {
  sparkCount: 'spark count',
  sparkSizeMin: 'spark size min',
  sparkSizeMax: 'spark size max',
  sparkSpread: 'spawn spread %',
  sparkOriginLo: 'spawn low %',
  sparkOriginHi: 'spawn high %',
  sparkRiseMin: 'rise min px',
  sparkRiseMax: 'rise max px',
  sparkSpeed: 'launch punch',
  sparkGravity: 'gravity px',
  sparkDrift: 'drift px',
  sparkAlpha: 'spark α',
  sparkGlow: 'spark glow',
  sparkTail: 'tail ×size',
  sparkMs: 'spark ms',
  sparkStagger: 'stagger ms',
  pinkColor: 'pink',
  goldColor: 'gold',
  purpleColor: 'purple',
  wiggleDeg: 'wiggle°',
  wiggleScale: 'pop scale',
  wiggleMs: 'wiggle ms',
  wiggleEase: 'pop softness',
  wiggleOvershoot: 'pop spring',
};

export function SpellBuffFxTuner() {
  const [cfg, setCfg] = useState<SpellBuffFxConfig>(getSpellBuffFxConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('spellbufffx');

  const set = (k: keyof SpellBuffFxConfig, v: number | string): void => { setSpellBuffFxValue(k, v); setCfg({ ...getSpellBuffFxConfig() }); };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getSpellBuffFxConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetSpellBuffFxConfig(); setCfg({ ...getSpellBuffFxConfig() }); };
  // Recruit publishes this while it's mounted — fires the cue on every spell/Ruby in hand right now.
  const test = (): void => { (window as { __spellBuffTest?: () => void }).__spellBuffTest?.(); };

  return (
    <div className="sfxmix lunge" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Spell Buff FX <span>dev · next burst · drag</span></div>
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={test}>✨ Test</button>
      </div>
      {SBF_NUM_KEYS.map((k) => {
        const [min, max, step] = SBF_RANGES[k];
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name" title={SBF_DESC[k]}>{LABELS[k]}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k] as number} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{cfg[k]}</span>
          </div>
        );
      })}
      {SBF_COLOR_KEYS.map((k) => (
        <div className="sfxmix-row" key={k}>
          <span className="sfxmix-name" title={SBF_DESC[k]}>{LABELS[k]}</span>
          <input type="color" value={cfg[k] as string} onChange={(e) => set(k, e.target.value)} />
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
