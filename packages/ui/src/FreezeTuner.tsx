import { FRZ_DEFAULTS, FRZ_NUM_KEYS, FRZ_RANGES, getFreezeConfig, resetFreezeConfig, setFreezeValue, type FreezeConfig } from './freezeConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the FREEZE button, plus the "Shop ice" ring laid over each frozen shop card (fit, offset,
 * opacity, glow, and the top-down grow-in).
 *
 * Values persist to localStorage and apply live through `applyFreezeVars()`. "Copy values" grabs the JSON to
 * bake into DEFAULTS *and* the styles.css fallbacks.
 */
const SPECS: Record<(typeof FRZ_NUM_KEYS)[number], [string, TunerUnit | undefined, string]> = {
  x:     ['Horizontal offset', 'px', 'Offset from the stage-pinned base point on the board’s right edge. Scales with the board.'],
  y:     ['Vertical offset', 'px', 'Offset from that base point. Positive moves the button down. Scales with the board.'],
  scale: ['Button size', '×', 'Overall size of the button.'],
  gemX:  ['Gem nudge X', 'px', 'Slide the gem overlay horizontally onto the baked gem.'],
  gemY:  ['Gem nudge Y', 'px', 'Slide the gem overlay vertically onto the baked gem.'],
  gemS:  ['Gem fit', '×', 'Size the gem overlay to sit exactly on the baked gem.'],
  pillX: ['Pill X', 'px', 'Move the "Freeze" label pill horizontally from the button centre.'],
  pillY: ['Pill Y', 'px', 'Move the "Freeze" label pill vertically from the button centre.'],
  pillS: ['Pill size', '×', 'Size the "Freeze" label pill.'],
  gemGlowSize: ['Glow size', 'px', 'Hover-glow halo blur around the gem.'],
  gemGlowStrength: ['Glow intensity', undefined, 'How strong the hover halo reads (stacked passes). 0 = off.'],
  gemHoverBright: ['Hover brightness', '×', 'How much the gem brightens while hovered.'],
  iceW: ['Ice width', '%', 'Width of the ice ring on a frozen shop minion, as % of its frame.'],
  iceH: ['Ice height', '%', 'Height of the ice ring on a frozen shop minion, as % of its frame.'],
  iceSpellW: ['Spell ice width', '%', 'Width of the spell ice on a frozen shop spell, as % of its frame.'],
  iceSpellH: ['Spell ice height', '%', 'Height of the spell ice on a frozen shop spell, as % of its frame.'],
  iceX: ['Ice X', '%', 'Shift the ice ring sideways, as % of the card frame.'],
  iceY: ['Ice Y', '%', 'Shift the ice ring up/down, as % of the card frame. Positive moves it down.'],
  iceOpacity: ['Ice opacity', 'opacity', 'How solid the ice reads once it has formed.'],
  iceGlowSize: ['Resting glow size', 'px', 'A cold glow that stays around the ice after it forms. 0 = off.'],
  iceGlowAlpha: ['Resting glow strength', 'opacity', 'How strong that resting glow is.'],
  iceFlash: ['Grow-in flash', '×', 'Brightness flash while the ice grows in. 1 = no flash.'],
  iceDur: ['Grow-in time', 's', 'How long the top-to-bottom grow takes. Toggle Freeze to replay it.'],
  iceFeather: ['Edge softness', '%', 'How soft the growing edge is. 0 = a hard line.'],
  iceSpellX: ['Spell ice X', '%', 'Shift the spell ice sideways, as % of the spell frame.'],
  iceSpellY: ['Spell ice Y', '%', 'Shift the spell ice up/down. Positive moves it down.'],
  iceSpellOpacity: ['Spell ice opacity', 'opacity', 'How solid the spell ice reads once formed.'],
  iceSpellGlowSize: ['Resting glow size', 'px', 'A cold glow that stays around the spell ice. 0 = off.'],
  iceSpellGlowAlpha: ['Resting glow strength', 'opacity', 'How strong that resting glow is.'],
  iceSpellFlash: ['Grow-in flash', '×', 'Brightness flash while the spell ice grows in. 1 = no flash.'],
  iceSpellDur: ['Grow-in time', 's', 'How long the top-to-bottom grow takes. Toggle Freeze to replay it.'],
  iceSpellFeather: ['Edge softness', '%', 'How soft the growing edge is. 0 = a hard line.'],
};

const controls: TunerControl<Extract<keyof FreezeConfig, string>>[] = FRZ_NUM_KEYS.map((key) => {
  const [label, unit, hint] = SPECS[key];
  const [min, max, step] = FRZ_RANGES[key];
  const group = key.startsWith('iceSpell') ? (['iceSpellFlash', 'iceSpellDur', 'iceSpellFeather'].includes(key) ? 'Spell ice — grow-in' : 'Spell ice — look')
    : key.startsWith('ice') ? (['iceFlash', 'iceDur', 'iceFeather'].includes(key) ? 'Minion ice — grow-in' : 'Minion ice — look')
    : key.startsWith('gemGlow') || key === 'gemHoverBright' ? 'Gem glow'
    : key.startsWith('gem') ? 'Gem overlay'
    : key.startsWith('pill') ? 'Freeze label'
    : 'Placement';
  return { key, label, unit, hint, group, min, max, step };
});

export const SPEC: TunerSpec<FreezeConfig> = {
  id: 'freezebtn',                  // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Freeze Button',
  note: 'dev · live · drag',
  read: getFreezeConfig,
  write: setFreezeValue,
  reset: resetFreezeConfig,
  defaults: FRZ_DEFAULTS,
  controls,
};

export function FreezeTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
