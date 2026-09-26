import type { AncientHeroSignature, BloomAccent, MedalEntrance } from './ancientHeroThemes';

/**
 * THE HERO SIGNATURES of the awakening bloom (owner 2026-09-26: "i want to do the bespoke animation + hero power
 * symbol animation for the ancient hero blooms"). A themed hero names an ACCENT (one signature flourish around the
 * medallion) and a MEDAL entrance (the hero power art's own beat) in `ancientHeroThemes.ts`; the motion lives here.
 *
 * Rules (the perf north star):
 *  · WAAPI one-shots on transform / opacity ONLY. Every part is a static-painted layer (its gradient / border never
 *    animates), so the compositor does all the work. Nothing loops; nothing has infinite iterations.
 *  · NO layout reads. Every part is a box the size of the medallion (`inset: 0` in the medallion's wrapper) with its
 *    mark drawn at the centre, so a `translate(%)` is a fraction of the medallion's size, whatever the screen.
 *  · Everything finishes inside the eruption + title hold (`end`), so the cinematic is never longer.
 *
 * `null` (the default theme, every hero without an entry) keeps the generic scale/fade entrance exactly as it was.
 */

/** How many parts each accent renders (the gate's markup reads this; the motion below animates them in order). */
export const ACCENT_PARTS: Record<BloomAccent, number> = { glints: 5, shell: 2, rings: 3, wisps: 14 };
/** The layers a medal entrance carries: INSIDE the medallion (clipped to it, class `anc-medal-<kind>-in`) and/or
 *  OUTSIDE it (round it, class `anc-medal-<kind>`). */
export const MEDAL_LAYERS: Record<MedalEntrance, readonly ('in' | 'out')[]> = { gild: ['in', 'out'], seal: [], thump: ['out'], rise: ['out'] };

interface Timing { eruptionMs: number; titleHoldMs: number }
// Presentation-only jitter (Math.random is banned in core/content/sim, not here).
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
const OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';

/** The generic entrance (the default theme): unchanged from the first bloom. */
const GENERIC: Keyframe[] = [
  { opacity: 0, transform: 'scale(0.6)' }, { opacity: 1, transform: 'scale(1.04)', offset: 0.7 }, { opacity: 1, transform: 'scale(1)' },
];
const MEDAL: Record<MedalEntrance, Keyframe[]> = {
  // Indy: a clean settle; the gild (sheen, rim flash, glints) is struck once it has landed (below).
  gild: [
    { opacity: 0, transform: 'scale(0.7)' }, { opacity: 1, transform: 'scale(1.03)', offset: 0.6 }, { opacity: 1, transform: 'scale(1)' },
  ],
  // Warden: drops in a touch large and SNAPS to size as the Ward shell seals round it.
  seal: [
    { opacity: 0, transform: 'scale(0.7)' }, { opacity: 1, transform: 'scale(1.07)', offset: 0.5 },
    { opacity: 1, transform: 'scale(0.96)', offset: 0.66 }, { opacity: 1, transform: 'scale(1.01)', offset: 0.82 }, { opacity: 1, transform: 'scale(1)' },
  ],
  // Auctioneer: comes down from above like a gavel and strikes: a squash, a rebound, settled.
  thump: [
    { opacity: 0, transform: 'translateY(-14%) scale(1.3)' }, { opacity: 1, transform: 'translateY(0) scale(1)', offset: 0.42, easing: 'cubic-bezier(0.5, 0, 1, 1)' },
    { opacity: 1, transform: 'translateY(2%) scale(1.12, 0.86)', offset: 0.5 }, { opacity: 1, transform: 'translateY(-1%) scale(0.95, 1.06)', offset: 0.66 },
    { opacity: 1, transform: 'translateY(0) scale(1.02, 0.98)', offset: 0.82 }, { opacity: 1, transform: 'translateY(0) scale(1)' },
  ],
  // Risen: rises up from below, overshoots a hair, settles.
  rise: [
    { opacity: 0, transform: 'translateY(48%) scale(0.9)' }, { opacity: 1, transform: 'translateY(-4%) scale(1)', offset: 0.72 }, { opacity: 1, transform: 'translateY(0) scale(1)' },
  ],
};

/** Play the medallion's entrance + its accent inside `wrap` (`.anc-gate-medalwrap`), from the eruption's start. */
export function playHeroBloom(wrap: Element | null | undefined, sig: AncientHeroSignature | null, t: Timing): void {
  if (!wrap) return;
  const medal = wrap.querySelector('.anc-gate-medal');
  const d = t.eruptionMs * 0.35; // the medallion starts once the curtain is a third open
  const D = t.eruptionMs + 260;
  const end = t.eruptionMs + t.titleHoldMs - 80; // everything is done before the reveal
  const fit = (delay: number, dur: number): number => Math.max(160, Math.min(dur, end - delay));
  medal?.animate(sig ? MEDAL[sig.medal] : GENERIC, { duration: D, delay: d, easing: OUT, fill: 'both' });
  if (!sig) return;
  const layer = wrap.querySelector(`.anc-medal-${sig.medal}`);
  const inner = wrap.querySelector(`.anc-medal-${sig.medal}-in`);
  const parts = Array.from(wrap.querySelectorAll('.anc-acc-p'));
  switch (sig.medal) {
    case 'gild': {
      // STRUCK GOLD: one crisp diagonal gold sheen across the art, and the thin gold rim flashing as it leaves.
      const at = d + D * 0.55;
      inner?.animate([
        { opacity: 0, transform: 'translateX(-250%) rotate(24deg)' }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.85 },
        { opacity: 0, transform: 'translateX(250%) rotate(24deg)' },
      ], { duration: fit(at, 720), delay: at, easing: 'cubic-bezier(0.4, 0, 0.5, 1)', fill: 'both' });
      const flash = at + 420;
      layer?.animate([{ opacity: 0 }, { opacity: 1, offset: 0.14 }, { opacity: 0.35 }],
        { duration: fit(flash, 700), delay: flash, easing: 'ease-out', fill: 'both' });
      break;
    }
    case 'seal': break; // the Ward shell (the accent) is the whole cap; the medallion just snaps in under it
    case 'thump': {
      // The strike's ring, off the rim, at the moment of impact.
      const at = d + D * 0.44;
      layer?.animate([{ opacity: 0.95, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.32)' }],
        { duration: fit(at, 360), delay: at, easing: 'ease-out', fill: 'both' });
      break;
    }
    case 'rise': {
      // The Rise DOME gathers round it as it rises: one breath of the card's `rebornpulse` (up to full, easing back),
      // and it rests under the title.
      layer?.animate([
        { opacity: 0, transform: 'scale(0.8)' }, { opacity: 1, transform: 'scale(1.03)', offset: 0.55 }, { opacity: 0.5, transform: 'scale(1)' },
      ], { duration: fit(d, D + 300), delay: d, easing: OUT, fill: 'both' });
      break;
    }
  }
  switch (sig.accent) {
    case 'glints': {
      // A few sharp gold glints on the rim, fired in turn as the sheen passes them: pop, turn a quarter, gone.
      const at = d + D * 0.55 + 160;
      const spots: readonly [number, number][] = [[-30, -38], [40, -24], [-46, 10], [30, 36], [4, -50]];
      parts.forEach((p, i) => {
        const [x, y] = spots[i % spots.length]!;
        const delay = at + ((x + y + 90) / 180) * 380; // along the sweep, upper-left to lower-right
        p.animate([
          { opacity: 0, transform: `translate(${x}%, ${y}%) scale(0) rotate(0deg)` },
          { opacity: 1, transform: `translate(${x}%, ${y}%) scale(1) rotate(30deg)`, offset: 0.35 },
          { opacity: 0, transform: `translate(${x}%, ${y}%) scale(0.2) rotate(90deg)` },
        ], { duration: fit(delay, 460), delay, easing: 'cubic-bezier(0.2, 0.8, 0.4, 1)', fill: 'both' });
      });
      break;
    }
    case 'shell': {
      // The WARD GLASS (the in-game shell's look) forms cleanly round the medallion, in from a touch larger; once it
      // has sealed, ONE crisp shine crosses the glass (the shell clips it); then it settles and rests.
      const [shell, shine] = parts;
      const at = d + D * 0.25;
      shell?.animate([
        { opacity: 0, transform: 'scale(1.22)' }, { opacity: 1, transform: 'scale(1)', offset: 0.5 }, { opacity: 0.85, transform: 'scale(1)' },
      ], { duration: fit(at, 1000), delay: at, easing: OUT, fill: 'both' });
      const sweep = at + 440;
      shine?.animate([
        { opacity: 0, transform: 'translate(-50%, -50%) translateX(-260%) rotate(28deg)' }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.78 },
        { opacity: 0, transform: 'translate(-50%, -50%) translateX(260%) rotate(28deg)' },
      ], { duration: fit(sweep, 540), delay: sweep, easing: 'cubic-bezier(0.45, 0, 0.3, 1)', fill: 'both', pseudoElement: '::after' });
      break;
    }
    case 'rings': {
      // Gavel-strike shock rings: three, from the impact, pulsing out like a Shout.
      const at = d + D * 0.44;
      parts.forEach((p, i) => {
        const delay = at + i * 170;
        p.animate([{ opacity: 0, transform: 'scale(0.95)' }, { opacity: 0.95 - i * 0.18, transform: 'scale(1.05)', offset: 0.08 }, { opacity: 0, transform: `scale(${2.3 - i * 0.25})` }],
          { duration: fit(delay, 760), delay, easing: 'cubic-bezier(0.1, 0.6, 0.3, 1)', fill: 'both' });
      });
      break;
    }
    case 'wisps': {
      // The Rise aura's thin wisps (the card's `rebornwisp` motion: rise, stretch taller, narrow, fade), round the
      // medallion's rim, behind it: an aura of spirit streaks climbing off the power.
      const at = d + D * 0.2;
      parts.forEach((p, i) => {
        const a = ((i % 7) / 7) * Math.PI + rnd(-0.15, 0.15); // spread across the lower half of the rim
        const x0 = Math.cos(a) * rnd(40, 56) * (i < 7 ? 1 : -1), y0 = Math.sin(a) * 30 + 10, sway = rnd(-10, 10), climb = rnd(80, 130);
        const delay = at + i * 45 + rnd(0, 90);
        p.animate([
          { opacity: 0, transform: `translate(${x0.toFixed(1)}%, ${y0.toFixed(1)}%) scale(0.9, 0.7)` },
          { opacity: 1, transform: `translate(${(x0 + sway * 0.3).toFixed(1)}%, ${(y0 - climb * 0.25).toFixed(1)}%) scale(0.85, 1)`, offset: 0.22 },
          { opacity: 0, transform: `translate(${(x0 + sway).toFixed(1)}%, ${(y0 - climb).toFixed(1)}%) scale(0.7, 1.25)` },
        ], { duration: fit(delay, rnd(950, 1200)), delay, easing: 'ease-in-out', fill: 'both' });
      });
      break;
    }
  }
}
