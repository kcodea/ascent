import { useEffect, useMemo, useState } from 'react';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only floating tuner for the authored card frames (the gold OVAL on minions + the purple SQUARE on spells,
 * see styles.css "AUTHORED FRAMES"). Every knob is a CSS custom property scoped to `.card.compact.stdframe` /
 * `.card.compact.spellframe`; this panel writes an override `<style>` (specificity-bumped so it always wins) so
 * dragging a slider updates every on-screen card LIVE. "Copy CSS" grabs the two paste-ready knob lines to bake
 * into styles.css as the shipped defaults. Dev-only (mounted from DevMenu) → stripped from production.
 */
type Knob = { key: string; label: string; min: number; max: number; step: number; def: number; pct?: boolean };

// Defaults MIRROR the shipped values in styles.css — keep them in sync when you bake in new numbers.
const STD_KNOBS: Knob[] = [
  { key: 'sh', label: 'frame size', min: 0.5, max: 1.0, step: 0.01, def: 0.73 },
  { key: 'fill', label: 'art overfill', min: 1.0, max: 1.5, step: 0.01, def: 1.28 },
  { key: 'dy', label: 'all Y', min: -0.1, max: 0.15, step: 0.005, def: 0.0 },
  { key: 'frameY', label: 'frame Y', min: -0.05, max: 0.15, step: 0.005, def: 0.03 },
  { key: 'tier', label: 'tier seat', min: 0.5, max: 1.0, step: 0.01, def: 0.83 },
  { key: 'artY', label: 'art vert %', min: 0, max: 100, step: 1, def: 60, pct: true },
  { key: 'artZoom', label: 'art zoom', min: 0.8, max: 1.8, step: 0.01, def: 1.12 },
  { key: 'wardsize', label: 'ward size (DS)', min: 0.4, max: 1.2, step: 0.01, def: 1.2 },
  { key: 'wardy', label: 'ward Y % (DS)', min: 30, max: 80, step: 1, def: 46, pct: true },
  { key: 'fovl-a', label: 'overlay opacity', min: 0, max: 1, step: 0.01, def: 0.75 },
];
const SPELL_KNOBS: Knob[] = [
  { key: 'sh', label: 'frame size', min: 0.5, max: 1.0, step: 0.01, def: 0.78 },
  { key: 'fill', label: 'art overfill', min: 1.0, max: 1.5, step: 0.01, def: 1.22 },
  { key: 'dy', label: 'all Y', min: -0.1, max: 0.15, step: 0.005, def: -0.02 },
  { key: 'frameY', label: 'frame Y', min: -0.05, max: 0.15, step: 0.005, def: 0.02 },
  { key: 'tier', label: 'tier seat', min: 0.5, max: 1.0, step: 0.01, def: 0.67 },
  { key: 'artY', label: 'art vert %', min: 0, max: 100, step: 1, def: 48, pct: true },
  { key: 'artZoom', label: 'art zoom', min: 0.8, max: 1.8, step: 0.01, def: 1.02 },
  { key: 'artRound', label: 'corner round %', min: 0, max: 40, step: 1, def: 13, pct: true },
  { key: 'artAR', label: 'window height', min: 0.6, max: 1.4, step: 0.01, def: 1.06 },
  { key: 'artW', label: 'window width', min: 0.6, max: 1.2, step: 0.01, def: 0.97 },
  { key: 'fovl-a', label: 'overlay opacity', min: 0, max: 1, step: 0.01, def: 0 },
];
// Colour-overlay tint (`.cframe-tint`, masked to the frame PNG) — colour per section; opacity is the knob above.
// Blend of the tint against the frame pixels: multiply darkens (keeps engraving shadows), overlay recolours
// preserving highlights, screen brightens, color swaps hue/sat keeping luminosity (truest "different metal").
const BLENDS = ['normal', 'multiply', 'overlay', 'screen', 'color'] as const;
type Blend = (typeof BLENDS)[number];
// Per-section shipped defaults (owner bake 2026-07-19): the minion oval carries a dark-slate overlay tint
// (steel look); the spell square is a no-op. Mirror styles.css — keep in sync when new values are baked.
const DEF_TINT_STD = '#272a35';
const DEF_BLEND_STD: Blend = 'overlay';
const DEF_TINT_SPELL = '#ffffff';
const DEF_BLEND_SPELL: Blend = 'normal';

type Vals = Record<string, number>;
const defaults = (knobs: Knob[]): Vals => Object.fromEntries(knobs.map((k) => [k.key, k.def]));
const declLine = (knobs: Knob[], v: Vals): string =>
  knobs.map((k) => `--${k.key}: ${v[k.key]}${k.pct ? '%' : ''};`).join(' ');
// specificity-bumped selectors (repeated class) so the override always beats the base rule, whatever the order
const cssText = (std: Vals, spell: Vals, stdTint: string, spellTint: string, stdBlend: Blend, spellBlend: Blend): string =>
  `.card.compact.stdframe.stdframe { ${declLine(STD_KNOBS, std)} --fovl: ${stdTint}; --fovl-blend: ${stdBlend}; }\n` +
  `.card.compact.spellframe.spellframe { ${declLine(SPELL_KNOBS, spell)} --fovl: ${spellTint}; --fovl-blend: ${spellBlend}; }`;

export function FrameTuner() {
  const [std, setStd] = useState<Vals>(() => defaults(STD_KNOBS));
  const [spell, setSpell] = useState<Vals>(() => defaults(SPELL_KNOBS));
  const [stdTint, setStdTint] = useState(DEF_TINT_STD);
  const [spellTint, setSpellTint] = useState(DEF_TINT_SPELL);
  const [stdBlend, setStdBlend] = useState<Blend>(DEF_BLEND_STD);
  const [spellBlend, setSpellBlend] = useState<Blend>(DEF_BLEND_SPELL);
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('frame');

  const style = useMemo(
    () => cssText(std, spell, stdTint, spellTint, stdBlend, spellBlend),
    [std, spell, stdTint, spellTint, stdBlend, spellBlend],
  );
  // Live apply: keep a single <style id="frametuner"> in sync with the sliders.
  useEffect(() => {
    let el = document.getElementById('frametuner') as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = 'frametuner';
      document.head.appendChild(el);
    }
    el.textContent = style;
    return () => { /* leave the last values applied while the panel is open */ };
  }, [style]);
  // Remove the override entirely when the panel unmounts, so the shipped CSS resumes.
  useEffect(() => () => { document.getElementById('frametuner')?.remove(); }, []);

  const copy = (): void => {
    // Paste-ready knob lines for styles.css (unbumped selectors — the shipped rules).
    const out =
      `.card.compact.stdframe { ${declLine(STD_KNOBS, std)} --fovl: ${stdTint}; --fovl-blend: ${stdBlend}; }\n` +
      `.card.compact.spellframe { ${declLine(SPELL_KNOBS, spell)} --fovl: ${spellTint}; --fovl-blend: ${spellBlend}; }`;
    void navigator.clipboard?.writeText(out);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => {
    setStd(defaults(STD_KNOBS)); setSpell(defaults(SPELL_KNOBS));
    setStdTint(DEF_TINT_STD); setSpellTint(DEF_TINT_SPELL); setStdBlend(DEF_BLEND_STD); setSpellBlend(DEF_BLEND_SPELL);
  };

  const tintRow = (label: string, tint: string, setTint: (v: string) => void) => (
    <div className="sfxmix-row">
      <span className="sfxmix-name">{label}</span>
      <input type="color" value={tint} onChange={(e) => setTint(e.target.value)} />
      <span className="sfxmix-val">{tint}</span>
    </div>
  );
  const blendRow = (blend: Blend, setBlend: (v: Blend) => void) => (
    <div className="sfxmix-row">
      <span className="sfxmix-name">overlay blend</span>
      <select value={blend} onChange={(e) => setBlend(e.target.value as Blend)}>
        {BLENDS.map((b) => <option key={b} value={b}>{b}</option>)}
      </select>
      <span className="sfxmix-val" />
    </div>
  );

  const rows = (knobs: Knob[], vals: Vals, setVals: (v: Vals) => void) =>
    knobs.map((k) => (
      <div className="sfxmix-row" key={k.key}>
        <span className="sfxmix-name">{k.label}</span>
        <input
          type="range" min={k.min} max={k.max} step={k.step} value={vals[k.key]}
          onChange={(e) => setVals({ ...vals, [k.key]: Number(e.target.value) })}
        />
        <span className="sfxmix-val">{vals[k.key]}{k.pct ? '%' : ''}</span>
      </div>
    ));

  return (
    <div className="sfxmix lunge flip" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Card Frames <span>dev · live · drag</span></div>
      <div className="sfxmix-sub">Standard oval (minions)</div>
      {rows(STD_KNOBS, std, setStd)}
      {tintRow('overlay colour', stdTint, setStdTint)}
      {blendRow(stdBlend, setStdBlend)}
      <div className="sfxmix-sub">Spell square</div>
      {rows(SPELL_KNOBS, spell, setSpell)}
      {tintRow('overlay colour', spellTint, setSpellTint)}
      {blendRow(spellBlend, setSpellBlend)}
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy CSS'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
