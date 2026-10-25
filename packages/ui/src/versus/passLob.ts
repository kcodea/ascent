/**
 * VERSUS DUOS — THE PASS ANIMATION: "the drop" (owner 2026-10-25: "make sure passing a card gets a bespoke animation that
 * is different from a typical coalesce"; then "dragging a minion over their portrait should have it glow that teal/blue
 * glow to showcase it is going to pass, then it 'drops' into their portrait kinda, and then on the other player's
 * screen, the card comes in through the teammate portrait basically"). R-DUOS-PASS-01.
 *
 *  - SENDING: from where you let go, the card hops once and SINKS into your teammate's bottom-right portrait, turning
 *    over onto its BACK (your equipped card plate) and shrinking into the disc as it goes under. One of your coins
 *    follows it in from your Gold (the pass's 1 Gold). The portrait catches it with a short pop.
 *  - RECEIVING: the reverse, through the same door. A face-down card rises OUT of your teammate's portrait (bottom
 *    right on your screen) at the portrait's size and GROWS the whole way as it nears your hand (owner 2026-10-25: "can
 *    you make the passed card get larger as it gets closer to hand?"), turning face up on the way and landing at full
 *    hand-card size (`emergeFrames`: the size follows how close it is, eased, never shrinking).
 * Not a coalesce (which collapses to a point in place): the card visibly travels between the two players' portraits.
 *
 * PERFORMANCE: imperative DOM + the Web Animations API, transform / opacity only, on one fixed layer created per pass
 * and removed when it lands. Two layout reads per pass (the start box and the portrait), never per frame.
 */
import { stageHost, toStage } from '../stage';

/** The send: hop and sink into the portrait (ms). */
export const DROP_MS = 440;
/** The arrival: out of the portrait into the hand (ms). */
export const EMERGE_MS = 640;
/** How small the card gets inside the portrait disc. */
const SUNK = 0.14;
const SAMPLES = 14;

interface Box { left: number; top: number; width: number; height: number }

function cardLayer(host: HTMLElement, at: Box, face: HTMLElement | null, back: string): { layer: HTMLElement; flip: HTMLElement } {
  const layer = document.createElement('div');
  layer.className = 'duoslob';
  layer.style.left = `${at.left}px`;
  layer.style.top = `${at.top}px`;
  layer.style.width = `${at.width}px`;
  layer.style.height = `${at.height}px`;
  const flip = document.createElement('div');
  flip.className = 'duoslob-flip';
  if (face) {
    const f = face.cloneNode(true) as HTMLElement;
    f.classList.add('duoslob-face');
    f.removeAttribute('data-uid');
    f.style.transform = '';
    f.style.left = '0';
    f.style.top = '0';
    f.style.position = 'absolute';
    flip.appendChild(f);
  }
  const img = document.createElement('img');
  img.className = 'duoslob-back';
  img.src = back;
  img.alt = '';
  img.draggable = false;
  flip.appendChild(img);
  layer.appendChild(flip);
  host.appendChild(layer);
  return { layer, flip };
}

const stageBox = (b: Box): Box => ({ left: toStage(b.left), top: toStage(b.top), width: toStage(b.width), height: toStage(b.height) });

/** SEND: the card at `from` (a screen box; `face` its element, cloned for the flight) hops and sinks into the portrait
 *  at `to`, turning onto `back`. `coin`: one coin follows it in from the HUD's Gold. */
export function playDrop(opts: { from: Box; to: Box; face: HTMLElement | null; back: string; coin: boolean; onLand?: () => void }): void {
  if (typeof document === 'undefined' || typeof Element === 'undefined' || !('animate' in Element.prototype)) { opts.onLand?.(); return; }
  const host = stageHost();
  const from = stageBox(opts.from);
  const to = stageBox(opts.to);
  const w = from.width || 120;
  const h = from.height || 170;
  const { layer, flip } = cardLayer(host, { ...from, width: w, height: h }, opts.face, opts.back);
  const cx0 = from.left + w / 2, cy0 = from.top + h / 2;
  const cx1 = to.left + to.width / 2, cy1 = to.top + to.height / 2;
  const dx = cx1 - cx0, dy = cy1 - cy0;
  const hop = Math.max(24, Math.min(70, Math.hypot(dx, dy) * 0.08));
  const frames: Keyframe[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    // A small hop up off the release point, then straight down into the disc: an ease-in pull, not a throw.
    const pull = t * t * (1.6 - 0.6 * t);
    const x = dx * pull;
    const y = dy * pull - hop * Math.sin(Math.min(1, t * 1.6) * Math.PI);
    const sc = 1 - (1 - SUNK) * pull;
    frames.push({ transform: `translate(${x}px, ${y}px) rotate(${-8 * Math.sin(t * Math.PI)}deg) scale(${sc})`, opacity: t > 0.72 ? Math.max(0, 1 - (t - 0.72) / 0.28) : 1, offset: t });
  }
  const a = layer.animate(frames, { duration: DROP_MS, easing: 'linear', fill: 'forwards' });
  flip.animate([{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(0deg)', offset: 0.18 }, { transform: 'rotateY(180deg)', offset: 0.55 }, { transform: 'rotateY(180deg)' }], { duration: DROP_MS, easing: 'ease-in-out', fill: 'forwards' });

  let coin: HTMLElement | null = null;
  if (opts.coin) {
    // The coin leaves YOUR Gold (the HUD's Gold pill and its own glyph) and drops into the portrait just after the card.
    const pill = document.querySelector('.goldpill');
    const pr = pill?.getBoundingClientRect();
    const gx = pr && pr.width > 0 ? toStage(pr.left + pr.width / 2) : cx0;
    const gy = pr && pr.width > 0 ? toStage(pr.top + pr.height / 2) : cy0;
    coin = document.createElement('span');
    coin.className = 'duoslob-coin';
    const glyph = pill?.querySelector('svg');
    if (glyph) coin.appendChild(glyph.cloneNode(true));
    coin.style.left = `${gx - 14}px`;
    coin.style.top = `${gy - 14}px`;
    host.appendChild(coin);
    const cdx = cx1 - gx, cdy = cy1 - gy;
    const cf: Keyframe[] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES;
      const pull = t * t * (1.6 - 0.6 * t);
      cf.push({ transform: `translate(${cdx * pull}px, ${cdy * pull - 40 * Math.sin(t * Math.PI)}px) scale(${1 - 0.5 * pull})`, opacity: t > 0.8 ? 1 - (t - 0.8) * 5 : 1, offset: t });
    }
    coin.animate(cf, { duration: DROP_MS, delay: 90, easing: 'linear', fill: 'both' });
  }
  const done = (): void => {
    layer.remove();
    coin?.remove();
    opts.onLand?.();
  };
  a.onfinish = done;
  a.oncancel = done;
}

/** The arrival's size at its start: about the portrait disc's width (a card that fits inside it), never a speck. */
export function emergeStartScale(discWidth: number, cardWidth: number): number {
  if (!(discWidth > 0) || !(cardWidth > 0)) return 0.3;
  return Math.max(0.18, Math.min(0.6, (discWidth * 0.55) / cardWidth));
}

/**
 * THE ARRIVAL'S PATH (pure, for the test and the animation). The card leaves the disc briskly (an ease-out on the
 * position) and its SIZE follows how close it is to the hand: `start` at the portrait, eased up continuously (slow
 * first, fastest in the last stretch) to exactly 1 in the slot. Size never shrinks on the way. `dx`/`dy`: from the slot
 * to the portrait centre.
 */
export function emergeFrames(dx: number, dy: number, start: number, samples = SAMPLES): Keyframe[] {
  const apex = Math.max(40, Math.min(120, Math.hypot(dx, dy) * 0.14));
  const frames: Keyframe[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const go = 1 - (1 - t) * (1 - t); // how far along the path (ease-out)
    const grow = go * go * (3 - 2 * go) * 0.35 + go * go * 0.65; // smooth, back-weighted: larger as it gets closer
    const x = dx * (1 - go);
    const y = dy * (1 - go) - apex * Math.sin(go * Math.PI);
    const sc = start + (1 - start) * grow;
    frames.push({ transform: `translate(${x}px, ${y}px) rotate(${6 * Math.sin(go * Math.PI)}deg) scale(${sc})`, opacity: t < 0.12 ? t / 0.12 : 1, offset: t });
  }
  return frames;
}

/** RECEIVE: a face-down card (`back`) rises out of the portrait at `from` and flies into `to` (its hand slot), growing
 *  from the portrait's size to full size as it nears the hand, turning face up along the way. */
export function playEmerge(opts: { from: Box; to: Box; back: string; onLand?: () => void }): void {
  if (typeof document === 'undefined' || typeof Element === 'undefined' || !('animate' in Element.prototype)) { opts.onLand?.(); return; }
  const host = stageHost();
  const from = stageBox(opts.from);
  const to = stageBox(opts.to);
  const w = to.width || 120;
  const h = to.height || 170;
  // The layer sits ON the hand slot; the frames start it inside the portrait (translated back there, tiny).
  const { layer, flip } = cardLayer(host, { left: to.left, top: to.top, width: w, height: h }, null, opts.back);
  const cx0 = from.left + from.width / 2, cy0 = from.top + from.height / 2;
  const cx1 = to.left + w / 2, cy1 = to.top + h / 2;
  const dx = cx0 - cx1, dy = cy0 - cy1;
  const frames = emergeFrames(dx, dy, emergeStartScale(from.width, w));
  const a = layer.animate(frames, { duration: EMERGE_MS, easing: 'linear', fill: 'forwards' });
  // Face up along the way (it has grown past half size by then), settled before it lands.
  flip.animate([{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(180deg)', offset: 0.35 }, { transform: 'rotateY(360deg)', offset: 0.8 }, { transform: 'rotateY(360deg)' }], { duration: EMERGE_MS, easing: 'ease-in-out', fill: 'forwards' });
  const done = (): void => {
    layer.remove();
    opts.onLand?.();
  };
  a.onfinish = done;
  a.oncancel = done;
}

/** The portrait that catches (or lets go of) a pass: a short one-shot pop (transform only). */
export function catchPulse(el: Element | null): void {
  if (!el || !('animate' in el)) return;
  (el as HTMLElement).animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.1)', offset: 0.35 }, { transform: 'scale(0.97)', offset: 0.7 }, { transform: 'scale(1)' }],
    { duration: 300, easing: 'ease-out' },
  );
}

/** The teammate portrait a pass goes through: the bottom-right dock's disc (`[data-duos-mate]`). */
export function mateDoor(): HTMLElement | null {
  const dock = document.querySelector<HTMLElement>('[data-duos-mate]');
  return dock?.querySelector<HTMLElement>('.duosdock-disc') ?? dock;
}

/** A teammate's pass just landed in MY hand as `uid`: a face-down card rises out of their portrait (bottom right) into
 *  its slot and turns face up there (the card itself is held invisible for the flight, then pops in). `back`: their
 *  card plate. */
export function playArrival(uid: string, back: string): void {
  if (typeof document === 'undefined') return;
  // Two frames: the commit that added the card has rendered its slot.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const target = document.querySelector<HTMLElement>(`.row.hand .card[data-uid="${uid}"]`);
    const door = mateDoor();
    if (!target || !door) return;
    const to = target.getBoundingClientRect();
    const from = door.getBoundingClientRect();
    catchPulse(door);
    target.classList.add('passincoming');
    playEmerge({
      from, to, back,
      onLand: () => {
        target.classList.remove('passincoming');
        if ('animate' in target) target.animate([{ transform: 'scale(0.85)' }, { transform: 'scale(1.08)', offset: 0.6 }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
      },
    });
  }));
}
