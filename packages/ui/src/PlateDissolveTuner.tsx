import { useState } from 'react';
import {
  PD_NUM_KEYS,
  PD_COLOR_KEYS,
  PD_RANGES,
  PD_DESC,
  getPlateDissolveConfig,
  resetPlateDissolveConfig,
  setPlateDissolveValue,
  playPlateDissolve,
  type PlateDissolveConfig,
} from './plateDissolve';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only tuner for the ARCANE PLATE DISSOLVE (`plateDissolve.ts`) — the effect the hand-card backplate
 * plays when a minion is played. Dials the wireframe imprint (timing, brightness, glow, palette) and the
 * arcane dust (count, spread, life, trail).
 *
 * "Play here" fires the effect over the panel itself, so it can be dialed without dragging a card into the
 * board over and over. Note the WIREFRAME ITSELF is not tunable from here: its linework is baked into
 * `frames/cardplate-wire.webp` by `scripts/build-plate-wire.mjs`, because extracting it costs a blur, a
 * Sobel pass and a percentile sort that has no business running during a shop phase. To change the linework,
 * dial it in `fx/plate-dissolve-preview.html` and re-run `npm run wire:plate`.
 *
 * Unlike the CSS-var tuners in this folder there is no `var(--x, fallback)` half to keep in sync — this
 * module renders the effect itself, so its defaults ARE what ships.
 */
const LABELS: Record<string, string> = {
  total: 'total (ms)', inMs: 'imprint in', holdMs: 'hold', plateOut: 'plate out', fadeMs: 'wireframe fade',
  puff: 'puff scale', inten: 'intensity', g1: 'glow near', g2: 'glow far', grad: 'gradient',
  count: 'dust · count', onLines: 'dust · off lines', spd: 'dust · spread', spdVar: 'dust · spread var',
  lift: 'dust · lift', size: 'dust · size', sizeVar: 'dust · size var', life: 'dust · life',
  lifeVar: 'dust · life var', stag: 'dust · stagger', trail: 'dust · trail',
  cDeep: 'colour · deep', cMid: 'colour · mid', cCore: 'colour · core',
};

export function PlateDissolveTuner() {
  const [cfg, setCfg] = useState<PlateDissolveConfig>(getPlateDissolveConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, panelElRef, headerPointerDown, panelStyle } = useDraggablePanel('platedissolve');

  const set = (k: keyof PlateDissolveConfig, v: number | string): void => {
    setPlateDissolveValue(k, v);
    setCfg({ ...getPlateDissolveConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getPlateDissolveConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetPlateDissolveConfig(); setCfg({ ...getPlateDissolveConfig() }); };
  // Fire it over the panel so the effect can be judged without playing a card each time.
  const demo = (): void => {
    const el = panelElRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const w = 240, h = w * 1.555;
    playPlateDissolve({ left: r.left - w - 24, top: r.top + 40, width: w, height: h });
  };

  return (
    <div className="sfxmix lunge flip" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Plate Dissolve <span>dev · play a minion</span></div>
      {PD_NUM_KEYS.map((k) => {
        const [min, max, step] = PD_RANGES[k];
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name" title={PD_DESC[k]}>{LABELS[k] ?? k}</span>
            <input
              type="range" min={min} max={max} step={step}
              value={cfg[k as keyof PlateDissolveConfig] as number}
              onChange={(e) => set(k as keyof PlateDissolveConfig, Number(e.target.value))}
            />
            <span className="sfxmix-val">{String(cfg[k as keyof PlateDissolveConfig])}</span>
          </div>
        );
      })}
      {PD_COLOR_KEYS.map((k) => (
        <div className="sfxmix-row" key={k}>
          <span className="sfxmix-name" title={PD_DESC[k]}>{LABELS[k]}</span>
          <input type="color" value={cfg[k]} onChange={(e) => set(k, e.target.value)} />
          <span className="sfxmix-val">{cfg[k]}</span>
        </div>
      ))}
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={demo}>Play here</button>
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
