import { useState } from 'react';
import {
  PC_NUM_KEYS,
  PC_COLOR_KEYS,
  PC_RANGES,
  PC_DESC,
  getPlateCoalesceConfig,
  resetPlateCoalesceConfig,
  setPlateCoalesceValue,
  playPlateCoalesce,
  type PlateCoalesceConfig,
} from './plateCoalesce';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only tuner for the ARCANE PLATE COALESCE (`plateCoalesce.ts`) — what plays when a card is GENERATED
 * (combat grants, Discover picks, spell/Battlecry conjures, quest rewards). Deliberately does NOT fire for
 * shop buys or gilds; see the module for why.
 *
 * "Play here" fires it beside the panel so it can be dialed without waiting for a Deathrattle to proc.
 *
 * The wireframe linework is not tunable here — it's baked into `frames/cardplate-wire.webp` by
 * `scripts/build-plate-wire.mjs` and shared with the dissolve. Change it in
 * `fx/plate-coalesce-preview.html` + `npm run wire:plate`.
 */
const LABELS: Record<string, string> = {
  total: 'total (ms)', gatherMs: 'gather', wireIn: 'wire in', holdMs: 'hold', cardIn: 'card in',
  dist: 'rush · start dist', distVar: 'rush · dist var', swirl: 'rush · swirl', ease: 'rush · ease',
  stag: 'rush · arrive spread', linger: 'rush · linger',
  count: 'dust · count', onLines: 'dust · onto lines', size: 'dust · size', sizeVar: 'dust · size var',
  trail: 'dust · trail',
  puff: 'gather scale', inten: 'intensity', g1: 'glow near', g2: 'glow far', grad: 'gradient',
  cDeep: 'colour · deep', cMid: 'colour · mid', cCore: 'colour · core',
};

export function PlateCoalesceTuner() {
  const [cfg, setCfg] = useState<PlateCoalesceConfig>(getPlateCoalesceConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('platecoalesce');

  const set = (k: keyof PlateCoalesceConfig, v: number | string): void => {
    setPlateCoalesceValue(k, v);
    setCfg({ ...getPlateCoalesceConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getPlateCoalesceConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetPlateCoalesceConfig(); setCfg({ ...getPlateCoalesceConfig() }); };
  // Anchored on a real card rather than the panel: `useDraggablePanel` hands back a CALLBACK ref, so
  // `panelRef.current` was always undefined and this button silently did nothing (caught by typecheck:web,
  // which CI doesn't run — see the devlog).
  const demo = (): void => {
    const real = document.querySelector<HTMLElement>('.row.hand .card[data-uid]')
      ?? document.querySelector<HTMLElement>('.row .card[data-uid]');
    if (!real) return;
    const plate = real.querySelector<HTMLElement>('.cardplate');
    const r = (plate ?? real).getBoundingClientRect();
    if (r.width > 0) playPlateCoalesce(r, real);
  };

  return (
    <div className="sfxmix lunge flip" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Plate Coalesce <span>dev · card generated</span></div>
      {PC_NUM_KEYS.map((k) => {
        const [min, max, step] = PC_RANGES[k];
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name" title={PC_DESC[k]}>{LABELS[k] ?? k}</span>
            <input
              type="range" min={min} max={max} step={step}
              value={cfg[k as keyof PlateCoalesceConfig] as number}
              onChange={(e) => set(k as keyof PlateCoalesceConfig, Number(e.target.value))}
            />
            <span className="sfxmix-val">{String(cfg[k as keyof PlateCoalesceConfig])}</span>
          </div>
        );
      })}
      {PC_COLOR_KEYS.map((k) => (
        <div className="sfxmix-row" key={k}>
          <span className="sfxmix-name" title={PC_DESC[k]}>{LABELS[k]}</span>
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
