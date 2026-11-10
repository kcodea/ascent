/**
 * THE DUOS CUES (2026-11-10, owner: "make the beats much stronger for duos"). WHAT each Duos moment plays, as data:
 * pure, so the tests can read a cue without an AudioContext (nobody can hear a headless run). `sfx.ts` plays them.
 *
 * NO NEW AUDIO FILES. Every layer is one of three things the game could already produce:
 *  - `fx`: a clip of the FX bank that code already names (`audio/codeClips.ts` `CODE_FX_CLIPS`, so a phone decodes
 *    nothing extra), played through `playFxSound` at its own gain and rate;
 *  - `sample`: a clip of the core bank (always decoded), on the cue's own fader;
 *  - `tone`: a note of the synth (`tone()`), the same one the game's fallback blips use.
 *
 * THE TEAM MOTIF. Duos had no sound of its own besides the ready ding. These cues share one small figure so the mode
 * reads as one thing: a RISING fifth and octave (G, D, G) for "my team steps up" (my tag-in, a teammate joining, a
 * win), and the same figure FALLING and lower (D, B flat, G) for the other team's hand-off and for a loss.
 *
 * NOBODY HAS HEARD THESE YET. The levels are starting points for the desk.
 */

export type DuosCueLayer =
  | { kind: 'fx'; clip: string; gain: number; rate?: number; delayMs?: number; fadeOutMs?: number; startOffsetMs?: number; endOffsetMs?: number }
  | { kind: 'sample'; clip: string; gain: number; delayMs?: number }
  | { kind: 'tone'; freq: number; durMs: number; type: 'sine' | 'triangle'; vol: number; slideTo?: number; delayMs?: number };

export type DuosSide = 'player' | 'enemy';

/** The heavy whoosh into a hit (the greatsword's clip). Its hit sits this far in at rate 1 (heroBlades.ts, measured). */
const STINGER_CLIP = 'fx/universfield-cinematic-swoosh-impact-454392';
export const DUOS_STINGER_HIT_MS = 480;
const WHOOSH_CLIP = 'fx/whoosh-03';
const GROUND_CLIP = 'fx/universfield-ground-impact-352053';

/** My team: G4, D5, G5. */
const RISE = [392, 587.33, 783.99] as const;
/** The other team: D4, B flat 3, G3. */
const FALL = [293.66, 233.08, 196] as const;

/** A motif's notes as tone layers, `stepMs` apart, starting at `atMs`. */
function motif(freqs: readonly number[], vol: number, stepMs: number, atMs = 0, durMs = 150): DuosCueLayer[] {
  return freqs.map((freq, i): DuosCueLayer => ({ kind: 'tone', freq, durMs, type: 'triangle', vol, delayMs: atMs + i * stepMs }));
}

/**
 * Start the stinger so its HIT lands `landMs` from now: late enough when there is room, sped up when there is not (a
 * fast fight or a Skip), never more than 2.5x. Pure.
 */
export function stingerLanding(landMs: number): { delayMs: number; rate: number } {
  const land = Math.max(80, landMs);
  if (land >= DUOS_STINGER_HIT_MS) return { delayMs: Math.round(land - DUOS_STINGER_HIT_MS), rate: 1 };
  return { delayMs: 0, rate: Math.min(2.5, DUOS_STINGER_HIT_MS / land) };
}

/**
 * THE TAG-IN (the hand-off): the motif as the board leaves its edge, the whoosh under the flight, and its hit plus a
 * low thud as the LAST body lands (`landMs` from the beat's start, already divided by the fight's speed).
 */
export function duosTagInCue(side: DuosSide, landMs: number): DuosCueLayer[] {
  const mine = side === 'player';
  const s = stingerLanding(landMs);
  const step = Math.max(28, Math.min(70, landMs / 6));
  return [
    ...motif(mine ? RISE : FALL, mine ? 0.075 : 0.06, step, 0, mine ? 160 : 190),
    { kind: 'fx', clip: STINGER_CLIP, gain: mine ? 0.5 : 0.42, rate: s.rate * (mine ? 1 : 0.92), delayMs: s.delayMs },
    { kind: 'sample', clip: 'tallyimpact', gain: 0.8, delayMs: Math.max(0, landMs) },
  ];
}

/**
 * THE FLY-IN after a won fight (the teammate's unfought board joins the survivors): the same entrance, lighter. A
 * soft whoosh, two notes of the motif, a card landing. No hit: nothing is at stake any more.
 */
export function duosFlyInCue(side: DuosSide, landMs: number): DuosCueLayer[] {
  const mine = side === 'player';
  return [
    ...motif((mine ? RISE : FALL).slice(0, 2), 0.05, Math.max(28, Math.min(70, landMs / 5))),
    { kind: 'fx', clip: WHOOSH_CLIP, gain: 0.32, rate: mine ? 1.15 : 1, fadeOutMs: 160 },
    { kind: 'sample', clip: 'cardlanding', gain: 0.6, delayMs: Math.max(0, landMs) },
  ];
}

/**
 * A BOARD HAS FALLEN: a low ground hit and a note sinking under it. Mine sinks lower and longer than theirs (theirs is
 * good news, so it is shorter and lighter).
 */
export function duosBoardFallenCue(side: DuosSide): DuosCueLayer[] {
  const mine = side === 'player';
  return [
    { kind: 'fx', clip: GROUND_CLIP, gain: mine ? 0.46 : 0.36, rate: mine ? 0.7 : 0.88, fadeOutMs: 260 },
    { kind: 'tone', freq: mine ? 196 : 246.94, durMs: mine ? 460 : 300, type: 'sine', vol: mine ? 0.1 : 0.07, slideTo: mine ? 82 : 147 },
  ];
}

/** A PASS LEAVES: a two-note pluck up (the release) and a quick, bright whoosh away. */
export function duosPassSendCue(): DuosCueLayer[] {
  return [
    { kind: 'tone', freq: 659.25, durMs: 80, type: 'triangle', vol: 0.06 },
    { kind: 'tone', freq: 987.77, durMs: 110, type: 'triangle', vol: 0.055, delayMs: 55 },
    { kind: 'fx', clip: WHOOSH_CLIP, gain: 0.26, rate: 1.4, fadeOutMs: 140 },
  ];
}

/**
 * A PASS ARRIVES: a slower, lower whoosh in, a three-note chime down into the hand, and the card landing as it forms
 * (`landMs` from now).
 */
export function duosPassReceiveCue(landMs: number): DuosCueLayer[] {
  const land = Math.max(0, landMs);
  return [
    { kind: 'fx', clip: WHOOSH_CLIP, gain: 0.22, rate: 0.85, fadeOutMs: 200 },
    { kind: 'tone', freq: 1567.98, durMs: 120, type: 'sine', vol: 0.045, delayMs: Math.max(0, land - 120) },
    { kind: 'tone', freq: 1318.51, durMs: 120, type: 'sine', vol: 0.045, delayMs: Math.max(0, land - 60) },
    { kind: 'tone', freq: 1046.5, durMs: 220, type: 'sine', vol: 0.05, delayMs: land },
    { kind: 'sample', clip: 'cardlanding', gain: 0.55, delayMs: land },
  ];
}

/** Onto the teammate's screen (two soft notes up) and back to mine (the same two, down). */
export function duosViewSwapCue(toMate: boolean): DuosCueLayer[] {
  const [a, b] = toMate ? [523.25, 783.99] : [783.99, 523.25];
  return [
    { kind: 'tone', freq: a, durMs: 80, type: 'sine', vol: 0.04 },
    { kind: 'tone', freq: b, durMs: 110, type: 'sine', vol: 0.04, delayMs: 50 },
  ];
}

/** My teammate sits down in the party: the motif, and a card landing under its last note. */
export function duosMateJoinedCue(): DuosCueLayer[] {
  return [...motif(RISE, 0.06, 75), { kind: 'sample', clip: 'cardlanding', gain: 0.5, delayMs: 150 }];
}

/** Both of us are locked in and the round is closing: one soft low note, so the wait reads as "locked", not "stuck". */
export function duosLockedInCue(): DuosCueLayer[] {
  return [
    { kind: 'tone', freq: 196, durMs: 260, type: 'sine', vol: 0.05 },
    { kind: 'tone', freq: 392, durMs: 320, type: 'sine', vol: 0.035, delayMs: 40 },
  ];
}

/** MY TEAM IS OUT: the motif falling, under the end screen's own low tone (`sfx.placementTone`, played beside it). */
export function duosTeamOutCue(): DuosCueLayer[] {
  return motif(FALL, 0.065, 150, 0, 380);
}

/** THE TEAM'S RESULT comes into view: a win rings the motif up and holds its top two notes; 2nd place plays it once,
 *  softly; 3rd and 4th let it fall. The placement tone itself is `sfx.placementTone`. */
export function duosTeamResultCue(placement: number): DuosCueLayer[] {
  if (placement === 1) {
    return [
      ...motif(RISE, 0.07, 110, 0, 260),
      { kind: 'tone', freq: 987.77, durMs: 700, type: 'triangle', vol: 0.055, delayMs: 330 },
      { kind: 'tone', freq: 1174.66, durMs: 900, type: 'sine', vol: 0.05, delayMs: 440 },
    ];
  }
  if (placement === 2) return motif(RISE, 0.05, 120, 0, 240);
  return motif(FALL, 0.055, 150, 0, 340);
}

/** The end screen's tone for a TEAM place out of four: the top half hears the high tone (as 1st to 4th of eight
 *  do), the bottom half the low one. Returns the solo placement whose tone to play. Pure. */
export function duosPlacementToneAs(placement: number): number {
  return placement <= 2 ? 1 : 8;
}
