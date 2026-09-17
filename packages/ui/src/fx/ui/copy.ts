import { FX_ANCHOR_IDS } from '../anchors';
import { FX_ANCHOR_PARTS } from '../anchorParts';
import type { FxAnchorId, FxAnchorPart } from '../def';

/**
 * Human-readable names for the things the workbench makes you pick between.
 *
 * The editor used to render raw ids — a row of buttons reading `burst` / `emitter` / `ribbon` / `shockwave`
 * / `smoke`, and an anchor dropdown reading `travel` / `source` / `target` / `slot` / `cursor` / `camera`.
 * Those are fine names for a registry key and useless as an interface: nothing on screen said that `emitter`
 * streams continuously while `burst` fires once, or what `travel` is travelling between. The one-line
 * `blurb` is the part that actually does the teaching; the `label` just stops the id being the headline.
 *
 * This lives in the UI layer, NOT on `FxPrimitive`, because it is presentation copy — a primitive's contract
 * is its params and its `spawn`, and the engine has no business carrying marketing text. The trade is that
 * copy can drift from the registry, so `copy.test.ts` asserts both maps cover exactly what exists.
 */
export interface FxCopy {
  label: string;
  blurb: string;
}

/** Keyed by `FxPrimitive.id`. `copy.test.ts` fails if a registered primitive is missing here. */
export const PRIMITIVE_COPY: Record<string, FxCopy> = {
  beam: {
    label: 'Beam',
    blurb: 'A clean sustained beam from source to target — grows in, holds, fades. Rays, heals, drains, links, channels.',
  },
  burst: {
    label: 'Burst',
    blurb: 'A one-off spray of particles thrown outward, then gone. Impacts, hits, pops.',
  },
  custom: {
    label: 'Custom',
    blurb: 'Your own PNG or SVG, drawn as-is — or as a sprite sheet, scattered N times, rippled, bent or tilted as a mesh, or used to distort / mask the other layers. Emblems, sigils, banners, slashes, haze.',
  },
  emitter: {
    label: 'Stream',
    blurb: 'Keeps emitting particles for as long as the layer runs. Fire, smoke trails, channelled effects.',
  },
  react: {
    label: 'React',
    blurb: 'The card itself moves — a swell, a flinch, a nudge. Target the whole card or one stat badge.',
  },
  screen: {
    label: 'Screen',
    blurb: 'Draws nothing — fires SCREEN juice: a camera shake, a full-screen flash, and/or a sound. Impacts, gilds, big moments.',
  },
  ribbon: {
    label: 'Trail',
    blurb: 'A tapering band that follows the moving head — a motion trail. Needs a scenario that MOVES.',
  },
  lightning: {
    label: 'Bolt',
    blurb: 'A branching electric bolt that reaches to its target, dwells, then releases. Zaps, arcs, arcane strikes.',
  },
  shockwave: {
    label: 'Ring',
    blurb: 'An expanding ring pushing outward from a point. Blasts, slams, pulses.',
  },
  smoke: {
    label: 'Smoke',
    blurb: 'Slow, swelling, drifting puffs that rise and fade. Plumes, dust, lingering aftermath.',
  },
  targeting: {
    label: 'Targeting',
    blurb: 'A glowing magic lasso from the source to the cursor that bobs and sways as you move — the aim line for a targeted power. Anchor it to the cursor.',
  },
  sound: {
    label: 'Sound',
    blurb: 'Plays a sound clip when the layer fires — pick or import a clip, set its level, pitch, fades and bus. The audio layer of a composition; draws nothing.',
  },
};

/** Keyed by `FxAnchorId`. `copy.test.ts` fails if this and `FX_ANCHOR_IDS` disagree in either direction. */
export const ANCHOR_COPY: Record<FxAnchorId, FxCopy> = {
  travel: {
    label: 'Travelling',
    blurb: 'Rides the moving path — the arc from source to target, or whatever path the scenario drives.',
  },
  source: { label: 'Source', blurb: 'Pinned to the acting unit (where the effect comes FROM).' },
  target: { label: 'Target', blurb: 'Pinned to the unit being acted on (where the effect lands).' },
  slot: { label: 'Board slot', blurb: 'Pinned to a fixed board position rather than to a unit.' },
  cursor: { label: 'Cursor', blurb: 'Pinned to the live mouse pointer.' },
  camera: { label: 'Screen centre', blurb: 'Pinned to the middle of the screen — for full-screen effects.' },
};

/** Keyed by `FxAnchorPart` — the "target within a source" picker. `copy.test.ts` fails if this and
 *  `FX_ANCHOR_PARTS` disagree in either direction. */
export const ANCHOR_PART_COPY: Record<FxAnchorPart, FxCopy> = {
  card: { label: 'Card centre', blurb: 'The middle of the card — the default, and what every anchor meant before parts existed.' },
  'badge.attack': { label: 'Attack badge', blurb: 'The attack stat badge in the card\'s corner.' },
  'badge.health': { label: 'Health badge', blurb: 'The health stat badge in the card\'s corner.' },
  medallion: { label: 'Medallion', blurb: 'The round tribe plate (falls back to the card centre on cards without one).' },
  tier: { label: 'Tier badge', blurb: 'The tier stars plaque at the top of the card.' },
  top: { label: 'Top edge', blurb: 'The middle of the card\'s top edge — for things that rise out of it.' },
  bottom: { label: 'Bottom edge', blurb: 'The middle of the card\'s bottom edge — for things that pool beneath it.' },
  left: { label: 'Left edge', blurb: 'The middle of the card\'s left edge.' },
  right: { label: 'Right edge', blurb: 'The middle of the card\'s right edge.' },
};

export function anchorPartLabel(id: FxAnchorPart): string {
  return ANCHOR_PART_COPY[id]?.label ?? id;
}

export function anchorPartBlurb(id: FxAnchorPart): string {
  return ANCHOR_PART_COPY[id]?.blurb ?? '';
}

/** Picker rows for the anchor part, in `FX_ANCHOR_PARTS` order. */
export const ANCHOR_PART_OPTIONS: readonly { id: FxAnchorPart; label: string; blurb: string }[] =
  FX_ANCHOR_PARTS.map((id) => ({ id, label: anchorPartLabel(id), blurb: anchorPartBlurb(id) }));

/** The primitive's display name, falling back to the raw id so an unregistered/new primitive still shows
 *  SOMETHING rather than a blank button. */
export function primitiveLabel(id: string): string {
  return PRIMITIVE_COPY[id]?.label ?? id;
}

/** The primitive's one-liner. Falls back to empty, which callers use as "no tooltip". */
export function primitiveBlurb(id: string): string {
  return PRIMITIVE_COPY[id]?.blurb ?? '';
}

export function anchorLabel(id: FxAnchorId): string {
  return ANCHOR_COPY[id]?.label ?? id;
}

export function anchorBlurb(id: FxAnchorId): string {
  return ANCHOR_COPY[id]?.blurb ?? '';
}

/** Every anchor with its copy, in picker order — so the `<select>` doesn't have to zip two lists together. */
export const ANCHOR_OPTIONS: { id: FxAnchorId; label: string; blurb: string }[] = FX_ANCHOR_IDS.map((id) => ({
  id,
  label: anchorLabel(id),
  blurb: anchorBlurb(id),
}));
