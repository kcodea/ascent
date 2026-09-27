import { ANCIENTS } from '@game/sim';
import { ANCIENT_HERO_THEMES, HERO_THEME_DEFAULTS, type HeroThemeKey } from './ancientHeroThemes';

/**
 * The ✦ Ancients tuner's values (DEV, proof of concept 2026-09-25).
 *
 * TWO kinds of value live here:
 *  · the METER's balance numbers (`cost` / `refresh` / `combat`) — handed to `enableAncients` when the Scene
 *    Builder starts a Set 3 run, and pushed into the live run when moved (so the sim stays the only authority:
 *    the UI never counts points itself);
 *  · the PRESENTATION dials (ring size / warm-up / timings / the awakening beat), read by the meter, the
 *    preview and the awakening.
 * Persisted in dev only; production always uses the defaults (it never reaches this system anyway: Ancients are
 * Scene Builder only).
 */
export interface AncientsConfig {
  /** Meter: points to fill it (awaken). */
  cost: number;
  /** Meter: points one Shop refresh adds. */
  refresh: number;
  /** Meter: points one combat adds. */
  combat: number;
  /** Ring: stroke thickness (design px). */
  ringWidth: number;
  /** Ring: gap between the hero-power button's edge and the ring (design px), so it never merges with the frame. */
  ringOffset: number;
  /** Ring: the empty track's colour. */
  trackColor: string;
  /** Ring: the empty track's opacity. */
  trackAlpha: number;
  /** Ring: the fill gradient's start (at the arc's tail). */
  fillFrom: string;
  /** Ring: the fill gradient's end (at the head). */
  fillTo: string;
  /** Ring: the leading-edge cap's size (× the ring width). 0 hides it. */
  capSize: number;
  /** Ring: quarter tick marks on the track (1 on, 0 off). */
  ticks: number;
  /** Fill: the arc's eased sweep when points are added (ms). */
  fillMs: number;
  /** Awaken: the full ring's flash before the Discover rises (ms). */
  flashMs: number;
  /** Pick: the split reveal duration (ms). */
  splitMs: number;
  /** Pick: the shine sweep duration (ms). */
  shineMs: number;
  /** Sound: the fill tick's gain (0 mutes). */
  tickGain: number;
  /** Sound: the awaken / reveal cue's gain (0 mutes). */
  revealGain: number;
  /** THE AWAKENING (owner 2026-09-25: "ominous exciting when the hero power erupts … delay the discover, and make the
   *  discover animation unique to the ancients in timing, sound and appearance"). Beat lengths (ms): */
  omenMs: number;
  /** Omen: how dark the screen edges go while the world holds its breath (opacity). */
  omenDark: number;
  /** Omen: the board's tremor at its peak (px). 0 = none. The hero power never moves. */
  omenTremor: number;
  /** Eruption: the curtain bloom out of the hero power (ms). */
  eruptionMs: number;
  /** Eruption: the energy ring riding the curtain's seam (peak opacity). */
  seamGlow: number;
  /** Title: how long "An Ancient Awakens" holds before the reveal (ms). */
  titleHoldMs: number;
  /** Reveal: the curtain fading off (ms). */
  revealFadeMs: number;
  /** Reveal: the pause before the first Ancient emerges (ms). */
  revealDelayMs: number;
  /** Reveal: between one Ancient emerging and the next (ms). */
  cardStaggerMs: number;
  /** Reveal: one Ancient's emergence (ms). */
  cardRevealMs: number;
  /** Reveal style: 1 = TWO BEATS (the middle rises and slams, then left + right slide out from behind it and slam
   *  together), 0 = SEQUENTIAL (left → middle → right). */
  revealStyle: number;
  /** REVEAL PASS (owner 2026-09-27: "make the ancient reveal sequence better"). The title handoff: the banner is born
   *  where the curtain's title stands and rises into place (ms). 0 = a plain fade. */
  handoffMs: number;
  /** Anticipation: the column of the first Ancient's colour gathering where it will stand (ms). 0 = none. */
  gatherMs: number;
  /** Each card's name and effect rising in after it lands (ms each). 0 = shown with the card. */
  textInMs: number;
  /** Each card's colour bloom over its art as it lands (peak opacity). 0 = none. */
  landFlash: number;
  /** Idle: the three cards' slow float once the choice is open (design px). 0 = still. The only loop: transform only. */
  idleFloat: number;
  /** Idle: one float cycle (ms). */
  idleMs: number;
  /** Hover: the other two cards step back to this opacity while one is hovered. 1 = no dim. */
  hoverDim: number;
  /** Two beats: the middle's rise + slam (ms). */
  beat1Ms: number;
  /** Two beats: the gap before the sides (ms). */
  beatGapMs: number;
  /** Two beats: the sides sliding out + slamming (ms). */
  beat2Ms: number;
  /** The slam's weight: overshoot, card shake and the landing FX size (×). */
  slamStrength: number;
  /** Hero-power dust: its lifetime as a fraction of the landing dust's (short, so it has cleared by the curtain). */
  hpDustLife: number;
  /** Landing dust (the Runeforge tablet landing's own dust, tinted; each slam + the eruption): count (×). 0 = none. */
  dustAmount: number;
  /** Landing dust: size and spread (×). */
  dustSize: number;
  /** Landing dust: how long it hangs before it settles (×). */
  dustLife: number;
  /** Landing dust: opacity (0..1). */
  dustOpacity: number;
  /** The reveal SLAMS' dust burst (×, on top of the dust settings; owner 2026-09-26: "have dust pop out when it slams
   *  in place a bit more"). 1 = the plain landing puff. */
  slamDust: number;
  /** The reveal slams' turbulent SPARK BLAST (×; owner 2026-09-26). 0 = none. */
  slamSparks: number;
  /** Screen colours: the curtain gradient's centre. */
  curtainInner: string;
  /** Screen colours: the curtain gradient's edge. */
  curtainOuter: string;
  /** Screen colours: the energy ring on the curtain's seam. */
  seamColor: string;
  /** Screen colours: the title's glow. */
  titleGlow: string;
  /** Screen colours: the backdrop tint behind the cards. */
  backdropTint: string;
  /** Tuner only: the hero the Hero theme group edits and the Play button plays as (`default` = every hero without
   *  its own theme). Nothing in the game reads it. */
  tunerHero: string;
  /** Tuner only: preview another bloom style on that hero (`auto` = the hero's own). Nothing in the game reads it. */
  tunerStyle: string;
  /** THE PICK → SLAM (owner 2026-09-27: "i dont want the black circle to go back to the hero power, id rather the screen
   *  fade back and give more emphasis on the choice slamming the hero power"). See `ancientPickSlam.ts` and the
   *  research note docs/devlog/2026-09-27-ancient-pick-research.md for why these numbers.
   *  The backdrop (and the unchosen cards + banner) fading off, from the click (ms). */
  pickFadeMs: number;
  /** THE COLLAPSE (owner 2026-09-27, second pass: "do not use the art square ... collapse it into the same pixi style
   *  effect we use for when the player gets a triple"): the chosen card pinches into a bright core of its colour (ms). */
  collapseMs: number;
  /** When the triple's trail launches out of the core, as a fraction of the collapse (the core hands off to it). */
  trailAt: number;
  /** The triple's trail (`gild-trail`, recoloured to the Ancient): its speed (× the triple's own 420 ms flight). */
  trailTime: number;
  /** The triple's trail: particle amount (×). */
  trailIntensity: number;
  /** The core's glow as the card collapses (peak opacity). */
  coreGlow: number;
  /** Hit-stop: the hero power held squashed at contact before the shake + crack release (ms). 0 = none. */
  hitStopMs: number;
  /** Screen react: the board's trauma shake after the release (ms). */
  shakeMs: number;
  /** Screen react: the shake's peak offset (design px). It decays with trauma squared. 0 = none. */
  shakePx: number;
  /** Screen react: the board's punch-zoom toward the hero power at the release (fraction: 0.012 = 1.2%). 0 = none. */
  punchZoom: number;
  /** Screen react: the hero power's recoil (squash, then a small overshoot) at the release (fraction). 0 = none. */
  recoil: number;
  /** The Pixi burst at the hero power (ring + sparks, in the Ancient's colour): size (×). 0 = none. */
  burstScale: number;
  /** The impact flash: a light bloom on the hero power at contact (peak opacity). 0 = none. */
  impactFlash: number;
  /** The impact flash's decay (ms). */
  impactFlashMs: number;
  /** Sound: the duck on the music + other sounds during the awakening (0 = silent, 1 = none). */
  duckAmount: number;
  /** Sound: the duck's ramp (ms). */
  duckRampMs: number;
  /** Preview: the slide/fade IN on hover (ms). */
  pvInMs: number;
  /** Preview: the slide/fade OUT when the pointer leaves (ms). */
  pvOutMs: number;
  /** Preview: the grace before it starts leaving, so the pointer can cross from the ring to the card (ms). */
  pvGraceMs: number;
  /** Crack: where the split runs, % of the button width from the left. */
  crackX: number;
  /** Crack: how far each zig swings either side of the line, % of the button width. */
  crackJag: number;
  /** Crack: how many zig-zag segments top to bottom. */
  crackSegs: number;
  /** Crack: the bright edge's width (design px). 0 hides it. */
  crackEdge: number;
  /** Crack: the bright edge's opacity. */
  crackEdgeAlpha: number;
  /** Crack: the shadow along the crack's edge (opacity). */
  crackShadow: number;
  /** Crack: the one-shot "opens" draw on awakening (ms). 0 = no draw. */
  crackOpenMs: number;
}

/** Per-Ancient art fit for the hero-power half: offset (design px), scale (x), rotation (deg), and a crack-position
 *  nudge (% of the button) when the default split cuts the art badly. Keys: `<ancient><X|Y|S|R|Crack>`. */
export type AncientArtKey = `${'death' | 'fortune' | 'war' | 'genesis' | 'time' | 'bonds'}${'X' | 'Y' | 'S' | 'R' | 'Crack'}`;
export const ANCIENT_ART_IDS = ['death', 'fortune', 'war', 'genesis', 'time', 'bonds'] as const;
export const ART_FIELDS = ['X', 'Y', 'S', 'R', 'Crack'] as const;
const ART_DEFAULTS = Object.fromEntries(
  ANCIENT_ART_IDS.flatMap((id) => ART_FIELDS.map((f) => [`${id}${f}`, f === 'S' ? 1 : 0])),
) as Record<AncientArtKey, number>;
export type AncientColorKey = `${'death' | 'fortune' | 'war' | 'genesis' | 'time' | 'bonds'}Color`;
/** THE AWAKENING SOUND CUES (owner: "i can help source sounds if you set up a tuner with timing cues"). Each cue is a
 *  clip id (swap in the owner's SFX in the tuner), a gain, an offset (ms, relative to its beat) and a rate (pitch). */
export const ANCIENT_CUES = ['omenRumble', 'eruptionBoom', 'eruptionFlash', 'titleSting', 'cardReveal', 'ambientHum', 'pickWoosh', 'pickSeal'] as const;
export type AncientCue = (typeof ANCIENT_CUES)[number];
export type AncientCueKey = `${AncientCue}${'Clip' | 'Gain' | 'Offset' | 'Rate'}`;
/** The shipped picks (existing repo clips, pitched where it helps). Gains baked from the owner's tuner 2026-09-26. */
export const ANCIENT_CUE_DEFAULTS: Record<AncientCue, { clip: string; gain: number; offset: number; rate: number }> = {
  omenRumble: { clip: 'turncharge', gain: 0.7, offset: 0, rate: 0.62 },
  eruptionBoom: { clip: 'fx/universfield-ground-impact-352053', gain: 0.9, offset: 0, rate: 0.82 },
  eruptionFlash: { clip: 'fx/universfield-cinematic-swoosh-impact-454392', gain: 0.6, offset: 40, rate: 0.9 },
  titleSting: { clip: 'fx/waking-rift', gain: 0.75, offset: 60, rate: 1 },
  cardReveal: { clip: 'runeselectimplosion', gain: 0.19, offset: 0, rate: 0.9 },
  ambientHum: { clip: 'turncharge', gain: 0.18, offset: 0, rate: 0.45 },
  // The pick's trail: the triple's own woosh + impact clips (the gild-trail def's sound layers, muted there so these
  // play on the undiminished hero bus and land exactly on the collapse / contact frames).
  pickWoosh: { clip: 'fx/metal-woosh', gain: 0.32, offset: 0, rate: 0.8 },
  pickSeal: { clip: 'fx/triple-impact', gain: 0.62, offset: 0, rate: 0.85 },
};
const CUE_DEFAULTS = Object.fromEntries(ANCIENT_CUES.flatMap((c) => {
  const d = ANCIENT_CUE_DEFAULTS[c];
  return [[`${c}Clip`, d.clip], [`${c}Gain`, d.gain], [`${c}Offset`, d.offset], [`${c}Rate`, d.rate]];
})) as Record<AncientCueKey, string | number>;
export type AncientsFullConfig = AncientsConfig & Record<AncientArtKey, number> & Record<AncientColorKey, string>
  & Record<HeroThemeKey, string>
  & Record<`${AncientCue}Clip`, string> & Record<`${AncientCue}${'Gain' | 'Offset' | 'Rate'}`, number>;

export const ANCIENTS_DEFAULTS: AncientsFullConfig = {
  ...ART_DEFAULTS,
  ...(CUE_DEFAULTS as unknown as Record<`${AncientCue}Clip`, string> & Record<`${AncientCue}${'Gain' | 'Offset' | 'Rate'}`, number>),
  ...(Object.fromEntries(ANCIENT_ART_IDS.map((id) => [`${id}Color`, ANCIENTS[id].color])) as Record<AncientColorKey, string>),
  // Per-hero awakening themes (ancientHeroThemes.ts): the themed heroes' colours under `<hero>Theme<Field>` keys.
  ...HERO_THEME_DEFAULTS,
  cost: 16,
  refresh: 1,
  combat: 2,
  ringWidth: 12,
  ringOffset: 7,
  trackColor: '#241c3d',
  trackAlpha: 0.55,
  fillFrom: '#ffe36e',
  fillTo: '#ff8a1f',
  capSize: 1.25,
  ticks: 1,
  fillMs: 520,
  flashMs: 480,
  splitMs: 440, // was 520: the follow-through after the slam, tightened 2026-09-27
  shineMs: 560, // was 800
  tickGain: 0.5, // drives the soft `ancientFillTick` synth now (owner 2026-09-26), not the tally-counter clip
  revealGain: 0.8,
  omenMs: 850,
  omenDark: 1,
  omenTremor: 2.5,
  eruptionMs: 520,
  seamGlow: 0.9,
  titleHoldMs: 1050, // was 1500: ~1 s of an unchanging title card (whole-sequence pass 2026-09-27)
  revealFadeMs: 320, // was 480 (2026-09-27 whole-sequence pass: shorter + ease-in, no murky mid-fade)
  revealDelayMs: 180, // was 280, 220, then 80; 180 (reveal pass 2026-09-27) leaves room for the gather beat before the rise
  cardStaggerMs: 460,
  cardRevealMs: 700,
  revealStyle: 1,
  handoffMs: 440,
  gatherMs: 420,
  textInMs: 240,
  landFlash: 0.7,
  idleFloat: 3,
  idleMs: 4800,
  hoverDim: 0.7,
  beat1Ms: 460, // was 720, then 600 (owner 2026-09-26: "speed up the first ancient slam even more")
  beatGapMs: 140, // was 360, then 250 (2026-09-27: the sides hide behind the middle, so the gap read as a stall)
  beat2Ms: 470, // was 560
  slamStrength: 1,
  hpDustLife: 0.45,
  dustAmount: 1,
  dustSize: 1,
  dustLife: 1,
  dustOpacity: 0.85,
  slamDust: 1.7,
  slamSparks: 1,
  // The DEFAULT hero theme (every hero without its own entry): the owner-baked screen colours, from the theme table.
  ...ANCIENT_HERO_THEMES.default,
  tunerHero: 'indy',
  tunerStyle: 'auto',
  // The pick → collapse → triple trail → slam (owner 2026-09-27; numbers argued in
  // docs/devlog/2026-09-27-ancient-pick-research.md). See `pickTimeline` for the resulting clock.
  pickFadeMs: 380,
  collapseMs: 200,
  trailAt: 0.7,
  trailTime: 0.75, // passes 1-2: at the triple's own 420 ms the ribbon's tail kept arriving ~180 ms after the hit
  trailIntensity: 0.55,
  coreGlow: 1,
  hitStopMs: 60,
  shakeMs: 280,
  shakePx: 5,
  punchZoom: 0.012,
  recoil: 0.1,
  burstScale: 0.6, // the triple's landing is the main burst now; this is only the crisp ring on the release
  impactFlash: 0.55,
  impactFlashMs: 200,
  duckAmount: 0.3,
  duckRampMs: 260,
  pvInMs: 180,
  pvOutMs: 110,
  pvGraceMs: 80,
  crackX: 50,
  crackJag: 4.5,
  crackSegs: 9,
  crackEdge: 2,
  crackEdgeAlpha: 0.9,
  crackShadow: 0.45,
  crackOpenMs: 260, // was 420, then 320 (2026-09-27 pass 3: the crack read late under the landing's sparks)
};

type NumKey = { [K in keyof AncientsFullConfig]: AncientsFullConfig[K] extends number ? K : never }[keyof AncientsFullConfig];
export type AncientsNumKey = NumKey;
export type AncientsColorKey = Exclude<keyof AncientsFullConfig, NumKey>;

export const ANCIENTS_RANGES: Record<NumKey, [number, number, number]> = {
  cost: [1, 40, 1],
  refresh: [0, 8, 1],
  combat: [0, 16, 1],
  ringWidth: [2, 30, 0.5],
  ringOffset: [0, 30, 0.5],
  trackAlpha: [0, 1, 0.01],
  capSize: [0, 2.5, 0.05],
  ticks: [0, 1, 1],
  fillMs: [0, 1600, 10],
  flashMs: [0, 1500, 10],
  splitMs: [120, 1600, 10],
  shineMs: [0, 2000, 10],
  tickGain: [0, 1, 0.01],
  revealGain: [0, 1, 0.01],
  omenMs: [0, 3000, 10],
  omenDark: [0, 1, 0.01],
  omenTremor: [0, 10, 0.1],
  eruptionMs: [100, 2000, 10],
  seamGlow: [0, 1, 0.01],
  titleHoldMs: [0, 4000, 10],
  revealFadeMs: [60, 2000, 10],
  revealDelayMs: [0, 2000, 10],
  cardStaggerMs: [0, 1500, 10],
  cardRevealMs: [100, 2000, 10],
  revealStyle: [0, 1, 1],
  handoffMs: [0, 1200, 10],
  gatherMs: [0, 1200, 10],
  textInMs: [0, 800, 10],
  landFlash: [0, 1, 0.01],
  idleFloat: [0, 12, 0.5],
  idleMs: [1500, 10000, 100],
  hoverDim: [0.3, 1, 0.01],
  beat1Ms: [200, 2000, 10],
  beatGapMs: [0, 1500, 10],
  beat2Ms: [200, 2000, 10],
  slamStrength: [0, 3, 0.05],
  hpDustLife: [0.1, 1.5, 0.05],
  dustAmount: [0, 4, 0.05],
  dustSize: [0.2, 3, 0.05],
  dustLife: [0.3, 3, 0.05],
  dustOpacity: [0, 1, 0.01],
  slamDust: [0, 4, 0.05],
  slamSparks: [0, 3, 0.05],
  pickFadeMs: [60, 1500, 10],
  collapseMs: [60, 800, 10],
  trailAt: [0, 1, 0.05],
  trailTime: [0.4, 2.5, 0.05],
  trailIntensity: [0, 2, 0.05],
  coreGlow: [0, 1, 0.01],
  hitStopMs: [0, 300, 5],
  shakeMs: [0, 1000, 10],
  shakePx: [0, 20, 0.5],
  punchZoom: [0, 0.06, 0.001],
  recoil: [0, 0.4, 0.01],
  burstScale: [0, 3, 0.05],
  impactFlash: [0, 1, 0.01],
  impactFlashMs: [40, 800, 10],
  duckAmount: [0, 1, 0.01],
  duckRampMs: [0, 1500, 10],
  pvInMs: [0, 600, 10],
  pvOutMs: [0, 400, 10],
  pvGraceMs: [0, 400, 10],
  ...(Object.fromEntries(ANCIENT_CUES.flatMap((c) => [
    [`${c}Gain`, [0, 1.5, 0.01]], [`${c}Offset`, [-500, 2000, 10]], [`${c}Rate`, [0.25, 2, 0.01]],
  ])) as Record<`${AncientCue}${'Gain' | 'Offset' | 'Rate'}`, [number, number, number]>),
  crackX: [20, 80, 0.5],
  crackJag: [0, 20, 0.25],
  crackSegs: [2, 20, 1],
  crackEdge: [0, 8, 0.25],
  crackEdgeAlpha: [0, 1, 0.01],
  crackShadow: [0, 1, 0.01],
  crackOpenMs: [0, 1500, 10],
  ...(Object.fromEntries(ANCIENT_ART_IDS.flatMap((id) => [
    [`${id}X`, [-80, 80, 0.5]], [`${id}Y`, [-80, 80, 0.5]], [`${id}S`, [0.3, 3, 0.01]], [`${id}R`, [-180, 180, 0.5]], [`${id}Crack`, [-30, 30, 0.5]],
  ])) as Record<AncientArtKey, [number, number, number]>),
};

const KEY = 'ascent.ancients';
const REV_KEY = 'ascent.ancients.rev';
const REV = 2;
/** The defaults retuned at `REV` (see the loader). */
const RETUNED = ['splitMs', 'shineMs', 'crackOpenMs', 'titleHoldMs', 'revealFadeMs', 'revealDelayMs', 'beatGapMs', 'hitStopMs', 'burstScale', 'trailTime', 'trailIntensity'];
let cfg: AncientsFullConfig = (() => {
  if (!import.meta.env.DEV) return { ...ANCIENTS_DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const s = (saved && typeof saved === 'object' ? { ...(saved as Record<string, unknown>) } : {}) as Record<string, unknown>;
    // A save stores EVERY value, so a save from before a retune would pin the old numbers. When the defaults are
    // retuned, bump `REV` and list the keys: an older save lets exactly those take their new defaults (the owner's
    // other dials are kept). Rev 1 = the 2026-09-27 whole-sequence pass; rev 2 = the reveal pass.
    let rev = 0;
    try { rev = Number(localStorage.getItem(REV_KEY) ?? 0); } catch { /* ignore */ }
    if (rev < REV) { for (const k of RETUNED) delete s[k]; try { localStorage.setItem(REV_KEY, String(REV)); } catch { /* ignore */ } }
    for (const k of ['closeMs', 'pickLiftMs', 'pickFlightMs']) delete s[k]; // retired keys
    return { ...ANCIENTS_DEFAULTS, ...(s as Partial<AncientsFullConfig>) };
  } catch {
    return { ...ANCIENTS_DEFAULTS };
  }
})();

const listeners = new Set<() => void>();
export function getAncientsConfig(): AncientsFullConfig { return cfg; }
export function subscribeAncientsConfig(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }

export function setAncientsValue(key: keyof AncientsFullConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
  for (const fn of listeners) fn();
}
export function resetAncientsConfig(): void {
  cfg = { ...ANCIENTS_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  for (const fn of listeners) fn();
}

/** The meter tuning handed to `enableAncients`. */
export function ancientMeterOverride(): { cost: number; refresh: number; combat: number } {
  return { cost: cfg.cost, refresh: cfg.refresh, combat: cfg.combat };
}

/** The Ancient's colour — the tuner's override, else the sim's colour table. */
export function ancientColor(id: string): string {
  return (cfg as unknown as Record<string, string>)[`${id}Color`] ?? '#c8922e';
}
