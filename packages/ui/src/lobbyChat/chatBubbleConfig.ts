/**
 * THE CHAT BUBBLES' SPRING (owner 2026-11-09: "add some bounce and springiness to the bubbles themselves"). Every number
 * the bubble motion uses, live-tunable from the dev menu's "Chat Bubbles" panel; production always plays DEFAULTS.
 *
 * Springs are described the way an animator thinks of them: SPEED (how many wobbles a second) and BOUNCE (how much it
 * overshoots and keeps wobbling: 0 = settles with no overshoot, 1 = rings for a long time). `chatBubbleSpring.ts` turns
 * them into keyframes. The two dot-hop numbers ride on CSS variables (`--cb-hop`, `--cb-hop-ms`).
 *
 * To bake a tune: Copy values in the panel, paste into DEFAULTS.
 */
import type { TunerControl, TunerSpec } from '../tunerSchema';

export interface ChatBubbleConfig {
  /** Pop-in: the bubble grows out of its tail. */
  inSpeed: number;
  inBounce: number;
  /** Starting size, as a share of full size. */
  inFrom: number;
  /** How much the overshoot squashes and stretches (wider + shorter, then taller + thinner). */
  inSquash: number;
  /** A little wobble of rotation as it lands, in degrees. */
  inTilt: number;
  /** The words land: the bubble springs from the dots' size to the words' size, with a kick. */
  landSpeed: number;
  landBounce: number;
  /** The extra boing on top of the size change, as a share of size. */
  landKick: number;
  /** Pushed to a new place: it slides there on a spring. */
  slideSpeed: number;
  slideBounce: number;
  /** Leaving: a quick puff up, then it shrinks back into its tail. */
  outMs: number;
  outPuff: number;
  outTo: number;
  /** The typing dots hop: how high, and how long one round of three hops takes. */
  hopPx: number;
  hopMs: number;
  /** THE HAND-DRAWN LOOK (chatBubbleShape.ts): the outline's ink colour and thickness. */
  ink: string;
  inkWidth: number;
  /** How far the outline drifts in and out, px (0 = a clean rounded box). */
  wobble: number;
  /** Corner roundness, px (each corner varies a little around it). */
  radius: number;
  /** How far the curvy tail reaches toward the speaker, px. */
  tailLen: number;
  /** How many loose sketch strokes sit outside the outline (0 to 3), and how far out. */
  accents: number;
  accentGap: number;
  /** The drop shadow's offset, px. */
  shadowX: number;
  shadowY: number;
  /** How far the corners lean, px: slightly askew, still clean (owner 2026-11-09). */
  askew: number;
  /** A long message's later bubble: how wide its long tail is where it leaves the bubble, px. */
  reachWidth: number;
  /** THE CHAT VIEW (Enter): where the history sits over the board, as shares of the screen, and how the game behind
   *  is dimmed (0 to 1) and blurred (px; 0 = no blur, the cheapest). */
  viewTop: number;
  viewWidth: number;
  viewHeight: number;
  viewDim: number;
  viewBlur: number;
}

const DEFAULTS: ChatBubbleConfig = {
  inSpeed: 2.4, inBounce: 0.55, inFrom: 0.25, inSquash: 0.6, inTilt: 4,
  landSpeed: 2.8, landBounce: 0.5, landKick: 0.08,
  slideSpeed: 2.2, slideBounce: 0.4,
  outMs: 260, outPuff: 0.08, outTo: 0.2,
  hopPx: 6, hopMs: 1000,
  ink: '#141a24', inkWidth: 3.5, wobble: 0.4, radius: 20, tailLen: 18, accents: 0, accentGap: 8, askew: 3, shadowX: 2, shadowY: 4, reachWidth: 22,
  // The chat view fills most of the board, the bar below it (owner 2026-11-09, a drawn-over screenshot).
  viewTop: 16, viewWidth: 52, viewHeight: 68, viewDim: 0.5, viewBlur: 6,
};

const KEY = 'ascent.chatBubbleSpring.v2';
/** The first save slot held the sketchier first-draft shape (owner 2026-11-09: "a bit too handdrawn"): only its
 *  spring tuning carries over. */
const OLD_KEY = 'ascent.chatBubbleSpring';
/** The chat view's place changed (owner 2026-11-09: "increase the size of the chat box"): a saved place from before it
 *  gives way to the new defaults once; the rest of the tune is kept. */
const VIEW_KEYS = ['viewTop', 'viewWidth', 'viewHeight'] as const;
const VIEW_LAYOUT_KEY = 'ascent.chatView.layout';
const VIEW_LAYOUT = '3'; // 3: moved up (owner 2026-11-09: "move it all up a bit")
const SPRING_KEYS = ['inSpeed', 'inBounce', 'inFrom', 'inSquash', 'inTilt', 'landSpeed', 'landBounce', 'landKick', 'slideSpeed', 'slideBounce', 'outMs', 'outPuff', 'outTo', 'hopPx', 'hopMs'] as const;

let cfg: ChatBubbleConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw != null) {
      const saved: unknown = JSON.parse(raw);
      const merged: ChatBubbleConfig = { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<ChatBubbleConfig>) : {}) };
      if (localStorage.getItem(VIEW_LAYOUT_KEY) !== VIEW_LAYOUT) {
        for (const k of VIEW_KEYS) merged[k] = DEFAULTS[k];
        localStorage.setItem(VIEW_LAYOUT_KEY, VIEW_LAYOUT);
        localStorage.setItem(KEY, JSON.stringify(merged));
      }
      return merged;
    }
    const old = JSON.parse(localStorage.getItem(OLD_KEY) ?? '{}') as Partial<ChatBubbleConfig> | null;
    const kept: Partial<ChatBubbleConfig> = {};
    for (const k of SPRING_KEYS) if (old && typeof old[k] === 'number') kept[k] = old[k];
    return { ...DEFAULTS, ...kept };
  } catch {
    return { ...DEFAULTS };
  }
})();

export const getChatBubbleConfig = (): ChatBubbleConfig => cfg;

function applyVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--cb-hop', `${cfg.hopPx}px`);
  root.setProperty('--cb-hop-ms', `${cfg.hopMs}ms`);
  root.setProperty('--cv-top', `${cfg.viewTop}%`);
  root.setProperty('--cv-w', `${cfg.viewWidth}%`);
  root.setProperty('--cv-h', `${cfg.viewHeight}%`);
  root.setProperty('--cv-dim', String(cfg.viewDim));
  root.setProperty('--cv-blur', `${cfg.viewBlur}px`);
}

function setValue(key: keyof ChatBubbleConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  applyVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

function reset(): void {
  cfg = { ...DEFAULTS };
  applyVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

type K = Extract<keyof ChatBubbleConfig, string>;
const speed = (key: K, group: string): TunerControl<K> =>
  ({ key, label: 'Speed', hint: 'Wobbles a second. Higher is snappier.', group, min: 0.5, max: 6, step: 0.1 });
const bounce = (key: K, group: string): TunerControl<K> =>
  ({ key, label: 'Bounce', hint: '0 settles with no overshoot; near 1 keeps wobbling.', group, min: 0, max: 0.95, step: 0.01 });

const controls: TunerControl<K>[] = [
  speed('inSpeed', 'Pop in'),
  bounce('inBounce', 'Pop in'),
  { key: 'inFrom', label: 'Start size', hint: 'How big it is the moment it appears, as a share of full size.', group: 'Pop in', min: 0, max: 0.95, step: 0.01 },
  { key: 'inSquash', label: 'Squash and stretch', hint: 'How much the overshoot squashes it wide, then stretches it tall.', group: 'Pop in', min: 0, max: 2, step: 0.05 },
  { key: 'inTilt', label: 'Tilt wobble', unit: '°', hint: 'A little rock as it lands.', group: 'Pop in', min: 0, max: 15, step: 0.5 },
  speed('landSpeed', 'Words land'),
  bounce('landBounce', 'Words land'),
  { key: 'landKick', label: 'Kick', hint: 'The extra boing when the dots become words.', group: 'Words land', min: 0, max: 0.4, step: 0.01 },
  speed('slideSpeed', 'Pushed down'),
  bounce('slideBounce', 'Pushed down'),
  { key: 'outMs', label: 'Length', unit: 'ms', hint: 'How long it takes to go.', group: 'Leave', min: 80, max: 800, step: 10 },
  { key: 'outPuff', label: 'Puff', hint: 'How much it swells before shrinking away.', group: 'Leave', min: 0, max: 0.4, step: 0.01 },
  { key: 'outTo', label: 'End size', hint: 'How small it gets as it fades out.', group: 'Leave', min: 0, max: 1, step: 0.01 },
  { key: 'ink', label: 'Ink colour', hint: 'The outline and sketch strokes.', group: 'Shape', kind: 'color', min: 0, max: 0, step: 0 },
  { key: 'inkWidth', label: 'Ink thickness', unit: 'px', hint: 'How heavy the outline is (the sketch strokes are a bit thinner).', group: 'Shape', min: 0, max: 8, step: 0.25 },
  { key: 'wobble', label: 'Wobble', unit: 'px', hint: 'How hand-drawn the outline looks. 0 is a clean box.', group: 'Shape', min: 0, max: 6, step: 0.1 },
  { key: 'askew', label: 'Askew', unit: 'px', hint: 'How far the corners lean, so the box sits a little crooked. Each message leans its own way.', group: 'Shape', min: 0, max: 10, step: 0.25 },
  { key: 'radius', label: 'Corner roundness', unit: 'px', hint: 'How round the corners are; each corner varies a little.', group: 'Shape', min: 4, max: 40, step: 1 },
  { key: 'tailLen', label: 'Tail length', unit: 'px', hint: 'How far the curvy tail reaches toward the speaker.', group: 'Shape', min: 0, max: 40, step: 1 },
  { key: 'accents', label: 'Sketch strokes', hint: 'How many loose strokes sit outside the outline.', group: 'Shape', min: 0, max: 3, step: 1 },
  { key: 'accentGap', label: 'Stroke gap', unit: 'px', hint: 'How far outside the outline the sketch strokes sit.', group: 'Shape', min: 2, max: 16, step: 0.5 },
  { key: 'reachWidth', label: 'Long tail width', unit: 'px', hint: "How wide a long message's second bubble's tail is where it leaves the bubble.", group: 'Shape', min: 6, max: 40, step: 1 },
  { key: 'shadowX', label: 'Shadow across', unit: 'px', hint: 'The drop shadow behind the bubble.', group: 'Shape', min: -10, max: 10, step: 0.5 },
  { key: 'shadowY', label: 'Shadow down', unit: 'px', hint: 'The drop shadow behind the bubble.', group: 'Shape', min: -10, max: 10, step: 0.5 },
  { key: 'viewTop', label: 'Top', unit: '%', hint: 'How far down the screen the chat history starts.', group: 'Chat view', min: 0, max: 70, step: 0.5 },
  { key: 'viewWidth', label: 'Width', unit: '%', hint: 'How wide the history and the chat bar are.', group: 'Chat view', min: 15, max: 90, step: 0.5 },
  { key: 'viewHeight', label: 'Height', unit: '%', hint: 'How tall the chat is, the history and the bar together.', group: 'Chat view', min: 10, max: 70, step: 0.5 },
  { key: 'viewDim', label: 'Darken', hint: 'How dark the game gets behind the chat. 0 is not at all.', group: 'Chat view', min: 0, max: 0.9, step: 0.01 },
  { key: 'viewBlur', label: 'Blur', unit: 'px', hint: 'How blurred the game gets behind the chat. 0 is no blur (cheapest).', group: 'Chat view', min: 0, max: 20, step: 0.5 },
  { key: 'hopPx', label: 'Hop height', unit: 'px', hint: 'How high each typing dot hops.', group: 'Typing dots', min: 0, max: 16, step: 0.5 },
  { key: 'hopMs', label: 'Hop round', unit: 'ms', hint: 'How long one round of three hops takes.', group: 'Typing dots', min: 300, max: 2500, step: 10 },
];

export const CHAT_BUBBLE_SPEC: TunerSpec<ChatBubbleConfig> = {
  id: 'chatbubbles', // FROZEN: indexes this panel's dragged position
  title: 'Chat Bubbles',
  note: 'dev · live (the shape on the next bubble) · turn on Chat sandbox + fake chatter',
  read: getChatBubbleConfig,
  write: (key, value) => setValue(key, value),
  writeColor: (key, value) => setValue(key, value),
  reset,
  defaults: DEFAULTS,
  controls,
};

applyVars();
