import type { FxAnchors } from './anchors';

export interface FxScenario {
  id: string;
  label: string;
  hint: string;
  /** Stage the anchors for this frame. `cursor` is the live pointer position in page coordinates. */
  anchorsAt(viewport: { w: number; h: number }, cursor: { x: number; y: number }): FxAnchors;
}

/** Two units facing off — the shape of an attack. */
export const twoUnits: FxScenario = {
  id: 'twoUnits',
  label: 'Two units',
  hint: 'Source on the left, target on the right — the shape an attack takes.',
  anchorsAt: (v) => ({
    source: { x: v.w * 0.3, y: v.h * 0.5 },
    target: { x: v.w * 0.7, y: v.h * 0.5 },
    camera: { x: v.w * 0.5, y: v.h * 0.5 },
  }),
};

/** Follows the pointer — the fastest way to judge noise shear and scroll speed. */
export const cursorScenario: FxScenario = {
  id: 'cursor',
  label: 'Follow cursor',
  hint: 'Move the pointer over the stage. Best for judging noise shear and scroll speed.',
  anchorsAt: (v, c) => ({
    source: { x: v.w * 0.5, y: v.h * 0.5 },
    target: c,
    cursor: c,
    camera: { x: v.w * 0.5, y: v.h * 0.5 },
  }),
};

export const SCENARIOS: FxScenario[] = [twoUnits, cursorScenario];
