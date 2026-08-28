import {
  SHOP_DEATH_FX_DEFAULTS, SHOP_DEATH_FX_RANGES, getShopDeathFxConfig, resetShopDeathFxConfig,
  setShopDeathFxValue, type ShopDeathFxConfig,
} from './shopDeathFxConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for SHOP DEATHS AND ECHOES (owner ask 2026-08-28: "add a tuner to the dev panel for this so
 * i can control timings and even position if need be for animations and time before destruction").
 *
 * There is no Test button, deliberately: these cues need a REAL death to judge, and the two that produce one
 * are a click away in the Scene Builder — give yourself a Graverobber and any Echo minion, or a Funeral on
 * Loan. A synthetic fire would let you tune the flourish while telling you nothing about the timing against
 * the body actually leaving, which is the whole thing being judged.
 *
 * Values are read at FIRE TIME, so an edit applies to the next death with no reload.
 */
const SPECS: Record<keyof ShopDeathFxConfig, [string, TunerUnit | undefined, string, string]> = {
  landingMs:    ['Time before destruction', 'ms', 'How long a borrowed minion (Funeral on Loan) stays on the board before it dies. 0 destroys it immediately.', 'Timing'],
  echoDelayMs:  ['Echo timing', 'ms', 'When the Echo skull fires, relative to the body being destroyed. NEGATIVE fires it EARLIER, while the minion is still on the board — only Funeral on Loan has a window for that; a single-action destroy clamps to 0.', 'Timing'],
  deathDelayMs: ['Death delay', 'ms', 'Pause between the body leaving and the death dissolve firing.', 'Timing'],

  offsetX:      ['Horizontal offset', 'px', 'Nudges both animations sideways from where the card was.', 'Position'],
  offsetY:      ['Vertical offset', 'px', 'Nudges both animations vertically. Positive is down.', 'Position'],
  sizeScale:    ['Size', '×', 'Scales the Echo burst relative to the card it played on.', 'Position'],

  echoEnabled:  ['Echo burst', undefined, '1 plays the Echo burst when an Echo triggers, 0 silences it.', 'On / off'],
  deathEnabled: ['Death dissolve', undefined, '1 plays the dissolve when a minion dies, 0 silences it.', 'On / off'],
};

/** Declaration order IS render order; controls sharing a group render under its heading. */
const ORDER: (keyof ShopDeathFxConfig)[] = [
  'landingMs', 'echoDelayMs', 'deathDelayMs',
  'offsetX', 'offsetY', 'sizeScale',
  'echoEnabled', 'deathEnabled',
];

const controls: TunerControl<Extract<keyof ShopDeathFxConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  const [min, max, step] = SHOP_DEATH_FX_RANGES[key]!;
  return { key, label, unit, hint, group, min, max, step };
});

export const SPEC: TunerSpec<ShopDeathFxConfig> = {
  id: 'shopdeathfx',                // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Shop Death & Echo',
  note: 'dev · next death · drag',
  read: getShopDeathFxConfig,
  write: setShopDeathFxValue,
  reset: resetShopDeathFxConfig,
  defaults: SHOP_DEATH_FX_DEFAULTS,
  controls,
};

export function ShopDeathFxTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
