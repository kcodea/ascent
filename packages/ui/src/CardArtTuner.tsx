import { useEffect, useSyncExternalStore } from 'react';
import { CARD_INDEX } from '@game/content';
import {
  CARD_ART_RANGES, cardArtVersion, clearSelected, exportCardArt, getSelectedCard,
  readSelected, resetCardArt, selectCard, setPickingCardArt, subscribeCardArt, tunedCardIds, writeSelected,
  type CardArt,
} from './cardArtConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec } from './tunerSchema';

/**
 * DEV-only tuner for PER-CARD art framing — how one illustration sits inside its frame window, plus an
 * optional colour tweak. The 🖼️ Card Frames tuner moves every card of a family at once; this one moves
 * exactly the card you pick, and only cards you touch get an entry.
 *
 * It reuses the standard schema-driven panel rather than growing its own UI: the card picker is a `select`
 * control, and `read`/`write` point at the config module's *selected card* instead of a global object. The
 * selection lives in the config module, not here, so that picking a card in this list and (later) clicking one
 * on the board are the same state rather than two that must be kept in sync.
 *
 * The picker lists cards ALREADY TUNED first. With 500+ cards, a flat alphabetical list is worst at the thing
 * you do most — returning to the card you were just working on.
 */
type ArtRow = Required<CardArt> & { card: string };

const SPECS: [keyof CardArt, string, string, string][] = [
  ['x', 'Horizontal', 'Nudge the illustration left/right, as a % of the window. Negative moves it left. 0 leaves it alone.', 'Framing'],
  ['y', 'Vertical', 'Nudge it up/down, as a % of the window. Negative moves it up. 0 leaves it alone.', 'Framing'],
  ['zoom', 'Zoom', 'Zoom into the illustration. Above 1 crops tighter; below 1 shows more of it.', 'Framing'],
  ['hue', 'Hue', 'Rotate the colours, in degrees. 0 leaves them alone.', 'Colour'],
  ['sat', 'Saturation', 'Saturation. 1 leaves it alone, 0 is greyscale.', 'Colour'],
  ['contrast', 'Contrast', 'Contrast. 1 leaves it alone.', 'Colour'],
];

/** Tuned cards first (the ones you are iterating on), then the rest — the rest sorted by the name actually
 *  shown, not by id, or the list reads as random to anyone reading names. */
function pickerOptions(): string[] {
  const tuned = tunedCardIds();
  const seen = new Set(tuned);
  const rest = Object.keys(CARD_INDEX)
    .filter((id) => !seen.has(id))
    .sort((a, b) => (CARD_INDEX[a]?.name ?? a).localeCompare(CARD_INDEX[b]?.name ?? b));
  return [...tuned, ...rest];
}

/** cardId -> printed name. The picker's VALUE stays the id (names are not unique and ids are what we key
 *  overrides by); only the display text changes. */
function pickerLabels(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of Object.keys(CARD_INDEX)) out[id] = CARD_INDEX[id]?.name ?? id;
  return out;
}

export const SPEC: TunerSpec<ArtRow> = {
  id: 'cardart',                    // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Card Art',
  note: () => {
    const id = getSelectedCard();
    return `${id ? CARD_INDEX[id]?.name ?? id : 'double-click a card'} · ${tunedCardIds().length} tuned · drag`;
  },
  controls: [
    {
      key: 'card', label: 'Card', group: 'Card',
      hint: 'Which card you are framing. Cards you have already tuned are listed first.',
      kind: 'select' as const, options: pickerOptions(), optionLabels: pickerLabels(), min: 0, max: 0, step: 0,
    },
    ...SPECS.map(([key, label, hint, group]): TunerControl<Extract<keyof ArtRow, string>> => {
      const [min, max, step] = CARD_ART_RANGES[key];
      return { key, label, hint, group, min, max, step };
    }),
  ],
  read: readSelected,
  write: (key, value) => {
    if (key !== 'card') writeSelected(key, value);   // the picker is a string control — see writeColor
  },
  writeColor: (key, value) => {
    if (key === 'card') selectCard(value);
  },
  // Panel reset clears EVERY local edit, matching what "reset" means in the other tuners. Dropping just the
  // card in front of you is the separate action below — that is the one you actually want mid-session.
  reset: resetCardArt,
  actions: [
    { label: 'Clear this card', hint: 'Drop just the selected card back to its frame family.', run: () => clearSelected() },
  ],
  // "Copy values" emits the whole session as source for `SHIPPED`, not the one card's JSON: the artifact you
  // paste back is the map, and copying a single card would silently drop every other card you tuned.
  copy: exportCardArt,
  copyLabel: 'Copy overrides',
};

export function CardArtTuner(): JSX.Element {
  // Re-read when an override or the selection changes, so the sliders track a card picked on the board.
  useSyncExternalStore(subscribeCardArt, cardArtVersion, cardArtVersion);
  // Double-click-to-select is armed only while this panel is open, and disarmed when it closes — a hidden
  // double-click meaning that outlived its panel would retarget the tuner with no visible cause.
  useEffect(() => {
    setPickingCardArt(true);
    return () => setPickingCardArt(false);
  }, []);
  return <TunerPanel spec={SPEC} />;
}
