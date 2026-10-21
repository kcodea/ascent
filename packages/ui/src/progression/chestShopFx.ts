/**
 * THE CHEST SHOP'S CELEBRATIONS (2026-10-20; spec docs/superpowers/specs/2026-10-20-chest-shop-screen-design.md,
 * "Selecting a chest: escalating by tier" and "The toggle"; ported from the approved mockup's `popChest` / `pop`).
 * Owner: "make selecting each of the chest rarities increasingly exciting for each rarity", and the focus toggle "SUPER
 * noticeable and fun when you toggle it on".
 *
 * A burst is a handful of transient DOM nodes (rings, sparks, motes) that animate by transform / opacity only (the
 * keyframes live in `chestShop.css`, inside its motion-allowed block) plus a one-shot `data-pop` attribute on the host
 * that the CSS keys the hop, shake, flash and sweep off. The steady "selected" look (the halo, the rays) is pure CSS on
 * `.on`. An ATTRIBUTE, not the mockup's `pop` class: the host is React's, and the pick's own re-render rewrites its
 * `className` (the card turns `.on`) in the same tick, which would wipe a class added here. React never touches an
 * attribute it does not render.
 *
 * SPAM-SAFE: each host keeps the nodes of its LAST burst only. A new burst on the same host first removes the previous
 * one, so rapid clicks never pile nodes up (at most one Ancient burst, 61 nodes, per card). Each node removes itself on
 * its `animationend`, and a timeout fallback removes whatever is left (an animation that never ran: a hidden tab, the
 * motion block not matching).
 *
 * REDUCED MOTION (the page's setting, or the OS one): no nodes, no pop. The sounds still play (they are not motion).
 */
import { sfx } from '../sfx';
import { CHEST_TIERS, type ChestTier } from './crateFx/chestTiers';

export interface PickFx {
  /** Rings blasting out of the chest. */
  rings: number;
  /** Sparks flying out (the headline number: it grows every tier). */
  sparks: number;
  /** How far the sparks fly, in px. */
  reach: number;
  /** Motes rising from the chest's foot. */
  motes: number;
  /** The card shakes: a little (Legendary), hard (Ancient). */
  shake: 'none' | 'small' | 'big';
  /** A white flash over the card. */
  flash: boolean;
  /** A tier-coloured light sweeping across the card. */
  sweep: boolean;
  /** While selected: rays turning slowly behind the chest. */
  rays: boolean;
}

/** Picking a chest: the higher the tier, the bigger the moment (the mockup's table; each tier out-does the one below).
 *  `shake`, `flash`, `sweep` and `rays` are drawn by `chestShop.css` per tier class; `chestShopFx.test.ts` holds the CSS
 *  to exactly this table. */
export const TIER_PICK_FX: Readonly<Record<ChestTier, PickFx>> = Object.freeze({
  standard: { rings: 1, sparks: 6, reach: 50, motes: 0, shake: 'none', flash: false, sweep: false, rays: false },
  rare: { rings: 1, sparks: 10, reach: 65, motes: 0, shake: 'none', flash: false, sweep: false, rays: false },
  epic: { rings: 2, sparks: 18, reach: 90, motes: 6, shake: 'none', flash: false, sweep: true, rays: false },
  legendary: { rings: 2, sparks: 28, reach: 115, motes: 10, shake: 'small', flash: true, sweep: true, rays: true },
  ancient: { rings: 3, sparks: 42, reach: 145, motes: 16, shake: 'big', flash: true, sweep: true, rays: true },
});

/** Switching a focus toggle ON: ~14 gold / white sparks, flying about 46 to 80 px (wider than tall: a pill). */
export const TOGGLE_FX: { readonly sparks: number; readonly reach: number } = Object.freeze({ sparks: 14, reach: 60 });

/** The sparks', rings' and motes' palettes per tier; Ancient (null) is every hue. */
const TIER_COLOURS: Readonly<Record<ChestTier, readonly string[] | null>> = {
  standard: ['#ffffff', '#d6e0ec'],
  rare: ['#5aa8ff', '#a9d2ff', '#ffffff'],
  epic: ['#c07bff', '#e2bfff', '#ffffff'],
  legendary: ['#ffb938', '#ffe08a', '#fff6d6', '#ffffff'],
  ancient: null,
};
/** Ancient's three rings: cyan, pink, opal (its name's colours). */
const ANCIENT_RINGS = ['#8af5ff', '#ff9bf0', '#f4eeff'] as const;
const TOGGLE_COLOURS = ['#fff1c4', '#ffd98a', '#ffb938', '#ffffff'] as const;

const pickFrom = (list: readonly string[]): string => list[Math.floor(Math.random() * list.length)]!;
function tierColour(tier: ChestTier): string {
  const c = TIER_COLOURS[tier];
  return c ? pickFrom(c) : `hsl(${Math.floor(Math.random() * 360)} 95% 75%)`;
}

/** How long a host keeps its `data-pop`: past its longest one-shot (Ancient's 0.85 s hop; the toggle's 0.6 s ring). */
const PICK_POP_MS = 1100;
const TOGGLE_POP_MS = 800;
/** The fallback that removes a burst's last nodes: past the latest node's end (an Ancient mote: 620 ms delay + 1.2 s). */
export const BURST_CLEANUP_MS = 2000;

interface HostBurst { nodes: Set<HTMLElement>; popTimer: ReturnType<typeof setTimeout> | null; cleanupTimer: ReturnType<typeof setTimeout> | null }
const bursts = new WeakMap<HTMLElement, HostBurst>();

function osReducedMotion(): boolean {
  try { return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** Removes the host's previous burst (its nodes, its timers) and returns its fresh record. */
function resetHost(host: HTMLElement): HostBurst {
  let b = bursts.get(host);
  if (!b) { b = { nodes: new Set(), popTimer: null, cleanupTimer: null }; bursts.set(host, b); }
  for (const n of b.nodes) n.remove();
  b.nodes.clear();
  if (b.cleanupTimer) clearTimeout(b.cleanupTimer);
  b.cleanupTimer = null;
  return b;
}

/** Restarts the host's one-shot `data-pop` (the mockup's remove / reflow / add, so a repeat click replays it). One
 *  layout read per click, never per frame. */
function restartPop(host: HTMLElement, b: HostBurst, ms: number): void {
  host.removeAttribute('data-pop');
  void host.offsetWidth;
  host.setAttribute('data-pop', '');
  if (b.popTimer) clearTimeout(b.popTimer);
  b.popTimer = setTimeout(() => { host.removeAttribute('data-pop'); b.popTimer = null; }, ms);
}

/** Appends one transient node to the burst layer, tracked so the next burst (or the fallback) can remove it. */
function addNode(layer: HTMLElement, b: HostBurst, cls: string, vars: Record<string, string>, delayMs: number, left?: string): void {
  const el = document.createElement('span');
  el.className = cls;
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  if (delayMs > 0) el.style.animationDelay = `${Math.round(delayMs)}ms`;
  if (left !== undefined) el.style.left = left;
  el.addEventListener('animationend', () => { el.remove(); b.nodes.delete(el); }, { once: true });
  b.nodes.add(el);
  layer.appendChild(el);
}

/** The nodes go into the host's empty `[data-burst]` layer when it has one (React owns the rest of the host), else
 *  into the host itself. */
const layerOf = (host: HTMLElement): HTMLElement => host.querySelector<HTMLElement>('[data-burst]') ?? host;

function armCleanup(b: HostBurst): void {
  b.cleanupTimer = setTimeout(() => {
    for (const n of b.nodes) n.remove();
    b.nodes.clear();
    b.cleanupTimer = null;
  }, BURST_CLEANUP_MS);
}

/** A chest card was picked (or picked again: it replays). `host` is the card; its tier class picks the CSS one-shots. */
export function playPickBurst(host: HTMLElement, tier: ChestTier, reduced: boolean): void {
  const b = resetHost(host);
  if (reduced || osReducedMotion()) return;
  const fx = TIER_PICK_FX[tier];
  const L = CHEST_TIERS.indexOf(tier);
  restartPop(host, b, PICK_POP_MS);
  const layer = layerOf(host);
  for (let i = 0; i < fx.rings; i++) {
    const c = tier === 'ancient' ? ANCIENT_RINGS[i % ANCIENT_RINGS.length]! : tierColour(tier);
    addNode(layer, b, 'cshop-ringfx', { '--c': c, '--rs': String(2.2 + L * 0.5 + i * 0.6) }, i * 110);
  }
  for (let i = 0; i < fx.sparks; i++) {
    const a = (i / fx.sparks) * Math.PI * 2 + Math.random() * 0.5;
    const d = fx.reach * (0.6 + Math.random() * 0.6);
    addNode(layer, b, 'cshop-spark', {
      '--dx': `${(Math.cos(a) * d).toFixed(1)}px`, '--dy': `${(Math.sin(a) * d * 0.85).toFixed(1)}px`, '--c': tierColour(tier),
    }, Math.random() * (40 + L * 40));
  }
  for (let i = 0; i < fx.motes; i++) {
    addNode(layer, b, 'cshop-mote', { '--c': tierColour(tier) }, 120 + Math.random() * 500, `${(15 + Math.random() * 70).toFixed(1)}%`);
  }
  armCleanup(b);
}

/** A focus toggle switched ON. `host` is the row: it pops (the pill bounces, its ring blasts, the name pops, a light
 *  sweeps the row) and the sparks fly from the toggle's `[data-burst]` layer. */
export function playToggleBurst(host: HTMLElement, reduced: boolean): void {
  const b = resetHost(host);
  if (reduced || osReducedMotion()) return;
  restartPop(host, b, TOGGLE_POP_MS);
  const layer = layerOf(host);
  const n = TOGGLE_FX.sparks;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const d = TOGGLE_FX.reach * (0.77 + Math.random() * 0.57);
    addNode(layer, b, 'cshop-spark', {
      '--dx': `${(Math.cos(a) * d * 1.5).toFixed(1)}px`, '--dy': `${(Math.sin(a) * d).toFixed(1)}px`, '--c': TOGGLE_COLOURS[i % TOGGLE_COLOURS.length]!,
    }, Math.random() * 60);
  }
  armCleanup(b);
}

/**
 * THE PICK SOUNDS, escalating by tier, from clips already in the game (no new audio):
 *  - Standard  `pulse`: the plain UI ping every Collection / shop button already makes. The baseline.
 *  - Rare      `discoverSelect`: the game's "choice committed" chord (a Discover pick, a Rune bought); brighter, a pick.
 *              (Not `pickPress`: that arms the pick latch, which would swallow the NEXT `discoverSelect`, an Epic click.)
 *  - Epic      `discoverSelect` + `equipmentSheen` 100 ms later: the pick, plus a shimmer that lands with the card's
 *              light sweep (which starts at 0.1 s).
 *  - Legendary `upgrade` (the Tavern Up fanfare) + the sheen: a fanfare instead of a chord.
 *  - Ancient   `triple` (the triple-reward fanfare, the game's biggest "you got something" cue) + `gemApply` (a bright
 *              gem ding) + the sheen: three layers.
 * Layers grow 1, 1, 2, 2, 3 and the headline cue steps up every tier.
 */
const SHEEN_DELAY_MS = 100;
export const TIER_PICK_SOUND: Readonly<Record<ChestTier, () => void>> = Object.freeze({
  standard: () => { sfx.pulse(); },
  rare: () => { sfx.discoverSelect(); },
  epic: () => { sfx.discoverSelect(); sfx.equipmentSheen(1, SHEEN_DELAY_MS); },
  legendary: () => { sfx.upgrade(); sfx.equipmentSheen(1, SHEEN_DELAY_MS); },
  ancient: () => { sfx.triple(); sfx.gemApply(); sfx.equipmentSheen(1, SHEEN_DELAY_MS); },
});

/** A focus toggle: switching ON is one bright cue (`triggerGlow`, the medallion's rising glow); switching off is the
 *  quiet `tick` (spec: "Switching off is quiet"). */
export function playToggleSound(on: boolean): void {
  if (on) sfx.triggerGlow(); else sfx.tick();
}
