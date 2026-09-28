import {
  HERO_DUEL_DEFAULTS, HERO_DUEL_DESC, HERO_DUEL_RANGES,
  getHeroDuelConfig, resetHeroDuelConfig, setHeroDuelValue, type HeroDuelConfig,
} from './heroDuelConfig';
import { playHeroClassic } from './heroAttack/heroClassic';
import { playAttackDemo } from './heroAttack/attackDemo';
import { formationPreviewSpeed } from './heroAttack/formationConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV tuner for the HERO DUEL: the foe portrait's placement (it drops in for the fight), its name, health, hero power
 * and runes.
 *
 * The post-combat blow itself moved 2026-09-28: the damage formation and Classic (the lunge) are tuned in the
 * 🧮 Damage Formation tuner, on the same one clock as every cosmetic attack. The old tally, attack pill, red damage
 * number and strike dials here drive nothing any more, so they are hidden (their saved values are harmless). The Test
 * buttons play the real Classic between the two portraits (they mount the foe, so they work from the shop).
 */
const LABELS: Record<keyof HeroDuelConfig, [string, TunerUnit | undefined]> = {
  oppScale:     ['Portrait size', '×'],
  oppX:         ['Portrait X', 'px'],
  oppY:         ['Portrait Y', 'px'],
  nameScale:    ['Name size', '×'],
  nameX:        ['Name X', 'px'],
  nameY:        ['Name Y', 'px'],
  hpScale:      ['Health size', '×'],
  hpX:          ['Health X', 'px'],
  hpY:          ['Health Y', 'px'],
  powerX:       ['Power X', 'px'],
  powerY:       ['Power Y', 'px'],
  powerScale:   ['Power size', '×'],
  powerAlpha:   ['Power opacity', '×'],
  pillScale:    ['Foe pill size', '×'],
  pillX:        ['Foe pill X', 'px'],
  pillY:        ['Foe pill Y', 'px'],
  pillPlayerScale: ['Your pill size', '×'],
  pillPlayerX:     ['Your pill X', 'px'],
  pillPlayerY:     ['Your pill Y', 'px'],
  dmgScale:        ['Damage num size', '×'],
  dmgX:            ['Damage num X', 'px'],
  dmgY:            ['Damage num Y', 'px'],
  sfxTravelDelay:  ['Travel SFX offset', 'ms'],
  sfxTravelVol:    ['Travel SFX vol', '×'],
  sfxAddDelay:     ['Pill-add SFX offset', 'ms'],
  sfxAddVol:       ['Pill-add SFX vol', '×'],
  sfxImpactDelay:  ['Impact SFX offset', 'ms'],
  sfxImpactVol:    ['Impact SFX vol', '×'],
  sfxCounterDelay: ['Counter SFX offset', 'ms'],
  sfxCounterVol:   ['Counter SFX vol', '×'],
  runeScale:       ['Rune size', '×'],
  rune1X:          ['Rune 1 X', 'px'],
  rune1Y:          ['Rune 1 Y', 'px'],
  rune2X:          ['Rune 2 X', 'px'],
  rune2Y:          ['Rune 2 Y', 'px'],
  rune3X:          ['Rune 3 X', 'px'],
  rune3Y:          ['Rune 3 Y', 'px'],
  runeX:           ['Rune row X', 'px'],
  runeY:           ['Rune row Y', 'px'],
  runeGap:         ['Rune gap', 'px'],
  slot1X: ['Slot 1 X', 'px'], slot1Y: ['Slot 1 Y', 'px'], slot1S: ['Slot 1 size', '×'],
  slot2X: ['Slot 2 X', 'px'], slot2Y: ['Slot 2 Y', 'px'], slot2S: ['Slot 2 size', '×'],
  slot3X: ['Slot 3 X', 'px'], slot3Y: ['Slot 3 Y', 'px'], slot3S: ['Slot 3 size', '×'],
  tallyStagger: ['Tally stagger', 'ms'],
  tallyFly:     ['Tally flight', 'ms'],
  pillHold:     ['Pill hold', 'ms'],
  strikeSpeed:  ['Swing speed', '×'],
  impactPower:  ['Impact power', '×'],
  settleMs:     ['Settle', 'ms'],
};
const GROUP: Record<keyof HeroDuelConfig, string> = {
  oppScale: 'Opponent portrait', oppX: 'Opponent portrait', oppY: 'Opponent portrait',
  nameScale: 'Foe name plate', nameX: 'Foe name plate', nameY: 'Foe name plate',
  hpScale: 'Foe health pill', hpX: 'Foe health pill', hpY: 'Foe health pill',
  powerX: 'Foe hero power', powerY: 'Foe hero power', powerScale: 'Foe hero power', powerAlpha: 'Foe hero power',
  pillScale: 'Foe attack pill', pillX: 'Foe attack pill', pillY: 'Foe attack pill',
  pillPlayerScale: 'Your attack pill', pillPlayerX: 'Your attack pill', pillPlayerY: 'Your attack pill',
  dmgScale: 'Damage number', dmgX: 'Damage number', dmgY: 'Damage number',
  sfxTravelDelay: 'Sound', sfxTravelVol: 'Sound', sfxAddDelay: 'Sound', sfxAddVol: 'Sound', sfxImpactDelay: 'Sound', sfxImpactVol: 'Sound', sfxCounterDelay: 'Sound', sfxCounterVol: 'Sound',
  runeScale: 'Opponent runes', runeX: 'Opponent runes', runeY: 'Opponent runes', runeGap: 'Opponent runes',
  rune1X: 'Opponent runes', rune1Y: 'Opponent runes', rune2X: 'Opponent runes', rune2Y: 'Opponent runes', rune3X: 'Opponent runes', rune3Y: 'Opponent runes',
  slot1X: 'Rune slots', slot1Y: 'Rune slots', slot1S: 'Rune slots',
  slot2X: 'Rune slots', slot2Y: 'Rune slots', slot2S: 'Rune slots',
  slot3X: 'Rune slots', slot3Y: 'Rune slots', slot3S: 'Rune slots',
  tallyStagger: 'Sequence', tallyFly: 'Sequence', pillHold: 'Sequence',
  strikeSpeed: 'Strike', impactPower: 'Strike', settleMs: 'Strike',
};
const ORDER: (keyof HeroDuelConfig)[] = [
  'oppScale', 'oppX', 'oppY',
  'nameScale', 'nameX', 'nameY',
  'hpScale', 'hpX', 'hpY',
  'pillScale', 'pillX', 'pillY',
  'pillPlayerScale', 'pillPlayerX', 'pillPlayerY',
  'dmgScale', 'dmgX', 'dmgY',
  'tallyStagger', 'tallyFly', 'pillHold',
  'strikeSpeed', 'impactPower', 'settleMs',
  'sfxCounterDelay', 'sfxCounterVol', 'sfxTravelDelay', 'sfxTravelVol', 'sfxAddDelay', 'sfxAddVol', 'sfxImpactDelay', 'sfxImpactVol',
  'runeScale', 'runeX', 'runeY', 'runeGap',
  'slot1X', 'slot1Y', 'slot1S', 'slot2X', 'slot2Y', 'slot2S', 'slot3X', 'slot3Y', 'slot3S',
];
// Safety net: any config key not in ORDER is appended, so a newly-added dial can never silently fail to render.
const ORDERED: (keyof HeroDuelConfig)[] = [
  ...ORDER,
  ...(Object.keys(HERO_DUEL_DEFAULTS) as (keyof HeroDuelConfig)[]).filter((k) => !ORDER.includes(k)),
];

/** Retired 2026-09-28 with the old tally / attack pill / red damage number / GSAP strike: hidden, drive nothing. */
const RETIRED = new Set<keyof HeroDuelConfig>([
  'pillScale', 'pillX', 'pillY', 'pillPlayerScale', 'pillPlayerX', 'pillPlayerY', 'dmgScale', 'dmgX', 'dmgY',
  'tallyStagger', 'tallyFly', 'pillHold', 'strikeSpeed', 'impactPower', 'settleMs',
  'sfxTravelDelay', 'sfxTravelVol', 'sfxAddDelay', 'sfxAddVol', 'sfxImpactDelay', 'sfxImpactVol', 'sfxCounterDelay', 'sfxCounterVol',
]);

const controls: TunerControl<Extract<keyof HeroDuelConfig, string>>[] = ORDERED.filter((key) => !RETIRED.has(key)).map((key) => {
  const [label, unit] = LABELS[key];
  const [min, max, step] = HERO_DUEL_RANGES[key];
  return { key, label, unit, hint: HERO_DUEL_DESC[key], group: GROUP[key], min, max, step };
});

/** Play the real Classic (the formation, then the lunge) between the two hero portraits, without touching the run. */
function demo(side: 'player' | 'opp'): void {
  void playAttackDemo(side, playHeroClassic, { board: { minionTiers: [2, 3, 4], heroTier: 3, cap: 10 }, speed: formationPreviewSpeed() });
}

export const SPEC: TunerSpec<HeroDuelConfig> = {
  id: 'heroduel',                    // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Hero Duel',
  note: 'dev · the foe portrait (the blow itself: 🧮 Damage Formation)',
  read: getHeroDuelConfig,
  write: (key, value) => setHeroDuelValue(key, value),
  reset: resetHeroDuelConfig,
  defaults: HERO_DUEL_DEFAULTS,
  controls,
  actions: [
    { label: 'Test: your hero strikes', hint: 'Plays Classic from your portrait at the foe (capped 12 to 10).', run: () => demo('player') },
    { label: 'Test: foe strikes', hint: 'Plays Classic from the foe at your portrait.', run: () => demo('opp') },
  ],
};

export function HeroDuelTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
