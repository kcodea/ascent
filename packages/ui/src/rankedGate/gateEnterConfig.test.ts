// @vitest-environment jsdom
/**
 * THE GATE'S WORD, TUNED (owner 2026-11-24): "make a tuner where i can adjust its x and y position, its scale, its
 * glow amount, glow blur, glow color, and give me ways to adjust the tint and color of the word itself".
 *
 * Pinned here:
 *   - every knob the owner asked for is a control, and the panel is registered where dev panels are found;
 *   - the stylesheet's `var(--rg-enter-*, fallback)` fallbacks ARE the shipped defaults (the two cannot drift);
 *   - what each knob writes: the place and size as numbers, the glow as two layers, the tint linked only while on;
 *   - a tune is live on :root at once, and Reset puts the shipped look back.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GATE_ENTER_BASE_W, GATE_ENTER_DEFAULTS, GATE_ENTER_TINT_ID, SPEC, gateEnterCssVars, getGateEnterConfig, resetGateEnterConfig,
  setGateEnterValue,
} from './gateEnterConfig';

const css = readFileSync(join(__dirname, 'rankedGate.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const src = (...p: string[]): string => readFileSync(join(__dirname, '..', ...p), 'utf8');
const root = (name: string): string => document.documentElement.style.getPropertyValue(name);

afterEach(() => resetGateEnterConfig());

describe('the gate word\'s tuner', () => {
  it('has a control for everything the owner asked to adjust', () => {
    const keys = SPEC.controls.map((c) => c.key);
    expect(keys).toEqual(expect.arrayContaining(['x', 'y', 'scale', 'glowAmount', 'glowBlur', 'glowColor']));
    // "ways to adjust the tint and color of the word itself": a tint (a colour and how much), and the colour as a whole.
    expect(keys).toEqual(expect.arrayContaining(['tintColor', 'tintAmount', 'hue', 'saturation', 'brightness']));
    expect(keys.sort()).toEqual(Object.keys(GATE_ENTER_DEFAULTS).sort());
    for (const key of ['glowColor', 'tintColor'] as const) expect(SPEC.controls.find((c) => c.key === key)!.kind, key).toBe('color');
    // Every slider's range holds its shipped value.
    for (const c of SPEC.controls.filter((x) => x.kind !== 'color')) {
      const v = GATE_ENTER_DEFAULTS[c.key] as number;
      expect(v, c.key).toBeGreaterThanOrEqual(c.min);
      expect(v, c.key).toBeLessThanOrEqual(c.max);
    }
    expect(SPEC.actions?.map((a) => a.label), 'a way to see the word while tuning it').toEqual(['▶ show gate']);
  });

  it('is registered: the dev menu lists it, the reset-all registry holds it, and it wears an emblem', () => {
    // Read as source: importing `tunerAll` or `DevMenu` pulls every panel (and Pixi) into jsdom.
    expect(src('DevMenu.tsx')).toContain(`key: '${SPEC.id}'`);
    expect(src('tunerAll.ts')).toMatch(/SPEC as GateEnterSpec[\s\S]*GateEnterSpec,/);
    expect(src('tunerSchema.ts')).toContain(`${SPEC.id}: '`);
    expect(src('GateEnterTuner.tsx')).toContain('<TunerPanel spec={SPEC} />');
    // The gate covers the screen and takes every pointer event, so this panel is lifted above it.
    expect(css).toMatch(new RegExp(`\\.sfxmix\\[data-devpanel="${SPEC.id}"\\] \\{ z-index: (\\d+) !important; \\}`));
    expect(Number(/data-devpanel="gateenter"\] \{ z-index: (\d+)/.exec(css)![1])).toBeGreaterThan(701);
  });

  it('the stylesheet\'s fallbacks are the shipped defaults', () => {
    const vars = gateEnterCssVars(GATE_ENTER_DEFAULTS);
    const fallback = (name: string): string => new RegExp(`var\\(${name}, ([^()]*?)\\)`).exec(css)![1]!.trim();
    for (const name of ['--rg-enter-x', '--rg-enter-dy', '--rg-enter-scale', '--rg-enter-glow-blur', '--rg-enter-hue', '--rg-enter-sat', '--rg-enter-bri', '--rg-enter-tint-col', '--rg-enter-tint-amt']) {
      expect(fallback(name), name).toBe(vars[name]);
    }
    // Shipped with no added glow and no tint: both glow layers are clear, and the tint step is absent.
    expect(GATE_ENTER_DEFAULTS.glowAmount).toBe(0);
    expect(GATE_ENTER_DEFAULTS.tintAmount).toBe(0);
    for (const layer of ['--rg-enter-glow-a', '--rg-enter-glow-b']) {
      expect(fallback(layer), layer).toBe('transparent');
      expect(vars[layer], layer).toMatch(/\/ 0\)$/);
    }
    expect(css).toContain('var(--rg-enter-tint, )');
    expect(vars['--rg-enter-tint']!.trim()).toBe('');
    // The size: the base width times the scale, in art pixels.
    expect(css).toContain(`width: calc(${GATE_ENTER_BASE_W} * var(--rg-enter-scale, 1) * var(--rg-u))`);
  });

  it('the filter runs tint, colour, glow, then the black cast shadow last (so no colour step re-colours the shadow)', () => {
    const filter = /\.rgate-enter-word \{[^}]*filter:([^;]*);/.exec(css)![1]!;
    const order = ['var(--rg-enter-tint', 'hue-rotate(', 'saturate(', 'brightness(', 'var(--rg-enter-glow-a,', 'var(--rg-enter-glow-b,', 'rgba(0, 0, 0'].map((s) => filter.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // Static: nothing animates a filter anywhere in the gate.
    for (const kf of css.matchAll(/@keyframes [\w-]+ \{([\s\S]*?)\n\}/g)) expect(kf[1]).not.toMatch(/filter/);
  });

  it('place, size and colour are written as the stylesheet reads them', () => {
    const vars = gateEnterCssVars({ ...GATE_ENTER_DEFAULTS, x: -40, y: 210, scale: 1.25, hue: -30, saturation: 140, brightness: 85, glowBlur: 22 });
    expect(vars).toMatchObject({
      '--rg-enter-x': '-40', '--rg-enter-dy': '210', '--rg-enter-scale': '1.25', '--rg-enter-glow-blur': '22',
      '--rg-enter-hue': '-30deg', '--rg-enter-sat': '140%', '--rg-enter-bri': '85%',
    });
  });

  it('the glow is two layers: the first carries the amount up to 1, the second what is over it', () => {
    const at = (glowAmount: number): [string, string] => {
      const v = gateEnterCssVars({ ...GATE_ENTER_DEFAULTS, glowColor: '#ff8000', glowAmount });
      return [v['--rg-enter-glow-a']!, v['--rg-enter-glow-b']!];
    };
    expect(at(0.4)).toEqual(['rgb(255 128 0 / 0.4)', 'rgb(255 128 0 / 0)']);
    expect(at(1)).toEqual(['rgb(255 128 0 / 1)', 'rgb(255 128 0 / 0)']);
    expect(at(1.5)).toEqual(['rgb(255 128 0 / 1)', 'rgb(255 128 0 / 0.5)']);
    expect(at(9), 'clamped').toEqual(['rgb(255 128 0 / 1)', 'rgb(255 128 0 / 1)']);
  });

  it('the tint is linked only while it is on, and the flood reads its colour and amount', () => {
    const on = gateEnterCssVars({ ...GATE_ENTER_DEFAULTS, tintColor: '#2f8fd8', tintAmount: 0.6 });
    expect(on['--rg-enter-tint']).toBe(`url(#${GATE_ENTER_TINT_ID})`);
    expect(on['--rg-enter-tint-col']).toBe('#2f8fd8');
    expect(on['--rg-enter-tint-amt']).toBe('0.6');
    expect(css).toMatch(/\.rgate-enter-tint-flood \{ flood-color: var\(--rg-enter-tint-col, [^)]*\); flood-opacity: var\(--rg-enter-tint-amt, 0\); \}/);
    // The filter it links is the one the gate renders beside the word: the colour, cut to the word, blended as COLOUR.
    const gate = readFileSync(join(__dirname, 'RankedGate.tsx'), 'utf8');
    expect(gate).toContain('<filter id={GATE_ENTER_TINT_ID}');
    expect(gate).toMatch(/<feFlood className="rgate-enter-tint-flood"[\s\S]*operator="in"[\s\S]*<feBlend [^>]*mode="color"/);
  });

  it('a tune is live on :root at once, and Reset puts the shipped look back', () => {
    setGateEnterValue('y', 120);
    setGateEnterValue('glowColor', '#00ffaa');
    setGateEnterValue('glowAmount', 1);
    expect(getGateEnterConfig()).toMatchObject({ y: 120, glowColor: '#00ffaa', glowAmount: 1 });
    expect(root('--rg-enter-dy')).toBe('120');
    expect(root('--rg-enter-glow-a')).toBe('rgb(0 255 170 / 1)');
    resetGateEnterConfig();
    expect(getGateEnterConfig()).toEqual(GATE_ENTER_DEFAULTS);
    expect(root('--rg-enter-dy')).toBe(String(GATE_ENTER_DEFAULTS.y));
    expect(root('--rg-enter-glow-a')).toMatch(/\/ 0\)$/);
  });
});
