import {
  PG_COLOR_KEYS, PG_DEFAULTS, PG_FLOURISHES, PG_RANGES,
  getPlateGildConfig, plateGildDuration, playPlateGild, resetPlateGildConfig, setPlateGildValue,
  type PlateGildConfig,
} from './plateGild';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the PLATE GILD — three copies combining into a gilded card.
 *
 * The effect is FOUR BEATS, and that structure is what makes it tunable: each beat has ONE duration and its
 * internals are expressed as SHARES of that duration, so tightening a beat cannot silently lengthen the effect
 * or desynchronise its parts. A control called "share" is therefore a fraction of its OWN beat, not of the
 * whole run. The sections below are numbered to match the beats.
 *
 * The header shows the derived TOTAL, which two controls bend in opposite directions: `crownLead` overlaps the
 * crown into the fuse and SHORTENS it, while a flourish longer than its beat EXTENDS it. That is why the note is
 * a function — a fixed string would be wrong the moment you moved either slider.
 *
 * "Play on a card" fires a mock gild over a real card on screen so it can be dialled without assembling a real
 * triple. The effect opens with the copies already gathered at centre, so it only needs that card's rect and how
 * many copies were consumed.
 *
 * Unlike the CSS-var tuners there is no `var(--x, fallback)` half to keep in sync: this module renders the effect
 * itself, so its DEFAULTS are what ships.
 */
type ColorKey = (typeof PG_COLOR_KEYS)[number];
const COLOR_SET = new Set<string>(PG_COLOR_KEYS);

const SPECS: Record<keyof PlateGildConfig, [string, TunerUnit | undefined, string, string]> = {
  inMs:         ['Beat length', 'ms', 'Beat 1 total — the three copies fade in at centre, already gathered.', '1 · Appear'],
  flyInEase:    ['Easing', '×', 'Arrival easing. 1 is linear; higher rushes then settles.', '1 · Appear'],
  flyStag:      ['Stagger share', 'opacity', 'Share of beat 1 spent staggering the three appearances.', '1 · Appear'],
  centreScale:  ['Centre zoom', '×', 'How big the cards get at centre — the hero zoom.', '1 · Appear'],
  cluster:      ['Spacing', '×', 'How far apart the three sit on arrival, as a multiple of card width.', '1 · Appear'],
  fanTilt:      ['Fan tilt', '°', 'Tilt on the two flanking cards.', '1 · Appear'],
  scrim:        ['Board dim', 'opacity', 'How much the board dims while this owns the screen.', '1 · Appear'],

  fuseMs:       ['Beat length', 'ms', 'Beat 2 total — hold as a trio, then merge.', '2 · Fuse'],
  holdFrac:     ['Hold share', 'opacity', 'Share of beat 2 the trio HOLDS before merging. The remainder is the merge itself.', '2 · Fuse'],
  streamCount:  ['Mote count', undefined, 'Motes drawn out of the two copies into the survivor.', '2 · Fuse'],
  arc:          ['Stream bow', '×', 'How much each stream bows on its way across. 0 is straight.', '2 · Fuse'],
  fuseSize:     ['Mote size', 'px', 'Mote radius.', '2 · Fuse'],
  trail:        ['Trail smear', 'opacity', 'Per-frame smear. Higher leaves comet tails.', '2 · Fuse'],

  crownMs:      ['Beat length', 'ms', 'Beat 3 total — the gold erupts.', '3 · Crown'],
  crownLead:    ['Overlap with fuse', 'opacity', 'Share of the crown that OVERLAPS the fuse. Higher SHORTENS the whole effect.', '3 · Crown'],
  wireInFrac:   ['Wireframe fade-in share', 'opacity', 'Share of beat 3 fading the gold wireframe in.', '3 · Crown'],
  wireHoldFrac: ['Wireframe hold share', 'opacity', 'Share holding it. Whatever remains is the fade-out.', '3 · Crown'],
  wireInten:    ['Wireframe brightness', '×', 'Peak brightness of the gold wireframe.', '3 · Crown'],
  punch:        ['Card punch', '×', 'How much the card punches outward on the crown.', '3 · Crown'],
  g1v:          ['Inner glow radius', 'px', 'Tight glow hugging the lines.', '3 · Crown'],
  g2v:          ['Outer bloom radius', 'px', 'Wide, soft bloom around the card.', '3 · Crown'],
  cardFlash:    ['Card flash', '×', 'Gold flash pushed through the card art itself.', '3 · Crown'],
  burst:        ['Burst motes', undefined, 'Motes thrown outward on the crown.', '3 · Crown'],
  burstSpd:     ['Burst speed', 'px/s', 'How fast those motes fly out.', '3 · Crown'],

  flourishType: ['Flourish', undefined, 'The signature only gilding gets. "none" removes it.', '3 · Flourish'],
  flFrac:       ['Length share', '×', 'Flourish length as a share of beat 3. Above 1 EXTENDS the whole effect.', '3 · Flourish'],
  flSize:       ['Size', '×', 'Flourish size.', '3 · Flourish'],
  flY:          ['Vertical offset', '×', 'Offset as a multiple of plate width. Positive sits lower.', '3 · Flourish'],
  flInten:      ['Brightness', '×', 'Flourish brightness.', '3 · Flourish'],
  flSpin:       ['Spin', '°', 'Flourish spin in degrees per second. Negative spins the other way.', '3 · Flourish'],

  outMs:        ['Beat length', 'ms', 'Beat 4 total — savour at centre, then hand the card to the slide.', '4 · Fly home'],
  savourFrac:   ['Savour share', 'opacity', 'Share of beat 4 the gilded card holds before the slide takes it.', '4 · Fly home'],
  flyOutEase:   ['Easing', '×', 'Departure easing.', '4 · Fly home'],

  grad:         ['Gradient spread', 'opacity', '0 is a flat mid colour. 1 is the full deep → mid → core ramp.', 'Gold palette'],
  cDeep:        ['Deep', undefined, 'Gold — the outer, darkest tone.', 'Gold palette'],
  cMid:         ['Mid', undefined, 'Gold — the middle tone.', 'Gold palette'],
  cCore:        ['Core', undefined, 'Gold — the brightest core.', 'Gold palette'],
};

/** Declaration order IS render order, grouped by beat; the select and colours sit inside their own runs. */
const ORDER: (keyof PlateGildConfig)[] = [
  'inMs', 'flyInEase', 'flyStag', 'centreScale', 'cluster', 'fanTilt', 'scrim',
  'fuseMs', 'holdFrac', 'streamCount', 'arc', 'fuseSize', 'trail',
  'crownMs', 'crownLead', 'wireInFrac', 'wireHoldFrac', 'wireInten', 'punch', 'g1v', 'g2v', 'cardFlash', 'burst', 'burstSpd',
  'flourishType', 'flFrac', 'flSize', 'flY', 'flInten', 'flSpin',
  'outMs', 'savourFrac', 'flyOutEase',
  'grad', 'cDeep', 'cMid', 'cCore',
];

const controls: TunerControl<Extract<keyof PlateGildConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  if (key === 'flourishType') {
    return { key, label, hint, group, kind: 'select' as const, options: PG_FLOURISHES, min: 0, max: 0, step: 0 };
  }
  if (COLOR_SET.has(key)) return { key, label, hint, group, kind: 'color' as const, min: 0, max: 0, step: 0 };
  const [min, max, step] = PG_RANGES[key];
  return { key, label, unit, hint, group, min, max, step };
});

export const SPEC: TunerSpec<PlateGildConfig> = {
  id: 'plategild',                  // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Plate Gild',
  note: () => `dev · ${Math.round(plateGildDuration())}ms total`,
  read: getPlateGildConfig,
  write: (key, value) => setPlateGildValue(key, value),
  writeColor: (key, value) => setPlateGildValue(key, value),  // also carries the flourish select's string
  reset: resetPlateGildConfig,
  defaults: PG_DEFAULTS,
  controls,
  actions: [{
    label: 'Play on a card',
    hint: 'Runs the whole four-beat gild on a real card in hand — the effect ends by handing that card to the slide, so it needs a real one. Needs a card on screen.',
    run: () => {
      const real = document.querySelector<HTMLElement>('.row.hand .card[data-uid]')
        ?? document.querySelector<HTMLElement>('.row .card[data-uid]');
      if (!real) return;
      const r = real.getBoundingClientRect();
      if (r.width > 0) playPlateGild(r, real, 3);
    },
  }],
};

export function PlateGildTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
