/**
 * The blend modes an FX primitive exposes as a `blendMode` enum param — one shared list so every effect
 * offers the same set (and adding one here reaches them all). The side-effect import registers PixiJS's
 * advanced modes (overlay, hard-light, …); the plain modes (normal/add/screen/multiply) need no import but
 * are listed here too so the whole set lives in one place.
 *
 * `add` is the usual default for glowing energy FX (it was the old `additive: true`); `overlay`/`multiply`
 * are the "mask"-style composites the owner asked for.
 */
import 'pixi.js/advanced-blend-modes';
import type { BLEND_MODES } from 'pixi.js';

export const FX_BLEND_MODES = ['normal', 'add', 'screen', 'multiply', 'overlay'] as const;

/** A `blendMode` enum param value narrowed to what PixiJS's `blendMode` setter accepts. */
export type FxBlendMode = (typeof FX_BLEND_MODES)[number] & BLEND_MODES;
