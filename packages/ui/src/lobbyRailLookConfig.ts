/**
 * DEV tuner config for the LOBBY RAIL's LOOK — the contents of the 8-seat table, as opposed to its fit. The
 * sibling 🪑 Lobby Rail tuner (`lobbyPanelConfig`) owns SIZE/POSITION (scale, width, row, font, where it sits);
 * this one owns EVERYTHING PAINTED INSIDE: portrait size + rounding, spacing, corner radii, every ink and fill,
 * and the whole next-foe marker. Split so "make it fit the frame" and "make it match the frame" are two clean
 * panels instead of one wall of forty sliders (owner ask 2026-08-28: match the gilded backplate, and make it
 * all tunable — portraits, colours, padding, rounding, and a suite for the next-foe display).
 *
 * Same architecture as `boardEdgeConfig` / `lobbyPanelConfig`: DEV-only localStorage, values pushed onto `:root`
 * as `--lby-*` custom properties that the `.lobbyseat` / `.lobbyrail` rules read WITH the shipped value as their
 * fallback — so PRODUCTION, which never runs the tuner, paints identically with no JS. Shipping a tune means
 * pasting the copied values into DEFAULTS here (the CSS fallbacks already mirror them).
 *
 * COLOURS ARE PLAIN HEX. Several targets are translucent (hairlines, glow, the bar track); rather than expose an
 * alpha channel the picker can't show, the CSS bakes the alpha with `color-mix(... N%, transparent)` and the
 * config stores only the hue. So a default of `#ffffff` at a CSS-side 8% reproduces the old `rgba(255,255,255,
 * .08)` hairline exactly, and picking gold recolours it at that same subtle strength.
 *
 * GEOMETRY IS PROPORTIONAL. Ring/glow/bar widths are multipliers of `--lrow` (the row unit), not raw px, so they
 * track the rail's scale dial instead of drifting when the whole rail is resized — every other rail measurement
 * is proportional for the same reason.
 */
import type { TunerControl, TunerSpec } from './tunerSchema';

export interface LobbyRailLookConfig {
  // Portrait
  faceScale: number;   // × the 18·lrow portrait cell (scales cell + image together)
  faceRadius: number;  // % — 50 = circle, 0 = square

  // Seat text
  nameScale: number;   // × the seat-name font size (the name also renders bold)

  // Spacing
  railPad: number;     // × the rail's inner padding (insets rows off the gilded frame)
  seatPad: number;     // × each seat's inner padding
  rowGap: number;      // × the gap between seats

  // Corners
  railRadius: number;  // × the rail's corner radius
  seatRadius: number;  // × each seat's corner radius

  // Seat colours
  seatBg: string;      // resting seat fill
  seatLine: string;    // resting seat hairline (baked to ~8% in CSS)
  nameCol: string;     // seat text / name ink

  // Your seat
  youBg: string;
  youLine: string;     // your-seat hairline (baked to ~60% in CSS)

  // Health & damage
  healthScale: number; // × the health + armor text size (both render bold); scales their heart/shield glyphs too
  barThick: number;    // × the health-bar thickness
  dmgScale: number;    // × the round-damage ("−N") text size
  hpShift: number;     // × lrow — nudge the health + armor cluster horizontally (positive = right)
  hpCol: string;       // health number + heart
  armorCol: string;    // the +armor number
  dmgCol: string;      // the round-damage number under the name
  barA: string;        // health-bar gradient, left
  barB: string;        // health-bar gradient, right
  youBarA: string;     // your health-bar gradient, left
  youBarB: string;     // your health-bar gradient, right
  barTrack: string;    // the empty bar track (baked to ~10% in CSS)

  // Header
  roundCol: string;    // "Round N"
  aliveCol: string;    // "N left"
  maxCol: string;      // the max-loss chip

  // Next foe — the whole marker, dial by dial
  foeBg: string;       // the next opponent's seat fill
  foeRingCol: string;  // the ring around the seat (baked to ~95%)
  foeRing: number;     // × lrow — ring thickness (0 = no ring)
  foeGlowCol: string;  // the outer glow colour (baked to ~55%)
  foeGlow: number;     // × lrow — outer glow blur (0 = no glow)
  foeSpread: number;   // × lrow — outer glow spread
  foeBarCol: string;   // a left accent bar (an alternative to the ring)
  foeBar: number;      // × lrow — left accent bar width (0 = no bar)
  foePulseDur: number; // s — pulse period
  foePulseMin: number; // opacity — how deep the pulse dips (1 = static, no pulse)
}

/** Owner-tunable; these mirror the CSS fallbacks in the `.lobbyrail` / `.lobbyseat` block, so production paints
 *  them with no JS. Bake a tune by pasting Copy values here AND updating those fallbacks. */
const DEFAULTS: LobbyRailLookConfig = {
  // Owner-tuned 2026-08-28 (🎨 Lobby Rail Look → Copy values). Warm-brown plaques with a gold hairline, a bold
  // blue YOUR-seat, hot-red health bars, and a fierce red-glowing next foe with a thick left accent bar + a deep
  // pulse. Portraits slightly larger + squarer, rows pulled well in off the frame, tight seat padding, square
  // rail corners. All mirrored into the styles.css fallbacks below so prod paints it with no JS.
  faceScale: 1.5,
  faceRadius: 22,

  nameScale: 1.5,

  railPad: 4.5,
  seatPad: 0.75,
  rowGap: 1.1,

  railRadius: 0,
  seatRadius: 0.55,

  seatBg: '#6b492e',
  seatLine: '#d4941c',
  nameCol: '#ffffff',

  youBg: '#003d75',
  youLine: '#00fbff',

  healthScale: 1.45,
  barThick: 2.05,
  dmgScale: 1.35,
  hpShift: 9,
  hpCol: '#fb3737',
  armorCol: '#a3a3a3',
  dmgCol: '#e18484',
  barA: '#ff5024',
  barB: '#fe0101',
  youBarA: '#ff5024',
  youBarB: '#fe0101',
  barTrack: '#000000',

  roundCol: '#fff6e4',
  aliveCol: '#f4d58a',
  maxCol: '#ff9a9a',

  foeBg: '#801900',
  foeRingCol: '#ff8080',
  foeRing: 1.7,
  foeGlowCol: '#ff5252',
  foeGlow: 14,
  foeSpread: 5,
  foeBarCol: '#ffc370',
  foeBar: 2.7,
  foePulseDur: 1.7,
  foePulseMin: 0.1,
};

export { DEFAULTS as LOBBY_RAIL_LOOK_DEFAULTS };

/** `[min, max, step]` for the numeric knobs only (colours have no range). */
const RANGES: Record<
  'faceScale' | 'faceRadius' | 'nameScale' | 'railPad' | 'seatPad' | 'rowGap' | 'railRadius' | 'seatRadius'
  | 'healthScale' | 'barThick' | 'dmgScale' | 'hpShift'
  | 'foeRing' | 'foeGlow' | 'foeSpread' | 'foeBar' | 'foePulseDur' | 'foePulseMin',
  [number, number, number]
> = {
  faceScale: [0.5, 2, 0.01],
  faceRadius: [0, 50, 1],
  nameScale: [0.7, 2.2, 0.05],
  healthScale: [0.7, 2.5, 0.05],
  barThick: [0.3, 4, 0.05],
  dmgScale: [0.7, 2.5, 0.05],
  hpShift: [-12, 12, 0.5],
  railPad: [0, 3, 0.05],
  seatPad: [0.3, 2.5, 0.05],
  rowGap: [0, 4, 0.05],
  railRadius: [0, 3, 0.05],
  seatRadius: [0, 3, 0.05],
  foeRing: [0, 2, 0.05],
  foeGlow: [0, 20, 0.5],
  foeSpread: [0, 5, 0.1],
  foeBar: [0, 4, 0.1],
  foePulseDur: [0.4, 4, 0.1],
  foePulseMin: [0.1, 1, 0.02],
};

const KEY = 'ascent.lobbyRailLook';

let cfg: LobbyRailLookConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<LobbyRailLookConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getLobbyRailLookConfig(): LobbyRailLookConfig {
  return cfg;
}

/** Push every value onto `:root` as `--lby-*`. Each `.lobbyseat` / `.lobbyrail` rule reads these WITH a fallback,
 *  so a missing var (production, or a stale save) renders the shipped look rather than a broken one. */
export function applyLobbyRailLookVars(): void {
  if (typeof document === 'undefined') return;
  const s = document.documentElement.style;
  s.setProperty('--lby-face', String(cfg.faceScale));
  s.setProperty('--lby-face-rad', String(cfg.faceRadius));
  s.setProperty('--lby-name-size', String(cfg.nameScale));
  s.setProperty('--lby-pad', String(cfg.railPad));
  s.setProperty('--lby-seat-pad', String(cfg.seatPad));
  s.setProperty('--lby-gap', String(cfg.rowGap));
  s.setProperty('--lby-rail-rad', String(cfg.railRadius));
  s.setProperty('--lby-seat-rad', String(cfg.seatRadius));
  s.setProperty('--lby-seat-bg', cfg.seatBg);
  s.setProperty('--lby-seat-line', cfg.seatLine);
  s.setProperty('--lby-name-col', cfg.nameCol);
  s.setProperty('--lby-you-bg', cfg.youBg);
  s.setProperty('--lby-you-line', cfg.youLine);
  s.setProperty('--lby-hp-size', String(cfg.healthScale));
  s.setProperty('--lby-bar-thick', String(cfg.barThick));
  s.setProperty('--lby-dmg-size', String(cfg.dmgScale));
  s.setProperty('--lby-hp-x', String(cfg.hpShift));
  s.setProperty('--lby-hp-col', cfg.hpCol);
  s.setProperty('--lby-armor-col', cfg.armorCol);
  s.setProperty('--lby-dmg-col', cfg.dmgCol);
  s.setProperty('--lby-bar-a', cfg.barA);
  s.setProperty('--lby-bar-b', cfg.barB);
  s.setProperty('--lby-youbar-a', cfg.youBarA);
  s.setProperty('--lby-youbar-b', cfg.youBarB);
  s.setProperty('--lby-bar-track', cfg.barTrack);
  s.setProperty('--lby-round-col', cfg.roundCol);
  s.setProperty('--lby-alive-col', cfg.aliveCol);
  s.setProperty('--lby-max-col', cfg.maxCol);
  s.setProperty('--lby-foe-bg', cfg.foeBg);
  s.setProperty('--lby-foe-ring-col', cfg.foeRingCol);
  s.setProperty('--lby-foe-ring', String(cfg.foeRing));
  s.setProperty('--lby-foe-glow-col', cfg.foeGlowCol);
  s.setProperty('--lby-foe-glow', String(cfg.foeGlow));
  s.setProperty('--lby-foe-spread', String(cfg.foeSpread));
  s.setProperty('--lby-foe-bar-col', cfg.foeBarCol);
  s.setProperty('--lby-foe-bar', String(cfg.foeBar));
  s.setProperty('--lby-foe-pulse-dur', String(cfg.foePulseDur));
  s.setProperty('--lby-foe-pulse-min', String(cfg.foePulseMin));
}

export function setLobbyRailLookValue(key: keyof LobbyRailLookConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  applyLobbyRailLookVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetLobbyRailLookConfig(): void {
  cfg = { ...DEFAULTS };
  applyLobbyRailLookVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** A range control from RANGES; a colour control needs no range. */
const r = (
  key: keyof typeof RANGES, label: string, group: string,
  unit: TunerControl['unit'], hint: string, note?: string,
): TunerControl<Extract<keyof LobbyRailLookConfig, string>> => {
  const [min, max, step] = RANGES[key];
  return { key, label, group, unit, hint, note, min, max, step };
};
const col = (
  key: Extract<keyof LobbyRailLookConfig, string>, label: string, group: string, hint: string,
): TunerControl<Extract<keyof LobbyRailLookConfig, string>> =>
  ({ key, label, group, hint, kind: 'color', min: 0, max: 0, step: 0 });

const controls: TunerControl<Extract<keyof LobbyRailLookConfig, string>>[] = [
  r('faceScale', 'Portrait size', 'Portrait', '×', 'Hero portrait size — scales the portrait and its column together.'),
  r('faceRadius', 'Portrait rounding', 'Portrait', '%', 'Portrait corner rounding. 50 = a circle, 0 = a square.'),

  r('nameScale', 'Name size', 'Seat text', '×', 'Size of the seat name text — it renders bold.'),

  r('railPad', 'Rail inset', 'Spacing', '×', 'How far the rows pull IN off the gilded frame. Raise it to seat the content inside the border.'),
  r('seatPad', 'Seat padding', 'Spacing', '×', 'Padding inside each seat row.'),
  r('rowGap', 'Gap between seats', 'Spacing', '×', 'Vertical space between seat rows.'),

  r('railRadius', 'Rail corners', 'Corners', '×', "The rail's own corner radius."),
  r('seatRadius', 'Seat corners', 'Corners', '×', 'Corner radius of every seat row.'),

  col('seatBg', 'Seat fill', 'Seat colours', 'Resting seat background — the plaque colour behind each opponent.'),
  col('seatLine', 'Seat hairline', 'Seat colours', 'The thin outline around a resting seat (painted subtly, ~8%).'),
  col('nameCol', 'Name ink', 'Seat colours', 'Opponent name text colour.'),

  col('youBg', 'Your seat fill', 'Your seat', 'The fill of YOUR row.'),
  col('youLine', 'Your hairline', 'Your seat', 'The outline around your row (painted at ~60%).'),

  r('healthScale', 'Health & armor size', 'Health & damage', '×', 'Size of the health + armor numbers and their heart/shield glyphs — they render bold.'),
  r('barThick', 'Bar thickness', 'Health & damage', '×', 'Thickness of the health bar.'),
  r('dmgScale', 'Damage-taken size', 'Health & damage', '×', 'Size of the "−N" round-damage number that pops under the name.'),
  r('hpShift', 'Health position', 'Health & damage', '×', 'Nudge the health + armor cluster left/right. Positive = right.'),
  col('hpCol', 'Health ink', 'Health & damage', 'The health number and heart.'),
  col('armorCol', 'Armor ink', 'Health & damage', 'The +armor number beside health.'),
  col('dmgCol', 'Damage ink', 'Health & damage', 'The round-damage number that pops under the name.'),
  col('barA', 'Bar fill · left', 'Health & damage', 'Left end of the health-bar gradient.'),
  col('barB', 'Bar fill · right', 'Health & damage', 'Right end of the health-bar gradient.'),
  col('youBarA', 'Your bar · left', 'Health & damage', 'Left end of YOUR health-bar gradient.'),
  col('youBarB', 'Your bar · right', 'Health & damage', 'Right end of YOUR health-bar gradient.'),
  col('barTrack', 'Bar track', 'Health & damage', 'The empty part of every health bar (painted at ~10%).'),

  col('roundCol', 'Round ink', 'Header', 'The "Round N" text.'),
  col('aliveCol', 'Seats-left ink', 'Header', 'The "N left" count.'),
  col('maxCol', 'Max-loss ink', 'Header', 'The most-you-can-lose chip.'),

  col('foeBg', 'Foe seat fill', 'Next foe', 'The next opponent’s seat background.'),
  col('foeRingCol', 'Ring colour', 'Next foe', 'The ring drawn around the next-foe seat.'),
  r('foeRing', 'Ring width', 'Next foe', '×', 'Thickness of the next-foe ring. 0 removes the ring (e.g. for a glow-only or bar-only marker).'),
  col('foeGlowCol', 'Glow colour', 'Next foe', 'The soft outer glow around the next-foe seat.'),
  r('foeGlow', 'Glow size', 'Next foe', '×', 'Outer-glow blur. 0 removes the glow.'),
  r('foeSpread', 'Glow spread', 'Next foe', '×', 'How far the glow bleeds outward before it fades.'),
  col('foeBarCol', 'Accent-bar colour', 'Next foe', 'A left-edge accent bar — an alternative marker style to the ring.'),
  r('foeBar', 'Accent-bar width', 'Next foe', '×', 'Left-edge accent-bar width. 0 = no bar; raise it for a bar-style marker.'),
  r('foePulseDur', 'Pulse speed', 'Next foe', 's', 'How long one breath of the pulse takes. Lower = faster.'),
  r('foePulseMin', 'Pulse depth', 'Next foe', 'opacity', 'How far the pulse dims between breaths. Set to 1 for a STATIC lit seat (no pulse).'),
];

export const SPEC: TunerSpec<LobbyRailLookConfig> = {
  id: 'lobbyraillook',              // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Lobby Rail Look',
  note: 'dev · live · persists',
  read: getLobbyRailLookConfig,
  write: (key, value) => setLobbyRailLookValue(key, value),
  writeColor: (key, value) => setLobbyRailLookValue(key, value),
  reset: resetLobbyRailLookConfig,
  defaults: DEFAULTS,
  controls,
};

// Reflect vars at load (dev: persisted values; prod: DEFAULTS — matches the styles.css fallbacks either way).
applyLobbyRailLookVars();
