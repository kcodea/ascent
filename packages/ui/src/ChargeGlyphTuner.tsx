import { useEffect, useMemo, useRef, useState } from 'react';
import { useDraggablePanel } from './useDraggablePanel';
import { chargeTune, chargePreview } from './chargeGlyphTune';

/**
 * DEV-only floating tuner for the end-of-turn CHARGE GLYPH (see `.chargeglyph` in styles.css + `ChargeGlyph` in
 * Recruit.tsx). The look rides `--cg-*` vars with baked fallbacks; this panel COMPOSES those vars from colour
 * pickers + sliders and writes an override `<style id="chargeglyphtuner">` (specificity-bumped) so every knob
 * updates the real glyph LIVE — at TRUE game scale, which the standalone fx/turn-glyph-preview.html can't match.
 *
 * Preview: the glyph only shows in the last ~20s of a turn, so a "Show / Play / scrub" block drives `chargePreview`
 * (a tiny store the component honours) to force it on-screen and scrub the fill 0→1 on demand. The core-bloom curve
 * (bloomAt / coreMax) mutates `chargeTune` live (visible while Play runs or when the scrub moves).
 *
 * "Copy CSS" emits paste-ready values to bake into styles.css (+ chargeGlyphTune.ts for the bloom curve). On close
 * the override + preview are cleared and `chargeTune` is restored, so shipped behaviour resumes. Dev-only (mounted
 * from DevMenu) → stripped from production. Placement (Size/X/Y) lives in the Layout Lab "Charge Glyph" group.
 */
type Knob = { key: string; label: string; min: number; max: number; step: number; def: number; unit?: string };

const KNOBS: Knob[] = [
  { key: 'm1', label: 'gradient mid stop', min: 8, max: 49, step: 1, def: 24, unit: '%' },
  { key: 'glowIn', label: 'glow inner', min: 0, max: 40, step: 1, def: 20, unit: 'px' },
  { key: 'glowOut', label: 'glow outer', min: 0, max: 80, step: 1, def: 31, unit: 'px' },
  { key: 'glowOutA', label: 'glow outer α', min: 0, max: 1, step: 0.01, def: 0.6 },
  { key: 'coreW', label: 'core width', min: 8, max: 90, step: 1, def: 55, unit: '%' },
  { key: 'coreH', label: 'core height', min: 5, max: 60, step: 1, def: 20, unit: '%' },
  { key: 'feather', label: 'front feather', min: 0, max: 24, step: 0.5, def: 0, unit: '%' },
  { key: 'pulseMin', label: 'pulse min', min: 0.3, max: 1, step: 0.01, def: 0.63 },
  { key: 'pulseS', label: 'pulse speed', min: 1, max: 8, step: 0.1, def: 2.5, unit: 's' },
  { key: 'baseA', label: 'unlit etch α', min: 0, max: 0.4, step: 0.01, def: 0.14 },
  { key: 'bloomAt', label: 'core bloom start', min: 0, max: 1, step: 0.01, def: 0.49 },
  { key: 'coreMax', label: 'core bloom max', min: 0, max: 1, step: 0.01, def: 1 },
];

type Vals = Record<string, number>;
const LS_KEY = 'ascent.chargeGlyphTuner';
const defaults = (): Vals => Object.fromEntries(KNOBS.map((k) => [k.key, k.def]));

const hexToRgb = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgba = (h: string, a: number): string => {
  const [r, g, b] = hexToRgb(h);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

type Colors = { core: string; mid: string; deep: string };
const DEF_COLORS: Colors = { core: '#eafcff', mid: '#33b0ff', deep: '#0a40ff' };

const fillGrad = (c: Colors, v: Vals): string =>
  `linear-gradient(90deg, ${c.deep} 0%, ${c.mid} ${v.m1}%, ${c.core} 50%, ${c.mid} ${100 - v.m1}%, ${c.deep} 100%)`;
const glowF = (c: Colors, v: Vals): string =>
  `drop-shadow(0 0 ${v.glowIn}px ${rgba(c.mid, 0.85)}) drop-shadow(0 0 ${v.glowOut}px ${rgba(c.deep, v.glowOutA)})`;
const coreGrad = (c: Colors, v: Vals): string =>
  `radial-gradient(ellipse ${v.coreW}% ${v.coreH}% at 50% 50%, ${c.core} 0%, ${c.mid} 34%, transparent 62%)`;
const coreGlowF = (c: Colors, v: Vals): string => `drop-shadow(0 0 ${v.glowIn}px ${c.core})`;

const varsBlock = (c: Colors, v: Vals): string =>
  `--cg-fill: ${fillGrad(c, v)}; --cg-glow: ${glowF(c, v)}; --cg-core: ${coreGrad(c, v)}; ` +
  `--cg-core-glow: ${coreGlowF(c, v)}; --cg-base: ${c.deep}; --cg-base-a: ${v.baseA}; ` +
  `--cg-pulse-min: ${v.pulseMin}; --cg-pulse-s: ${v.pulseS}s; --feather: ${v.feather}%;`;

export function ChargeGlyphTuner() {
  const [vals, setVals] = useState<Vals>(() => {
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      return { ...defaults(), ...(s.vals ?? {}) };
    } catch {
      return defaults();
    }
  });
  const [colors, setColors] = useState<Colors>(() => {
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      return { ...DEF_COLORS, ...(s.colors ?? {}) };
    } catch {
      return DEF_COLORS;
    }
  });
  const [scrub, setScrub] = useState(1);
  const [showing, setShowing] = useState(true);
  const [copied, setCopied] = useState(false);
  const rafRef = useRef(0);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('chargeglyph');

  // Live apply the composed look vars via one <style id="chargeglyphtuner"> (bumped selector so it always wins).
  const style = useMemo(() => `.chargeglyph.chargeglyph { ${varsBlock(colors, vals)} }`, [colors, vals]);
  useEffect(() => {
    let el = document.getElementById('chargeglyphtuner') as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = 'chargeglyphtuner';
      document.head.appendChild(el);
    }
    el.textContent = style;
  }, [style]);

  // The bloom curve isn't a CSS var — mutate the shared knobs the component reads each frame.
  useEffect(() => {
    chargeTune.bloomAt = vals.bloomAt;
    chargeTune.coreMax = vals.coreMax;
  }, [vals.bloomAt, vals.coreMax]);

  // Force-show + scrub the glyph via the preview store (null → back on the real clock).
  useEffect(() => {
    chargePreview.set(showing ? scrub : null);
  }, [showing, scrub]);

  // Persist; tear everything down on close so shipped behaviour resumes.
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ vals, colors }));
    } catch {
      /* ignore */
    }
  }, [vals, colors]);
  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      document.getElementById('chargeglyphtuner')?.remove();
      chargePreview.set(null);
      chargeTune.bloomAt = 0.49;
      chargeTune.coreMax = 1;
    },
    [],
  );

  const play = (): void => {
    cancelAnimationFrame(rafRef.current);
    setShowing(true);
    const t0 = performance.now();
    const step = (now: number): void => {
      const f = Math.min(1, (now - t0) / 20000);
      setScrub(f);
      if (f < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  };
  const stopPlay = (): void => cancelAnimationFrame(rafRef.current);

  const copy = (): void => {
    const out =
      `/* Charge Glyph — bake into styles.css (replace the var fallbacks) */\n` +
      `.chargeglyph .charge-fill { background: ${fillGrad(colors, vals)}; filter: ${glowF(colors, vals)}; }\n` +
      `@keyframes chargepulse { 0%,100% { opacity: ${vals.pulseMin}; } 50% { opacity: 1; } } /* animation ${vals.pulseS}s */\n` +
      `.chargeglyph .charge-core { background: ${coreGrad(colors, vals)}; filter: ${coreGlowF(colors, vals)}; }\n` +
      `.chargeglyph .charge-base { background: ${colors.deep}; opacity: ${vals.baseA}; }\n` +
      `.chargeglyph { --feather: ${vals.feather}%; }\n` +
      `/* chargeGlyphTune.ts → chargeTune: bloomAt ${vals.bloomAt}, coreMax ${vals.coreMax} */`;
    void navigator.clipboard?.writeText(out);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => {
    setVals(defaults());
    setColors(DEF_COLORS);
  };

  const colorRow = (label: string, key: keyof Colors) => (
    <div className="sfxmix-row" key={key}>
      <span className="sfxmix-name">{label}</span>
      <input type="color" value={colors[key]} onChange={(e) => setColors({ ...colors, [key]: e.target.value })} />
      <span className="sfxmix-val">{colors[key]}</span>
    </div>
  );

  return (
    <div className="sfxmix" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>
        Charge Glyph <span>dev · live · drag</span>
      </div>

      <div className="sfxmix-sub">Preview (force-show + scrub)</div>
      <div className="sfxmix-row">
        <span className="sfxmix-name">charge</span>
        <input type="range" min={0} max={1} step={0.001} value={scrub} onChange={(e) => { stopPlay(); setShowing(true); setScrub(Number(e.target.value)); }} />
        <span className="sfxmix-val">{Math.round(scrub * 100)}%</span>
      </div>
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={play}>▶ Play 20s</button>
        <button className="sfxmix-copy" onClick={() => { stopPlay(); setShowing((s) => !s); }}>{showing ? 'Hide' : 'Show'}</button>
      </div>

      <div className="sfxmix-sub">Colour</div>
      {colorRow('core (white-hot)', 'core')}
      {colorRow('mid (cyan)', 'mid')}
      {colorRow('deep (blue)', 'deep')}

      <div className="sfxmix-sub">Look</div>
      {KNOBS.map((k) => (
        <div className="sfxmix-row" key={k.key}>
          <span className="sfxmix-name">{k.label}</span>
          <input
            type="range" min={k.min} max={k.max} step={k.step} value={vals[k.key]}
            onChange={(e) => setVals({ ...vals, [k.key]: Number(e.target.value) })}
          />
          <span className="sfxmix-val">{vals[k.key]}{k.unit ?? ''}</span>
        </div>
      ))}

      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy CSS'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
