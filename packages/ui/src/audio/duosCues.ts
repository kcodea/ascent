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
 * THE TEAM MOTIF. Duos had no sound of its own besides the ready ding. The menu and result cues share one small figure:
 * a RISING fifth and octave (G, D, G) for "my team steps up" (a teammate joining, a win), and the same figure FALLING
 * and lower (D, B flat, G) for a loss. The combat hand-off does NOT use it any more (2026-11-12): it plays landings.
 *
 * NOBODY HAS HEARD THESE YET. The levels are starting points for the desk.
 */

export type DuosCueLayer =
  | { kind: 'fx'; clip: string; gain: number; rate?: number; delayMs?: number; fadeOutMs?: number; startOffsetMs?: number; endOffsetMs?: number }
  | { kind: 'sample'; clip: string; gain: number; delayMs?: number }
  | { kind: 'tone'; freq: number; durMs: number; type: 'sine' | 'triangle'; vol: number; slideTo?: number; delayMs?: number };

export type DuosSide = 'player' | 'enemy';

/** A light whoosh. Its sound starts this far into the file (measured: 326 ms of lead-in silence). */
const WHOOSH_CLIP = 'fx/whoosh-03';
const WHOOSH_LEAD_MS = 300;
/** A low ground hit. Its hit sits this far into the file (measured), so it is started that much into itself. */
const GROUND_CLIP = 'fx/universfield-ground-impact-352053';
const GROUND_LEAD_MS = 90;

/** My team: G4, D5, G5. */
const RISE = [392, 587.33, 783.99] as const;
/** The other team: D4, B flat 3, G3. */
const FALL = [293.66, 233.08, 196] as const;

/** A motif's notes as tone layers, `stepMs` apart, starting at `atMs`. */
function motif(freqs: readonly number[], vol: number, stepMs: number, atMs = 0, durMs = 150): DuosCueLayer[] {
  return freqs.map((freq, i): DuosCueLayer => ({ kind: 'tone', freq, durMs, type: 'triangle', vol, delayMs: atMs + i * stepMs }));
}

/** Each body's touchdown as a card landing (the sound a card already makes when it lands), `lands` ms from now. */
function landings(lands: readonly number[], gain: number): DuosCueLayer[] {
  return lands.map((l): DuosCueLayer => ({ kind: 'sample', clip: 'cardlanding', gain, delayMs: Math.max(0, Math.round(l)) }));
}

/**
 * THE TAG-IN (the hand-off), second pass (owner 2026-11-12: "the teammate landing looks really bad still - the sound is
 * off, and the ring is bad"). The first cue was a cinematic whoosh-into-hit SPED UP to fit the short drop (so it played
 * pitched up, at a different pitch for every board size) under three synth notes. Now it is only what is on screen: a
 * light whoosh as the board drops, the game's own card landing on EACH body's touchdown (`lands`, ms from the beat's
 * start, already divided by the fight's speed), and one low ground hit under the last. No notes, nothing re-pitched.
 */
export function duosTagInCue(side: DuosSide, lands: readonly number[]): DuosCueLayer[] {
  const mine = side === 'player';
  const ls = lands.length > 0 ? lands : [0];
  const last = Math.max(0, Math.round(Math.max(...ls)));
  return [
    { kind: 'fx', clip: WHOOSH_CLIP, gain: 0.2, startOffsetMs: WHOOSH_LEAD_MS, fadeOutMs: 180 },
    ...landings(ls, 0.5),
    { kind: 'fx', clip: GROUND_CLIP, gain: mine ? 0.32 : 0.26, startOffsetMs: GROUND_LEAD_MS, delayMs: last, fadeOutMs: 260 },
  ];
}

/**
 * THE FLY-IN after a won fight (the teammate's unfought board joins the survivors): the same entrance, lighter. The
 * whoosh and each body's card landing, no ground hit: nothing is at stake any more.
 */
export function duosFlyInCue(_side: DuosSide, lands: readonly number[]): DuosCueLayer[] {
  return [
    { kind: 'fx', clip: WHOOSH_CLIP, gain: 0.16, startOffsetMs: WHOOSH_LEAD_MS, fadeOutMs: 160 },
    ...landings(lands.length > 0 ? lands : [0], 0.4),
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
