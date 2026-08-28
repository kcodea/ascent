import {
  LOBBY_PANEL_DEFAULTS, LOBBY_PANEL_RANGES,
  getLobbyPanelConfig, resetLobbyPanelConfig, setLobbyPanelValue,
  type LobbyPanelConfig, type LobbyPanelKey,
} from './lobbyPanelConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the LOBBY RAIL — the 8-seat table down the right edge of the stage. Rail scale, row scale
 * and font size are deliberately separate dials (owner ask 2026-07-29) because they trade off against each other:
 * bigger text in the same box means fewer rows fit, and scaling the whole rail to fix the text also moves it off
 * the board edge. Applies live through `--lby-*` vars on `:root` — no reload, no re-render.
 *
 * LANGUAGE. Every label was prefixed to fake grouping ("panel · scale", "rows · font size"); those are real
 * sections now. `height` also needed its hint to carry the non-obvious part: it is a MAXIMUM, and the rail
 * scrolls past it rather than clipping.
 */
const SPECS: Record<LobbyPanelKey, [string, TunerUnit | undefined, string, string]> = {
  scale:     ['Overall size', '×', 'Size of the whole rail — multiplies every other measurement here.', 'Rail'],
  width:     ['Width', 'px', 'Rail width in design pixels.', 'Rail'],
  right:     ['Gap from right edge', 'px', 'Distance from the stage’s right edge.', 'Rail'],
  top:       ['Top edge', '%', 'Top of the rail, as a percentage of stage height.', 'Rail'],
  height:    ['Maximum height', '%', 'A CAP, not a fixed height — the rail sizes itself to its rows and scrolls past this rather than clipping.', 'Rail'],
  offsetX:   ['Shift · horizontal', 'px', 'Nudge the WHOLE panel and its contents left/right. Positive = right.', 'Shift'],
  offsetY:   ['Shift · vertical', 'px', 'Nudge the WHOLE panel and its contents up/down. Positive = down.', 'Shift'],
  rowScale:  ['Row size', '×', 'Seat-row box: its padding and portrait size.', 'Seat rows'],
  fontScale: ['Text size', '×', 'Seat-row text: name, health and damage.', 'Seat rows'],
  foeScale:  ['Card size', '×', 'The Next Foe card — its portrait and text.', 'Next foe'],
};

/** Declaration order IS render order, and controls sharing a group render together under its heading. */
const ORDER: LobbyPanelKey[] = ['scale', 'width', 'right', 'top', 'height', 'offsetX', 'offsetY', 'rowScale', 'fontScale', 'foeScale'];

const controls: TunerControl<Extract<keyof LobbyPanelConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  const [min, max, step] = LOBBY_PANEL_RANGES[key];
  return { key, label, unit, hint, group, min, max, step };
});

export const SPEC: TunerSpec<LobbyPanelConfig> = {
  id: 'lobbypanel',                 // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Lobby Rail',
  note: 'dev · live · drag',
  read: getLobbyPanelConfig,
  write: setLobbyPanelValue,
  reset: resetLobbyPanelConfig,
  defaults: LOBBY_PANEL_DEFAULTS,
  controls,
};

export function LobbyPanelTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
