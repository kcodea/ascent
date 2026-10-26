/**
 * THE WIPE MACHINE — the combat <-> shop curtain's states and what each DOM layer wears in them, as pure functions
 * so the rules ("the scene only ever swaps under full cover", "nothing in the game paints over the blue") are
 * testable without a browser. Recruit owns the timers and the transitions between states; the tuner's preview
 * (`WipePreview`) drives the same classes with its own timers.
 *
 * Entry:  idle → chargeIn (gem tell) → coverIn (bloom) → coveredIn (hold; the board swaps to combat) → revealIn
 *         (R→L sweep) → combat (parked).
 * Exit:   combat → primeOut (tell) → coverOut (bloom) → coveredOut (hold; the run resolves back to the shop) →
 *         revealOut (L→R sweep) → idle.
 */
export type WipeState =
  | 'idle' | 'chargeIn' | 'coverIn' | 'coveredIn' | 'revealIn' | 'combat'
  | 'primeOut' | 'coverOut' | 'coveredOut' | 'revealOut';

export const WIPE_STATES: readonly WipeState[] = [
  'idle', 'chargeIn', 'coverIn', 'coveredIn', 'revealIn', 'combat', 'primeOut', 'coverOut', 'coveredOut', 'revealOut',
];

/** The states whose clip is animating (advance on the curtain's transitionend + a backstop timer). */
export function wipeSweeping(w: WipeState): boolean {
  return w === 'coverIn' || w === 'revealIn' || w === 'coverOut' || w === 'revealOut';
}

/** The exit half (the daylight-blue curtain + RETURNING TO SHOP). */
export function wipeExiting(w: WipeState): boolean {
  return w === 'primeOut' || w === 'coverOut' || w === 'coveredOut' || w === 'revealOut';
}

/** The holds: the ONLY states in which the scene underneath may swap. */
export function wipeCovered(w: WipeState): boolean {
  return w === 'coveredIn' || w === 'coveredOut';
}

/**
 * The curtain is UP: from the gem's tell until the reveal sweep has finished. Recruit mirrors this onto
 * `body.wipe-up`, which (a) hides the hover layers that sit above the curtain's z (card references, cast previews,
 * game tooltips) and (b) makes the lobby's damage float wait until the new screen is revealed instead of popping
 * over the blue (owner 2026-09-24: "sometimes background elements come through the wipe or it flickers").
 */
export function wipeUp(w: WipeState): boolean {
  return w !== 'idle' && w !== 'combat';
}

/** Whether the COMBAT backdrop (and, in combat, the combat units) is shown. It flips only across a hold: on at
 *  `coveredIn`, off at `coveredOut`, so the swap is always under full blue. */
export function combatBackdropShown(w: WipeState): boolean {
  return w === 'coveredIn' || w === 'revealIn' || w === 'combat' || w === 'primeOut' || w === 'coverOut';
}

/**
 * What the curtain wears. Covers wear `full` (the bloom, ellipse geometry); the holds wear `full settle` (which
 * ALSO swaps the clip to the full-cover inset, transition:none, the invisible shape change that lets the reveal
 * run linear); `gone` is the entry reveal's R→L retreat (parked through combat), `gone rtl` the exit reveal's L→R
 * retreat; the tells wear `settle` so the zero ellipse SNAPS to the freshly measured gem (a transition there would
 * slide the bloom's centre for its first half).
 */
export function curtainClassFor(w: WipeState): string {
  const shape = w === 'chargeIn' || w === 'primeOut' ? ' settle'
    : w === 'coveredIn' || w === 'coveredOut' ? ' full settle'
    : w === 'coverIn' || w === 'coverOut' ? ' full'
    : w === 'revealIn' ? ' gone'
    : w === 'combat' ? ' gone parked' // parked: the falling gate's crank plays only on the reveal, never on a resume
    : w === 'revealOut' ? ' gone rtl' : '';
  return `wipecurtain${shape}${wipeExiting(w) ? ' exit' : ''}`;
}

/** The ring riding the bloom's seam: grows during the covers, parked (snapped, invisible) otherwise. */
export function frontClassFor(w: WipeState): string {
  return `wipefront${w === 'coverIn' || w === 'coverOut' ? ' grow sweeping' : ' snap'}`;
}

/** The bar riding the linear reveals: parked at the launch edge during each hold. */
export function barClassFor(w: WipeState): string {
  return `wipebar${
    w === 'revealIn' ? ' rtl go sweeping'
    : w === 'revealOut' ? ' go sweeping'
    : w === 'coveredIn' ? ' rtl snap'
    : ' snap'}`;
}

/** The next state when a sweep ends (transitionend or the backstop). Non-sweeps are unchanged. */
export function afterSweep(w: WipeState): WipeState {
  return w === 'coverIn' ? 'coveredIn' : w === 'revealIn' ? 'combat' : w === 'coverOut' ? 'coveredOut' : w === 'revealOut' ? 'idle' : w;
}

/** The next state when a timed beat (a tell or a hold) ends. */
export function afterBeat(w: WipeState): WipeState {
  return w === 'chargeIn' ? 'coverIn' : w === 'primeOut' ? 'coverOut' : w === 'coveredIn' ? 'revealIn' : w === 'coveredOut' ? 'revealOut' : w;
}

/** The two full passes, in order, for tests and the preview. */
export const WIPE_ENTRY: readonly WipeState[] = ['idle', 'chargeIn', 'coverIn', 'coveredIn', 'revealIn', 'combat'];
export const WIPE_EXIT: readonly WipeState[] = ['combat', 'primeOut', 'coverOut', 'coveredOut', 'revealOut', 'idle'];

/**
 * THE RETURN TRIP (owner 2026-10-23: "i want to separate the returnn to shop experience from the door and gate"): the
 * exit pass no longer drops the gate. It fades in a VISTA of the shop and its landscape (six parallax layers), writes
 * RETURNING TO SHOP in its sky, pushes slowly in towards the shop, then dives through the shop's door into the Shop.
 *   primeOut   hidden (the gem's tell)
 *   coverOut   `on in`: fades in (and the parallax push starts)
 *   coveredOut `on in held`: fully opaque, the fade snapped home (the shop swaps in behind it)
 *   revealOut  `on dive`: dives through the door while fading away, onto the Shop
 * Every other state: hidden. The gate keeps the entry pass only (`.wipecurtain.exit` is hidden in styles.css).
 */
export function vistaClassFor(w: WipeState): string {
  return `wipevista${w === 'coverOut' ? ' on in' : w === 'coveredOut' ? ' on in held' : w === 'revealOut' ? ' on dive' : ''}`;
}

/**
 * THE WARM-UP (owner report 2026-10-25, "images glitching and not loading straight away"; R-PRESENT-36). The vista's
 * five layers are 2560 x 1440 pictures that Chromium's compositor decodes and draws only when they are shown, and it
 * drops that work again after a while (measured: a warm-up at load had decayed a minute later). Cold, the first trip
 * showed nothing for ~0.12 s (the fight stayed up, then the scene popped in) and its dive started a frame late. So the
 * moment a fight's replay ends (End Combat can only be pressed after it), the vista plays its hold and its dive once,
 * INVISIBLY: `warming` puts it behind the game at 1% (the compositor still draws covered content, measured). By the
 * press it is warm, and the trip is frame-for-frame the same as a warm one. `null` = not warming.
 */
export type VistaWarmStep = 'hold' | 'dive';
/** How long each warm step is shown (ms): long enough for the compositor to draw it at every scale it will need. */
export const VISTA_WARM_MS: Readonly<Record<VistaWarmStep, number>> = { hold: 400, dive: 450 };
export function vistaWarmClassFor(step: VistaWarmStep): string {
  return `wipevista warming${step === 'hold' ? ' on in held' : ' on dive'}`;
}
/** Only a REAL trip's own animations may move the machine on (a warm-up plays the same ones, unseen). */
export function vistaDrivesMachine(w: WipeState): boolean {
  return w === 'coverOut' || w === 'revealOut';
}
