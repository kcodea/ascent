/**
 * LOBBY RAIL TUNER 2 (owner 2026-10-30: "a lot of the tuner things dont seem to work, can you rebuild a new tuner called
 * lobby rail tuner 2 that actually gives me full control of the sizing/position/spacing etc of the rail"). DEV only.
 *
 * It drives the MEDALLIONS (C) rail, the owner's pick, and nothing else. WHY THE OLD DIALS FAILED there (audit):
 *  - most of the 🎨 Lobby Rail Look / 🪑 Lobby Rail dials feed Classic or Gem rules that the C rail overrides outright
 *    (seat fill, padding, portrait size, row gap, foe ring...), so moving them changed nothing on C;
 *  - on phones `phoneLayout.css` / `touchUi.css` re-declare several `--lby-*` vars ON `.lobbyrail`, which shadows the
 *    tuner's `:root` value for every rail descendant, so those dials were dead on a phone even in Gem;
 *  - the Guides tab places itself from a formula of Classic's row heights (`--ltab-rail-h`), so on a rail that sizes to
 *    its content it never followed;
 *  - the first C cut mixed tuner vars with fixed multipliers (the phone factor, the name-size dial / 1.5), so one slider
 *    was quietly fighting another.
 * Tuner 2 fixes that by construction: ONE uniquely named var per control (`--lr2-*`), nothing else in the codebase
 * declares any of them, and every one is read by exactly the rule that paints what the control names
 * (lobbyRailMedallions.css). The vars live on `:root` (not on the rail element) because the rail, its header, its
 * Guides tab and the hover card (portaled to <body>) all read them, and a rail-element var would not reach the card.
 * `lobbyRailTuner2.test.ts` holds that contract: every control's var is applied here and consumed in that sheet, and
 * no other stylesheet sets it.
 *
 * Persistence: localStorage (try/catch), DEV only. Production never imports this module (LobbyPanel loads it with the
 * C stylesheet under `import.meta.env.DEV`), and the sheet's fallbacks equal DEFAULTS.
 */
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

export const LR2_ANCHORS = ['right', 'left'] as const;
/** D's Health layout (owner 2026-10-30): the plaque beside the portrait, or over its lower rim like your hero's. */
export const LR2_DHP = ['beside', 'overlap'] as const;
export type Lr2DHp = (typeof LR2_DHP)[number];
export type Lr2Anchor = (typeof LR2_ANCHORS)[number];

export interface LobbyRailTuner2Config {
  anchor: Lr2Anchor;
  dHp: Lr2DHp;
  railX: number; railY: number; railScale: number;
  phoneY: number; phoneScale: number;
  headX: number; headY: number; headFont: number; headGap: number; headShadow: number;
  tabX: number; tabY: number; tabScale: number;
  medSize: number; ringSize: number; medGap: number; medCol: number; nameFont: number; nameX: number; nameY: number;
  ovScale: number; ovY: number; ovFace: number; ovNameGap: number;
  seatPad: number; seatGap: number; seatRadius: number; faceNameGap: number; nameLines: number;
  hpScale: number; hpX: number; hpY: number; hpFont: number;
  deadScale: number; deadOpacity: number; deadGap: number;
  bgOpacity: number; bgPad: number; bgRadius: number; bgW: number; bgH: number;
  pulseRing: number; pulseGlow: number; pulseMin: number; pulseMax: number; pulsePeriod: number;
  cardW: number; cardX: number; cardY: number; cardFont: number;
}
type NumKey = Exclude<keyof LobbyRailTuner2Config, 'anchor' | 'dHp'>;

/** The owner's tune of 2026-10-30 ("the below settings are the best for this rail"), plus D's card dials. */
export const LR2_DEFAULTS: LobbyRailTuner2Config = {
  anchor: 'right',
  dHp: 'beside',
  railX: -6, railY: 76, railScale: 1,
  phoneY: -76, phoneScale: 1.1,
  headX: 0, headY: 0, headFont: 1.29, headGap: 1.9, headShadow: 3,
  tabX: 0, tabY: 268, tabScale: 0.75,
  medSize: 36.5, ringSize: 1, medGap: 8.5, medCol: 0.98, nameFont: 17.5, nameX: 0, nameY: 0,
  ovScale: 1.1, ovY: 45, ovFace: 30, ovNameGap: 1.5,
  seatPad: 4, seatGap: 3, seatRadius: 8, faceNameGap: 2.5, nameLines: 2,
  hpScale: 1.19, hpX: 0, hpY: 0, hpFont: 18,
  deadScale: 0.5, deadOpacity: 0.85, deadGap: 6,
  bgOpacity: 1, bgPad: 1, bgRadius: 42, bgW: 0, bgH: 0,
  pulseRing: 1.4, pulseGlow: 1, pulseMin: 0.63, pulseMax: 1, pulsePeriod: 1.1,
  cardW: 1, cardX: 0, cardY: 0, cardFont: 1,
};

/** Each numeric control's var, its range and what it means. The var names are the contract with the stylesheet. */
const NUM: Record<NumKey, { v: string; group: string; label: string; unit?: TunerUnit; min: number; max: number; step: number; hint: string }> = {
  railX: { v: '--lr2-rail-x', group: 'Rail position', label: 'Move left / right', unit: 'px', min: -800, max: 800, step: 1, hint: 'Moves the whole rail (with its header and Guides tab). Positive = right.' },
  railY: { v: '--lr2-rail-y', group: 'Rail position', label: 'Move up / down', unit: 'px', min: -400, max: 600, step: 1, hint: 'Moves the whole rail (with its header and Guides tab). Positive = down.' },
  railScale: { v: '--lr2-scale', group: 'Rail position', label: 'Overall scale', unit: '×', min: 0.5, max: 2, step: 0.01, hint: 'Scales everything on the rail: medallions, text, pills, spacing and the backing.' },
  phoneY: { v: '--lr2-phone-y', group: 'Phones only', label: 'Extra up / down', unit: 'px', min: -400, max: 400, step: 1, hint: 'Added to the rail’s move on a phone only (a phone screen is far shorter). Negative = up.' },
  phoneScale: { v: '--lr2-phone-scale', group: 'Phones only', label: 'Size on phones', unit: '×', min: 0.6, max: 1.8, step: 0.01, hint: 'How much bigger the rail draws on a phone than on a desktop.' },
  headX: { v: '--lr2-head-x', group: 'Header (Round / left / max dmg)', label: 'Move left / right', unit: 'px', min: -300, max: 300, step: 1, hint: 'Moves the header text. Positive = right.' },
  headY: { v: '--lr2-head-y', group: 'Header (Round / left / max dmg)', label: 'Move up / down', unit: 'px', min: -200, max: 200, step: 1, hint: 'Moves the header text. Positive = down.' },
  headFont: { v: '--lr2-head-font', group: 'Header (Round / left / max dmg)', label: 'Text size', unit: '×', min: 0.5, max: 2.5, step: 0.01, hint: 'Size of ROUND and of the LEFT / MAX DMG line.' },
  headGap: { v: '--lr2-head-gap', group: 'Header (Round / left / max dmg)', label: 'Gap', min: 0, max: 3, step: 0.05, hint: 'Space between "N LEFT" and "MAX DMG", in letter widths.' },
  headShadow: { v: '--lr2-head-shadow', group: 'Header (Round / left / max dmg)', label: 'Shadow strength', unit: '×', min: 0, max: 5, step: 0.05, hint: 'How strong the shadow under the header text is. 0 = none; past 1 it spreads wider and darker.' },
  tabX: { v: '--lr2-tab-x', group: 'Guides button', label: 'Move left / right', unit: 'px', min: -400, max: 400, step: 1, hint: 'Moves the Guides / Opponents button from its spot on the left edge of the rail. Positive = right.' },
  tabY: { v: '--lr2-tab-y', group: 'Guides button', label: 'Move up / down', unit: 'px', min: -300, max: 800, step: 1, hint: 'Moves the Guides / Opponents button. Positive = down.' },
  tabScale: { v: '--lr2-tab-scale', group: 'Guides button', label: 'Size', unit: '×', min: 0.5, max: 2.5, step: 0.01, hint: 'Scales the button: its plate and both icons together.' },
  medSize: { v: '--lr2-med-size', group: 'Medallion', label: 'Size', min: 16, max: 80, step: 0.5, hint: 'Diameter of each living seat\'s portrait medallion.' },
  ringSize: { v: '--lr2-ring-size', group: 'Medallion', label: 'Ring size', unit: '×', min: 0.8, max: 1.4, step: 0.005, hint: 'Grows the painted ring round the portrait (a bigger ring reads as a thicker rim).' },
  medGap: { v: '--lr2-med-gap', group: 'Medallion', label: 'Gap between medallions', min: 0, max: 30, step: 0.5, hint: 'C: vertical space between one living seat and the next. D: the space from each medallion to its Health pill (D spaces its cards with Card gap).' },
  medCol: { v: '--lr2-med-col', group: 'Medallion', label: 'Column width', unit: '×', min: 0.8, max: 2, step: 0.01, hint: 'Width of the medallion column, so the names and pills sit further right.' },
  nameFont: { v: '--lr2-name-font', group: 'Medallion', label: 'Name size', min: 8, max: 32, step: 0.5, hint: 'Size of the player names.' },
  nameX: { v: '--lr2-name-x', group: 'Medallion', label: 'Name left / right', unit: 'px', min: -60, max: 60, step: 0.5, hint: 'Nudges every name sideways.' },
  nameY: { v: '--lr2-name-y', group: 'Medallion', label: 'Name up / down', unit: 'px', min: -40, max: 40, step: 0.5, hint: 'Nudges every name up or down.' },
  ovScale: { v: '--lr2-ov-scale', group: 'Cards (D): Health over the portrait', label: 'Plaque scale', unit: '×', min: 0.5, max: 2, step: 0.01, hint: 'Overlap layout: the size of the Health / Armor plaque on the portrait rim.' },
  ovY: { v: '--lr2-ov-y', group: 'Cards (D): Health over the portrait', label: 'Plaque overlap', unit: '%', min: -50, max: 150, step: 1, hint: 'Overlap layout: how much of the plaque hangs below the portrait rim, in % of its height. 0 = all over the portrait, 100 = all below it.' },
  ovFace: { v: '--lr2-ov-face', group: 'Cards (D): Health over the portrait', label: 'Portrait size', min: 16, max: 90, step: 0.5, hint: 'Overlap layout: the centred portrait size.' },
  ovNameGap: { v: '--lr2-ov-name-gap', group: 'Cards (D): Health over the portrait', label: 'Name gap', min: 0, max: 30, step: 0.25, hint: 'Overlap layout: the space between the portrait (and its plaque) and the name.' },
  seatPad: { v: '--lr2-seat-pad', group: 'Cards (D)', label: 'Card padding', min: 0, max: 16, step: 0.25, hint: 'Space inside each seat card, round the portrait, Health and name.' },
  seatGap: { v: '--lr2-seat-gap', group: 'Cards (D)', label: 'Card gap', min: 0, max: 20, step: 0.25, hint: 'Vertical space between one card and the next.' },
  seatRadius: { v: '--lr2-seat-radius', group: 'Cards (D)', label: 'Card corner radius', unit: 'px', min: 0, max: 40, step: 0.5, hint: 'Rounding of each seat card.' },
  faceNameGap: { v: '--lr2-face-name-gap', group: 'Cards (D)', label: 'Portrait to name gap', min: 0, max: 16, step: 0.25, hint: 'Space between the portrait line and the name line.' },
  nameLines: { v: '--lr2-name-lines', group: 'Cards (D)', label: 'Name max lines', min: 1, max: 3, step: 1, hint: 'How many lines a long name may wrap to before it is cut.' },
  hpScale: { v: '--lr2-hp-scale', group: 'Health / Armor plate', label: 'Plate scale', unit: '×', min: 0.5, max: 2.5, step: 0.01, hint: 'Scales the whole heart + Armor plate (box and text together).' },
  hpX: { v: '--lr2-hp-x', group: 'Health / Armor plate', label: 'Left / right', unit: 'px', min: -80, max: 80, step: 0.5, hint: 'Moves the plate relative to its medallion.' },
  hpY: { v: '--lr2-hp-y', group: 'Health / Armor plate', label: 'Up / down', unit: 'px', min: -60, max: 60, step: 0.5, hint: 'Moves the plate relative to its medallion.' },
  hpFont: { v: '--lr2-hp-font', group: 'Health / Armor plate', label: 'Number size', min: 8, max: 40, step: 0.5, hint: 'Size of the Health and Armor numbers (the plate grows to fit).' },
  deadScale: { v: '--lr2-dead-scale', group: 'Fallen seats', label: 'Size', unit: '×', min: 0.2, max: 1, step: 0.01, hint: 'A fallen medallion\'s size, as a share of a living one.' },
  deadOpacity: { v: '--lr2-dead-opacity', group: 'Fallen seats', label: 'Opacity', unit: 'opacity', min: 0.1, max: 1, step: 0.01, hint: 'How faded the fallen seats are.' },
  deadGap: { v: '--lr2-dead-gap', group: 'Fallen seats', label: 'Gap', min: 0, max: 30, step: 0.5, hint: 'Space above each fallen seat.' },
  bgOpacity: { v: '--lr2-bg-opacity', group: 'Backing', label: 'Opacity', unit: 'opacity', min: 0, max: 1, step: 0.01, hint: '1 = solid panel, 0 = no backing.' },
  bgPad: { v: '--lr2-bg-pad', group: 'Backing', label: 'Padding', unit: '×', min: 0, max: 4, step: 0.05, hint: 'Space between the backing\'s edge and the medallions.' },
  bgRadius: { v: '--lr2-bg-radius', group: 'Backing', label: 'Corner radius', unit: 'px', min: 0, max: 120, step: 1, hint: 'Rounding of the backing\'s corners.' },
  bgW: { v: '--lr2-bg-w', group: 'Backing', label: 'Width override', unit: 'px', min: 0, max: 600, step: 1, hint: '0 = the rail\'s own width (times the overall scale). Anything else = that exact width.' },
  bgH: { v: '--lr2-bg-h', group: 'Backing', label: 'Height override', unit: 'px', min: 0, max: 1000, step: 1, hint: '0 = fits the seats. Anything else = that exact height.' },
  pulseRing: { v: '--lr2-pulse-ring', group: 'Opponent pulse', label: 'Ring thickness', min: 0, max: 6, step: 0.05, hint: 'The red ring round the medallion of the player you fight next.' },
  pulseGlow: { v: '--lr2-pulse-glow', group: 'Opponent pulse', label: 'Glow strength', unit: '×', min: 0, max: 3, step: 0.05, hint: 'How far the red glow spreads.' },
  pulseMin: { v: '--lr2-pulse-min', group: 'Opponent pulse', label: 'Dimmest', unit: 'opacity', min: 0, max: 1, step: 0.01, hint: 'The pulse\'s low point. Set it equal to Brightest for a steady ring.' },
  pulseMax: { v: '--lr2-pulse-max', group: 'Opponent pulse', label: 'Brightest', unit: 'opacity', min: 0, max: 1, step: 0.01, hint: 'The pulse\'s high point.' },
  pulsePeriod: { v: '--lr2-pulse-period', group: 'Opponent pulse', label: 'Period', unit: 's', min: 0.4, max: 5, step: 0.05, hint: 'Seconds for one full breath.' },
  cardW: { v: '--lr2-card-w', group: 'Hover card', label: 'Width', unit: '×', min: 0.6, max: 1.8, step: 0.01, hint: 'Width of the scouting card, as a multiple of the original card.' },
  cardX: { v: '--lr2-card-x', group: 'Hover card', label: 'Left / right', unit: 'px', min: -300, max: 300, step: 1, hint: 'Moves the card from where it opens.' },
  cardY: { v: '--lr2-card-y', group: 'Hover card', label: 'Up / down', unit: 'px', min: -300, max: 300, step: 1, hint: 'Moves the card from where it opens.' },
  cardFont: { v: '--lr2-card-font', group: 'Hover card', label: 'Text + icon scale', unit: '×', min: 0.6, max: 2, step: 0.01, hint: 'Scales the card\'s text, portraits and runes.' },
};
/** For the contract test: every numeric control's var. */
export const LR2_VARS: Readonly<Record<NumKey, string>> = Object.fromEntries(Object.entries(NUM).map(([k, d]) => [k, d.v])) as Record<NumKey, string>;

const KEY = 'ascent.lobbyRailTuner2';
const isAnchor = (v: unknown): v is Lr2Anchor => v === 'right' || v === 'left';
const isDHp = (v: unknown): v is Lr2DHp => v === 'beside' || v === 'overlap';

function load(): LobbyRailTuner2Config {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const out: LobbyRailTuner2Config = { ...LR2_DEFAULTS };
    if (isAnchor(o.anchor)) out.anchor = o.anchor;
    if (isDHp(o.dHp)) out.dHp = o.dHp;
    // 1.7 was the lean card's width; the restored original card's width is a multiple of its own (1 = as shipped).
    if (o.cardW === 1.7) delete o.cardW;
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

/** Every value onto `:root`, one var per control. The two size overrides are REMOVED at 0 ("automatic"), so the sheet's
 *  fallback (the rail's own width x the scale / auto height) applies: a var holding `var(--lr-w)` would be resolved on
 *  :root, where `--lr-w` does not exist, and silently fall back unscaled. */
export function applyLobbyRailTuner2(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-lr2-anchor', cfg.anchor);
  root.setAttribute('data-lr2-dhp', cfg.dHp);
  for (const k of Object.keys(NUM) as NumKey[]) {
    const v = cfg[k];
    if ((k === 'bgW' || k === 'bgH') && v <= 0) { root.style.removeProperty(NUM[k].v); continue; }
    root.style.setProperty(NUM[k].v, k === 'bgW' || k === 'bgH' ? `${v}px` : String(v));
  }
}

function save(): void {
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* storage unavailable: this session only */ }
}
export function setLobbyRailTuner2(key: keyof LobbyRailTuner2Config, value: number | string): void {
  if (key === 'anchor') { if (!isAnchor(value)) return; cfg = { ...cfg, anchor: value }; }
  else if (key === 'dHp') { if (!isDHp(value)) return; cfg = { ...cfg, dHp: value }; }
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
    key: 'anchor', label: 'Anchor side', group: 'Rail position', kind: 'select', options: LR2_ANCHORS,
    optionLabels: { right: 'Right edge (shipped)', left: 'Left edge' },
    hint: 'Which screen edge the rail hangs from. The moves below are measured from it.', min: 0, max: 0, step: 0,
  },
  {
    key: 'dHp', label: 'D health layout', group: 'Rail position', kind: 'select', options: LR2_DHP,
    optionLabels: { beside: 'Beside the portrait', overlap: 'Overlap (centred portrait, plaque on its rim)' },
    hint: 'D only. Beside: portrait left, the Health plaque beside it. Overlap: portrait centred with the plaque over its lower rim, like your own hero portrait.', min: 0, max: 0, step: 0,
  },
  ...(Object.keys(NUM) as NumKey[]).map((k) => {
    const d = NUM[k];
    return { key: k, label: d.label, group: d.group, unit: d.unit, hint: d.hint, min: d.min, max: d.max, step: d.step };
  }),
];

export const LR2_SPEC: TunerSpec<LobbyRailTuner2Config> = {
  id: 'lobbyrailtuner2',            // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Lobby Rail Tuner 2',
  note: 'dev · Medallions rail · live',
  read: getLobbyRailTuner2,
  write: (key, value) => setLobbyRailTuner2(key, value),
  writeColor: (key, value) => setLobbyRailTuner2(key, value),
  reset: resetLobbyRailTuner2,
  defaults: LR2_DEFAULTS,
  buttonsOnTop: true,
  copyLabel: 'Copy values (JSON)',
  controls,
};

applyLobbyRailTuner2();
