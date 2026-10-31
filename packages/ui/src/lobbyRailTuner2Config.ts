/**
 * LOBBY RAIL TUNER 2 (owner 2026-10-30: "a lot of the tuner things dont seem to work, can you rebuild a new tuner called
 * lobby rail tuner 2 that actually gives me full control of the sizing/position/spacing etc of the rail"). DEV only.
 *
 * It drives the DOCKED rail (owner 2026-10-31; lobbyRailDocked.css + lobbyRailDockedLayout.ts) and nothing else. Its
 * geometry is laid out in JS off the board's own Refresh / gem / Gold, so those dials (`LR2_LAYOUT`) feed the layout
 * through `setDockCfg` (lobbyRailVariant.ts); its paint dials are CSS vars.
 * WHY THE OLD DIALS FAILED (audit, 2026-10-30): most 🎨 Lobby Rail Look / 🪑 Lobby Rail dials feed Classic or Gem rules
 * that a variant overrides outright; on phones `phoneLayout.css` / `touchUi.css` re-declare `--lby-*` vars on the rail,
 * which shadows a `:root` value; and fixed multipliers fought the sliders. Tuner 2 fixes that by construction: ONE uniquely
 * named var per paint control (`--lr2-*`), nothing else in the codebase declares any of them, and every one is read by
 * exactly the rule that paints what the control names. The vars live on `:root` because the rail, its header and the
 * hover card (portaled to <body>) all read them. `lobbyRailTuner2.test.ts` holds that contract, and that
 * every layout dial moves the docked layout.
 *
 * Persistence: localStorage (try/catch), DEV only. Production never imports this module (LobbyPanel loads it under
 * `import.meta.env.DEV`); there the sheet's fallbacks and DOCK_DEFAULTS are the shipped values, equal to LR2_DEFAULTS.
 */
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';
import { DOCK_DEFAULTS, DOCK_TOP_MODES, type DockCfg, type DockTopMode } from './lobbyRailDockedLayout';
import { SLICE_LABELS, setDockCfg, setSliceLabel, type SliceLabel } from './lobbyRailVariant';

/** The Health bar's look (owner 2026-10-31: "Can the health bar look more satisfying instead of pill like"): flush and
 *  bevelled into the portrait's foot, with or without a faint tick every 5 Health. */
export const LR2_BAR_STYLES = ['gloss', 'smooth'] as const;
/** Docked slice content (owner 2026-10-31: "have their art start on the left side and fade it out and have the player
 *  name on the right side"; "i want to try a few things with the art/name etc"). */
// `fade75` (owner 2026-10-31: "can we add a 75% art into a fade option and try hero names as the text with that"): the art
// across the left 75% at full strength, fading into the plate over the last quarter.
// `navy` (owner 2026-10-31: "i want number and armor number left in the navy blue, fades into the hero portrait, which only
// takes up the right most 60% of space"): a dark navy plate on the left carrying the Health numbers, the art on the right
// `--lr2-navy-art-w`% fading in from it. The shipped look.
export const LR2_ART_LAYOUTS = ['navy', 'left', 'full', 'right', 'center', 'fade75'] as const;
export type Lr2ArtLayout = (typeof LR2_ART_LAYOUTS)[number];
export const LR2_NAME_SIDES = ['right', 'left'] as const;
export type Lr2NameSide = (typeof LR2_NAME_SIDES)[number];
export const LR2_NAME_SHOW = ['on', 'off'] as const;

export type Lr2NameShow = (typeof LR2_NAME_SHOW)[number];

export type Lr2BarStyle = (typeof LR2_BAR_STYLES)[number];

/** How a slice shows Health (owner 2026-10-31: "the health bar is impossible to know what it actually means, right? can we
 *  make that a number?"): the numbers (default), the bar, or both. */
export const LR2_HP_SHOW = ['number', 'bar', 'both'] as const;
export type Lr2HpShow = (typeof LR2_HP_SHOW)[number];
/** The navy plate's colour (a #rrggbb). */
export const LR2_NAVY_DEFAULT = '#0d1a36';

export interface LobbyRailTuner2Config {
  barStyle: Lr2BarStyle;
  hpShow: Lr2HpShow;
  navyColor: string;
  dkTop: DockTopMode;
  artLayout: Lr2ArtLayout; nameSide: Lr2NameSide; nameShow: Lr2NameShow;
  /** What the slice's label says: the player's name, the hero's name, or nothing (owner 2026-10-31). */
  nameText: SliceLabel;
  navyArtW: number; navyFade: number;
  hpNumSize: number; armNumSize: number; hpNumX: number; hpNumY: number;
  artZoom: number; artFx: number; artFy: number; artW: number; fadeStart: number; fadeLen: number; fadeStr: number; artBright: number;
  nameSize: number; nameWeight: number; nameLines: number; nameX: number; nameY: number; nameShadow: number;
  // Docked: the layout (JS) ...
  dkEclipse: number; dkPanelMax: number; dkGap: number; dkOffset: number; dkTopShift: number; dkEdge: number; dkNotch: number; dkCoinPad: number; dkRefreshPad: number; dkGemPad: number; dkBottom: number; dkHeadH: number; dkMaxW: number;
  // ... and its paint (CSS).
  dkHeadFont: number;
  // The Health bar (both rails).
  barH: number; barOverlap: number; barInset: number;
  headX: number; headY: number; headShadow: number;
  pulseRing: number; pulseGlow: number; pulseMin: number; pulseMax: number; pulsePeriod: number;
  cardW: number; cardX: number; cardY: number; cardFont: number;
}
type SelKey = 'barStyle' | 'hpShow' | 'navyColor' | 'dkTop' | 'artLayout' | 'nameSide' | 'nameShow' | 'nameText';
type NumKey = Exclude<keyof LobbyRailTuner2Config, SelKey>;

export const LR2_DEFAULTS: LobbyRailTuner2Config = {
  barStyle: 'gloss', hpShow: 'number', navyColor: LR2_NAVY_DEFAULT,
  // The shipped look (owner pick 2026-10-31, "i like these values"): the navy plate with the Health numbers, the art on the right, the hero's name on each slice.
  navyArtW: 73, navyFade: 63,
  hpNumSize: 24.5, armNumSize: 14, hpNumX: -7, hpNumY: 0,
  artLayout: 'navy', nameSide: 'right', nameShow: 'on', nameText: 'hero',
  artZoom: 1.04, artFx: 0, artFy: 21, artW: 20, fadeStart: 0, fadeLen: 100, fadeStr: 1, artBright: 1,
  nameSize: 15, nameWeight: 800, nameLines: 2, nameX: 0, nameY: 0, nameShadow: 1,
  dkTop: DOCK_DEFAULTS.topMode,
  dkEclipse: DOCK_DEFAULTS.eclipse,
  dkPanelMax: DOCK_DEFAULTS.panelMax, dkGap: DOCK_DEFAULTS.gap, dkOffset: DOCK_DEFAULTS.offset, dkTopShift: DOCK_DEFAULTS.topShift,
  dkEdge: DOCK_DEFAULTS.edge, dkNotch: DOCK_DEFAULTS.notch, dkCoinPad: DOCK_DEFAULTS.coinPad, dkRefreshPad: DOCK_DEFAULTS.refreshPad, dkGemPad: DOCK_DEFAULTS.gemPad, dkBottom: DOCK_DEFAULTS.bottomShift, dkHeadH: DOCK_DEFAULTS.headH, dkMaxW: DOCK_DEFAULTS.maxW,
  dkHeadFont: 1,
  barH: 22, barOverlap: 0, barInset: 0,
  headX: 1, headY: 0, headShadow: 0,
  pulseRing: 1.95, pulseGlow: 3, pulseMin: 0.53, pulseMax: 1, pulsePeriod: 2.2,
  cardW: 1.8, cardX: -9, cardY: 0, cardFont: 1.39,
};

/** The docked layout dials and the `DockCfg` field each feeds. */
export const LR2_LAYOUT: Readonly<Partial<Record<NumKey, Exclude<keyof DockCfg, 'topMode'>>>> = {
  dkEclipse: 'eclipse', dkPanelMax: 'panelMax', dkGap: 'gap', dkOffset: 'offset', dkTopShift: 'topShift', dkEdge: 'edge', dkNotch: 'notch', dkCoinPad: 'coinPad', dkRefreshPad: 'refreshPad', dkGemPad: 'gemPad', dkBottom: 'bottomShift', dkHeadH: 'headH', dkMaxW: 'maxW',
};

interface NumDef { v: string; group: string; label: string; unit?: TunerUnit; min: number; max: number; step: number; hint: string }
const D = 'Docked: layout', DP = 'Docked: look', SA = 'Slice art & name', HN = 'Health numbers', HB = 'Health bar';
/** Each numeric control's var (or layout field), its range and what it means. The var names are the contract with the sheets. */
const NUM: Record<NumKey, NumDef> = {
  dkPanelMax: { v: '--lr2-dk-panel-max', group: D, label: 'Max slice height', unit: 'px', min: 50, max: 260, step: 1, hint: 'Docked: the tallest a slice may be (matters on a short table, e.g. a 4-player Versus group).' },
  dkGap: { v: '--lr2-dk-gap', group: D, label: 'Panel gap', unit: 'px', min: 0, max: 24, step: 0.5, hint: 'Docked: the space between panels.' },
  dkHeadH: { v: '--lr2-dk-head-h', group: D, label: 'Round slice height', unit: 'px', min: 30, max: 120, step: 0.5, hint: 'Docked (Slight eclipse / Level): the height of the round slice above the stack. In Below it takes the Refresh pill’s height.' },
  dkOffset: { v: '--lr2-dk-offset', group: D, label: 'Offset from the board rail', unit: 'px', min: -40, max: 80, step: 0.5, hint: 'Docked: from the board’s right rail (the gem’s centre line) to the slices’ left edge.' },
  dkEclipse: { v: '--lr2-dk-eclipse', group: D, label: 'Eclipse depth', unit: '×', min: 0, max: 1, step: 0.01, hint: 'Docked, Slight eclipse: how much of the Refresh pill’s height the first slice tucks under (0 = just touching its foot).' },
  dkTopShift: { v: '--lr2-dk-top-shift', group: D, label: 'Top player offset', unit: 'px', min: -150, max: 150, step: 0.5, hint: 'Docked: moves the first player’s slice from level with the Refresh pill (0). Negative = up. The stack re-fits down to the coin.' },
  dkMaxW: { v: '--lr2-dk-max-w', group: D, label: 'Max slice width', unit: 'px', min: 120, max: 500, step: 1, hint: 'Docked: the widest a slice may be.' },
  dkEdge: { v: '--lr2-dk-edge', group: D, label: 'Margin from screen edges', unit: 'px', min: 0, max: 80, step: 0.5, hint: 'Docked: the margin kept from the window’s top, right and bottom edges.' },
  dkRefreshPad: { v: '--lr2-dk-refresh-pad', group: D, label: 'Extra Refresh clearance', unit: 'px', min: -10, max: 30, step: 0.5, hint: 'Docked: extra gap round the Refresh pill only, on top of Cut clearance.' },
  dkGemPad: { v: '--lr2-dk-gem-pad', group: D, label: 'Extra gem clearance', unit: 'px', min: -10, max: 30, step: 0.5, hint: 'Docked: extra gap round the End Turn gem only, on top of Cut clearance.' },
  dkBottom: { v: '--lr2-dk-bottom', group: D, label: 'Stack bottom', unit: 'px', min: -60, max: 80, step: 0.5, hint: 'Docked: where the player slices end, from the foot of the Gold coin’s ring (+ = lower, so taller slices). The round slice never moves.' },
  dkCoinPad: { v: '--lr2-dk-coin-pad', group: D, label: 'Extra coin clearance', unit: 'px', min: -10, max: 30, step: 0.5, hint: 'Docked: extra gap round the Gold coin only, on top of Cut clearance.' },
  dkNotch: { v: '--lr2-dk-notch', group: D, label: 'Cut clearance', unit: 'px', min: 0, max: 30, step: 0.5, hint: 'Docked: the even gap kept between the Refresh pill, the gem or the Gold coin and the slice cut round it.' },

  navyArtW: { v: '--lr2-navy-art-w', group: SA, label: 'Navy: art width', unit: '%', min: 30, max: 100, step: 1, hint: 'Navy layout: how much of the slice, from the right, the hero art covers.' },
  navyFade: { v: '--lr2-navy-fade', group: SA, label: 'Navy: fade length', unit: '%', min: 0, max: 100, step: 1, hint: 'Navy layout: how far into the art (a share of its width) the fade from the navy plate runs.' },
  hpNumSize: { v: '--lr2-hpnum-size', group: HN, label: 'Health size', unit: 'px', min: 10, max: 44, step: 0.5, hint: 'The Health number’s size (board px at 1080p).' },
  armNumSize: { v: '--lr2-armnum-size', group: HN, label: 'Armor size', unit: 'px', min: 8, max: 36, step: 0.5, hint: 'The Armor number’s size (board px at 1080p).' },
  hpNumX: { v: '--lr2-hpnum-x', group: HN, label: 'Move left / right', unit: 'px', min: -60, max: 120, step: 0.5, hint: 'Nudges the numbers sideways from just clear of the slice’s cut.' },
  hpNumY: { v: '--lr2-hpnum-y', group: HN, label: 'Move up / down', unit: 'px', min: -40, max: 40, step: 0.5, hint: 'Nudges the numbers up or down from the slice’s middle.' },
  artZoom: { v: '--lr2-art-zoom', group: SA, label: 'Art crop zoom', unit: '×', min: 0.6, max: 2.5, step: 0.01, hint: 'Zooms the hero art inside its area (1 = fills it).' },
  artFx: { v: '--lr2-art-fx', group: SA, label: 'Art focal X', unit: '%', min: 0, max: 100, step: 1, hint: 'Which part of the art stays in view, left (0) to right (100).' },
  artFy: { v: '--lr2-art-fy', group: SA, label: 'Art focal Y', unit: '%', min: 0, max: 100, step: 1, hint: 'Which part of the art stays in view, top (0) to bottom (100). Faces sit near 20-30.' },
  artW: { v: '--lr2-art-w', group: SA, label: 'Art width', unit: '%', min: 20, max: 100, step: 1, hint: 'How much of the slice the art covers (Left fade / Right fade / Centered).' },
  fadeStart: { v: '--lr2-fade-start', group: SA, label: 'Fade start', unit: '%', min: 0, max: 100, step: 1, hint: 'Where the art starts fading out, as a share of its own width.' },
  fadeLen: { v: '--lr2-fade-len', group: SA, label: 'Fade length', unit: '%', min: 0, max: 100, step: 1, hint: 'How long the fade runs, as a share of the art’s width.' },
  fadeStr: { v: '--lr2-fade-str', group: SA, label: 'Fade strength', unit: '×', min: 0, max: 1, step: 0.01, hint: 'How fully the art fades into the slice’s plate (1 = gone, 0 = no fade).' },
  artBright: { v: '--lr2-art-bright', group: SA, label: 'Art brightness', unit: '×', min: 0.4, max: 1.6, step: 0.01, hint: 'Brightens or darkens every slice’s art.' },
  nameSize: { v: '--lr2-name-size', group: SA, label: 'Name size', unit: 'px', min: 7, max: 26, step: 0.5, hint: 'The player name’s size (board px at 1080p).' },
  nameWeight: { v: '--lr2-name-weight', group: SA, label: 'Name weight', min: 400, max: 900, step: 100, hint: 'How bold the name is.' },
  nameLines: { v: '--lr2-name-lines', group: SA, label: 'Name max lines', min: 1, max: 3, step: 1, hint: 'Lines a long name may wrap to before it is cut with an ellipsis.' },
  nameX: { v: '--lr2-name-x', group: SA, label: 'Name left / right', unit: 'px', min: -80, max: 80, step: 0.5, hint: 'Nudges every name sideways.' },
  nameY: { v: '--lr2-name-y', group: SA, label: 'Name up / down', unit: 'px', min: -40, max: 40, step: 0.5, hint: 'Nudges every name up or down.' },
  nameShadow: { v: '--lr2-name-shadow', group: SA, label: 'Name shadow', unit: '×', min: 0, max: 3, step: 0.05, hint: 'How strong the shadow under the name is.' },
  barH: { v: '--lr2-bar-h', group: HB, label: 'Bar height', unit: '%', min: 4, max: 30, step: 0.5, hint: 'The Health bar’s height, as a share of the portrait’s height.' },
  barOverlap: { v: '--lr2-bar-overlap', group: HB, label: 'Bar overlap', unit: '%', min: -100, max: 100, step: 1, hint: 'How much of the bar hangs below the portrait’s foot. 0 = sits on the foot, inside; 50 = straddles the edge; 100 = just under it.' },
  barInset: { v: '--lr2-bar-inset', group: HB, label: 'Bar width inset', unit: '%', min: 0, max: 30, step: 0.5, hint: 'Space kept at each end of the bar, as a share of the portrait’s width. 0 = full width.' },
  dkHeadFont: { v: '--lr2-dk-head-font', group: DP, label: 'Round slice text size', unit: '×', min: 0.5, max: 2.5, step: 0.01, hint: 'Docked: ROUND N and MAX DMG in the round slice.' },
  headX: { v: '--lr2-head-x', group: 'Header (Round / left / max dmg)', label: 'Move left / right', unit: 'px', min: -300, max: 300, step: 1, hint: 'Moves the header text. Positive = right.' },
  headY: { v: '--lr2-head-y', group: 'Header (Round / left / max dmg)', label: 'Move up / down', unit: 'px', min: -200, max: 200, step: 1, hint: 'Moves the header text. Positive = down.' },
  headShadow: { v: '--lr2-head-shadow', group: 'Header (Round / left / max dmg)', label: 'Shadow strength', unit: '×', min: 0, max: 5, step: 0.05, hint: 'How strong the shadow under the header text is. 0 = none.' },
  pulseRing: { v: '--lr2-pulse-ring', group: 'Opponent pulse', label: 'Ring thickness', min: 0, max: 6, step: 0.05, hint: 'The red ring round the player you fight next.' },
  pulseGlow: { v: '--lr2-pulse-glow', group: 'Opponent pulse', label: 'Glow strength', unit: '×', min: 0, max: 3, step: 0.05, hint: 'How far the red glow spreads.' },
  pulseMin: { v: '--lr2-pulse-min', group: 'Opponent pulse', label: 'Dimmest', unit: 'opacity', min: 0, max: 1, step: 0.01, hint: 'The pulse’s low point. Set it equal to Brightest for a steady ring.' },
  pulseMax: { v: '--lr2-pulse-max', group: 'Opponent pulse', label: 'Brightest', unit: 'opacity', min: 0, max: 1, step: 0.01, hint: 'The pulse’s high point.' },
  pulsePeriod: { v: '--lr2-pulse-period', group: 'Opponent pulse', label: 'Period', unit: 's', min: 0.4, max: 5, step: 0.05, hint: 'Seconds for one full breath.' },
  cardW: { v: '--lr2-card-w', group: 'Hover card', label: 'Width', unit: '×', min: 0.6, max: 1.8, step: 0.01, hint: 'Width of the scouting card.' },
  cardX: { v: '--lr2-card-x', group: 'Hover card', label: 'Left / right', unit: 'px', min: -300, max: 300, step: 1, hint: 'Moves the card from where it opens.' },
  cardY: { v: '--lr2-card-y', group: 'Hover card', label: 'Up / down', unit: 'px', min: -300, max: 300, step: 1, hint: 'Moves the card from where it opens.' },
  cardFont: { v: '--lr2-card-font', group: 'Hover card', label: 'Text + icon scale', unit: '×', min: 0.6, max: 2, step: 0.01, hint: 'Scales the card’s text, portraits and runes.' },
};
/** For the contract test: every numeric control's var. */
export const LR2_VARS: Readonly<Record<NumKey, string>> = Object.fromEntries(Object.entries(NUM).map(([k, d]) => [k, d.v])) as Record<NumKey, string>;

const KEY = 'ascent.lobbyRailTuner2.v3'; // v3: the navy layout + Health numbers became the default
const isBarStyle = (v: unknown): v is Lr2BarStyle => v === 'gloss' || v === 'smooth';
const isHpShow = (v: unknown): v is Lr2HpShow => (LR2_HP_SHOW as readonly unknown[]).includes(v);
const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const isArt = (v: unknown): v is Lr2ArtLayout => (LR2_ART_LAYOUTS as readonly unknown[]).includes(v);
const isSide = (v: unknown): v is Lr2NameSide => v === 'right' || v === 'left';
const isShow = (v: unknown): v is Lr2NameShow => v === 'on' || v === 'off';
const isLabel = (v: unknown): v is SliceLabel => (SLICE_LABELS as readonly unknown[]).includes(v);
const isTop = (v: unknown): v is DockTopMode => (DOCK_TOP_MODES as readonly unknown[]).includes(v);

function load(): LobbyRailTuner2Config {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const out: LobbyRailTuner2Config = { ...LR2_DEFAULTS };
    if (isBarStyle(o.barStyle)) out.barStyle = o.barStyle;
    if (isHpShow(o.hpShow)) out.hpShow = o.hpShow;
    if (isHex(o.navyColor)) out.navyColor = o.navyColor;
    if (isArt(o.artLayout)) out.artLayout = o.artLayout;
    if (isSide(o.nameSide)) out.nameSide = o.nameSide;
    if (isShow(o.nameShow)) out.nameShow = o.nameShow;
    if (isLabel(o.nameText)) out.nameText = o.nameText;
    if (isTop(o.dkTop)) out.dkTop = o.dkTop;
    for (const k of Object.keys(NUM) as NumKey[]) {
      const v = o[k];
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(NUM[k].max, Math.max(NUM[k].min, v));
    }
    return out;
  } catch {
    return { ...LR2_DEFAULTS };
  }
}
let cfg: LobbyRailTuner2Config = load();

export const getLobbyRailTuner2 = (): LobbyRailTuner2Config => cfg;

/** The docked layout's dials out of the tuner's values. */
export function dockCfgOf(c: LobbyRailTuner2Config): DockCfg {
  const out: DockCfg = { ...DOCK_DEFAULTS, topMode: c.dkTop };
  for (const [k, f] of Object.entries(LR2_LAYOUT) as [NumKey, Exclude<keyof DockCfg, 'topMode'>][]) out[f] = c[k];
  return out;
}

/** Every value onto `:root`, one var per control (the layout dials too, so the contract is uniform), and the layout
 *  dials into the docked layout. */
export function applyLobbyRailTuner2(): void {
  setDockCfg(dockCfgOf(cfg));
  setSliceLabel(cfg.nameText);
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-lr2-bar', cfg.barStyle);
  root.setAttribute('data-lr2-hp', cfg.hpShow);
  root.style.setProperty('--lr2-navy', cfg.navyColor);
  root.setAttribute('data-lr2-art', cfg.artLayout);
  root.setAttribute('data-lr2-name-side', cfg.nameSide);
  root.setAttribute('data-lr2-name', cfg.nameShow);
  for (const k of Object.keys(NUM) as NumKey[]) root.style.setProperty(NUM[k].v, String(cfg[k]));
}

function save(): void {
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* storage unavailable: this session only */ }
}
export function setLobbyRailTuner2(key: keyof LobbyRailTuner2Config, value: number | string): void {
  if (key === 'barStyle') { if (!isBarStyle(value)) return; cfg = { ...cfg, barStyle: value }; }
  else if (key === 'hpShow') { if (!isHpShow(value)) return; cfg = { ...cfg, hpShow: value }; }
  else if (key === 'navyColor') { if (!isHex(value)) return; cfg = { ...cfg, navyColor: value }; }
  else if (key === 'artLayout') { if (!isArt(value)) return; cfg = { ...cfg, artLayout: value }; }
  else if (key === 'nameSide') { if (!isSide(value)) return; cfg = { ...cfg, nameSide: value }; }
  else if (key === 'nameShow') { if (!isShow(value)) return; cfg = { ...cfg, nameShow: value }; }
  else if (key === 'nameText') { if (!isLabel(value)) return; cfg = { ...cfg, nameText: value }; }
  else if (key === 'dkTop') { if (!isTop(value)) return; cfg = { ...cfg, dkTop: value }; }
  else if (typeof value === 'number' && Number.isFinite(value)) cfg = { ...cfg, [key]: Math.min(NUM[key].max, Math.max(NUM[key].min, value)) };
  else return;
  applyLobbyRailTuner2();
  save();
}
export function resetLobbyRailTuner2(): void {
  cfg = { ...LR2_DEFAULTS };
  applyLobbyRailTuner2();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

const controls: TunerControl<Extract<keyof LobbyRailTuner2Config, string>>[] = [
  {
    key: 'dkTop', label: 'Top player vs Refresh', group: D, kind: 'select', options: DOCK_TOP_MODES,
    optionLabels: { below: 'Below (the round slice ties into the pill; the default)', eclipse: 'Slight eclipse (tucks under the pill’s foot)', level: 'Level (centred on the pill, deep cut)' },
    hint: 'Docked: where the first player’s slice sits against the Refresh pill. The stack re-fits down to the coin.', min: 0, max: 0, step: 0,
  },
  {
    key: 'hpShow', label: 'Show Health as', group: HN, kind: 'select', options: LR2_HP_SHOW,
    optionLabels: { number: 'Numbers (Health + Armor; default)', bar: 'Bar only', both: 'Numbers and bar' },
    hint: 'Docked: Health and Armor as numbers on the slice’s left, the bar along its foot, or both.', min: 0, max: 0, step: 0,
  },
  {
    key: 'navyColor', label: 'Navy: plate colour', group: SA, kind: 'color',
    hint: 'Navy layout: the colour of the plate the numbers sit on (it fades into the art).', min: 0, max: 0, step: 0,
  },
  {
    key: 'barStyle', label: 'Bar style', group: HB, kind: 'select', options: LR2_BAR_STYLES,
    optionLabels: { gloss: 'Gloss (bevelled gold rim, glossy fills; default)', smooth: 'Smooth (flat rim, softer fills)' },
    hint: 'The Health bar set into the slice’s foot. Gloss: a bevelled gold rim, glossy red and steel-blue fills, a glow at the red’s leading edge. Smooth: the earlier, calmer bar.', min: 0, max: 0, step: 0,
  },
  {
    key: 'artLayout', label: 'Art layout', group: SA, kind: 'select', options: LR2_ART_LAYOUTS,
    optionLabels: { navy: 'Navy (numbers on a navy plate, art on the right; default)', left: 'Left fade (art left, fading right)', full: 'Full width (the art across the slice)', right: 'Right fade (art right, fading left)', center: 'Centered portrait (fading both sides)', fade75: '75% fade (full art over 75%, fading over the last quarter)' },
    hint: 'Docked: where the hero art sits in each slice and how it fades into the plate.', min: 0, max: 0, step: 0,
  },
  {
    key: 'nameSide', label: 'Name side', group: SA, kind: 'select', options: LR2_NAME_SIDES,
    optionLabels: { right: 'Right (over the faded side; default)', left: 'Left' }, hint: 'Docked: which side of the slice the player name sits on.', min: 0, max: 0, step: 0,
  },
  {
    key: 'nameShow', label: 'Show name', group: SA, kind: 'select', options: LR2_NAME_SHOW,
    optionLabels: { on: 'On', off: 'Off' }, hint: 'Docked: show the player name on each slice.', min: 0, max: 0, step: 0,
  },
  {
    key: 'nameText', label: 'Slice label', group: SA, kind: 'select', options: SLICE_LABELS,
    optionLabels: { player: 'Player name', hero: 'Hero name', none: 'None (default)' },
    hint: 'Docked, every mode: what each slice says. The fallen follow it; the hover card always shows both names.', min: 0, max: 0, step: 0,
  },
  ...(Object.keys(NUM) as NumKey[]).map((k) => {
    const d = NUM[k];
    return { key: k, label: d.label, group: d.group, unit: d.unit, hint: d.hint, min: d.min, max: d.max, step: d.step };
  }),
];
// Each group renders once, in the order its first control is declared (the panel only merges ADJACENT controls).
const GROUP_ORDER = [D, DP, SA, HN, HB, ...new Set(controls.map((c) => c.group))].filter((g, i, a) => a.indexOf(g) === i);
controls.sort((x, y) => GROUP_ORDER.indexOf(x.group) - GROUP_ORDER.indexOf(y.group));

export const LR2_SPEC: TunerSpec<LobbyRailTuner2Config> = {
  id: 'lobbyrailtuner2',            // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Lobby Rail Tuner 2',
  note: 'dev · Docked rail · live',
  read: getLobbyRailTuner2,
  write: (key, value) => setLobbyRailTuner2(key, value),
  writeColor: (key, value) => setLobbyRailTuner2(key, value),
  reset: resetLobbyRailTuner2,
  defaults: LR2_DEFAULTS,
  buttonsOnTop: true,
  copyLabel: 'Copy values (JSON)',
  // The owner's trial combos (2026-10-31: "I think I like the full hero art but can we add a 75% art into a fade option and
  // try hero names as the text with that"), one click each. They set only the art layout and the slice label.
  actions: [
    { label: 'Preset: Navy + numbers', hint: 'Art layout Navy, Health as numbers, Slice label Hero name.', run: () => { setLobbyRailTuner2('artLayout', 'navy'); setLobbyRailTuner2('hpShow', 'number'); setLobbyRailTuner2('nameText', 'hero'); } },
    { label: 'Preset: Full art', hint: 'Art layout Full width, Slice label None.', run: () => { setLobbyRailTuner2('artLayout', 'full'); setLobbyRailTuner2('nameText', 'none'); } },
    { label: 'Preset: 75% fade + hero name', hint: 'Art layout 75% fade, Slice label Hero name.', run: () => { setLobbyRailTuner2('artLayout', 'fade75'); setLobbyRailTuner2('nameText', 'hero'); } },
  ],
  controls,
};

applyLobbyRailTuner2();
