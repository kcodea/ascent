import {
  DRAG_DEFAULTS_VERSION, DRAG_RANGES,
  getDragFeel, hasLocalDragOverride, resetDragFeel, setDragValue, type DragFeel,
} from './dragFeel';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the weighted card-drag feel. The drag's rAF loop reads these every frame, so they apply
 * live while you are holding a card.
 *
 * THE HEADER TELLS YOU WHOSE VALUES YOU ARE FEELING. A saved local override beats what `main` ships until you
 * Reset, and it is otherwise invisible — you can spend an afternoon judging feel against your own stale numbers
 * and conclude main is wrong. The note is a function so it re-reads on every render: it shows either "LOCAL
 * override" or the version of the defaults on main. Reset means "run exactly what main ships".
 *
 * LANGUAGE. `follow` read "lag (lower=heavier)" — the name, the direction and the consequence crammed into one
 * label. It is "Catch-up speed" with the direction in its hint, where there is room to say that lower is heavier
 * and 1 is instant.
 */
const SPECS: Record<keyof DragFeel, [string, TunerUnit | undefined, string, string]> = {
  follow:        ['Catch-up speed', '×', 'How fast the card catches up to the cursor. LOWER is heavier and laggier; 1 is instant, with no lag at all.', 'Weight'],
  scale:         ['Hold size', '×', 'How much the card grows while held.', 'Weight'],
  threshold:     ['Drag threshold', 'px', 'How far the pointer must move before a press becomes a drag rather than a click.', 'Weight'],

  tiltGain:      ['Dive gain', '×', 'Degrees of dive per px/frame of travel — one gain for both axes; the leading edge dips toward the board.', 'Tilt'],
  tiltEase:      ['Dive smoothing', '×', 'How the dive builds and settles. 1 tracks raw travel and snaps flat on stop; lower is softer.', 'Tilt'],
  tiltMax:       ['Tilt cap', '°', 'Ceiling on the dive, so a fast flick cannot over-rotate the card.', 'Tilt'],
  perspective:   ['Perspective', 'px', 'CSS perspective depth. Lower is a deeper corner pinch / more extreme dive.', 'Tilt'],
  staticRotate:  ['Resting angle', '°', 'A fixed 2D tilt held while dragging, on top of the dive.', 'Tilt'],

  recenter:      ['Recentre speed', '×', 'How quickly the card levels out when the cursor stops moving.', 'Settle'],
  recenterAfter: ['Recentre after', 'px', 'How far the cursor must travel before recentring kicks in.', 'Settle'],
  handGrabY:     ['Hand grab point', '×', 'Where a HAND card hangs from the cursor, as a fraction of card height. 0.5 is centre; higher hangs it lower, nearer the stat badges. Hand only — shop and board ride centred.', 'Settle'],
  snapMs:        ['Snap-back time', 'ms', 'How long the card takes to snap home on an invalid drop.', 'Settle'],

  collapseY:     ['Row collapse lift', 'px', 'How far you must lift a card out of its row before the others slide in to fill the gap.', 'Row behaviour'],
  handFloor:     ['Hand card floor', '×', 'Where a hovered hand card’s BOTTOM lands, as a multiple of card height. Works against the pop lift — higher sits lower.', 'Row behaviour'],
  handPop:       ['Hand card pop', '×', 'How far a hovered hand card pops up, as a multiple of card height.', 'Row behaviour'],

  spellLine:     ['Spell cast line', '×', 'How far a SPELL must be lifted from the hand before it arms. 0 = up at the warband (a long drag); 1 = right at the hand’s top edge. Higher = less drag to cast. Spells only — minions unchanged.', 'Spell cast'],

  magSlideMs:    ['Magnet slide', 'ms', 'How long an Attachment takes to slide onto its host.', 'Attachment'],
  magWeldLeadMs: ['Weld lead', 'ms', 'How early before the slide ends the weld commits, so its ring OVERLAPS the tail of the slide instead of starting after it. 0 is back-to-back.', 'Attachment'],

  shGrow:        ['Grow', '×', 'How much the drag shadow spreads while a card is held.', 'Drag shadow'],
  shLift:        ['Lift', 'px', 'How far the shadow drops below the card, which reads as height.', 'Drag shadow'],
  shBlur:        ['Blur', 'px', 'Softness of the shadow.', 'Drag shadow'],
  shFade:        ['Opacity', 'opacity', 'Shadow opacity.', 'Drag shadow'],
};

/** Declaration order IS render order, and controls sharing a group render together under its heading. */
const ORDER: (keyof DragFeel)[] = [
  'follow', 'scale', 'threshold',
  'tiltGain', 'tiltEase', 'tiltMax', 'perspective', 'staticRotate',
  'recenter', 'recenterAfter', 'handGrabY', 'snapMs',
  'collapseY', 'handFloor', 'handPop',
  'spellLine',
  'magSlideMs', 'magWeldLeadMs',
  'shGrow', 'shLift', 'shBlur', 'shFade',
];

const controls: TunerControl<Extract<keyof DragFeel, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  const [min, max, step] = DRAG_RANGES[key]!;
  return { key, label, unit, hint, group, min, max, step };
});

export const SPEC: TunerSpec<DragFeel> = {
  id: 'drag',                       // matches DevMenu's key — the two must agree or the ✕ does nothing
  title: 'Drag Feel',
  // Derived, so it re-reads every render: which values you are actually feeling is otherwise invisible.
  note: () => (hasLocalDragOverride() ? 'dev · LOCAL override' : `dev · main · v${DRAG_DEFAULTS_VERSION}`),
  read: getDragFeel,
  write: setDragValue,
  // Drops this machine's saved override so the panel runs exactly what main ships.
  reset: resetDragFeel,
  controls,
  toggles: [{
    id: 'dsh',
    label: 'Preview drag shadow',
    hint: 'Pins the drag shadow onto every resting card so the four shadow sliders can be tuned — you cannot hold a card and a slider at once. Preview only; nothing is saved.',
    bodyClass: 'dsh-preview',
    defaultOn: false,
  }],
};

export function DragTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
