import { LAYOUT_VARS, defaultLayout, getLayout, resetLayout, setLayoutValue, type LayoutConfig } from './layoutConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec } from './tunerSchema';

/**
 * DEV-only Layout Lab — live scale + position for the whole board. Two global multipliers ride the master sizing
 * vars (every card, all chrome); the rest are per-region scale + offsets for the shop, warband, hand, HUD bar,
 * quest nodes, charge glyph, and the buy/sell drop lines. Values drive CSS custom properties on `:root`, persist
 * to localStorage, and apply at boot — all dev-gated, so production always runs the shipped layout.
 *
 * THE CONTROL METADATA ALREADY LIVED IN THE CONFIG. `LAYOUT_VARS` carries the label, group, range and format for
 * every knob, which is exactly the schema's shape, so this panel is a mapping rather than a rewrite — and the
 * per-knob comments in `layoutConfig.ts` that explained the non-obvious ones (why the hand overlap is a
 * multiplier, that the buy/sell edges also move the drop hit-test) become hints you can read in the panel
 * instead of by opening the source.
 *
 * `def` values here are the SHIPPED layout, not no-ops, so the revert dots are load-bearing: it is otherwise
 * impossible to tell a nudged board from the real one by eye.
 */
const HINTS: Record<string, string> = {
  cardScale: 'Scales every card everywhere, by overriding the master card-height var rather than transforming — a parent transform would fight the per-swing combat lunges.',
  uiScale:   'Scales all HUD and chrome, leaving cards alone.',
  boardZoom: 'Fine-scales the painted board backdrop so its frame lines up with the fixed 16:9 UI. Use when swapping in new board art.',

  shopS:   'Size of the shop cards only.',
  shopGap: 'Space between shop cards.',
  shopX:   'Moves the shop CARDS sideways — not the shop buttons, which are their own group. The enemy warband renders in this same zone during combat, so this also places the opponent’s board.',
  shopY:   'Moves the shop cards vertically. Also moves the opponent’s combat board.',

  shopUiS: 'Size of the shop controls tray — the round plaque, Upgrade / Reroll / Freeze / End Turn, and the info strip.',
  shopUiX: 'Moves that tray sideways.',
  shopUiY: 'Moves that tray vertically.',

  wbS:   'Size of your warband cards.',
  wbGap: 'Space between warband cards.',
  wbX:   'Moves your warband sideways.',
  wbY:   'Moves your warband vertically.',

  handS:   'Size of your hand cards.',
  handGap: 'How much fanned hand cards overlap, as a fraction of card width — so it stays proportional when card size changes. Negative overlaps; 0 makes edges touch; positive opens a real gap.',
  handX:   'Moves the hand sideways.',
  handY:   'Moves the hand vertically.',

  hudS: 'Size of the top HUD bar.',
  hudX: 'Moves the HUD bar sideways.',
  hudY: 'Moves the HUD bar vertically.',

  qbS:   'Size of the active quest and rune badges above the hero panel.',
  qbX:   'Moves that badge row sideways.',
  qbY:   'Moves that badge row vertically.',
  qbGap: 'Space between the badges.',

  glyphW: 'Width of the end-of-turn charge glyph. The whole glyph scales with it, aspect locked.',
  glyphX: 'Nudges the glyph sideways off the board midline it anchors to.',
  glyphY: 'Nudges the glyph up or down off that midline. The midline itself auto-aligns to the art divider at any aspect ratio.',

  sellZoneY: 'Moves the drag-to-SELL boundary. This is not only cosmetic — it moves the actual drop hit-test as well as the gradient. Higher values lower the line, making the sell region bigger.',
  buyZoneY:  'Moves the drag-to-BUY boundary, hit-test included. Lower values raise the line, making the buy region bigger.',
};

const controls: TunerControl<string>[] = LAYOUT_VARS.map((v) => ({
  key: v.key,
  label: v.label,
  hint: HINTS[v.key],
  // A `mul` knob is a multiplier of some base; a `px` knob is an absolute offset. Only the hand overlap is a
  // multiplier of something other than "the shipped size", and its hint says so.
  unit: v.fmt === 'px' ? ('px' as const) : ('×' as const),
  group: v.group,
  min: v.min,
  max: v.max,
  step: v.step,
}));

const SPEC: TunerSpec<LayoutConfig> = {
  id: 'layout',                     // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Layout Lab',
  note: 'dev · scale + position',
  read: getLayout,
  write: setLayoutValue,
  reset: resetLayout,
  defaults: defaultLayout(),
  controls,
};

export function LayoutTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
