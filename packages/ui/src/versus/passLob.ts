/**
 * VERSUS DUOS — THE PASS ANIMATION: "the lob" (owner 2026-10-25: "make sure passing a card gets a bespoke animation that
 * is different from a typical coalesce"; the lead picked concept A). R-DUOS-PASS-01.
 *
 *  - SENDING: the card leaves your release point in a high ARC toward your teammate's portrait, turning over onto its
 *    BACK (your equipped card plate, the game's face-down card) at the top of the arc and shrinking as it falls into
 *    the portrait. One of your coins rides just behind it (the pass's 1 Gold). The portrait catches it: a short squash.
 *  - RECEIVING: the reverse. A face-down card drops out of the teammate's portrait in an arc into your hand, and the card
 *    that landed there pops in face up as the back reaches it.
 * The opposite of a coalesce (which collapses to a point in place): the card is visibly THROWN between two players.
 *
 * PERFORMANCE: imperative DOM + the Web Animations API, transform / opacity only, on one fixed layer created per throw
 * and removed when it lands. Two layout reads per throw (the start box and the portrait), never per frame.
 */
import { stageHost, toStage } from '../stage';

/** Throw length (ms). */
export const LOB_MS = 620;
/** The arc's apex above the straight line (stage px), by distance. */
const apexFor = (dist: number): number => Math.max(90, Math.min(220, dist * 0.32));
const SAMPLES = 14;

interface Box { left: number; top: number; width: number; height: number }

/** A throw from `from` (a screen box) into `to` (a screen box). `face`: the card's on-screen element (cloned for the
 *  flight; null = the back only). `back`: the face-down picture. `coin`: a coin rides behind it. `toBack`: turn from
 *  the face onto the back (a send) or from the back to the face (an arrival lands face up). */
export function playLob(opts: { from: Box; to: Box; face: HTMLElement | null; back: string; coin: boolean; send: boolean; onLand?: () => void }): void {
  if (typeof document === 'undefined' || typeof Element === 'undefined' || !('animate' in Element.prototype)) { opts.onLand?.(); return; }
  const host = stageHost();
  const s = (b: Box): Box => ({ left: toStage(b.left), top: toStage(b.top), width: toStage(b.width), height: toStage(b.height) });
  const from = s(opts.from);
  const to = s(opts.to);
  const w = from.width || 120;
  const h = from.height || 170;
  const layer = document.createElement('div');
  layer.className = 'duoslob';
  layer.style.left = `${from.left}px`;
  layer.style.top = `${from.top}px`;
  layer.style.width = `${w}px`;
  layer.style.height = `${h}px`;
  const flip = document.createElement('div');
  flip.className = 'duoslob-flip';
  if (opts.face) {
    const f = opts.face.cloneNode(true) as HTMLElement;
    f.classList.add('duoslob-face');
    f.removeAttribute('data-uid');
    f.style.transform = '';
    f.style.left = '0';
    f.style.top = '0';
    f.style.position = 'absolute';
    flip.appendChild(f);
  }
  const back = document.createElement('img');
  back.className = 'duoslob-back';
  back.src = opts.back;
  back.alt = '';
  back.draggable = false;
  flip.appendChild(back);
  layer.appendChild(flip);
  host.appendChild(layer);

  const cx0 = from.left + w / 2, cy0 = from.top + h / 2;
  const cx1 = to.left + to.width / 2, cy1 = to.top + to.height / 2;
  const dx = cx1 - cx0, dy = cy1 - cy0;
  const apex = apexFor(Math.hypot(dx, dy));
  const endScale = Math.max(0.24, Math.min(0.6, (to.width || 80) / w));
  const startScale = opts.send ? 1 : endScale;
  const finalScale = opts.send ? endScale : 1;
  const frames: Keyframe[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const x = dx * t;
    const y = dy * t - apex * 4 * t * (1 - t);
    const sc = startScale + (finalScale - startScale) * t;
    const tilt = (opts.send ? 1 : -1) * Math.sin(t * Math.PI) * 14;
    frames.push({ transform: `translate(${x}px, ${y}px) rotate(${tilt}deg) scale(${sc})`, opacity: opts.send && t > 0.9 ? 1 - (t - 0.9) * 8 : 1, offset: t });
  }
  // The turn-over: face to back on a send (it reads as handed over, face down), back to face on an arrival.
  const turn: Keyframe[] = opts.send
    ? [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(0deg)', offset: 0.28 }, { transform: 'rotateY(180deg)', offset: 0.58 }, { transform: 'rotateY(180deg)' }]
    : [{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(180deg)', offset: 0.55 }, { transform: 'rotateY(360deg)', offset: 0.92 }, { transform: 'rotateY(360deg)' }];
  const a = layer.animate(frames, { duration: LOB_MS, easing: 'cubic-bezier(0.3, 0.05, 0.4, 1)', fill: 'forwards' });
  flip.animate(turn, { duration: LOB_MS, easing: 'ease-in-out', fill: 'forwards' });

  let coin: HTMLElement | null = null;
  if (opts.coin) {
    // The coin leaves YOUR Gold (the HUD's Gold pill and its own glyph) and rides into the portrait with the card.
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
    const capex = apexFor(Math.hypot(cdx, cdy)) * 0.8;
    const cf: Keyframe[] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES;
      cf.push({ transform: `translate(${cdx * t}px, ${cdy * t - capex * 4 * t * (1 - t)}px) scale(${1 - 0.3 * t})`, opacity: t > 0.88 ? 1 - (t - 0.88) * 8 : 1, offset: t });
    }
    coin.animate(cf, { duration: LOB_MS, delay: 70, easing: 'cubic-bezier(0.3, 0.05, 0.4, 1)', fill: 'both' });
  }
  const done = (): void => {
    layer.remove();
    coin?.remove();
    opts.onLand?.();
  };
  a.onfinish = done;
  a.oncancel = done;
}

/** The portrait that catches (or lets go of) a pass: a short one-shot squash (`.duoscatch`, transform only). */
export function catchPulse(el: Element | null): void {
  if (!el || !('animate' in el)) return;
  (el as HTMLElement).animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.12, 0.9)', offset: 0.35 }, { transform: 'scale(0.96, 1.05)', offset: 0.7 }, { transform: 'scale(1)' }],
    { duration: 300, easing: 'ease-out' },
  );
}

/** A teammate's pass just landed in MY hand as `uid`: a face-down card drops out of their portrait into its slot and
 *  turns face up there (the card itself is held invisible for the flight, then pops in). `back`: their card plate. */
export function playArrival(uid: string, back: string): void {
  if (typeof document === 'undefined') return;
  // Two frames: the commit that added the card has rendered its slot.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const target = document.querySelector<HTMLElement>(`.row.hand .card[data-uid="${uid}"]`);
    const mate = document.querySelector('[data-duos-mate]');
    if (!target || !mate) return;
    const to = target.getBoundingClientRect();
    const from = mate.getBoundingClientRect();
    catchPulse(mate);
    target.classList.add('passincoming');
    playLob({
      from: { left: from.left + from.width / 2 - to.width / 2, top: from.top + from.height / 2 - to.height / 2, width: to.width, height: to.height },
      to, face: null, back, coin: false, send: false,
      onLand: () => {
        target.classList.remove('passincoming');
        if ('animate' in target) target.animate([{ transform: 'scale(0.85)' }, { transform: 'scale(1.08)', offset: 0.6 }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
      },
    });
  }));
}
