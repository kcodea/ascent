/**
 * THE LOCATION REVEAL (owner 2026-11-24): the gate's crystal shatters and its magic carries you to where the game is
 * played. The gate asks for it (`warmLocationReveal` as its doors shut, `playLocationReveal` on the press) and gives it a
 * place in its own layer; hero select, over the same painting blurred, is already behind.
 *
 * TWO VERSIONS of one sequence:
 *  - the full one (revealGl.ts): from the press to the end it IS the picture, doors and crystal included;
 *  - the light one, for phones and machines that cannot draw it: the gate opens its own doors as always, on the painting,
 *    then the name, the line and the parchments fade in. Same words, same sound from the name on.
 * Plain DOM, one rAF loop, no React state: nothing here re-renders the game.
 */
import { PHONE_GPU } from '../phoneDiag';
import { locationArt, locationName, POSTER_NAME, type LocationDef, type Poster } from './locations';
import { prepareReveal, stageHeight, type PreparedReveal, type RevealGl } from './revealGl';
import { lightCues, loadRevealSound, type RevealSound } from './revealSound';
import { dropAtmosphere, setAtmosphereCovered, syncAtmosphere, warmAtmosphere } from './atmosphereGl';
import { arriveHeroSelect, type ArriveFrom } from './heroArrive';
export type { ArriveFrom } from './heroArrive';
import { A, fitOf, HOLD, NAME, outCubic, outroAt, POST, POST_GAP, posterName, posterRest, POSTER_H, POSTER_W, realOf, seg, simEnd, simOf, smoother, START, washAt, washReach } from './revealTimeline';
import './locationReveal.css';



export interface LocationRevealRequest {
  location: LocationDef;
  /** The parchments, in order (`postersFor`). None: a JOURNEY (`JOURNEY_REST`), the travel alone, with no name either. */
  tribes: readonly Poster[];
  /** The screen the leaving wave washes in (default: hero select). Called once, as the wave starts. */
  arrive?: (from: ArriveFrom) => void;
}

interface Warm { id: LocationDef['id']; loc: LocationDef; gl: PreparedReveal | null; sound: RevealSound; art: HTMLImageElement[] }
let warm: Warm | null = null;

const loadLight = (id: LocationDef['id']): RevealSound => loadRevealSound(id, (n) => lightCues(id, n, { name: LIGHT.name, posters: LIGHT.posters, step: LIGHT.step, leave: lightSeconds(n) - LIGHT.fade }));

/** Get a reveal ready (idempotent). Called as the gate's doors meet, so it is whole before the crystal can be pressed. */
export function warmLocationReveal(loc: LocationDef): void {
  if (typeof window === 'undefined') return;
  if (warm?.loc === loc) return; // the def itself: Terys Gate's result colours share one id
  dropLocationReveal();
  const light = PHONE_GPU || typeof createImageBitmap !== 'function';
  // The light version's pictures; the full one needs only the blur hero select shows.
  const files = light ? ['flat', 'blur', ...loc.posters.map((t) => `poster-${t}`)] : ['blur'];
  const art = files.map((f) => { const i = new Image(); i.decoding = 'async'; i.src = locationArt(loc.id, f); return i; });
  const w: Warm = { id: loc.id, loc, gl: light ? null : prepareReveal(loc), sound: light ? loadLight(loc.id) : loadRevealSound(loc.id), art };
  warm = w;
  // Hero select's living ground, once the reveal itself is whole (not for a gate that has gone meanwhile).
  void w.gl?.ready.then(() => { if (warm === w) warmAtmosphere(loc); });
}

/** Ends the reveal on screen, if there is one. */
let endNow: (() => void) | null = null;

/** Cut the reveal on screen short: it fades off what is behind it (a live match that ended under it). */
export function stopLocationReveal(): void {
  endNow?.();
}

/** Let go of a reveal that was made ready and will not play (the gate opened quietly). */
export function dropLocationReveal(): void {
  const w = warm;
  warm = null;
  dropAtmosphere();
  if (!w) return;
  w.gl?.drop();
  w.sound.stop();
}

/** The full version once it is ready, or null (the light one) when it is not going to be, or not within `waitMs`. */
export async function readyReveal(loc: LocationDef, waitMs = 900): Promise<RevealGl | null> {
  warmLocationReveal(loc);
  const gl = warm?.gl;
  if (!gl) return null;
  return Promise.race([gl.ready, new Promise<null>((res) => { window.setTimeout(() => res(null), waitMs); })]);
}

const el = (tag: string, cls: string, parent: HTMLElement): HTMLElement => {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
};


/** The words over the picture: the name, and the parchments' names. They are placed once and only ever fade. */
function buildWords(root: HTMLElement, r: LocationRevealRequest): { title: HTMLElement; letters: HTMLElement[]; names: HTMLElement[]; layout: (stageH: number, fit: number) => void } {
  const words = el('div', 'lrev-words', root);
  words.setAttribute('aria-hidden', 'true');
  const title = el('div', 'lrev-title', words);
  const letters = [...locationName(r.location)].map((ch) => { const i = el('i', '', title); i.textContent = ch; return i; });
  const n = r.tribes.length;
  const names = r.tribes.map((t) => {
    const e = el('span', 'lrev-tribe', words);
    e.textContent = POSTER_NAME[t] ?? t;
    e.style.setProperty('--c', `var(--t-${t})`);
    return e;
  });
  const layout = (stageH: number, fit: number): void => {
    const u = stageH * fit;
    words.style.setProperty('--lru', `${u}px`);
    names.forEach((e, i) => {
      const p = posterRest(i, n);
      e.style.left = `calc(50% + ${((p.x - Math.sin(p.angle) * 0.2) * u).toFixed(1)}px)`;
      e.style.top = `calc(50% + ${((p.y + (POSTER_H / 2) * 0.985) * u).toFixed(1)}px)`;
      e.style.transform = `translate(-50%, -12%) rotate(${(p.angle * 57.3).toFixed(2)}deg)`;
    });
  };
  // For a screen reader: the place, said once.
  const say = el('div', 'lrev-say', root);
  say.setAttribute('role', 'status');
  say.textContent = r.location.line;
  return { title, letters, names, layout };
}

/** Write the words at sim second `s`. Styles are written only while something of theirs is moving. */
function makeWordsWriter(w: ReturnType<typeof buildWords>, n: number): (s: number) => void {
  const { title, letters, names } = w;
  const mid = (letters.length - 1) / 2;
  const out = outroAt(n);
  let calm = -1;
  const at = names.map((_, i) => posterRest(i, n).at);
  return (s) => {
    const moving = (s > NAME - 0.1 && s < NAME + 1.9) || (s > POST && s < at[n - 1]! + 1.2) || s > out - 0.1;
    const phase = s < NAME ? 0 : s < POST ? 1 : 2;
    if (!moving && calm === phase) return;
    calm = moving ? -1 : phase;
    const u = s - NAME;
    title.style.opacity = u >= 0 ? '1' : '0';
    title.style.transform = `scale(${(1 + 0.16 * (1 - outCubic(seg(u, 0, 0.75)))).toFixed(4)})`;
    letters.forEach((e, i) => {
      const from = Math.abs(i - mid) * 0.022;
      const k = seg(u, from, from + 0.48);
      const eased = outCubic(k);
      const hop = Math.sin(Math.PI * seg(u, 0.62 + i * 0.035, 1.02 + i * 0.035)) ** 2;
      const hot = (k > 0 ? Math.exp(-Math.max(0, u - from) * 3.6) : 0) + 0.35 * hop;
      const away = smoother(seg(s, out + 0.16 + from, out + 0.52 + from)); // it lifts off, letter by letter, as it came
      e.style.opacity = String(smoother(Math.min(1, k * 1.6)) * (1 - away));
      e.style.transform = `translate(${((i - mid) * ((1 - eased) * 9 + away * 5)).toFixed(2)}%, ${(14 * (1 - eased) - 5 * hop - 22 * away).toFixed(2)}%)`;
      e.style.filter = hot > 0.02 ? `brightness(${(1 + hot * 1.5).toFixed(3)})` : 'none';
    });
    names.forEach((e, i) => { e.style.opacity = posterName(i, n, s).toFixed(3); });
  };
}

/** The sizes of the layer the reveal is drawn in (layout px, read on mount and on a resize, never per frame). */
function watchSize(root: HTMLElement, apply: (stageH: number, fit: number, w: number, h: number) => void): () => void {
  const measure = (): void => {
    const w = root.clientWidth;
    const h = root.clientHeight;
    if (!w || !h) return;
    const stageH = stageHeight(w, h);
    apply(stageH, fitOf(w / stageH, h / stageH), w, h);
  };
  measure();
  window.addEventListener('resize', measure);
  return () => window.removeEventListener('resize', measure);
}

/**
 * THE FULL VERSION, in `host` (the gate's layer). `onCovered`: its first frames are up, so the gate may hide its own doors.
 * Resolves when it is over. It rejects only if it could not start at all (the gate then just opens).
 */
export function playFullReveal(host: HTMLElement, r: LocationRevealRequest, gl: RevealGl, onCovered: () => void): Promise<void> {
  const w = warm;
  warm = null; // this play owns it now
  const n = r.tribes.length;
  gl.tribes = r.tribes;
  return new Promise<void>((resolve) => {
    const root = el('div', 'lrev', host);
    gl.canvas.className = 'lrev-canvas';
    root.appendChild(gl.canvas);
    const words = n > 0 ? buildWords(root, r) : null;
    const write = words ? makeWordsWriter(words, n) : (): void => undefined;
    let fit = 1;
    let stagePx = 0;
    const unwatch = watchSize(root, (stageH, f, w, h) => {
      gl.resize(w, h);
      fit = f;
      stagePx = stageH;
      gl.canvas.style.width = `${stageH * A}px`;
      gl.canvas.style.height = `${stageH}px`;
      words?.layout(stageH, f);
    });
    let raf = 0;
    let over = false;
    let cut = false;
    const finish = (): void => {
      if (over) return;
      over = true;
      endNow = null;
      setAtmosphereCovered(false);
      cancelAnimationFrame(raf);
      window.clearTimeout(guard);
      unwatch();
      w?.sound.stop(120, !cut);
      gl.destroy();
      root.remove();
      resolve();
    };
    const from = realOf(START);
    const end = simEnd(n);
    const total = realOf(end) - from;
    const guard = window.setTimeout(finish, (total + 4) * 1000); // whatever happens, hero select is reached
    let t0 = 0;
    let covered = false;
    let arrived = false;
    const tick = (now: number): void => {
      if (over) return;
      if (!t0) { t0 = now; w?.sound.play(n); }
      const real = (now - t0) / 1000;
      if (gl.lost || real >= total) { finish(); return; }
      const s = simOf(from + real);
      try { gl.draw(s, fit); write(s); } catch (err) { console.warn('[locationReveal] stopped', err); finish(); return; }
      // It fades up over the gate's own doors, which it matches, then they can go.
      root.style.opacity = real < 0.1 ? String(real / 0.1) : '1';
      // The wave that washes the world away brings hero select in behind it.
      if (!arrived && s >= washAt(n)) { arrived = true; setAtmosphereCovered(false); syncAtmosphere(s); (r.arrive ?? arriveHeroSelect)(waveFrom(root, gl, stagePx, n)); }
      if (!covered && real > 0.14) { covered = true; setAtmosphereCovered(!arrived); onCovered(); }
      raf = requestAnimationFrame(tick);
    };
    root.style.opacity = '0';
    endNow = () => {
      endNow = null;
      cut = true;
      setAtmosphereCovered(false);
      window.setTimeout(finish, STOP_MS);
      w?.sound.stop();
      root.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: STOP_MS, fill: 'forwards' });
    };
    raf = requestAnimationFrame(tick);
  });
}

/** How long a reveal that is cut short takes to fade. */
const STOP_MS = 260;

/** Where the leaving wave starts on screen, and when it reaches a point. */
function waveFrom(root: HTMLElement, gl: RevealGl, stagePx: number, n: number): ArriveFrom {
  const box = root.getBoundingClientRect();
  const scale = root.clientWidth ? box.width / root.clientWidth : 1; // the game's stage may be scaled
  const unit = Math.max(1, stagePx * scale);
  return {
    x: box.left + box.width / 2 + (gl.vp[0] - 0.5) * A * unit,
    y: box.top + box.height / 2 + (gl.vp[1] - 0.5) * unit,
    delayMs: (px) => washReach(px / unit, n, gl.far) * 1000,
  };
}

/** The light version's own moments (s from when the doors start to part). */
export const LIGHT = { name: 1.1, posters: 2.6, step: POST_GAP, hold: HOLD, fade: 0.55 } as const;
export const lightSeconds = (n: number): number => (n === 0 ? 0.35 + LIGHT.fade : LIGHT.posters + Math.max(0, n - 1) * LIGHT.step + 0.5 + LIGHT.hold + LIGHT.fade);

/**
 * THE LIGHT VERSION, in `under` (behind the gate's doors, which the gate opens itself). `partAt` (ms): when they start to
 * part. Resolves when it has faded away. CSS fades only. It rejects only if it could not start at all.
 */
export function playLightReveal(under: HTMLElement, r: LocationRevealRequest, partAt: number): Promise<void> {
  const w = warm;
  warm = null;
  w?.gl?.drop();
  const n = r.tribes.length;
  return new Promise<void>((resolve) => {
    const root = el('div', 'lrev lrev-light', under);
    const pic = el('div', 'lrev-pic', root);
    pic.style.backgroundImage = `url(${locationArt(r.location.id, 'flat')})`;
    const sheets = el('div', 'lrev-words', root);
    const posters = r.tribes.map((t) => {
      const e = el('div', 'lrev-sheet', sheets);
      e.style.backgroundImage = `url(${locationArt(r.location.id, `poster-${t}`)})`;
      return e;
    });
    const words = n > 0 ? buildWords(root, r) : null; // a journey: the place alone, no name
    words?.letters.forEach((e) => { e.style.opacity = '1'; });
    const unwatch = watchSize(root, (stageH, fit) => {
      const u = stageH * fit;
      words?.layout(stageH, fit);
      sheets.style.setProperty('--lru', `${u}px`);
      posters.forEach((e, i) => {
        const p = posterRest(i, n);
        e.style.left = `calc(50% + ${((p.x - POSTER_W / 2) * u).toFixed(1)}px)`;
        e.style.top = `calc(50% + ${((p.y - POSTER_H / 2) * u).toFixed(1)}px)`;
        e.style.width = `${(POSTER_W * u).toFixed(1)}px`;
        e.style.height = `${(POSTER_H * u).toFixed(1)}px`;
        e.style.rotate = `${(p.angle * 57.3).toFixed(2)}deg`;
      });
    });
    const timers: number[] = [];
    if (w && !w.gl) w.sound.play(n, partAt / 1000); // a machine that turned out too slow has the full version's clips: it stays quiet
    const later = (sec: number, fn: () => void): void => { timers.push(window.setTimeout(fn, partAt + sec * 1000)); };
    if (words) later(LIGHT.name, () => { words.title.classList.add('on'); });
    posters.forEach((e, i) => later(LIGHT.posters + i * LIGHT.step, () => { e.classList.add('on'); words?.names[i]!.classList.add('on'); }));
    const total = lightSeconds(n);
    const finish = (): void => { endNow = null; timers.forEach((t) => window.clearTimeout(t)); unwatch(); w?.sound.stop(); root.remove(); resolve(); };
    endNow = () => { endNow = null; timers.forEach((t) => window.clearTimeout(t)); root.classList.add('off'); timers.push(window.setTimeout(finish, LIGHT.fade * 1000)); };
    later(total - LIGHT.fade, () => {
      root.classList.add('off');
      const box = root.getBoundingClientRect();
      (r.arrive ?? arriveHeroSelect)({ x: box.left + box.width / 2, y: box.top + box.height / 2, delayMs: (px) => 120 + (px / Math.max(1, box.height)) * 380 });
    });
    later(total, finish);
  });
}
