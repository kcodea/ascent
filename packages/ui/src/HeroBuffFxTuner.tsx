import { useState } from 'react';
import {
  HEROBUFFFX_KEYS, HEROBUFFFX_COLOR_KEYS, HEROBUFFFX_RANGES,
  getHeroBuffFxConfig, resetHeroBuffFxConfig, setHeroBuffFxValue, type HeroBuffFxConfig,
} from './heroBuffFxConfig';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only "Hero Buff Flash" tuner — the shard/blast pop with an eased ripple over the hero portrait when any
 * run buff grows (`heroBuffFxConfig` → the `.herobuff-blast` CSS). Persists to localStorage; edits reflect to
 * the `--hbf-*` vars immediately, so ▶ Test replays the flash on the live portrait. "Copy" grabs the JSON to
 * bake as the shipped defaults; "Reset" clears.
 */
const HBF_LABELS: Partial<Record<keyof HeroBuffFxConfig, string>> = {
  rippleScale: 'ripple size ×',
  rippleMs: 'ripple ms',
  rippleWidth: 'ripple width',
  shardScale: 'shard size ×',
  shardMs: 'shard ms',
  shardRotate: 'shard spin °',
  shardSpokes: 'shard spokes',
  peakAlpha: 'shard α',
  colorCore: 'colour',
};

/** Replay the flash on the live portrait by remounting `.herobuff-blast` via a one-off clone. Simplest
 *  reliable trigger without threading state into StatusBar: toggle a data attr the component watches. */
function fireTest(): void {
  const f = document.querySelector('.statusbar .hero .f');
  if (!f) return;
  const old = f.querySelector('.herobuff-blast');
  if (old) old.remove();
  const el = document.createElement('span');
  el.className = 'herobuff-blast';
  el.setAttribute('aria-hidden', 'true');
  f.insertBefore(el, f.firstChild);
}

export function HeroBuffFxTuner() {
  const [cfg, setCfg] = useState<HeroBuffFxConfig>(getHeroBuffFxConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('herobufffx');

  const set = (k: keyof HeroBuffFxConfig, v: number | string): void => {
    setHeroBuffFxValue(k, v);
    setCfg({ ...getHeroBuffFxConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getHeroBuffFxConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetHeroBuffFxConfig(); setCfg({ ...getHeroBuffFxConfig() }); };

  const sliderKeys = HEROBUFFFX_KEYS.filter((k) => !HEROBUFFFX_COLOR_KEYS.includes(k));

  return (
    <div className="sfxmix lunge" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Hero Buff Flash <span>dev · live · drag</span></div>
      {sliderKeys.map((k) => {
        const [min, max, step] = HEROBUFFFX_RANGES[k]!;
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name">{HBF_LABELS[k] ?? k}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k] as number} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{cfg[k]}</span>
          </div>
        );
      })}
      {HEROBUFFFX_COLOR_KEYS.map((k) => (
        <div className="sfxmix-row" key={k}>
          <span className="sfxmix-name">{HBF_LABELS[k] ?? k}</span>
          <input type="color" value={cfg[k] as string} onChange={(e) => set(k, e.target.value)} />
          <span className="sfxmix-val">{cfg[k]}</span>
        </div>
      ))}
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={fireTest} title="Replay the flash on the hero portrait">▶ Test FX</button>
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
