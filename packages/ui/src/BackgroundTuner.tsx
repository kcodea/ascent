import { useEffect, useState } from 'react';
import {
  BACKDROPS, BACKDROP_IDS, NUMBER_KEYS, SHARED_KEYS, clearLiveTune, getBackdrop, sharedLook, isBackdropId, setBackdrop,
  setLiveShared, setLiveTune, tuneOf,
  type BackdropId, type BackdropNumberKey, type BackdropTune, type SharedKey, type SharedLook,
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

type BgConfig = { backdrop: BackdropId } & BackdropTune & SharedLook;
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

const read = (): BgConfig => ({ backdrop: selected, ...tuneOf(selected), ...sharedLook() });

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
      body: JSON.stringify({ id, values: tuneOf(id), shared: sharedLook() }),
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

/** The hero-shade group: one setting for EVERY background (owner 2026-10-29), so its title says so. */
const SHADES = 'Hero shades (all backgrounds)';
/** The board's shadow is one setting for every background too (owner 2026-10-29: "same with the board shadow settings"). */
const BOARD_SHADOW = 'Board shadow (all backgrounds)';

// ── The panel ────────────────────────────────────────────────────────────────────────────────────────────────────
const num = (key: BackdropNumberKey | SharedKey, label: string, hint: string, group: string, min: number, max: number, step: number, unit?: TunerControl<Key>['unit']): TunerControl<Key> =>
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
  num('shadow', 'Strength', 'How dark the board\'s shadow is on this background.', BOARD_SHADOW, 0, 1, 0.01, 'opacity'),
  num('shadowX', 'Left / right', 'Moves the board\'s shadow sideways. Positive moves it right.', BOARD_SHADOW, -120, 120, 1, 'px'),
  num('shadowY', 'Up / down', 'Moves the board\'s shadow up or down. Positive moves it down.', BOARD_SHADOW, -120, 120, 1, 'px'),
  num('shadeDark', 'Darkness', 'How dark the circles are (all three). The same on every background. They sit under the board, so they never darken it. 0 = off, 1 = black at the centre.', SHADES, 0, 1, 0.01, 'opacity'),
  num('shadeSoft', 'Softness', 'How gradually the circles fade out. 0 = a hard edge, 100 = fades from the very centre.', SHADES, 0, 100, 1, '%'),
  num('shadeSize', 'Portrait size', 'How wide the circle behind YOUR portrait spreads (its diameter).', SHADES, 0, 4000, 10, 'px'),
  num('shadeX', 'Portrait left / right', 'Where the circle behind your portrait sits, from the board\'s centre. Positive moves it right.', SHADES, -2000, 2000, 1, 'px'),
  num('shadeY', 'Portrait up / down', 'Where the circle behind your portrait sits, from the board\'s centre. Positive moves it down.', SHADES, -2000, 2000, 1, 'px'),
  num('powerShadeSize', 'Hero power size', 'How wide the circle behind your HERO POWER spreads (its diameter).', SHADES, 0, 4000, 10, 'px'),
  num('powerShadeX', 'Hero power left / right', 'Where the circle behind your hero power sits, from the board\'s centre. Positive moves it right.', SHADES, -2000, 2000, 1, 'px'),
  num('powerShadeY', 'Hero power up / down', 'Where the circle behind your hero power sits, from the board\'s centre. Positive moves it down.', SHADES, -2000, 2000, 1, 'px'),
  num('oppShadeSize', 'Opponent size', 'How wide the circle behind the OPPONENT\'s portrait spreads, in combat (its diameter).', SHADES, 0, 4000, 10, 'px'),
  num('oppShadeX', 'Opponent left / right', 'Where the circle behind the opponent\'s portrait sits, from the board\'s centre. Positive moves it right.', SHADES, -2000, 2000, 1, 'px'),
  num('oppShadeY', 'Opponent up / down', 'Where the circle behind the opponent\'s portrait sits, from the board\'s centre. Positive moves it down.', SHADES, -2000, 2000, 1, 'px'),
];

export const SPEC: TunerSpec<BgConfig> = {
  id: 'background',                 // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Background Tuner',
  note: () => `dev · ${LABELS[selected] ?? selected}`,
  read,
  write: (key, value) => {
    if ((NUMBER_KEYS as readonly string[]).includes(key)) setLiveTune(selected, key as BackdropNumberKey, value);
    else if ((SHARED_KEYS as readonly string[]).includes(key)) setLiveShared(key as SharedKey, value);
  },
  writeColor: (key, value) => {
    if (key === 'backdrop') pick(value);
    else if (key === 'tint') setLiveTune(selected, 'tint', value);
  },
  reset: () => { clearLiveTune(); setStatus(''); },
  controls,
  readout: () => <Readout />,
  buttonsOnTop: true,
  actions: [{ label: 'Save background', hint: 'Write this background\'s numbers, and the board shadow and hero shades every background shares, to backdrop-tuning.json, so every player gets them once it ships.', run: () => { void save(); } }],
  copy: () => JSON.stringify({ allBackgrounds: sharedLook(), [selected]: tuneOf(selected) }, null, 2),
};

export function BackgroundTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
