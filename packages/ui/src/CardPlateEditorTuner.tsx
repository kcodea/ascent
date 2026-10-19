import { useEffect, useState, type CSSProperties } from 'react';
import { CARD_INDEX } from '@game/content';
import { COSMETICS } from '@game/progression';
import { Card } from './Card';
import { toView } from './MinionBook';
import {
  CARD_PLATE_LOOKS, CardPlateContext, PLATE_IDS, clearLivePlateTuning, plateLayeringOf, plateTuningOf, setLivePlateTuning,
  type PlateTuningKey,
} from './cardPlate/cardPlateLook';
import { PREVIEW_CCW, previewPlateK } from './progression/SkinCardPreview';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec } from './tunerSchema';

/**
 * THE CARD PLATE EDITOR (owner 2026-10-18: "create a tuner that would allow me to select each Card Plate and
 * individually edit the card plates frame and interior size and positioning"). DEV-only.
 *
 * Pick ONE plate; the sliders move only that plate's frame (size, left/right, up/down) and interior (width, height,
 * left/right, up/down), live on the preview card here and on every card on screen wearing it. Nothing is global: the
 * standard and gilded plates are never touched. "Save plate" writes that plate's numbers into
 * `cardPlate/plate-tuning.json` through the dev server (`apps/web/plateTuningPlugin.ts`) and rebuilds its Collection
 * image; the file ships when it is committed. "Reset" drops every unsaved edit, back to what is saved.
 *
 * Frame size is the plate's `artScale` (the art drawn past the plate box, uncropped). The interior numbers are its fit
 * on the UNSCALED frame, so resizing the frame keeps the interior seated (`scaledInterior` in cardPlateLook.ts).
 */

type EditorConfig = { plate: string } & Record<PlateTuningKey, number>;

const PICK_KEY = 'ascent.plateEditor.plate';
const NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  COSMETICS.filter((c) => c.category === 'card_plate' && c.assets.art).map((c) => [c.assets.art as string, c.name]),
);
const OPTIONS = [...PLATE_IDS].sort((a, b) => (NAMES[a] ?? a).localeCompare(NAMES[b] ?? b));

function loadPick(): string {
  try {
    const v = localStorage.getItem(PICK_KEY);
    if (v && PLATE_IDS.includes(v)) return v;
  } catch { /* storage blocked: start on the first plate */ }
  return OPTIONS[0];
}
let selected = loadPick();
function pick(id: string): void {
  if (!PLATE_IDS.includes(id)) return;
  selected = id;
  try { localStorage.setItem(PICK_KEY, id); } catch { /* per-viewer convenience only */ }
}

const read = (): EditorConfig => ({ plate: selected, ...plateTuningOf(selected) });

// ── Save ─────────────────────────────────────────────────────────────────────────────────────────────────────────
let status = '';
const statusListeners = new Set<() => void>();
function setStatus(s: string): void {
  status = s;
  for (const fn of statusListeners) fn();
}
async function save(): Promise<void> {
  const id = selected;
  const name = NAMES[id] ?? id;
  setStatus(`Saving ${name}…`);
  try {
    const res = await fetch('/__plates/tuning', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, values: plateTuningOf(id), ...plateLayeringOf(id) }),
    });
    const out = (await res.json()) as { ok: boolean; error?: string };
    setStatus(out.ok ? `Saved ${name}. Tell Claude "ship the plates" to merge.` : `Not saved: ${out.error ?? res.status}`);
  } catch (e) {
    setStatus(`Not saved: ${(e as Error).message}`);
  }
}

// ── The preview card ─────────────────────────────────────────────────────────────────────────────────────────────
// The MINION with the most rules text in Set 2 (owner 2026-10-18: "what card has the most amount of text on it in set
// 2? i want that to be the card that is previewed", then "lets use impossible todd"): Impossible Todd, 104 characters.
// (Decoy Sigil, a spell, has 113, but a spell's text sits higher on the card than a minion's.)
const SAMPLE_CARD = 'dm_todd';
const CH = 308; // 220 x 1.4 (owner 2026-10-18: "make the preview of the card in the card plate editor roughly 40% larger")
const CW = Math.round(CH * 0.752);
const CCW = Math.round(CW * 0.85);

function PlatePreview({ id }: { id: string }): JSX.Element {
  const [, force] = useState(0);
  // Re-render when a save reports back, so the status line updates.
  useEffect(() => {
    const fn = (): void => force((n) => n + 1);
    statusListeners.add(fn);
    return () => { statusListeners.delete(fn); };
  }, []);
  const def = CARD_INDEX[SAMPLE_CARD];
  const view = def ? toView(def) : null;
  // The plate's px lift is tuned on the game's own card; this card is CCW wide, so it lifts by the same ratio.
  const plateK = (CCW / PREVIEW_CCW) * previewPlateK();
  const style = { '--ch': `${CH}px`, '--cw': `${CW}px`, '--ccw': `${CCW}px`, '--plate-k': plateK } as CSSProperties;
  const { layered } = plateLayeringOf(id);
  return (
    <div className="plate-editor-preview">
      <div className="plate-editor-stage" style={style}>
        {view && (
          <CardPlateContext.Provider value={CARD_PLATE_LOOKS[id] ?? null}>
            <Card card={view} forceFull suppressPop plated />
          </CardPlateContext.Provider>
        )}
      </div>
      {!layered && <p className="plate-editor-note">A single-image plate: only the Frame sliders apply.</p>}
      {status && <p className="plate-editor-note">{status}</p>}
    </div>
  );
}

// ── The panel ────────────────────────────────────────────────────────────────────────────────────────────────────
const range = (key: PlateTuningKey, label: string, hint: string, group: string, min: number, max: number, step: number): TunerControl<Extract<keyof EditorConfig, string>> =>
  ({ key, label, hint, group, min, max, step, unit: '×' });

const controls: TunerControl<Extract<keyof EditorConfig, string>>[] = [
  { key: 'plate', label: 'Card plate', hint: 'The plate you are editing. Every slider below changes this plate only.', group: 'Plate', kind: 'select', options: OPTIONS, optionLabels: NAMES, min: 0, max: 0, step: 0 },
  range('artScale', 'Size', 'How big the frame art is drawn. Above 1 it spills past the plate box, uncropped; the interior grows with it.', 'Frame', 0.5, 2, 0.005),
  range('frameX', 'Left / right', 'Moves the frame, and its interior with it. Positive moves right. In card widths.', 'Frame', -0.3, 0.3, 0.001),
  range('frameY', 'Up / down', 'Moves the frame, and its interior with it. Positive moves down. In card widths.', 'Frame', -0.3, 0.3, 0.001),
  range('interiorSx', 'Width', 'Stretches the interior sideways, about its centre.', 'Interior', 0.5, 2, 0.001),
  range('interiorSy', 'Height', 'Stretches the interior up and down, about its centre.', 'Interior', 0.5, 2, 0.001),
  range('interiorX', 'Left / right', 'Moves the interior under the frame. Positive moves right. In card widths.', 'Interior', -0.3, 0.3, 0.001),
  range('interiorY', 'Up / down', 'Moves the interior under the frame. Positive moves down. In card widths.', 'Interior', -0.3, 0.3, 0.001),
];

export const SPEC: TunerSpec<EditorConfig> = {
  id: 'plateeditor',                // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Card Plate Editor',
  note: () => `dev · ${NAMES[selected] ?? selected}`,
  read,
  write: (key, value) => { if (key !== 'plate') setLivePlateTuning(selected, key, value); },
  writeColor: (key, value) => { if (key === 'plate') pick(value); },
  reset: clearLivePlateTuning,
  controls,
  readout: () => <PlatePreview id={selected} />,
  buttonsOnTop: true,
  actions: [{ label: 'Save plate', hint: 'Write this plate\'s numbers to plate-tuning.json and rebuild its Collection picture.', run: () => { void save(); } }],
  copy: () => JSON.stringify({ [selected]: plateTuningOf(selected) }, null, 2),
};

export function CardPlateEditorTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
