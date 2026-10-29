import { useEffect, useState } from 'react';
import {
  BACKDROPS, BACKDROP_IDS, NUMBER_KEYS, clearLiveTune, getBackdrop, isBackdropId, setBackdrop, setLiveTune, tuneOf,
  type BackdropId, type BackdropNumberKey, type BackdropTune,
} from './backdrop';
import { backdropFit } from './layoutConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec } from './tunerSchema';

/**
 * THE BACKGROUND TUNER (owner 2026-10-29: "could i still have controls that increase the size and position of these
 * backgrounds?", then "lets make a standalone background tuner. i dont want it in the scale and layout"). DEV-only.
 *
 * Pick ONE board backdrop: it goes on screen (as your own Settings pick), and the sliders change only that backdrop,
 * live: zoom and position for a painted image, tile size for a tile, then darkness, blur, tint and the board's shadow
 * for either. "Save background" writes that backdrop's numbers into `backdrop-tuning.json` through the dev server
 * (`apps/web/backdropTuningPlugin.ts`); the file ships to every player once it is committed. "Reset" drops every
 * unsaved edit, back to what is saved.
 */

type BgConfig = { backdrop: BackdropId } & BackdropTune;
type Key = Extract<keyof BgConfig, string>;

const LABELS: Readonly<Record<string, string>> = Object.fromEntries(BACKDROP_IDS.map((id) => [id, BACKDROPS[id].label]));
const isCover = (id: BackdropId): boolean => backdropFit(BACKDROPS[id].texture) === 'cover';

let selected: BackdropId = getBackdrop();
function pick(id: string): void {
  if (!isBackdropId(id)) return;
  selected = id;
  setBackdrop(id); // what you tune is what is on screen
  setStatus('');
}

const read = (): BgConfig => ({ backdrop: selected, ...tuneOf(selected) });

// ── Save ─────────────────────────────────────────────────────────────────────────────────────────────────────────
let status = '';
const statusListeners = new Set<() => void>();
function setStatus(s: string): void {
  status = s;
  for (const fn of statusListeners) fn();
}
async function save(): Promise<void> {
  const id = selected;
  const name = LABELS[id] ?? id;
  setStatus(`Saving ${name}…`);
  try {
    const res = await fetch('/__backdrops/tuning', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, values: tuneOf(id) }),
    });
    const out = (await res.json()) as { ok: boolean; error?: string };
    setStatus(out.ok ? `Saved ${name}. Tell Claude "ship the backgrounds" to merge.` : `Not saved: ${out.error ?? res.status}`);
  } catch (e) {
    setStatus(`Not saved: ${(e as Error).message}`);
  }
}

function Readout(): JSX.Element {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = (): void => force((n) => n + 1);
    statusListeners.add(fn);
    return () => { statusListeners.delete(fn); };
  }, []);
  return (
    <div className="bg-tuner-readout">
      <p className="bg-tuner-note">
        {isCover(selected)
          ? 'A painted image: Zoom and Position apply. Tile size does nothing.'
          : 'A repeating tile: Tile size applies. Zoom and Position do nothing.'}
      </p>
      {status && <p className="bg-tuner-note">{status}</p>}
    </div>
  );
}

// ── The panel ────────────────────────────────────────────────────────────────────────────────────────────────────
const num = (key: BackdropNumberKey, label: string, hint: string, group: string, min: number, max: number, step: number, unit?: TunerControl<Key>['unit']): TunerControl<Key> =>
  ({ key, label, hint, group, min, max, step, unit });

const controls: TunerControl<Key>[] = [
  { key: 'backdrop', label: 'Background', hint: 'The background you are tuning. It is put on screen, and every slider below changes this one only.', group: 'Background', kind: 'select', options: BACKDROP_IDS, optionLabels: LABELS, min: 0, max: 0, step: 0 },
  num('zoom', 'Zoom', 'Painted images: enlarges the picture about the screen centre. 1 = just fills the window. Above about 1.4 it starts to soften.', 'Size & position', 1, 3, 0.01, '×'),
  num('panX', 'Left / right', 'Painted images: slides the picture within the room Zoom gives it. Positive moves it right. 100 = as far as it goes. At Zoom 1 there is little room.', 'Size & position', -100, 100, 1, '%'),
  num('panY', 'Up / down', 'Painted images: slides the picture within the room Zoom gives it. Positive moves it down. 100 = as far as it goes.', 'Size & position', -100, 100, 1, '%'),
  num('size', 'Tile size', 'Tiles only: how big one repeat of the pattern is.', 'Size & position', 100, 3000, 10, 'px'),
  num('dark', 'Darkness', 'A black wash over the background. 0 = as painted.', 'Look', 0, 1, 0.01, 'opacity'),
  num('blur', 'Blur', 'Softens the background. 0 = sharp.', 'Look', 0, 40, 0.5, 'px'),
  { key: 'tint', label: 'Tint colour', hint: 'The colour washed over the background, by Tint amount.', group: 'Look', kind: 'color', min: 0, max: 0, step: 0 },
  num('tintAmount', 'Tint amount', 'How strongly the tint colour shows. 0 = none.', 'Look', 0, 1, 0.01, 'opacity'),
  num('shadow', 'Strength', 'How dark the board\'s shadow is on this background.', 'Board shadow', 0, 1, 0.01, 'opacity'),
  num('shadowX', 'Left / right', 'Moves the board\'s shadow sideways. Positive moves it right.', 'Board shadow', -120, 120, 1, 'px'),
  num('shadowY', 'Up / down', 'Moves the board\'s shadow up or down. Positive moves it down.', 'Board shadow', -120, 120, 1, 'px'),
  num('shadeDark', 'Darkness', 'How dark the circles under both hero portraits are. 0 = off, 1 = black at the centre.', 'Hero shades', 0, 1, 0.01, 'opacity'),
  num('shadeSoft', 'Softness', 'How gradually the circles fade out. 0 = a hard edge, 100 = fades from the very centre.', 'Hero shades', 0, 100, 1, '%'),
  num('shadeSize', 'Your size', 'How wide the circle under YOUR portrait spreads, in portrait widths (2 = twice the portrait).', 'Hero shades', 0, 10, 0.05, '×'),
  num('shadeX', 'Your left / right', 'Moves the circle under your portrait, in % of the portrait. Positive moves it right.', 'Hero shades', -400, 400, 1, '%'),
  num('shadeY', 'Your up / down', 'Moves the circle under your portrait, in % of the portrait. Positive moves it down.', 'Hero shades', -400, 400, 1, '%'),
  num('oppShadeSize', 'Opponent size', 'How wide the circle under the OPPONENT\'s portrait spreads (in combat), in portrait widths.', 'Hero shades', 0, 10, 0.05, '×'),
  num('oppShadeX', 'Opponent left / right', 'Moves the circle under the opponent\'s portrait, in % of the portrait. Positive moves it right.', 'Hero shades', -400, 400, 1, '%'),
  num('oppShadeY', 'Opponent up / down', 'Moves the circle under the opponent\'s portrait, in % of the portrait. Positive moves it down.', 'Hero shades', -400, 400, 1, '%'),
];

export const SPEC: TunerSpec<BgConfig> = {
  id: 'background',                 // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Background Tuner',
  note: () => `dev · ${LABELS[selected] ?? selected}`,
  read,
  write: (key, value) => {
    if ((NUMBER_KEYS as readonly string[]).includes(key)) setLiveTune(selected, key as BackdropNumberKey, value);
  },
  writeColor: (key, value) => {
    if (key === 'backdrop') pick(value);
    else if (key === 'tint') setLiveTune(selected, 'tint', value);
  },
  reset: () => { clearLiveTune(); setStatus(''); },
  controls,
  readout: () => <Readout />,
  buttonsOnTop: true,
  actions: [{ label: 'Save background', hint: 'Write this background\'s numbers to backdrop-tuning.json, so every player gets them once it ships.', run: () => { void save(); } }],
  copy: () => JSON.stringify({ [selected]: tuneOf(selected) }, null, 2),
};

export function BackgroundTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
