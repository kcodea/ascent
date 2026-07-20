import { useEffect, useMemo, useState } from 'react';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only floating tuner for the COMPENDIUM palette (styles.css "Compendium palette + scale").
 *
 * The book recolours by re-declaring the shared ink/card/line vars scoped to `.book`, so every descendant
 * rule follows — which means the whole palette is tunable from one place. This panel writes an override
 * `<style>` (specificity-bumped so it always wins) and every picker updates the open Compendium LIVE.
 *
 * Two traps this exists to avoid, both hit while hand-picking the navy:
 *  - The panel/header used to mix the GOLD accent into the surface, so a correct colour var still rendered
 *    grey. The overrides here state each surface directly — what you pick is what paints.
 *  - Inverting to a dark surface left the CONTROL CHROME (rail, tabs, Glossary/Gilded, close, search) pale
 *    on pale, because it reads `--bg2`. That is a knob here, so it can never silently disagree again.
 *
 * "Copy CSS" grabs the paste-ready block to bake into styles.css as the shipped defaults.
 * Dev-only (mounted from DevMenu) → stripped from production.
 */
type Swatch = { key: string; label: string; def: string; hint?: string };

// Defaults MIRROR the shipped values in styles.css — keep in sync when you bake in new numbers.
const SWATCHES: Swatch[] = [
  { key: 'card', label: 'surface', def: '#004c8a', hint: 'the panel body behind the cards' },
  { key: 'head', label: 'header bar', def: '#003f74' },
  { key: 'rail', label: 'side rail', def: '#003a6a' },
  { key: 'bg2', label: 'buttons / tabs', def: '#013f73', hint: 'rail buttons, tier tabs, Glossary, close' },
  { key: 'line', label: 'borders', def: '#1d6fb8' },
  { key: 'ink', label: 'text', def: '#eef5fd' },
  { key: 'ink3', label: 'text (dim)', def: '#9dbfdf', hint: 'counts, power blurbs' },
];

type Vals = Record<string, string>;
const defaults = (): Vals => Object.fromEntries(SWATCHES.map((s) => [s.key, s.def]));

/**
 * The surface can be a FLAT fill or a GRADIENT (owner request: "give it some depth"). The gradient runs
 * from `top` down to the surface colour, so the flat pick stays the base and the second colour only lifts
 * the top edge — dialling `depth` to 0 makes it visually identical to flat.
 */
const DEF_GRAD = true;
const DEF_TOP = '#005ea8';
const DEF_DEPTH = 16; // % of the panel height the top colour occupies before it lands on the surface

const cssText = (v: Vals, grad: boolean, top: string, depth: number): string =>
  `.book.book {\n` +
  `  --card: ${v.card}; --line: ${v.line}; --ink: ${v.ink}; --ink3: ${v.ink3};\n` +
  `  --bg2: ${v.bg2}; --bg3: ${v.bg2};\n` +
  `}\n` +
  `.book.book { background: ${grad ? `linear-gradient(180deg, ${top} 0%, ${v.card} ${depth}%)` : v.card}; }\n` +
  `.book.book .book-head { background: ${v.head}; }\n` +
  `.book.book .book-rail { background: ${v.rail}; }`;

export function BookTuner() {
  const [vals, setVals] = useState<Vals>(defaults);
  const [grad, setGrad] = useState(DEF_GRAD);
  const [top, setTop] = useState(DEF_TOP);
  const [depth, setDepth] = useState(DEF_DEPTH);
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('booktuner');

  const style = useMemo(() => cssText(vals, grad, top, depth), [vals, grad, top, depth]);

  // Live apply: keep a single <style id="booktuner"> in sync with the pickers.
  useEffect(() => {
    let el = document.getElementById('booktuner') as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = 'booktuner';
      document.head.appendChild(el);
    }
    el.textContent = style;
  }, [style]);
  // Drop the override when the panel closes, so the shipped palette comes back.
  useEffect(() => () => { document.getElementById('booktuner')?.remove(); }, []);

  const copy = (): void => {
    void navigator.clipboard?.writeText(style);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => {
    setVals(defaults()); setGrad(DEF_GRAD); setTop(DEF_TOP); setDepth(DEF_DEPTH);
  };

  return (
    <div className="sfxmix lunge flip" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Compendium <span>dev · live · drag</span></div>
      <div className="sfxmix-sub">Open the Compendium to see changes</div>
      {SWATCHES.map((s) => (
        <div className="sfxmix-row" key={s.key} title={s.hint}>
          <span className="sfxmix-name">{s.label}</span>
          <input type="color" value={vals[s.key]} onChange={(e) => setVals({ ...vals, [s.key]: e.target.value })} />
          <span className="sfxmix-val">{vals[s.key]}</span>
        </div>
      ))}

      <div className="sfxmix-sub">Surface depth</div>
      <div className="sfxmix-row">
        <span className="sfxmix-name">gradient</span>
        <input type="checkbox" checked={grad} onChange={(e) => setGrad(e.target.checked)} />
        <span className="sfxmix-val">{grad ? 'on' : 'flat'}</span>
      </div>
      <div className="sfxmix-row" title="The colour the panel fades FROM at the top edge">
        <span className="sfxmix-name">top colour</span>
        <input type="color" value={top} disabled={!grad} onChange={(e) => setTop(e.target.value)} />
        <span className="sfxmix-val">{top}</span>
      </div>
      <div className="sfxmix-row" title="How far down the top colour reaches before landing on the surface">
        <span className="sfxmix-name">falloff</span>
        <input
          type="range" min={2} max={100} step={1} value={depth} disabled={!grad}
          onChange={(e) => setDepth(Number(e.target.value))}
        />
        <span className="sfxmix-val">{depth}%</span>
      </div>

      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy CSS'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
