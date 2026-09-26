import type { AncientHeroSignature, BloomKnobs, MedalEntrance } from './ancientHeroThemes';

/**
 * THE BLOOM STYLES of the awakening (owner 2026-09-26: "the bespoke animation + hero power symbol animation for the
 * ancient hero blooms", then "build all 9 styles"). A hero names a STYLE + knobs in `ancientHeroThemes.ts`; this file
 * turns that into the medallion's markup (`bloomMarkup`, rendered by `AncientBloom.tsx`) and its motion
 * (`playHeroBloom`). The static paint of every layer lives in `ancients.css`.
 *
 * Rules (the perf north star):
 *  · WAAPI one-shots on transform / opacity ONLY. Every part is a static-painted layer (its gradient / border / SVG
 *    never animates), so the compositor does all the work. Nothing loops; nothing has infinite iterations.
 *  · NO layout reads. Every part is a box sized in % of the medallion with its mark drawn inside, so a translate(%) or
 *    a rotate is relative to the medallion, whatever the screen.
 *  · Everything finishes inside the eruption + title hold (`end`), so the cinematic is never longer.
 *  · Owner taste: clean. Thin lines, crisp sheens, restrained rings, soft motion; no bounce, no confetti, no bubbles.
 *
 * `null` (the default theme) keeps the generic scale/fade entrance exactly as it was.
 *
 * The approved four (Indy, the Warden, the Auctioneer, Risen) are the original accents under their style names, with
 * the same markup, keyframes and timings as before this refactor.
 */

/** One part of an accent layer. Rendered as `<i class="anc-acc-p p<i> <cls>" style=…>` with an optional inner SVG or
 *  the medallion's art. `pos` places a small part round the medallion (left/top, % of the medallion). */
export interface BloomPart {
  cls?: string;
  pos?: { x: number; y: number };
  svg?: BloomSvg;
  img?: boolean;
}
export type BloomSvg =
  | { kind: 'dial'; bright?: boolean }
  | { kind: 'jag' }
  | { kind: 'glyph'; i: number; rot: number }
  | { kind: 'vine'; rot: number; flip: boolean }
  | { kind: 'arc'; r: number; from: number; to: number; dots?: boolean }
  | { kind: 'crown' };
export interface BloomLayer { name: string; cls?: string; parts: BloomPart[] }
export interface BloomMarkup {
  /** Extra classes on `.anc-gate-medalwrap`. */
  wrapCls: string;
  medal: MedalEntrance;
  /** Layers OUTSIDE the medallion (round it), before it in the markup. */
  out: string[];
  /** Layers INSIDE the medallion (clipped to it). */
  in: string[];
  /** Accent layers (`.anc-acc anc-acc-<name>`), after the medallion. */
  layers: BloomLayer[];
}

const n = (k: BloomKnobs['count'], fallback: number): number => k ?? fallback;
const parts = (count: number, make?: (i: number) => BloomPart): BloomPart[] => Array.from({ length: count }, (_, i) => (make ? make(i) : {}));
/** A point round the medallion: clock angle (0 = top, clockwise) at radius r (% of the medallion). */
const onRim = (deg: number, r: number): { x: number; y: number } => {
  const a = (deg * Math.PI) / 180;
  return { x: +(50 + r * Math.sin(a)).toFixed(2), y: +(50 - r * Math.cos(a)).toFixed(2) };
};
const ETCH_GLYPHS = 12;
const SCRIPT_GLYPHS = 9;
/** The script line's clock angles: over the top of the rim, left to right (300 degrees round to 420), clear of the
 *  title under the medallion. */
const scriptAngle = (i: number): number => 300 + (i * 120) / (SCRIPT_GLYPHS - 1);
const VINE_ANGLES: readonly [number, boolean][] = [[200, true], [160, false], [235, true], [125, false], [270, true], [90, false], [305, true], [55, false]];

/** The markup a signature needs (the gate renders it; `playHeroBloom` animates it). */
export function bloomMarkup(sig: AncientHeroSignature | null): BloomMarkup | null {
  if (!sig) return null;
  const k = sig.knobs;
  const tintable = sig.style === 'coinStrike' || sig.style === 'glassShell' || sig.style === 'spiritRise';
  const tint = tintable && !k.baked ? ' tint' : '';
  const sheenIn = k.sheen && sig.style !== 'coinStrike' ? ['anc-medal-fx anc-medal-sheen-in'] : [];
  const m = (medal: MedalEntrance, accent: string, rest: Omit<BloomMarkup, 'medal' | 'wrapCls'>, extraCls = ''): BloomMarkup => ({
    wrapCls: `acc-${accent} med-${medal}${tint}${extraCls}`, medal, ...rest, in: [...rest.in, ...sheenIn],
  });
  switch (sig.style) {
    case 'coinStrike': {
      const extra: BloomLayer[] = [];
      if (k.extra === 'coinRise') extra.push({ name: 'extra', cls: 'k-coinrise', parts: parts(1) });
      if (k.extra === 'coinArcs') extra.push({ name: 'extra', cls: 'k-coinarcs', parts: parts(3) });
      if (k.extra === 'gem') extra.push({ name: 'extra', cls: 'k-gem', parts: parts(1) });
      if (k.extra === 'tagSlash') extra.push({ name: 'extra', cls: 'k-slash', parts: parts(1) });
      return m('gild', 'glints', {
        out: ['anc-medal-fx anc-medal-gild'],
        in: ['anc-medal-fx anc-medal-gild-in', ...(n(k.count, 1) >= 2 ? ['anc-medal-fx anc-medal-gild-in s2'] : [])],
        layers: [{ name: 'glints', parts: parts(5) }, ...extra],
      });
    }
    case 'starGlint':
      return m('settle', 'star', { out: [], in: [], layers: [{ name: 'star', parts: parts(1) }] });
    case 'cardFan':
      return m('settle', 'fan', { out: [], in: [], layers: [{ name: 'fan', cls: k.tall ? 'k-tall' : undefined, parts: parts(n(k.count, 2)) }] });
    case 'strikeRings': {
      const medal = k.medal ?? 'settle';
      const extra: BloomLayer[] = [];
      if (k.extra === 'anvil') extra.push({ name: 'sparks', parts: parts(6) });
      if (k.extra === 'blade') extra.push({ name: 'extra', cls: 'k-blade', parts: parts(1) });
      return m(medal, 'rings', {
        out: medal === 'thump' ? ['anc-medal-fx anc-medal-thump'] : [],
        in: [],
        layers: [{ name: 'rings', cls: k.jagged ? 'k-jagged' : undefined, parts: parts(n(k.count, 3), () => (k.jagged ? { svg: { kind: 'jag' } } : {})) }, ...extra],
      });
    }
    case 'collapse':
      return m('settle', 'collapse', { out: [], in: [], layers: [{ name: 'collapse', parts: parts(3) }] });
    case 'spiritRise':
      return m('rise', 'wisps', { out: ['anc-medal-fx anc-medal-rise'], in: [], layers: [{ name: 'wisps', cls: k.embers ? 'k-embers' : undefined, parts: parts(14) }] });
    case 'clockDial':
      return m('settle', 'dial', {
        out: [], in: [],
        layers: [{ name: 'dial', parts: [
          { cls: 'd-ring', svg: { kind: 'dial' } }, { cls: 'd-hi', svg: { kind: 'dial', bright: true } }, { cls: 'd-ptr' },
          ...(k.pip ? [{ cls: 'd-pip' }] : []),
        ] }],
      });
    case 'glassShell':
      return m(k.medal ?? 'settle', 'shell', {
        out: [], in: [],
        layers: [{ name: 'shell', parts: parts(2) }, ...(k.extra === 'crown' ? [{ name: 'extra', cls: 'k-crown', parts: [{ svg: { kind: 'crown' } } as BloomPart] }] : [])],
      }, k.mirror ? ' k-mirror' : '');
    case 'runeEtch': {
      const glyphRing = (r: number, offset: number): BloomPart[] => parts(ETCH_GLYPHS, (i) => {
        const deg = (i * 360) / ETCH_GLYPHS;
        return { cls: 'g', pos: onRim(deg, r), svg: { kind: 'glyph', i: i + offset, rot: deg } };
      });
      const layers: BloomLayer[] = k.script
        ? [{ name: 'etch', cls: 'k-script', parts: [
            { cls: 'e-line', svg: { kind: 'arc', r: 56, from: 300, to: 420 } }, { cls: 'e-pen' },
            ...parts(SCRIPT_GLYPHS, (i) => ({ cls: 'g', pos: onRim(scriptAngle(i), 64), svg: { kind: 'glyph', i, rot: scriptAngle(i) } })),
          ] }]
        : [
            { name: 'etch', parts: [{ cls: 'e-line' }, { cls: 'e-pen' }, ...glyphRing(64, 0)] },
            ...(k.double ? [{ name: 'etch', cls: 'k-outer', parts: [{ cls: 'e-line' }, { cls: 'e-pen' }, ...glyphRing(78, 3)] }] : []),
          ];
      return m('settle', 'etch', { out: [], in: [], layers }, k.flicker ? ' k-flicker' : '');
    }
    case 'vines':
      return m('settle', 'vines', { out: [], in: [], layers: [{ name: 'vines', parts: VINE_ANGLES.map(([deg, flip]) => ({ pos: onRim(deg, 60), svg: { kind: 'vine', rot: deg, flip } })) }] });
    case 'echoCopy':
      return m('settle', 'echo', {
        out: [], in: [],
        layers: [{ name: 'echo', cls: k.streak ? 'k-streak' : k.crisp ? 'k-crisp' : undefined, parts: parts(n(k.count, 1), () => ({ img: true })) }],
      });
    case 'swapArcs': {
      const pts = k.three ? 3 : 2;
      const arcs = parts(pts, (i) => ({ cls: 'a', svg: { kind: 'arc', r: k.three ? 44 : i === 0 ? 45 : 40, from: k.three ? -22 : -50, to: k.three ? 22 : 50, dots: true } }));
      return m('settle', 'swap', { out: [], in: [], layers: [{ name: 'swap', parts: [...arcs, ...(k.tether ? [{ cls: 's-tether' }] : [])] }] });
    }
  }
}

interface Timing { eruptionMs: number; titleHoldMs: number }
// Presentation-only jitter (Math.random is banned in core/content/sim, not here).
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
const OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';

/** The generic entrance (the default theme): unchanged from the first bloom. */
const GENERIC: Keyframe[] = [
  { opacity: 0, transform: 'scale(0.6)' }, { opacity: 1, transform: 'scale(1.04)', offset: 0.7 }, { opacity: 1, transform: 'scale(1)' },
];
const SETTLE: Keyframe[] = [
  { opacity: 0, transform: 'scale(0.7)' }, { opacity: 1, transform: 'scale(1.03)', offset: 0.6 }, { opacity: 1, transform: 'scale(1)' },
];
const MEDAL: Record<MedalEntrance, Keyframe[]> = {
  // Every new style: a clean fade and a soft settle (no bounce).
  settle: SETTLE,
  // Indy: the same clean settle; the gild (sheen, rim flash, glints) is struck once it has landed (below).
  gild: SETTLE,
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
/** The crisp diagonal sheen (Indy's gild, and every `sheen` knob): across the art, clipped by the medallion. */
const SHEEN: Keyframe[] = [
  { opacity: 0, transform: 'translateX(-250%) rotate(24deg)' }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.85 },
  { opacity: 0, transform: 'translateX(250%) rotate(24deg)' },
];
const SHEEN_EASE = 'cubic-bezier(0.4, 0, 0.5, 1)';

/** Play the medallion's entrance + its accent inside `wrap` (`.anc-gate-medalwrap`), from the eruption's start. */
export function playHeroBloom(wrap: Element | null | undefined, sig: AncientHeroSignature | null, t: Timing): void {
  if (!wrap) return;
  const mk = bloomMarkup(sig);
  const medal = wrap.querySelector('.anc-gate-medal');
  const d = t.eruptionMs * 0.35; // the medallion starts once the curtain is a third open
  const D = t.eruptionMs + 260;
  const end = t.eruptionMs + t.titleHoldMs - 80; // everything is done before the reveal
  const fit = (delay: number, dur: number): number => Math.max(160, Math.min(dur, end - delay));
  const shot = (el: Element | null | undefined, k: Keyframe[], delay: number, dur: number, easing: string, extra?: Partial<KeyframeAnimationOptions>): void => {
    el?.animate(k, { duration: fit(delay, dur), delay, easing, fill: 'both', ...extra });
  };
  medal?.animate(mk ? MEDAL[mk.medal] : GENERIC, { duration: D, delay: d, easing: OUT, fill: 'both' });
  if (!sig || !mk) return;
  const k = sig.knobs;
  const layer = wrap.querySelector(`.anc-medal-${mk.medal}`);
  const inner = wrap.querySelector(`.anc-medal-${mk.medal}-in`);
  const all = (sel: string): Element[] => Array.from(wrap.querySelectorAll(sel));
  // The medallion's own layers (the approved four's entrances), exactly as before.
  switch (mk.medal) {
    case 'gild': {
      // STRUCK GOLD: one crisp diagonal gold sheen across the art, and the thin gold rim flashing as it leaves.
      const at = d + D * 0.55;
      inner?.animate(SHEEN, { duration: fit(at, 720), delay: at, easing: SHEEN_EASE, fill: 'both' });
      const flash = at + 420;
      layer?.animate([{ opacity: 0 }, { opacity: 1, offset: 0.14 }, { opacity: 0.35 }],
        { duration: fit(flash, 700), delay: flash, easing: 'ease-out', fill: 'both' });
      // A: the second sheen (Midas), narrower, a beat behind the first.
      shot(wrap.querySelector('.anc-medal-gild-in.s2'), SHEEN, at + 200, 640, SHEEN_EASE);
      break;
    }
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
    default: break; // settle / seal: the medallion's own motion is the whole entrance
  }
  // The `sheen` knob: one crisp sheen once the medallion has landed.
  shot(wrap.querySelector('.anc-medal-sheen-in'), SHEEN, d + D * 0.6, 720, SHEEN_EASE);

  switch (sig.style) {
    case 'coinStrike': {
      // A few sharp glints on the rim, fired in turn as the sheen passes them: pop, turn a quarter, gone.
      const at = d + D * 0.55 + 160;
      const spots: readonly [number, number][] = [[-30, -38], [40, -24], [-46, 10], [30, 36], [4, -50]];
      all('.anc-acc-glints .anc-acc-p').forEach((p, i) => {
        const [x, y] = spots[i % spots.length]!;
        const delay = at + ((x + y + 90) / 180) * 380; // along the sweep, upper-left to lower-right
        p.animate([
          { opacity: 0, transform: `translate(${x}%, ${y}%) scale(0) rotate(0deg)` },
          { opacity: 1, transform: `translate(${x}%, ${y}%) scale(1) rotate(30deg)`, offset: 0.35 },
          { opacity: 0, transform: `translate(${x}%, ${y}%) scale(0.2) rotate(90deg)` },
        ], { duration: fit(delay, 460), delay, easing: 'cubic-bezier(0.2, 0.8, 0.4, 1)', fill: 'both' });
      });
      const ex = all('.anc-acc-extra .anc-acc-p');
      if (k.extra === 'coinRise') {
        // One thin coin rises out from behind the medallion, turning on its edge as it climbs, and fades above it.
        shot(ex[0], [
          { opacity: 0, transform: 'translate(0%, 30%) scaleX(1)' }, { opacity: 1, transform: 'translate(0%, -24%) scaleX(0.3)', offset: 0.3 },
          { opacity: 1, transform: 'translate(0%, -52%) scaleX(1)', offset: 0.55 }, { opacity: 0.8, transform: 'translate(0%, -70%) scaleX(0.35)', offset: 0.8 },
          { opacity: 0, transform: 'translate(0%, -82%) scaleX(1)' },
        ], d + D * 0.35, 1150, 'cubic-bezier(0.3, 0.2, 0.3, 1)');
      } else if (k.extra === 'coinArcs') {
        // Three thin coins arc over the top of the medallion, left to right, one after another.
        ex.forEach((p, i) => {
          const path = [160, 125, 90, 55, 20].map((deg) => { const a = (deg * Math.PI) / 180; return `translate(${(-Math.cos(a) * 68).toFixed(1)}%, ${(-Math.sin(a) * 68).toFixed(1)}%)`; });
          shot(p, [
            { opacity: 0, transform: `${path[0]} scaleX(1)` }, { opacity: 1, transform: `${path[1]} scaleX(0.4)`, offset: 0.25 },
            { opacity: 1, transform: `${path[2]} scaleX(1)`, offset: 0.5 }, { opacity: 1, transform: `${path[3]} scaleX(0.4)`, offset: 0.75 },
            { opacity: 0, transform: `${path[4]} scaleX(1)` },
          ], d + D * 0.5 + i * 170, 820, 'linear');
        });
      } else if (k.extra === 'gem') {
        // One gem glint on the upper-right rim after the sheen: a thin diamond that catches and goes.
        shot(ex[0], [
          { opacity: 0, transform: 'translate(34%, -34%) rotate(45deg) scale(0.2)' }, { opacity: 1, transform: 'translate(34%, -34%) rotate(45deg) scale(1)', offset: 0.3 },
          { opacity: 0, transform: 'translate(34%, -34%) rotate(45deg) scale(0.85)' },
        ], d + D * 0.55 + 440, 620, 'cubic-bezier(0.2, 0.8, 0.4, 1)');
      } else if (k.extra === 'tagSlash') {
        // A thin price-tag slash cuts across the medallion and fades.
        shot(ex[0], [
          { opacity: 0, transform: 'rotate(-28deg) scaleX(0)' }, { opacity: 1, transform: 'rotate(-28deg) scaleX(1)', offset: 0.22 },
          { opacity: 0.9, transform: 'rotate(-28deg) scaleX(1)', offset: 0.6 }, { opacity: 0, transform: 'rotate(-28deg) scaleX(1)' },
        ], d + D * 0.55 + 300, 700, 'cubic-bezier(0.2, 0.8, 0.3, 1)');
      }
      break;
    }
    case 'starGlint': {
      // ONE clean four-point glint on the upper-right rim: it opens, turns a touch, and closes.
      shot(all('.anc-acc-star .anc-acc-p')[0], [
        { opacity: 0, transform: 'translate(30%, -30%) scale(0) rotate(-30deg)' }, { opacity: 1, transform: 'translate(30%, -30%) scale(1) rotate(0deg)', offset: 0.3 },
        { opacity: 0.9, transform: 'translate(30%, -30%) scale(0.95) rotate(8deg)', offset: 0.6 }, { opacity: 0, transform: 'translate(30%, -30%) scale(0.3) rotate(20deg)' },
      ], d + D * 0.6, 1000, 'cubic-bezier(0.3, 0.1, 0.3, 1)');
      break;
    }
    case 'cardFan': {
      // Thin card OUTLINES fan out from behind the medallion like a hand being shown, then fade.
      const cards = all('.anc-acc-fan .anc-acc-p');
      const fan: Record<number, number[]> = { 1: [0], 2: [-14, 14], 3: [-22, 0, 22] };
      const angles = fan[cards.length] ?? fan[3]!;
      const lift = k.tall ? 36 : 40;
      cards.forEach((p, i) => {
        const a = angles[i] ?? 0;
        shot(p, [
          { opacity: 0, transform: 'rotate(0deg) translateY(6%) scale(0.94)' },
          { opacity: 1, transform: `rotate(${a}deg) translateY(-${lift}%) scale(1)`, offset: 0.35 },
          { opacity: 0.9, transform: `rotate(${a * 1.08}deg) translateY(-${lift + 3}%) scale(1)`, offset: 0.72 },
          { opacity: 0, transform: `rotate(${a * 1.14}deg) translateY(-${lift + 6}%) scale(1)` },
        ], d + D * 0.3 + Math.abs(a) * 3, 1200, 'cubic-bezier(0.25, 0.7, 0.3, 1)');
      });
      break;
    }
    case 'strikeRings': {
      const rings = all('.anc-acc-rings .anc-acc-p');
      const rhythm = k.rhythm ?? 'shout';
      const at = d + D * 0.44;
      if (rhythm === 'shout') {
        // The Auctioneer's gavel-strike shock rings: three, from the impact, pulsing out like a Shout.
        rings.forEach((p, i) => {
          const delay = at + i * 170;
          p.animate([{ opacity: 0, transform: 'scale(0.95)' }, { opacity: 0.95 - i * 0.18, transform: 'scale(1.05)', offset: 0.08 }, { opacity: 0, transform: `scale(${2.3 - i * 0.25})` }],
            { duration: fit(delay, 760), delay, easing: 'cubic-bezier(0.1, 0.6, 0.3, 1)', fill: 'both' });
        });
      } else if (rhythm === 'drum') {
        // Even drumbeats: equal thin rings, evenly spaced.
        rings.forEach((p, i) => shot(p, [{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 0.85, transform: 'scale(1.03)', offset: 0.08 }, { opacity: 0, transform: 'scale(1.9)' }],
          at + i * 280, 640, 'cubic-bezier(0.1, 0.6, 0.3, 1)'));
      } else {
        // One sharp blast: fast and wide.
        rings.forEach((p, i) => shot(p, [{ opacity: 0, transform: 'scale(0.92)' }, { opacity: 1, transform: 'scale(1.02)', offset: 0.05 }, { opacity: 0, transform: `scale(${2.8 - i * 0.4})` }],
          at + i * 90, 520, 'cubic-bezier(0.05, 0.7, 0.2, 1)'));
      }
      // Anvil: a few short straight sparks fly off the rim with the blast.
      all('.anc-acc-sparks .anc-acc-p').forEach((p, i) => {
        const a = -70 + i * 28 + (i % 2 ? 6 : -6);
        shot(p, [{ opacity: 0, transform: `rotate(${a}deg) translateY(-50%) scaleY(0.4)` }, { opacity: 1, transform: `rotate(${a}deg) translateY(-62%) scaleY(1)`, offset: 0.2 },
          { opacity: 0, transform: `rotate(${a}deg) translateY(-92%) scaleY(0.6)` }], at + 20, 420, 'cubic-bezier(0.1, 0.7, 0.3, 1)');
      });
      // Blade: one thin blade glint crosses the medallion after the rings.
      if (k.extra === 'blade') {
        shot(all('.anc-acc-extra .anc-acc-p')[0], [
          { opacity: 0, transform: 'rotate(-35deg) translateX(-30%) scaleX(0.2)' }, { opacity: 1, transform: 'rotate(-35deg) translateX(0%) scaleX(1)', offset: 0.3 },
          { opacity: 0, transform: 'rotate(-35deg) translateX(30%) scaleX(0.5)' },
        ], at + 420, 520, 'cubic-bezier(0.3, 0.1, 0.3, 1)');
      }
      break;
    }
    case 'collapse': {
      // A thin ring collapses inward onto the medallion's rim (a second, fainter one just behind it); the rim flashes
      // once as they land.
      const [r0, r1, flash] = all('.anc-acc-collapse .anc-acc-p');
      const at = d + D * 0.1;
      const dur = 760;
      shot(r0, [{ opacity: 0, transform: 'scale(2.6)' }, { opacity: 0.9, transform: 'scale(2.1)', offset: 0.22 }, { opacity: 1, transform: 'scale(1)', offset: 0.92 }, { opacity: 0, transform: 'scale(0.98)' }],
        at, dur, 'cubic-bezier(0.5, 0, 0.8, 0.5)');
      shot(r1, [{ opacity: 0, transform: 'scale(3.2)' }, { opacity: 0.5, transform: 'scale(2.6)', offset: 0.22 }, { opacity: 0.6, transform: 'scale(1)', offset: 0.92 }, { opacity: 0, transform: 'scale(0.98)' }],
        at + 130, dur, 'cubic-bezier(0.5, 0, 0.8, 0.5)');
      shot(flash, [{ opacity: 0, transform: 'scale(1)' }, { opacity: 1, transform: 'scale(1.01)', offset: 0.15 }, { opacity: 0, transform: 'scale(1.05)' }],
        at + 130 + dur * 0.9, 560, 'ease-out');
      break;
    }
    case 'spiritRise': {
      // The Rise aura's thin wisps (the card's `rebornwisp` motion: rise, stretch taller, narrow, fade), round the
      // medallion's rim, behind it: an aura of spirit streaks climbing off the power. (Embers: small warm points.)
      const at = d + D * 0.2;
      all('.anc-acc-wisps .anc-acc-p').forEach((p, i) => {
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
    case 'clockDial': {
      // A thin dial ring with tick marks fades in a notch and a half back, eases round a notch, holds, then CLICKS the
      // last notch home: a brighter copy of the ring flashes once (the click), and the pip lights if it has one.
      const ring = wrap.querySelector('.anc-acc-dial .d-ring');
      const at = d + D * 0.2;
      const dur = fit(at, 1350);
      const e = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
      ring?.animate([
        { opacity: 0, transform: 'rotate(-30deg) scale(1.04)', easing: e }, { opacity: 1, transform: 'rotate(-15deg) scale(1)', offset: 0.28 },
        { opacity: 1, transform: 'rotate(-15deg) scale(1)', offset: 0.52, easing: 'cubic-bezier(0.6, 0, 0.9, 0.6)' }, { opacity: 1, transform: 'rotate(0deg) scale(1)', offset: 0.57 },
        { opacity: 0.9, transform: 'rotate(0deg) scale(1)', offset: 0.84 }, { opacity: 0, transform: 'rotate(0deg) scale(1)' },
      ], { duration: dur, delay: at, easing: 'linear', fill: 'both' });
      const click = at + dur * 0.57;
      shot(wrap.querySelector('.anc-acc-dial .d-ptr'), [{ opacity: 0 }, { opacity: 1, offset: 0.28 }, { opacity: 1, offset: 0.84 }, { opacity: 0 }], at, dur, 'linear');
      shot(wrap.querySelector('.anc-acc-dial .d-hi'), [{ opacity: 0 }, { opacity: 1, offset: 0.18 }, { opacity: 0 }], click - 20, 340, 'ease-out');
      shot(wrap.querySelector('.anc-acc-dial .d-pip'), [{ opacity: 0, transform: 'scale(0.6)' }, { opacity: 1, transform: 'scale(1)', offset: 0.15 }, { opacity: 1, offset: 0.6 }, { opacity: 0, transform: 'scale(1)' }],
        click, 760, 'ease-out');
      break;
    }
    case 'glassShell': {
      // The WARD GLASS (the in-game shell's look) forms cleanly round the medallion, in from a touch larger; once it
      // has sealed, ONE crisp shine crosses the glass (the shell clips it); then it settles and rests.
      const [shell, shine] = all('.anc-acc-shell .anc-acc-p');
      const at = d + D * 0.25;
      shell?.animate([
        { opacity: 0, transform: 'scale(1.22)' }, { opacity: 1, transform: 'scale(1)', offset: 0.5 }, { opacity: 0.85, transform: 'scale(1)' },
      ], { duration: fit(at, 1000), delay: at, easing: OUT, fill: 'both' });
      const sweep = at + 440;
      shine?.animate([
        { opacity: 0, transform: 'translate(-50%, -50%) translateX(-260%) rotate(28deg)' }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.78 },
        { opacity: 0, transform: 'translate(-50%, -50%) translateX(260%) rotate(28deg)' },
      ], { duration: fit(sweep, 540), delay: sweep, easing: 'cubic-bezier(0.45, 0, 0.3, 1)', fill: 'both', pseudoElement: '::after' });
      // Crown: a small thin crown settles onto the top of the shell as it seals.
      shot(all('.anc-acc-extra .anc-acc-p')[0], [{ opacity: 0, transform: 'translateY(-14%)' }, { opacity: 1, transform: 'translateY(0%)', offset: 0.5 }, { opacity: 0.9, transform: 'translateY(0%)' }],
        at + 300, 800, OUT);
      break;
    }
    case 'runeEtch': {
      // A pen of light runs round the ring; each glyph etches in as the pen passes it and the thin ring line fades up
      // behind. (Double: a second, wider ring turns the other way. Script: one line of glyphs over the top of the rim.)
      const at = d + D * 0.3;
      const flicker = !!k.flicker;
      Array.from(wrap.querySelectorAll('.anc-acc-etch')).forEach((ring, ri) => {
        const script = ring.classList.contains('k-script');
        const start = at + ri * 160;
        const dur = script ? 760 : 920;
        const dir = ri % 2 ? -1 : 1;
        const [from, to] = script ? [300, 420] : [0, 360 * dir];
        shot(ring.querySelector('.e-pen'), [
          { opacity: 0, transform: `rotate(${from}deg)` }, { opacity: 1, offset: 0.08 }, { opacity: 1, offset: 0.9 }, { opacity: 0, transform: `rotate(${to}deg)` },
        ], start, dur, 'linear');
        shot(ring.querySelector('.e-line'), [{ opacity: 0 }, { opacity: script ? 0.55 : 0.45 }], start, dur, 'ease-in');
        const glyphs = Array.from(ring.querySelectorAll('.g'));
        glyphs.forEach((g, i) => {
          const frac = script ? i / (glyphs.length - 1) : (dir > 0 ? i : (glyphs.length - i) % glyphs.length) / glyphs.length;
          const delay = start + frac * dur * 0.9;
          shot(g, flicker
            ? [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 0.15, offset: 0.3 }, { opacity: 0.9, offset: 0.45 }, { opacity: 0.3, offset: 0.6 }, { opacity: 0.95 }]
            : [{ opacity: 0, transform: 'scale(0.7)' }, { opacity: 1, transform: 'scale(1)', offset: 0.45 }, { opacity: 0.9, transform: 'scale(1)' }],
          delay, flicker ? 420 : 300, 'ease-out');
        });
      });
      break;
    }
    case 'vines': {
      // Thin vine lines grow up both sides of the rim from the bottom, a segment at a time, and rest.
      const at = d + D * 0.3;
      all('.anc-acc-vines .anc-acc-p').forEach((p, i) => {
        const step = Math.floor(i / 2);
        shot(p, [{ opacity: 0, transform: 'scale(0.4)' }, { opacity: 1, transform: 'scale(1)', offset: 0.6 }, { opacity: 0.9, transform: 'scale(1)' }],
          at + step * 170, 460, 'cubic-bezier(0.2, 0.7, 0.3, 1)');
      });
      break;
    }
    case 'echoCopy': {
      // A faint copy of the medallion slides out from behind it and merges back (a pair parts left and right; three
      // spread out). Crisp: it snaps out and back like a photocopy. Streak: it smears out fast with a motion streak.
      const echoes = all('.anc-acc-echo .anc-acc-p');
      const off: Record<number, [number, number][]> = { 1: [[16, -8]], 2: [[-20, 0], [20, 0]], 3: [[-16, -8], [16, -8], [0, 16]] };
      const dirs = off[echoes.length] ?? off[3]!;
      const at = d + D * 0.45;
      echoes.forEach((p, i) => {
        const [x, y] = dirs[i] ?? [0, 0];
        const T = (tx: number, ty: number, sx = 1): string => `translate(${tx}%, ${ty}%) scaleX(${sx})`;
        if (k.crisp) {
          shot(p, [{ opacity: 0, transform: T(0, 0) }, { opacity: 0.8, transform: T(x, y), offset: 0.02 }, { opacity: 0.8, transform: T(x, y), offset: 0.6 },
            { opacity: 0, transform: T(0, 0), offset: 0.62 }, { opacity: 0, transform: T(0, 0) }], at + i * 60, 900, 'linear');
        } else if (k.streak) {
          shot(p, [{ opacity: 0, transform: T(0, 0) }, { opacity: 0.75, transform: T(x * 1.6, y, 1.2), offset: 0.22 }, { opacity: 0.6, transform: T(x * 1.6, y), offset: 0.55 },
            { opacity: 0, transform: T(0, 0) }], at + i * 60, 900, 'cubic-bezier(0.3, 0, 0.3, 1)');
        } else {
          const quick = !!k.quick;
          shot(p, [{ opacity: 0, transform: T(0, 0) }, { opacity: 0.75, transform: T(x, y), offset: 0.35 }, { opacity: 0.7, transform: T(x, y), offset: 0.6 },
            { opacity: 0, transform: T(0, 0) }], at + i * (quick ? 80 : 0), quick ? 620 : 1000, 'cubic-bezier(0.45, 0, 0.3, 1)');
        }
      });
      break;
    }
    case 'swapArcs': {
      // Two thin arcs trade places round the medallion (three points each move on to the next; a tether spins with
      // them), then fade.
      const arcs = all('.anc-acc-swap .a');
      const at = d + D * 0.3;
      const turn = arcs.length === 3 ? 120 : 180;
      const same = arcs.length === 3 || !!wrap.querySelector('.s-tether');
      arcs.forEach((p, i) => {
        const base = (i * 360) / arcs.length;
        const to = base + (same || i === 0 ? turn : -turn);
        shot(p, [{ opacity: 0, transform: `rotate(${base}deg)` }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.8 }, { opacity: 0, transform: `rotate(${to}deg)` }],
          at, 1150, 'cubic-bezier(0.55, 0, 0.35, 1)');
      });
      shot(wrap.querySelector('.anc-acc-swap .s-tether'), [{ opacity: 0, transform: 'rotate(0deg)' }, { opacity: 0.8, offset: 0.2 }, { opacity: 0.8, offset: 0.8 }, { opacity: 0, transform: `rotate(${turn}deg)` }],
        at, 1150, 'cubic-bezier(0.55, 0, 0.35, 1)');
      break;
    }
  }
}
