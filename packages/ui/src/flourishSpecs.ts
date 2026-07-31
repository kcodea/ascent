import type { TunerUnit } from './tunerSchema';

/**
 * The shared control vocabulary for the ARROW-FAN FLOURISH family — three tuners drive the same primitive with
 * the same keys: Step Proc (a counter filling), Spell Power (a spell resolving) and Ruby Power (a Ruby's
 * strength). They are separate panels on purpose, so each can be sized independently, but their CONTROLS are
 * identical.
 *
 * Writing these ~30 labels and hints three times guaranteed they would drift apart, which is the exact failure
 * the audit found across the old panels: the same concept named three ways. One table, three consumers.
 *
 * Each panel picks the subset of keys it actually has — Step Proc has no floating number, by design, because a
 * step proc has no natural stat gain to print.
 */
export type FlourishSpec = [label: string, unit: TunerUnit | undefined, hint: string, group: string];

export const FLOURISH_SPECS = {
  arrowCount:   ['Count', undefined, 'How many arrows rise in the fan. 0 removes them.', 'Arrow fan'],
  arrowRise:    ['Rise distance', 'px', 'How far the arrows travel upward.', 'Arrow fan'],
  arrowSpread:  ['Fan width', 'px', 'How wide the fan spreads at its top.', 'Arrow fan'],
  arrowLen:     ['Shaft length', 'px', 'Length of each arrow shaft.', 'Arrow fan'],
  arrowWidth:   ['Shaft thickness', 'px', 'Thickness of each shaft.', 'Arrow fan'],
  arrowHead:    ['Head size', 'px', 'Size of each arrowhead. 0 leaves bare shafts.', 'Arrow fan'],
  arrowMs:      ['Rise time', 'ms', 'How long one arrow takes to rise and fade.', 'Arrow fan'],
  arrowStagger: ['Stagger', 'ms', 'Delay between one arrow launching and the next.', 'Arrow fan'],
  arrowDrift:   ['Side drift', 'px', 'How far arrows wander sideways as they rise.', 'Arrow fan'],
  arrowFadeAt:  ['Fade starts at', 'opacity', 'How far through its rise an arrow begins to fade. 0 fades from the start.', 'Arrow fan'],

  blastCount:   ['Count', undefined, 'How many motes burst from the origin. 0 removes them.', 'Mote blast'],
  blastSpeed:   ['Speed', 'px/s', 'Initial mote speed.', 'Mote blast'],
  blastSize:    ['Size', 'px', 'Size of each mote.', 'Mote blast'],
  blastLife:    ['Lifetime', 'ms', 'How long one mote lasts.', 'Mote blast'],
  blastSpread:  ['Cone width', '°', 'Width of the cone the motes fire into. 360 is all directions.', 'Mote blast'],
  blastAngle:   ['Cone aim', '°', 'Which way that cone points.', 'Mote blast'],
  blastRise:    ['Upward kick', 'px', 'Extra upward push on every mote, on top of the cone.', 'Mote blast'],
  blastGravity: ['Gravity', 'px', 'How far motes are dragged back down over their flight.', 'Mote blast'],
  blastDrag:    ['Drag', 'opacity', 'How quickly motes lose speed. 0 coasts forever.', 'Mote blast'],
  blastJitter:  ['Speed variance', 'opacity', 'Randomness in mote speed, so they do not move as one.', 'Mote blast'],
  blastSpin:    ['Spin', '°', 'Mote rotation speed, in degrees per second.', 'Mote blast'],
  blastStagger: ['Stagger', 'ms', 'Largest random launch delay across the motes.', 'Mote blast'],
  blastShrink:  ['End size', 'opacity', 'Mote size at the end of its life, as a fraction of its start. 0 shrinks to nothing.', 'Mote blast'],

  numShow:      ['Show the number', undefined, 'Whether the flourish prints its value. Stored as 0 or 1.', 'Floating number'],
  numSize:      ['Size', 'px', 'Size of the printed number.', 'Floating number'],
  numRise:      ['Rise', 'px', 'How far the number drifts up.', 'Floating number'],
  numDelay:     ['Delay', 'ms', 'How long after the flourish starts the number appears.', 'Floating number'],
  numHoldMs:    ['Hold', 'ms', 'How long it holds at full opacity.', 'Floating number'],
  numFadeMs:    ['Fade', 'ms', 'How long it takes to fade out.', 'Floating number'],
  colorText:    ['Fill colour', undefined, 'Fill colour of the number.', 'Floating number'],
  colorOutline: ['Outline colour', undefined, 'Outline colour of the number.', 'Floating number'],

  glowAlpha:    ['Opacity', 'opacity', 'Opacity of the glow around arrows and motes.', 'Glow'],
  glowWidth:    ['Width', 'px', 'Thickness of that glow. 0 removes it.', 'Glow'],

  // Hue SLOTS, not fixed colours. Their variable names (colorA/B/C) and the old labels ("pink", "purple",
  // "gold") both stop being true the moment one is changed.
  colorA:       ['Hue slot 1', undefined, 'First of three hues cycled across the arrows and motes.', 'Colours'],
  colorB:       ['Hue slot 2', undefined, 'Second of three hues cycled across them.', 'Colours'],
  colorC:       ['Hue slot 3', undefined, 'Third of three hues cycled across them.', 'Colours'],
} as const satisfies Record<string, FlourishSpec>;

/** Render order for the two panels that print a number (Spell Power, Ruby Power). */
export const FLOURISH_ORDER_WITH_NUMBER = [
  'arrowCount', 'arrowRise', 'arrowSpread', 'arrowLen', 'arrowWidth', 'arrowHead', 'arrowMs', 'arrowStagger', 'arrowDrift', 'arrowFadeAt',
  'blastCount', 'blastSpeed', 'blastSize', 'blastLife', 'blastSpread', 'blastAngle', 'blastRise', 'blastGravity',
  'blastDrag', 'blastJitter', 'blastSpin', 'blastStagger', 'blastShrink',
  'numShow', 'numSize', 'numRise', 'numDelay', 'numHoldMs', 'numFadeMs', 'colorText', 'colorOutline',
  'glowAlpha', 'glowWidth',
  'colorA', 'colorB', 'colorC',
] as const;
