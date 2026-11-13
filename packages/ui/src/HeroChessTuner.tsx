import {
  CHESS_LEVELS, CHESS_LEVEL_NAMES, CHESS_LEVEL_SUFFIXES, HERO_CHESS_DEFAULTS, HERO_CHESS_RANGES, chessPlan, getHeroChessConfig,
  heroChessConfigJson, resetHeroChessConfig, setHeroChessValue,
  type ChessLevel, type ChessLevelSuffix, type HeroChessConfig, type HeroChessNumKey, type HeroChessStrKey,
} from './heroChess/heroChessConfig';
import { clipNames } from './sfx';
import { DEV_HERO_ATTACK_CHOICES, DEV_HERO_ATTACK_LABELS, devHeroAttackChoice, setDevHeroAttackChoice } from './heroBlast/heroAttackStyle';
import { playHeroChess, type HeroChessHandle, type HeroChessOptions } from './heroChess/heroChess';
import { boardOfDamage, playAttackDemo, previewLeadIn, previewParts } from './heroAttack/attackDemo';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV tuner for the CHECKMATE hero attack (style id `chess`, an Epic): chess pieces that move by their own rules on a
 * faint board beside the struck hero. Three looks: the Pawn (hops up its file and captures diagonally), the Knight (its
 * L-shaped jump onto the portrait) and the Queen (the long diagonal, the king tipping over, CHECKMATE). The Play buttons
 * run the REAL runner between the two real hero portraits (works from the shop), in either direction. A preview never
 * touches the run. The "Attack style" row is the same dev override as the other attack tuners' (Auto = what a player
 * would see). Production plays the baked defaults.
 */
type ChessTunerValues = HeroChessConfig & { attackStyle: string };

type Spec = [string, TunerUnit | undefined, string, string];
type GlobalNumKey = Exclude<HeroChessNumKey, `v${number}${string}`>;

const SPECS: Record<GlobalNumKey, Spec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the Play buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Knight from', undefined, 'Damage at which the shared Tier II starts (Checkmate plays the Knight from here). Shared with every style (6).', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'The shared Tier III (still the Knight for an Epic). Shared (12).', 'Damage tiers'],
  tier4At: ['Queen from', undefined, 'Damage at which the shared Tier IV starts: the Queen. Shared (20). A knockout always plays it.', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Ready'],
  heroCoilPx: ['Lean back', 'px', 'How far the hero leans back from the target as it readies.', 'Ready'],
  heroNodPx: ['Nod', 'px', 'How far the hero nods toward the board as the piece is set down and as it moves.', 'Ready'],
  squareK: ['Square size', '×', 'A board square, in struck-portrait radii (the portrait sits on one square).', 'Board'],
  boardAlpha: ['Board', 'opacity', 'How strong the dark squares are (the light ones are fainter). Keep it subtle.', 'Board'],
  boardFadeMs: ['Board fade', 'ms', 'A square fading in, and the board fading out at the end.', 'Board'],
  hintAlpha: ['Move hint', 'opacity', 'How bright the squares the move crosses glow gold.', 'Board'],
  pieceK: ['Piece height', '×', 'The height of the piece box, in squares (the king fills it; the look size multiplies it).', 'Pieces'],
  setMs: ['Set down', 'ms', 'The piece coming down onto its square.', 'Pieces'],
  setDropPx: ['Set-down height', 'px', 'How far above the board the piece appears.', 'Pieces'],
  holdMs: ['Hold', 'ms', 'Pawn and Knight: how long the piece stays after the capture before it fades.', 'Pieces'],
  pawnHops: ['Pawn hops', undefined, 'How many squares the pawn walks before it captures.', 'Pawn'],
  hopMs: ['Hop time', 'ms', 'One hop to the next square.', 'Pawn'],
  hopGapMs: ['Hop gap', 'ms', 'The pause between hops.', 'Pawn'],
  hopLift: ['Hop height', '×', 'How high a hop rises, in squares.', 'Pawn'],
  captureMs: ['Capture', 'ms', 'The diagonal jab into the portrait.', 'Pawn'],
  rearMs: ['Rear and spin', 'ms', 'The knight rearing back, then spinning once on its square.', 'Knight'],
  jumpMs: ['Jump time', 'ms', 'The L-shaped jump, from take-off to landing.', 'Knight'],
  jumpLift: ['Jump height', '×', 'How high the jump arcs, in squares.', 'Knight'],
  jumpSpins: ['Somersaults', undefined, 'Whole turns the knight makes in the air.', 'Knight'],
  gleamMs: ['Gleam', 'ms', 'The gleam running up the queen to her crown.', 'Queen'],
  slideMs: ['Slide time', 'ms', 'The queen sweeping her diagonal.', 'Queen'],
  diagMax: ['Diagonal', undefined, 'The longest diagonal the queen may sweep, in squares (it shortens to stay on screen).', 'Queen'],
  ghostAlpha: ['Afterimages', 'opacity', 'The faint copies trailing the sliding queen (0 = none).', 'Queen'],
  kingWobbleMs: ['King wobble', 'ms', 'The king wobbling after the capture before it tips.', 'Queen'],
  kingFallMs: ['King fall', 'ms', 'The king tipping over onto its side.', 'Queen'],
  wordAtMs: ['Word delay', 'ms', 'How long after the capture CHECKMATE sets.', 'Queen'],
  wordHoldMs: ['Word hold', 'ms', 'How long CHECKMATE stays.', 'Queen'],
  wordSize: ['Word size', '×', 'The size of CHECKMATE.', 'Queen'],
  flashAlpha: ['Flash', 'opacity', 'How bright the capture flash is.', 'Camera and portraits'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked back.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxSetGain: ['set down: gain', undefined, 'The piece set down on the board (also under the capture).', 'Sound: set down'],
  sfxSetRate: ['set down: pitch', '×', 'Pitch of the set-down tap (the queen plays lower).', 'Sound: set down'],
  sfxHopGain: ['hop: gain', undefined, 'A pawn hop landing (each a little higher), and the king settling.', 'Sound: hop'],
  sfxHopRate: ['hop: pitch', '×', 'Pitch of the first hop.', 'Sound: hop'],
  sfxWhooshGain: ['whoosh: gain', undefined, 'The knight leaving on its jump (and a short one on the pawn capture).', 'Sound: whoosh'],
  sfxWhooshRate: ['whoosh: pitch', '×', 'Pitch of the whoosh.', 'Sound: whoosh'],
  sfxSlideGain: ['slide: gain', undefined, 'The queen sliding on the wood.', 'Sound: slide'],
  sfxSlideRate: ['slide: pitch', '×', 'Pitch (and speed) of the slide.', 'Sound: slide'],
  sfxGleamGain: ['gleam: gain', undefined, 'The gleam running up the queen.', 'Sound: gleam'],
  sfxGleamRate: ['gleam: pitch', '×', 'Pitch of the gleam.', 'Sound: gleam'],
  sfxThudGain: ['thud: gain', undefined, 'The knight landing on the portrait.', 'Sound: thud'],
  sfxThudRate: ['thud: pitch', '×', 'Pitch of the thud.', 'Sound: thud'],
  sfxPunchGain: ['punch: gain', undefined, 'A punch under every capture.', 'Sound: punch'],
  sfxPunchRate: ['punch: pitch', '×', 'Pitch of the punch (lower up the looks).', 'Sound: punch'],
  sfxImpactGain: ['impact: gain', undefined, 'THE impact under every capture.', 'Sound: impact'],
  sfxImpactRate: ['impact: pitch', '×', 'Pitch of the impact.', 'Sound: impact'],
  sfxBigGain: ['big hit: gain', undefined, 'The queen only: an extra crack on the capture.', 'Sound: big hit'],
  sfxBigRate: ['big hit: pitch', '×', 'Pitch of the big hit.', 'Sound: big hit'],
  sfxToppleGain: ['topple: gain', undefined, 'The king hitting the board on its side.', 'Sound: topple'],
  sfxToppleRate: ['topple: pitch', '×', 'Pitch of the topple.', 'Sound: topple'],
  sfxImpactLenMs: ['impact length', 'ms', 'The impact clip is cut to this long (with a fade).', 'Sound: mix'],
  sfxTailMix: ['impact tail', undefined, 'A short reverb tail on the impact. 0 = dry.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the attack plays (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<ChessLevelSuffix, [string, TunerUnit | undefined, string]> = {
  ReadyMs: ['Ready', 'ms', 'The hero readying (and the board fading in) before the piece comes down. The view pushes in from here.'],
  PieceSize: ['Piece size', '×', 'The piece size multiplier for this look.'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the capture.'],
  Zoom: ['Push in', '×', 'How far the view pushes in before the capture.'],
  Punch: ['Impact punch', '×', 'Extra push on the capture before the view settles.'],
  Sparks: ['Sparks', undefined, 'Sparks thrown by the capture.'],
  Burst: ['Burst size', '×', 'Scale of the capture flash and rings.'],
  SettleMs: ['Settle', 'ms', 'Hold after the last beat before the sequence ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const CLIP_OF: Partial<Record<string, HeroChessStrKey>> = {
  'Sound: set down': 'sfxSetClip', 'Sound: hop': 'sfxHopClip', 'Sound: whoosh': 'sfxWhooshClip', 'Sound: slide': 'sfxSlideClip',
  'Sound: gleam': 'sfxGleamClip', 'Sound: thud': 'sfxThudClip', 'Sound: punch': 'sfxPunchClip', 'Sound: impact': 'sfxImpactClip',
  'Sound: big hit': 'sfxBigClip', 'Sound: topple': 'sfxToppleClip',
};

const COLORS: [HeroChessStrKey, string, string][] = [
  ['colorIvory', 'Light squares', 'The light squares of the board, and the dust where a piece lands.'],
  ['colorEbony', 'Dark squares', 'The dark squares of the board.'],
  ['colorGold', 'Gold', 'The move hint, the gold rings and the glints.'],
  ['colorPlayer', 'Your side', 'The ring, sparks and total colour when YOU strike.'],
  ['colorFoe', 'Foe side', 'The ring, sparks and total colour when THEY strike.'],
];

type Ctl = TunerControl<Extract<keyof ChessTunerValues, string>>;

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
  const push = (key: HeroChessNumKey, [label, unit, hint, group]: Spec): void => {
    const [min, max, step] = HERO_CHESS_RANGES[key];
    out.push({ key, label, unit, hint, group, min, max, step });
  };
  const globals = Object.entries(SPECS) as [GlobalNumKey, Spec][];
  for (const [key, spec] of globals) if (!spec[3].startsWith('Sound')) push(key, spec);
  for (const v of CHESS_LEVELS) {
    for (const s of CHESS_LEVEL_SUFFIXES) {
      const [label, unit, hint] = LEVEL_SPECS[s];
      const key = `v${v}${s}` as HeroChessNumKey;
      const [min, max, step] = HERO_CHESS_RANGES[key];
      out.push({ key, label, unit, hint, group: CHESS_LEVEL_NAMES[v as ChessLevel], min, max, step });
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

let live: HeroChessHandle | null = null;

/** Play the real Checkmate between the two portraits, from the shop or a fight, without touching the run. */
export function demo(
  side: 'player' | 'opp',
  opts: { damage?: number; parts?: number; reduced?: boolean; frames?: HeroChessOptions['frames']; sound?: boolean; safety?: boolean; speed?: number } = {},
): Promise<HeroChessHandle | null> {
  live?.cancel();
  const cfg = getHeroChessConfig();
  return playAttackDemo(side, (o) => playHeroChess(o), {
    board: boardOfDamage(opts.damage ?? cfg.previewDamage, opts.parts ?? cfg.previewParts),
    speed: opts.speed ?? 1, reduced: opts.reduced, frames: opts.frames, sound: opts.sound, safety: opts.safety,
  }, () => { live = null; }).then((h) => { live = h; return h; });
}

// DEV: a console / capture-rig handle on the same player the buttons use.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroChess?: unknown }).__heroChess = { demo, previewParts, play: playHeroChess };
}

const LOOK_OF: Record<ChessLevel, string> = { 1: 'hops and captures', 2: 'the L-shaped jump', 3: 'the long diagonal' };

export const SPEC: TunerSpec<ChessTunerValues> = {
  id: 'herochess',                   // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Checkmate',
  note: () => {
    const c = getHeroChessConfig();
    const p = chessPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    return `dev · ${CHESS_LEVEL_NAMES[p.level]} (${LOOK_OF[p.level]}) · set ${Math.round(p.tapAt)} · move ${Math.round(p.strikeAt)} · impact ${Math.round(p.impactAt)} · end ${Math.round(p.endAt)} ms`;
  },
  read: () => ({ ...getHeroChessConfig(), attackStyle: devHeroAttackChoice() }),
  write: (key, value) => setHeroChessValue(key as keyof HeroChessConfig, value),
  writeColor: (key, value) => { if (key === 'attackStyle') setDevHeroAttackChoice(value); else setHeroChessValue(key as keyof HeroChessConfig, value); },
  reset: () => { resetHeroChessConfig(); setDevHeroAttackChoice('auto'); },
  defaults: { ...HERO_CHESS_DEFAULTS, attackStyle: 'auto' },
  controls: buildControls(),
  copy: () => heroChessConfigJson(),
  copyLabel: 'Copy JSON',
  buttonsOnTop: true,
  actions: [
    { label: '▶ You strike', hint: 'Your hero plays a piece at the foe for the preview damage.', run: () => { void demo('player'); } },
    { label: '▶ Foe strikes', hint: 'The foe plays a piece at your hero for the preview damage.', run: () => { void demo('opp'); } },
    { label: '▶ Pawn (3)', hint: 'Your hero strikes for 3: the pawn hops up its file and captures diagonally.', run: () => { void demo('player', { damage: 3, parts: 2 }); } },
    { label: '▶ Knight (8)', hint: 'Your hero strikes for 8: the knight makes its L-shaped jump.', run: () => { void demo('player', { damage: 8, parts: 3 }); } },
    { label: '▶ Knight (12)', hint: 'Your hero strikes for 12 from four numbers: still the knight (an Epic has three looks).', run: () => { void demo('player', { damage: 12, parts: 4 }); } },
    { label: '▶ Queen (40)', hint: 'Your hero strikes for 40 from seven numbers: the queen, the king tipping over, CHECKMATE.', run: () => { void demo('player', { damage: 40, parts: 7 }); } },
    { label: '▶ Foe pawn (3)', hint: 'The foe strikes your hero for 3.', run: () => { void demo('opp', { damage: 3, parts: 2 }); } },
    { label: '▶ Foe knight (8)', hint: 'The foe strikes your hero for 8.', run: () => { void demo('opp', { damage: 8, parts: 3 }); } },
    { label: '▶ Foe queen (40)', hint: 'The foe strikes your hero for 40.', run: () => { void demo('opp', { damage: 40, parts: 7 }); } },
  ],
};

export function HeroChessTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
