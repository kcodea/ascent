import type { FxAnchors, FxPoint } from './anchors';
import { pointOnTravel } from './anchors';

export interface FxScenario {
  id: string;
  label: string;
  hint: string;
  /** Stage the anchors for this frame. `cursor` is the live pointer position in page coordinates. */
  anchorsAt(viewport: { w: number; h: number }, cursor: { x: number; y: number }): FxAnchors;
  /** Optional: scenarios that move the effect head along a custom path (e.g. chaining between several
   *  units) implement this. `progress` is 0..1 through the effect's loop. When present, the workbench
   *  drives the effect head from this instead of the default source→target travel arc. */
  headAt?(viewport: { w: number; h: number }, cursor: { x: number; y: number }, progress: number): FxPoint;
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

/** The four unit centres a bounce/chain effect ricochets between, staged in a diamond around the viewport
 *  centre. Exported so tests can assert `headAt` lands on these without re-deriving the layout. */
export function bounceUnits(v: { w: number; h: number }): FxPoint[] {
  const units: FxPoint[] = [];
  for (let i = 0; i < 4; i++) {
    const angle = -Math.PI / 2 + i * (Math.PI / 2);
    units.push({
      x: v.w * 0.5 + Math.cos(angle) * v.w * 0.28,
      y: v.h * 0.5 + Math.sin(angle) * v.h * 0.3,
    });
  }
  return units;
}

/** Chains the effect head between four units in a loop — the shape a bounce/ricochet/chain-lightning
 *  spell takes, as opposed to a single source→target hop. */
export const bounceScenario: FxScenario = {
  id: 'bounce',
  label: 'Bounce between units',
  hint: 'The effect head chains around four units on arcs — the shape a ricochet / chain-lightning spell takes.',
  anchorsAt: (v) => {
    const units = bounceUnits(v);
    return {
      source: units[0],
      target: units[1],
      camera: { x: v.w * 0.5, y: v.h * 0.5 },
    };
  },
  headAt: (v, _cursor, progress) => {
    const units = bounceUnits(v);
    const legs = units.length;
    const scaled = progress * legs;
    const leg = Math.min(Math.floor(scaled), legs - 1);
    const t = scaled - leg;
    return pointOnTravel(units[leg], units[(leg + 1) % legs], t, 0.28);
  },
};

export const SCENARIOS: FxScenario[] = [twoUnits, cursorScenario, bounceScenario];
