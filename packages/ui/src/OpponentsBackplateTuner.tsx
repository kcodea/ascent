import { useEffect } from 'react';
import { createCssTunerStore } from './cssTunerStore';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec } from './tunerSchema';

/**
 * DEV-only tuner for the OPPONENTS BACKPLATE — the gilded frame art behind the lobby rail (`.lobbyrail` in
 * styles.css, rendered by `LobbyPanel.tsx`). Same shape as the Runeforge Backdrop tuner: the backplate is ONE
 * `background` shorthand — a dark dim layer over `url(...)` at a size and position — so every control here is an
 * ingredient of a single declaration rather than a var of its own, which is exactly what `cssTunerStore` is for.
 *
 * PERSISTS (like the Runeforge backdrop): placing framed art by eye is done in passes against a panel you
 * re-open, so losing the values to a reload costs a session. Reset returns the shipped look; "Copy CSS" emits the
 * undoubled rule to bake back into `styles.css` (the `.lobbyrail` background).
 *
 * The art is a FRAME, so it fills the rail (`background-size` W×H) rather than being aspect-fit — the rail's
 * height changes as opponents die, and a frame that only spanned part of it would read as broken. The `dim`
 * layer sits ON TOP of the image (darkening the backplate if it's too bright behind the rows) and does NOT touch
 * the rows themselves, which are DOM content above the rail's background.
 */
interface BackplateVals {
  sizeW: number;   // % — background-size width
  sizeH: number;   // % — background-size height
  posX: number;    // %
  posY: number;    // %
  dim: number;     // opacity of a black layer OVER the image, darkening the backplate (not the rows)
  [k: string]: number | string;
}

/** MIRRORS the shipped `.lobbyrail` background in styles.css — keep the two in lockstep so Reset returns what
 *  players see. */
const DEFAULTS: BackplateVals = {
  sizeW: 100,
  sizeH: 100,
  posX: 50,
  posY: 50,
  dim: 0,
};

const num = (v: BackplateVals, k: string): number => Number(v[k]);

/** The full shorthand. The dim layer is FIRST (CSS paints layer one on top), so it darkens the frame; the image
 *  sits under it. */
const bg = (v: BackplateVals): string => {
  const d = num(v, 'dim');
  return `linear-gradient(rgba(0, 0, 0, ${d}), rgba(0, 0, 0, ${d})), `
    + `url('/opponents-backplate.webp') ${num(v, 'posX')}% ${num(v, 'posY')}% / ${num(v, 'sizeW')}% ${num(v, 'sizeH')}% no-repeat`;
};

const store = createCssTunerStore<BackplateVals>({
  styleId: 'opponentsbackplatetuner',
  defaults: DEFAULTS,
  storageKey: 'ascent.opponentsBackplateTuner',
  css: (v) => `.lobbyrail.lobbyrail { background: ${bg(v)}; }`,
});

const copyCss = (): string =>
  `/* Opponents backplate — bake into styles.css, replacing the .lobbyrail background */\n`
  + `.lobbyrail {\n  background: ${bg(store.get())};\n}`;

const controls: TunerControl<string>[] = [
  {
    key: 'sizeW', label: 'Width', unit: '%', group: 'Size', min: 50, max: 200, step: 1,
    hint: 'The frame width as a percentage of the rail. 100 fills it edge to edge.',
  },
  {
    key: 'sizeH', label: 'Height', unit: '%', group: 'Size', min: 50, max: 200, step: 1,
    hint: 'The frame height as a percentage of the rail. 100 fills it top to bottom.',
  },
  {
    key: 'posX', label: 'Horizontal position', unit: '%', group: 'Position', min: -50, max: 150, step: 1,
    hint: 'Slides the frame across. 50 centres it.',
  },
  {
    key: 'posY', label: 'Vertical position', unit: '%', group: 'Position', min: -50, max: 150, step: 1,
    hint: 'The same, up and down.',
  },
  {
    key: 'dim', label: 'Dim', unit: 'opacity', group: 'Readability', min: 0, max: 1, step: 0.01,
    hint: 'A black layer over the backplate, darkening it behind the rows. 0 leaves the art at full brightness; it does not dim the opponent rows.',
  },
];

export const SPEC: TunerSpec<BackplateVals> = {
  id: 'opponentsbackplate',          // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Opponents Backplate',
  note: 'dev · live · persists',
  read: store.get,
  write: store.set,
  reset: store.reset,
  defaults: DEFAULTS,
  controls,
  copy: copyCss,
  copyLabel: 'Copy CSS',
};

export function OpponentsBackplateTuner(): JSX.Element {
  useEffect(store.mount, []);
  return <TunerPanel spec={SPEC} />;
}
