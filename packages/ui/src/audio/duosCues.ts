/**
 * THE DUOS CUES (2026-11-10, owner: "make the beats much stronger for duos"). WHAT each Duos moment plays, as data:
 * pure, so the tests can read a cue without an AudioContext (nobody can hear a headless run). `sfx.ts` plays them.
 *
 * Every layer is one of three things (the hand-off's two generated clips, 2026-11-12, are the only new audio files):
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

/** The drop's own air (generated for this beat, 2026-11-12): a soft half-second swell, peaking about 200 to 340 ms in,
 *  so started on the beat it crests as the first bodies touch down. */
const DROP_WHOOSH_CLIP = 'fx/duos-drop-whoosh';
/** One body touching down (generated for this beat): a short, soft, dry thump. Its hit sits this far into the file. */
const LAND_CLIP = 'fx/duos-land';
const LAND_LEAD_MS = 20;
/** A light whoosh (the pass cues). */
const WHOOSH_CLIP = 'fx/whoosh-03';
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

/** How much each later body's landing rises in pitch: a small run up the row (the whimsy), never past `LAND_RATE_MAX`. */
export const LAND_RATE_BASE = 0.94;
export const LAND_RATE_STEP = 0.03;
export const LAND_RATE_MAX = 1.12;

/** Each body's touchdown, `lands` ms from now: the same soft thump, each one a touch higher than the last, so a board
 *  arriving reads as a quick run of steps up the row. The pitch depends only on the body's turn, never on the board's
 *  size or the fight's speed. */
function landings(lands: readonly number[], gain: number): DuosCueLayer[] {
  return lands.map((l, i): DuosCueLayer => {
    const rate = Math.min(LAND_RATE_MAX, LAND_RATE_BASE + i * LAND_RATE_STEP);
    return { kind: 'fx', clip: LAND_CLIP, gain, rate, delayMs: Math.max(0, Math.round(l - LAND_LEAD_MS / rate)) };
  });
}

/**
 * THE TAG-IN (the hand-off), third pass (owner 2026-11-12: "clean it up and add a tiny bit of whimsy"). Only what is on
 * screen: the drop's air as the board comes down, one soft thump on EACH body's touchdown (`lands`, ms from the beat's
 * start, already divided by the fight's speed), each a touch higher than the last, and a quiet ground hit under the
 * final one. No synth notes; the two generated clips are in `audio/fx/` (`duos-drop-whoosh`, `duos-land`).
 */
export function duosTagInCue(side: DuosSide, lands: readonly number[]): DuosCueLayer[] {
  const mine = side === 'player';
  const ls = lands.length > 0 ? lands : [0];
  const last = Math.max(0, Math.round(Math.max(...ls)));
  return [
    { kind: 'fx', clip: DROP_WHOOSH_CLIP, gain: 0.26, fadeOutMs: 200 },
    ...landings(ls, 0.5),
    { kind: 'fx', clip: GROUND_CLIP, gain: mine ? 0.2 : 0.17, startOffsetMs: GROUND_LEAD_MS, delayMs: last, fadeOutMs: 260 },
  ];
}

/**
 * THE FLY-IN after a won fight (the teammate's unfought board joins the survivors): the same entrance, lighter. The
 * air and each body's thump, no ground hit: nothing is at stake any more.
 */
export function duosFlyInCue(_side: DuosSide, lands: readonly number[]): DuosCueLayer[] {
  return [
    { kind: 'fx', clip: DROP_WHOOSH_CLIP, gain: 0.2, fadeOutMs: 180 },
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
