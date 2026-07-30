import { useEffect, useRef, useState } from 'react';
import { chargePreview, chargeTune } from './chargeGlyphTune';
import { createCssTunerStore } from './cssTunerStore';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the end-of-turn CHARGE GLYPH (`.chargeglyph` in styles.css, `ChargeGlyph` in Recruit.tsx).
 *
 * The look rides `--cg-*` vars with baked fallbacks, and each of those vars is COMPOSED from several controls: a
 * colour and two radii become one `drop-shadow` pair, three colours and a stop become one gradient. So this panel
 * writes a `<style>` override rather than driving vars one-to-one — and it does it against the real glyph at TRUE
 * game scale, which the standalone `fx/turn-glyph-preview.html` cannot match.
 *
 * IT NEEDS A PREVIEW HARNESS, not just a body class. The glyph only appears in the last twenty seconds of a turn
 * and fills as that clock runs down, so without a way to force it on screen and HOLD the fill at a chosen point,
 * most of these controls cannot be judged at all. That is what the scrub block above the controls does; Play runs
 * the real twenty-second fill once.
 *
 * Two of the controls are not CSS. The core bloom is computed per frame in the component, so those two write into
 * the shared `chargeTune` object instead — and are restored on close, along with the override and the preview, so
 * shipped behaviour resumes.
 *
 * This is the one CSS-composing tuner that PERSISTS: its look is dialled over long sessions against something
 * visible twenty seconds at a time, so losing the values to a reload was costly. Reset returns the shipped look.
 */
type GlyphVals = Record<string, number | string>;

interface Knob {
  key: string; label: string; unit?: TunerUnit; hint: string;
  min: number; max: number; step: number; def: number; group: string;
}

const KNOBS: Knob[] = [
  { key: 'm1', label: 'Colour blend point', unit: '%', group: 'Fill',
    hint: 'Where the mid colour sits between the deep end and the white-hot centre. Lower keeps more of the bar deep.',
    min: 8, max: 49, step: 1, def: 19 },
  { key: 'pulseMin', label: 'Pulse floor', unit: 'opacity', group: 'Fill',
    hint: 'How far the fill dims at the bottom of its breathing pulse. 1 stops the pulse entirely.',
    min: 0.3, max: 1, step: 0.01, def: 0.63 },
  { key: 'pulseS', label: 'Pulse period', unit: 's', group: 'Fill',
    hint: 'How long one full breath of that pulse takes.',
    min: 1, max: 8, step: 0.1, def: 4.3 },
  { key: 'feather', label: 'Leading-edge fade', unit: '%', group: 'Fill',
    hint: 'How softly the filled portion fades out at its leading edge, instead of ending on a hard line.',
    min: 0, max: 24, step: 0.5, def: 0 },
  { key: 'baseA', label: 'Unlit etch', unit: 'opacity', group: 'Fill',
    hint: 'Visibility of the empty channel ahead of the fill. 0 hides it, so the glyph appears to draw itself.',
    min: 0, max: 0.4, step: 0.01, def: 0 },

  { key: 'glowIn', label: 'Inner glow radius', unit: 'px', group: 'Glow',
    hint: 'The tight halo hugging the fill, in the mid colour.',
    min: 0, max: 100, step: 1, def: 40 },
  { key: 'glowOut', label: 'Outer glow radius', unit: 'px', group: 'Glow',
    hint: 'The wide bloom beyond it, in the deep colour.',
    min: 0, max: 200, step: 1, def: 80 },
  { key: 'glowOutA', label: 'Outer glow strength', unit: 'opacity', group: 'Glow',
    hint: 'Opacity of that wide bloom.',
    min: 0, max: 1, step: 0.01, def: 1 },

  { key: 'coreW', label: 'Core width', unit: '%', group: 'Core',
    hint: 'Width of the white-hot core running along the glyph, as a percentage of its length.',
    min: 8, max: 100, step: 1, def: 90 },
  { key: 'coreH', label: 'Core thickness', unit: '%', group: 'Core',
    hint: 'Thickness of that core.',
    min: 1, max: 60, step: 1, def: 5 },
  { key: 'bloomAt', label: 'Bloom starts at', unit: 'opacity', group: 'Core',
    hint: 'How full the charge must be before the core begins to bloom — 0.65 means the last third of the turn. Not CSS: this is read per frame by the glyph itself.',
    min: 0, max: 1, step: 0.01, def: 0.65 },
  { key: 'coreMax', label: 'Bloom peak', unit: 'opacity', group: 'Core',
    hint: 'How bright that bloom gets at a full charge. Not CSS: read per frame by the glyph itself.',
    min: 0, max: 1, step: 0.01, def: 1 },
];

const COLORS = [
  { key: 'core', label: 'Centre', def: '#ffffff', hint: 'The white-hot middle of the bar — the hottest end of the ramp.' },
  { key: 'mid',  label: 'Mid',    def: '#009dff', hint: 'The colour between centre and end. Also the inner glow.' },
  { key: 'deep', label: 'Ends',   def: '#0037ff', hint: 'The colour at both ends of the bar. Also the outer bloom and the unlit etch.' },
] as const;

const DEFAULTS: GlyphVals = {
  ...Object.fromEntries(KNOBS.map((k) => [k.key, k.def])),
  ...Object.fromEntries(COLORS.map((c) => [c.key, c.def])),
};

const num = (v: GlyphVals, k: string): number => Number(v[k]);
const str = (v: GlyphVals, k: string): string => String(v[k]);

const rgba = (hex: string, a: number): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

const fillGrad = (v: GlyphVals): string =>
  `linear-gradient(90deg, ${str(v, 'deep')} 0%, ${str(v, 'mid')} ${num(v, 'm1')}%, ${str(v, 'core')} 50%, `
  + `${str(v, 'mid')} ${100 - num(v, 'm1')}%, ${str(v, 'deep')} 100%)`;
const glowF = (v: GlyphVals): string =>
  `drop-shadow(0 0 ${num(v, 'glowIn')}px ${rgba(str(v, 'mid'), 0.85)}) `
  + `drop-shadow(0 0 ${num(v, 'glowOut')}px ${rgba(str(v, 'deep'), num(v, 'glowOutA'))})`;
const coreGrad = (v: GlyphVals): string =>
  `radial-gradient(ellipse ${num(v, 'coreW')}% ${num(v, 'coreH')}% at 50% 50%, ${str(v, 'core')} 0%, `
  + `${str(v, 'mid')} 34%, transparent 62%)`;
const coreGlowF = (v: GlyphVals): string => `drop-shadow(0 0 ${num(v, 'glowIn')}px ${str(v, 'core')})`;

const store = createCssTunerStore<GlyphVals>({
  styleId: 'chargeglyphtuner',
  defaults: DEFAULTS,
  storageKey: 'ascent.chargeGlyphTuner',
  css: (v) =>
    `.chargeglyph.chargeglyph { `
    + `--cg-fill: ${fillGrad(v)}; --cg-glow: ${glowF(v)}; --cg-core: ${coreGrad(v)}; `
    + `--cg-core-glow: ${coreGlowF(v)}; --cg-base: ${str(v, 'deep')}; --cg-base-a: ${num(v, 'baseA')}; `
    + `--cg-pulse-min: ${num(v, 'pulseMin')}; --cg-pulse-s: ${num(v, 'pulseS')}s; --feather: ${num(v, 'feather')}%;`
    + ` }`,
});

/** What to paste back: the shipped rules in styles.css, plus the two knobs that live in chargeGlyphTune.ts. */
const copyCss = (): string => {
  const v = store.get();
  return `/* Charge Glyph — bake into styles.css (replace the var fallbacks) */\n`
    + `.chargeglyph .charge-fill { background: ${fillGrad(v)}; filter: ${glowF(v)}; }\n`
    + `@keyframes chargepulse { 0%,100% { opacity: ${num(v, 'pulseMin')}; } 50% { opacity: 1; } }`
    + ` /* animation ${num(v, 'pulseS')}s */\n`
    + `.chargeglyph .charge-core { background: ${coreGrad(v)}; filter: ${coreGlowF(v)}; }\n`
    + `.chargeglyph .charge-base { background: ${str(v, 'deep')}; opacity: ${num(v, 'baseA')}; }\n`
    + `.chargeglyph { --feather: ${num(v, 'feather')}%; }\n`
    + `/* chargeGlyphTune.ts → chargeTune: bloomAt ${num(v, 'bloomAt')}, coreMax ${num(v, 'coreMax')} */`;
};

const controls: TunerControl<string>[] = [
  ...COLORS.map((c) => ({
    key: c.key, label: c.label, hint: c.hint, group: 'Colour', kind: 'color' as const,
    min: 0, max: 0, step: 0,
  })),
  ...KNOBS.map((k) => ({
    key: k.key, label: k.label, unit: k.unit, hint: k.hint, group: k.group,
    min: k.min, max: k.max, step: k.step,
  })),
];

/**
 * The preview harness. The glyph is on the turn clock, so `chargePreview` holds it on screen at a chosen fill;
 * setting it back to null returns it to the real clock.
 */
function GlyphPreview(): JSX.Element {
  const [scrub, setScrub] = useState(1);
  const [showing, setShowing] = useState(true);
  const rafRef = useRef(0);

  useEffect(() => { chargePreview.set(showing ? scrub : null); }, [showing, scrub]);

  const stopPlay = (): void => cancelAnimationFrame(rafRef.current);
  const play = (): void => {
    stopPlay();
    setShowing(true);
    const t0 = performance.now();
    const step = (now: number): void => {
      const f = Math.min(1, (now - t0) / 20000);
      setScrub(f);
      if (f < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  };
  // Hand the glyph back to the real turn clock when the panel closes.
  useEffect(() => () => { cancelAnimationFrame(rafRef.current); chargePreview.set(null); }, []);

  return (
    <div className="tuner-previews tuner-harness">
      <div className="sfxmix-row tuner-row">
        <span className="sfxmix-name" title="Holds the glyph on screen at this fill, so the look can be judged at any point in the charge.">
          Hold charge at
        </span>
        <input
          type="range" min={0} max={1} step={0.001} value={scrub}
          aria-label="Hold charge at"
          onChange={(e) => { stopPlay(); setShowing(true); setScrub(Number(e.target.value)); }}
        />
        <span className="sfxmix-val tuner-unit">{Math.round(scrub * 100)}%</span>
      </div>
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={play} title="Runs the real twenty-second fill once.">▶ Play 20s</button>
        <button className="sfxmix-copy" onClick={() => { stopPlay(); setShowing((s) => !s); }}>
          {showing ? 'Release to turn clock' : 'Force on screen'}
        </button>
      </div>
    </div>
  );
}

/**
 * The bloom curve is NOT CSS — the glyph reads it per frame from the shared `chargeTune` object — so those two
 * controls have to be pushed there as well as into the store, on every write and on reset.
 */
const pushBloom = (): void => {
  const v = store.get();
  chargeTune.bloomAt = Number(v.bloomAt);
  chargeTune.coreMax = Number(v.coreMax);
};

const SPEC: TunerSpec<GlyphVals> = {
  id: 'chargeglyph',                // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Charge Glyph',
  note: 'dev · live · placement is in Layout Lab',
  read: store.get,
  write: (key, value) => { store.set(key, value); pushBloom(); },
  writeColor: store.set,
  reset: () => { store.reset(); pushBloom(); },
  defaults: DEFAULTS,
  controls,
  readout: () => <GlyphPreview />,
  copy: copyCss,
  copyLabel: 'Copy CSS',
};

export function ChargeGlyphTuner(): JSX.Element {
  useEffect(store.mount, []);
  // Apply the persisted bloom curve on open, and restore the shipped one on close so the real glyph resumes.
  useEffect(() => {
    pushBloom();
    return () => {
      chargeTune.bloomAt = Number(DEFAULTS.bloomAt);
      chargeTune.coreMax = Number(DEFAULTS.coreMax);
    };
  }, []);
  return <TunerPanel spec={SPEC} />;
}
