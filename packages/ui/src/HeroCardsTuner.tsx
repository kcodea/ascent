import {
  CARD_LEVELS, CARD_LEVEL_NAMES, CARDS_LEVEL_SUFFIXES, HERO_CARDS_DEFAULTS, HERO_CARDS_RANGES, cardsPlan, getHeroCardsConfig,
  heroCardsConfigJson, resetHeroCardsConfig, setHeroCardsValue,
  type CardLevel, type CardsLevelSuffix, type HeroCardsConfig, type HeroCardsNumKey, type HeroCardsStrKey,
} from './heroCards/heroCardsConfig';
import { clipNames } from './sfx';
import { DEV_HERO_ATTACK_CHOICES, DEV_HERO_ATTACK_LABELS, devHeroAttackChoice, setDevHeroAttackChoice } from './heroBlast/heroAttackStyle';
import { playHeroCards, type HeroCardsHandle, type HeroCardsOptions } from './heroCards/heroCards';
import { boardOfDamage, playAttackDemo, previewLeadIn, previewParts } from './heroAttack/attackDemo';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV tuner for the CARD SHARK hero attack (an Epic; owner ask 2026-09-29: "build 5 animations that range from rare ->
 * epic ... rare and epics should only have 2 or 3 tiers"). Three looks: Small (one card), Medium (three of a kind), Big
 * (the royal flush). The Play buttons run the REAL runner between the two real hero portraits (works from the shop), in
 * either direction. A preview never touches the run. The "Attack style" row is the same dev override as the other
 * attack tuners' (Auto = what a player would see). Production plays the baked defaults.
 */
type CardsTunerValues = HeroCardsConfig & { attackStyle: string };

type Spec = [string, TunerUnit | undefined, string, string];
type GlobalNumKey = Exclude<HeroCardsNumKey, `v${number}${string}`>;

const SPECS: Record<GlobalNumKey, Spec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the Play buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Medium from', undefined, 'Damage at which the shared Tier II starts (Card Shark plays Medium from here). Shared with every style (6).', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'The shared Tier III (still Medium for an Epic). Shared (12).', 'Damage tiers'],
  tier4At: ['Big from', undefined, 'Damage at which the shared Tier IV starts: the royal flush. Shared (20). A knockout always plays it.', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Ready'],
  heroCoilPx: ['Lean back', 'px', 'How far the hero leans back from the target as it readies.', 'Ready'],
  heroFlickPx: ['Throw flick', 'px', 'How far the hero flicks toward the target on each throw.', 'Ready'],
  cardLength: ['Card height', 'px', 'How tall a thrown card is (the look size multiplies it).', 'Cards'],
  cardGlow: ['Card glow', 'opacity', 'The soft glow round each card, in your side colour (0 = none).', 'Cards'],
  ghostAlpha: ['Spin ghosts', 'opacity', 'The faint copies trailing a spinning card (0 = none).', 'Cards'],
  embed: ['Stick depth', '×', 'How much of the card sinks past the point it hits (edge first).', 'Cards'],
  quiver: ['Quiver', undefined, 'How hard a stuck card quivers (radians).', 'Cards'],
  stickHoldMs: ['Stick hold', 'ms', 'Small and Medium: how long the cards stay stuck before they fall away.', 'Cards'],
  dealMs: ['Deal time', 'ms', 'Big: one card flying from the hero into the fanned hand.', 'Royal flush (Big)'],
  dealStaggerMs: ['Deal stagger', 'ms', 'Big: the gap between cards being dealt.', 'Royal flush (Big)'],
  flipMs: ['Flip time', 'ms', 'Big: one card turning face up.', 'Royal flush (Big)'],
  flipStaggerMs: ['Flip stagger', 'ms', 'Big: the gap between flips (the reveal rolls left to right).', 'Royal flush (Big)'],
  goldMs: ['Gold reveal', 'ms', 'Big: the faces turning to gold, the shine sweeping across.', 'Royal flush (Big)'],
  holdMs: ['Hold', 'ms', 'Big: the golden hand held up a beat before it fires.', 'Royal flush (Big)'],
  fanSize: ['Hand size', '×', 'Big: how big the fanned hand is compared to a thrown card.', 'Royal flush (Big)'],
  fanReach: ['Hand reach', '×', 'Big: how far in front of the hero the hand fans out (portrait radii).', 'Royal flush (Big)'],
  fanSpread: ['Fan spread', '°', 'Big: the angle between neighbouring cards in the hand.', 'Royal flush (Big)'],
  confetti: ['Confetti', undefined, 'Big: card confetti pieces per card in the burst.', 'Royal flush (Big)'],
  confettiGravity: ['Confetti gravity', undefined, 'px/s². How fast the confetti falls.', 'Royal flush (Big)'],
  flashAlpha: ['Flash', 'opacity', 'How bright the impact flash is.', 'Camera and portraits'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked back.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxDrawGain: ['draw: gain', undefined, 'A card drawn as the hero readies.', 'Sound: draw'],
  sfxDrawRate: ['draw: pitch', '×', 'Pitch of the draw.', 'Sound: draw'],
  sfxFlickGain: ['flick: gain', undefined, 'The quick swish of each card leaving (each a little higher).', 'Sound: flick'],
  sfxFlickRate: ['flick: pitch', '×', 'Pitch of the first swish.', 'Sound: flick'],
  sfxSnapGain: ['snap: gain', undefined, 'The snap layered on each throw.', 'Sound: snap'],
  sfxSnapRate: ['snap: pitch', '×', 'Pitch of the snap.', 'Sound: snap'],
  sfxThunkGain: ['thunk: gain', undefined, 'A card sticking in (climbs per card).', 'Sound: thunk'],
  sfxThunkRate: ['thunk: pitch', '×', 'Pitch of the first thunk.', 'Sound: thunk'],
  sfxPunchGain: ['punch: gain', undefined, 'A low punch under each thunk.', 'Sound: punch'],
  sfxPunchRate: ['punch: pitch', '×', 'Pitch of the punch.', 'Sound: punch'],
  sfxImpactGain: ['impact: gain', undefined, 'THE impact: the last card, or under the flush burst.', 'Sound: impact'],
  sfxImpactRate: ['impact: pitch', '×', 'Pitch of the impact.', 'Sound: impact'],
  sfxBigGain: ['big hit: gain', undefined, 'Medium and Big: an extra crack on the impact.', 'Sound: big hit'],
  sfxBigRate: ['big hit: pitch', '×', 'Pitch of the big hit.', 'Sound: big hit'],
  sfxDealGain: ['deal: gain', undefined, 'Big: each card dealt into the hand.', 'Sound: deal'],
  sfxDealRate: ['deal: pitch', '×', 'Pitch of the first deal (climbs per card).', 'Sound: deal'],
  sfxFlipGain: ['flip: gain', undefined, 'Big: each card turning face up.', 'Sound: flip'],
  sfxFlipRate: ['flip: pitch', '×', 'Pitch of the first flip (climbs per card).', 'Sound: flip'],
  sfxRevealGain: ['reveal: gain', undefined, 'Big: the royal flush turning gold.', 'Sound: reveal'],
  sfxRevealRate: ['reveal: pitch', '×', 'Pitch of the reveal.', 'Sound: reveal'],
  sfxBurstGain: ['burst: gain', undefined, 'Big: the flush bursting into confetti.', 'Sound: burst'],
  sfxBurstRate: ['burst: pitch', '×', 'Pitch of the burst.', 'Sound: burst'],
  sfxSparkleGain: ['sparkle: gain', undefined, 'Big: the glitter on the gold reveal and the burst.', 'Sound: sparkle'],
  sfxSparkleRate: ['sparkle: pitch', '×', 'Pitch of the sparkle.', 'Sound: sparkle'],
  sfxFlickLenMs: ['flick length', 'ms', 'Each flick swish is cut to this long (with a fade).', 'Sound: mix'],
  sfxImpactLenMs: ['impact length', 'ms', 'The impact and burst clips are cut to this long (with a fade).', 'Sound: mix'],
  sfxTailMix: ['impact tail', undefined, 'A short reverb tail on the impact. 0 = dry.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the cards play (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<CardsLevelSuffix, [string, TunerUnit | undefined, string]> = {
  ChargeMs: ['Ready', 'ms', 'The hero readying before the first card leaves (Big: before the deal). The view pushes in over this.'],
  Cards: ['Card count', undefined, 'How many cards (Small one, Medium three of a kind, Big the five of the flush).'],
  StaggerMs: ['Throw stagger', 'ms', 'Gap between each throw (the thunk, thunk, thunk).'],
  FlightMs: ['Card speed', 'ms', 'A card crossing the board (at 1600 px; lower = faster).'],
  Arc: ['Arc', '×', 'How high a card arcs, as a fraction of the distance.'],
  Fan: ['Fan', '×', 'How far the throws spread their arcs apart.'],
  Spins: ['Spins', undefined, 'Whole turns a card spins in flight.'],
  CardSize: ['Card size', '×', 'The card size multiplier for this look.'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact.'],
  Zoom: ['Push in', '×', 'How far the view pushes in through the ready.'],
  Punch: ['Impact punch', '×', 'Extra push on the impact before the view settles.'],
  Sparks: ['Sparks', undefined, 'Sparks thrown by the impact.'],
  Burst: ['Burst size', '×', 'Scale of the impact flash, rings and confetti spread.'],
  SettleMs: ['Settle', 'ms', 'Hold after the last beat before the sequence ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const CLIP_OF: Partial<Record<string, HeroCardsStrKey>> = {
  'Sound: draw': 'sfxDrawClip', 'Sound: flick': 'sfxFlickClip', 'Sound: snap': 'sfxSnapClip', 'Sound: thunk': 'sfxThunkClip',
  'Sound: punch': 'sfxPunchClip', 'Sound: impact': 'sfxImpactClip', 'Sound: big hit': 'sfxBigClip', 'Sound: deal': 'sfxDealClip',
  'Sound: flip': 'sfxFlipClip', 'Sound: reveal': 'sfxRevealClip', 'Sound: burst': 'sfxBurstClip', 'Sound: sparkle': 'sfxSparkleClip',
};

const COLORS: [HeroCardsStrKey, string, string][] = [
  ['colorIvory', 'Ivory', 'The paper of the card faces at rest, and ivory confetti.'],
  ['colorRed', 'Red', 'The red confetti.'],
  ['colorGold', 'Gold', 'The royal flush gilding, the gold rings, glints and confetti.'],
  ['colorPlayer', 'Your side', 'The card glow and total colour when YOU deal.'],
  ['colorFoe', 'Foe side', 'The card glow and total colour when THEY deal.'],
];

type Ctl = TunerControl<Extract<keyof CardsTunerValues, string>>;

function clipOptions(): string[] {
  let names: string[] = [];
  try { names = clipNames(); } catch { /* no audio here */ }
  return ['', ...names];
}

function buildControls(): Ctl[] {
  const out: Ctl[] = [{
    key: 'attackStyle', label: 'Attack style', kind: 'select', options: DEV_HERO_ATTACK_CHOICES, group: 'Style',
    optionLabels: DEV_HERO_ATTACK_LABELS,
    hint: 'Which hero attack real fights play in this dev build, for both sides. Auto = what a player sees.', min: 0, max: 0, step: 0,
  }];
  const clips = clipOptions();
  const push = (key: HeroCardsNumKey, [label, unit, hint, group]: Spec): void => {
    const [min, max, step] = HERO_CARDS_RANGES[key];
    out.push({ key, label, unit, hint, group, min, max, step });
  };
  const globals = Object.entries(SPECS) as [GlobalNumKey, Spec][];
  for (const [key, spec] of globals) if (!spec[3].startsWith('Sound')) push(key, spec);
  for (const v of CARD_LEVELS) {
    for (const s of CARDS_LEVEL_SUFFIXES) {
      const [label, unit, hint] = LEVEL_SPECS[s];
      const key = `v${v}${s}` as HeroCardsNumKey;
      const [min, max, step] = HERO_CARDS_RANGES[key];
      out.push({ key, label, unit, hint, group: CARD_LEVEL_NAMES[v as CardLevel], min, max, step });
    }
  }
  for (const [ck, cl, ch] of COLORS) out.push({ key: ck, label: cl, hint: ch, group: 'Colours', kind: 'color', min: 0, max: 0, step: 0 });
  let lastGroup = '';
  for (const [key, spec] of globals) {
    const group = spec[3];
    if (!group.startsWith('Sound')) continue;
    const clipKey = CLIP_OF[group];
    if (clipKey && group !== lastGroup) {
      out.push({ key: clipKey, label: `${group.replace('Sound: ', '')}: clip`, hint: 'Which clip this cue plays. (none) = silent.', group, kind: 'select', options: clips, optionLabels: { '': '(none)' }, min: 0, max: 0, step: 0 });
    }
    lastGroup = group;
    push(key, spec);
  }
  return out;
}

let live: HeroCardsHandle | null = null;

/** Play the real Card Shark between the two portraits, from the shop or a fight, without touching the run. */
export function demo(
  side: 'player' | 'opp',
  opts: { damage?: number; parts?: number; reduced?: boolean; frames?: HeroCardsOptions['frames']; sound?: boolean; safety?: boolean } = {},
): Promise<HeroCardsHandle | null> {
  live?.cancel();
  const cfg = getHeroCardsConfig();
  return playAttackDemo(side, (o) => playHeroCards(o), {
    board: boardOfDamage(opts.damage ?? cfg.previewDamage, opts.parts ?? cfg.previewParts),
    speed: 1, reduced: opts.reduced, frames: opts.frames, sound: opts.sound, safety: opts.safety,
  }, () => { live = null; }).then((h) => { live = h; return h; });
}

// DEV: a console / capture-rig handle on the same player the buttons use.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroCards?: unknown }).__heroCards = { demo, previewParts, play: playHeroCards };
}

const LOOK_OF: Record<CardLevel, string> = { 1: 'one card', 2: 'three of a kind', 3: 'the royal flush' };

export const SPEC: TunerSpec<CardsTunerValues> = {
  id: 'herocards',                   // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Card Shark',
  note: () => {
    const c = getHeroCardsConfig();
    const p = cardsPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    return `dev · ${CARD_LEVEL_NAMES[p.level]} (${LOOK_OF[p.level]}) · throw ${Math.round(p.throwAt)} · impact ${Math.round(p.impactAt)} · end ${Math.round(p.endAt)} ms`;
  },
  read: () => ({ ...getHeroCardsConfig(), attackStyle: devHeroAttackChoice() }),
  write: (key, value) => setHeroCardsValue(key as keyof HeroCardsConfig, value),
  writeColor: (key, value) => { if (key === 'attackStyle') setDevHeroAttackChoice(value); else setHeroCardsValue(key as keyof HeroCardsConfig, value); },
  reset: () => { resetHeroCardsConfig(); setDevHeroAttackChoice('auto'); },
  defaults: { ...HERO_CARDS_DEFAULTS, attackStyle: 'auto' },
  controls: buildControls(),
  copy: () => heroCardsConfigJson(),
  copyLabel: 'Copy JSON',
  buttonsOnTop: true,
  actions: [
    { label: '▶ You deal', hint: 'Your hero deals cards at the foe for the preview damage.', run: () => { void demo('player'); } },
    { label: '▶ Foe deals', hint: 'The foe deals cards at your hero for the preview damage.', run: () => { void demo('opp'); } },
    { label: '▶ Small (3)', hint: 'Your hero deals for 3: Small, one card.', run: () => { void demo('player', { damage: 3, parts: 2 }); } },
    { label: '▶ Medium (8)', hint: 'Your hero deals for 8: Medium, three of a kind.', run: () => { void demo('player', { damage: 8, parts: 3 }); } },
    { label: '▶ Medium (12)', hint: 'Your hero deals for 12 from four numbers: still Medium (an Epic has three looks).', run: () => { void demo('player', { damage: 12, parts: 4 }); } },
    { label: '▶ Big (40)', hint: 'Your hero deals for 40 from seven numbers: Big, the royal flush.', run: () => { void demo('player', { damage: 40, parts: 7 }); } },
    { label: '▶ Foe small (3)', hint: 'The foe deals at your hero for 3.', run: () => { void demo('opp', { damage: 3, parts: 2 }); } },
    { label: '▶ Foe medium (8)', hint: 'The foe deals at your hero for 8.', run: () => { void demo('opp', { damage: 8, parts: 3 }); } },
    { label: '▶ Foe big (40)', hint: 'The foe deals at your hero for 40.', run: () => { void demo('opp', { damage: 40, parts: 7 }); } },
  ],
};

export function HeroCardsTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
