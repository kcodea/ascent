/**
 * The top section tuner: a panel for moving and resizing the scene's pieces live. Opened by adding `?tune` to the page
 * address, and loaded only then, so an ordinary visitor never downloads it. Nothing here changes the page for anyone
 * else: the numbers are kept in this browser and copied out as text to be written into the stylesheet by hand.
 *
 * A piece's offset uses the CSS `translate` and `scale` properties, which stack with the `transform` the mouse parallax
 * writes, so the two never fight. Offsets are in the scene's own unit (`--u`, or `vw` on a phone) so they hold at any
 * window size.
 */

interface Tune {
  x: number;
  y: number;
  size: number;
  depth: number;
}
type Layout = 'desktop' | 'phone';
type Saved = Record<Layout, Record<string, Tune>>;

const KEY = 'ascent-site-top-tune';
const PIECES: ReadonlyArray<readonly [id: string, label: string, selector: string]> = [
  ['left-front', 'Drakko + Paragon', '.top__team--left-front'],
  ['left-back', 'Brian + Lastlight', '.top__team--left-back'],
  ['right-front', 'Sylus + Voss', '.top__team--right-front'],
  ['right-back', 'Oona + Recaller', '.top__team--right-back'],
  ['sky', 'Sky', '.top__sky'],
  ['logo', 'Logo', '.top__crest'],
  ['words', 'Headline and button', '.top__inner'],
];

const CSS = `
.tuner{position:fixed;top:12px;right:12px;z-index:9999;width:270px;padding:12px;border-radius:10px;font:13px/1.35 system-ui,sans-serif;
  color:#f3ecdd;background:#0d1220ee;border:1px solid #c9a24a;box-shadow:0 12px 30px #000a;text-align:left}
.tuner h2{margin:0 0 8px;font:700 13px system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#e9c46a}
.tuner select,.tuner button{font:inherit;color:inherit;background:#1b2338;border:1px solid #47506b;border-radius:6px;padding:5px 8px}
.tuner select{width:100%;margin-bottom:8px}
.tuner label{display:grid;grid-template-columns:44px 1fr 52px;align-items:center;gap:6px;margin:4px 0}
.tuner input[type=range]{width:100%}
.tuner input[type=number]{width:52px;font:inherit;color:inherit;background:#1b2338;border:1px solid #47506b;border-radius:6px;padding:3px 4px}
.tuner .row{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}
.tuner .hint{margin:8px 0 0;font-size:12px;color:#aab2c8}
.tuner .mode{float:right;font-weight:400;letter-spacing:0;text-transform:none;color:#aab2c8}
.tuner-on [data-tune-pick]{outline:2px dashed #e9c46a;outline-offset:-2px}
.tuner-on .top{touch-action:none}
`;

const round = (n: number, step: number): number => Math.round(n / step) * step;

export function initTuner(doc: Document): void {
  const win = doc.defaultView;
  const stage = doc.querySelector<HTMLElement>('.top');
  if (!win || !stage) return;

  const els = new Map<string, HTMLElement>();
  for (const [id, , sel] of PIECES) {
    const el = stage.querySelector<HTMLElement>(sel);
    if (el) els.set(id, el);
  }
  const base = new Map<string, number>([...els].map(([id, el]) => [id, Number(el.dataset.depth) || 0]));

  const layout = (): Layout => (win.innerWidth >= 760 ? 'desktop' : 'phone');
  const unit = (): string => (layout() === 'desktop' ? 'var(--u)' : '1vw');
  /** One unit in pixels, for turning a drag into units. */
  const unitPx = (): number => (layout() === 'desktop' ? Math.min(win.innerWidth / 100, (win.innerHeight * 1.7778) / 100) : win.innerWidth / 100);

  let saved: Saved = { desktop: {}, phone: {} };
  try {
    const raw = win.localStorage.getItem(KEY);
    if (raw) saved = { desktop: {}, phone: {}, ...(JSON.parse(raw) as Partial<Saved>) };
  } catch {
    /* A private window: the tuner still works, it just forgets on reload. */
  }
  const get = (id: string): Tune => (saved[layout()][id] ??= { x: 0, y: 0, size: 100, depth: base.get(id) ?? 0 });
  const store = (): void => {
    try {
      win.localStorage.setItem(KEY, JSON.stringify(saved));
    } catch {
      /* see above */
    }
  };

  const apply = (id: string): void => {
    const el = els.get(id);
    if (!el) return;
    const t = get(id);
    el.style.translate = `calc(${t.x} * ${unit()}) calc(${t.y} * ${unit()})`;
    el.style.scale = String(t.size / 100);
    if (base.has(id) && el.dataset.depth !== undefined) el.dataset.depth = String(t.depth);
  };
  const applyAll = (): void => {
    for (const id of els.keys()) apply(id);
  };

  doc.head.append(Object.assign(doc.createElement('style'), { textContent: CSS }));
  doc.documentElement.classList.add('tuner-on');
  const panel = doc.createElement('div');
  panel.className = 'tuner';
  panel.innerHTML = `<h2>Top section tuner <span class="mode" data-mode></span></h2>
    <select data-pick aria-label="Piece to adjust">${PIECES.filter(([id]) => els.has(id)).map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select>
    ${(['x', 'y', 'size', 'depth'] as const)
      .map((k) => {
        const [min, max, step] = k === 'size' ? [30, 250, 1] : k === 'depth' ? [0, 80, 1] : [-60, 60, 0.25];
        const name = { x: 'Across', y: 'Down', size: 'Size %', depth: 'Slide' }[k];
        return `<label>${name}<input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" /><input type="number" data-k="${k}" step="${step}" aria-label="${name}" /></label>`;
      })
      .join('')}
    <div class="row"><button type="button" data-copy>Copy settings</button><button type="button" data-reset-one>Reset piece</button><button type="button" data-reset-all>Reset all</button></div>
    <p class="hint">Pick a piece, then drag anywhere on the picture to move it. Arrow keys nudge. Scroll over the picture to resize. "Slide" is how far it moves with the mouse. Phone and desktop are tuned separately: narrow the window to tune the phone layout.</p>`;
  doc.body.append(panel);

  const pick = panel.querySelector<HTMLSelectElement>('[data-pick]')!;
  const mode = panel.querySelector<HTMLElement>('[data-mode]')!;
  const inputs = [...panel.querySelectorAll<HTMLInputElement>('input[data-k]')];
  const current = (): string => pick.value;

  const show = (): void => {
    const t = get(current());
    mode.textContent = layout();
    for (const i of inputs) {
      const k = i.dataset.k as keyof Tune;
      i.value = String(t[k]);
      i.disabled = k === 'depth' && !base.get(current());
    }
    for (const [id, el] of els) el.toggleAttribute('data-tune-pick', id === current());
  };
  const set = (patch: Partial<Tune>): void => {
    Object.assign(get(current()), patch);
    apply(current());
    store();
    show();
  };

  pick.addEventListener('change', show);
  for (const i of inputs) i.addEventListener('input', () => set({ [i.dataset.k as keyof Tune]: Number(i.value) }));

  panel.querySelector('[data-reset-one]')!.addEventListener('click', () => {
    delete saved[layout()][current()];
    apply(current());
    store();
    show();
  });
  panel.querySelector('[data-reset-all]')!.addEventListener('click', () => {
    saved[layout()] = {};
    applyAll();
    store();
    show();
  });
  const copyBtn = panel.querySelector<HTMLButtonElement>('[data-copy]')!;
  copyBtn.addEventListener('click', () => {
    const text = JSON.stringify(saved, null, 1);
    const done = (ok: boolean): void => {
      copyBtn.textContent = ok ? 'Copied' : 'Copy failed: see console';
      if (!ok) console.log(text);
      win.setTimeout(() => (copyBtn.textContent = 'Copy settings'), 1600);
    };
    win.navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
  });

  // Drag anywhere on the picture to move the picked piece.
  let drag: { x: number; y: number; t: Tune; px: number } | null = null;
  stage.addEventListener('pointerdown', (e) => {
    if ((e.target as Element).closest('a, button')) return;
    const t = get(current());
    drag = { x: e.clientX, y: e.clientY, t: { ...t }, px: unitPx() };
    stage.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    set({ x: round(drag.t.x + (e.clientX - drag.x) / drag.px, 0.25), y: round(drag.t.y + (e.clientY - drag.y) / drag.px, 0.25) });
  });
  const drop = (): void => void (drag = null);
  stage.addEventListener('pointerup', drop);
  stage.addEventListener('pointercancel', drop);
  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      set({ size: Math.max(30, Math.min(250, get(current()).size + (e.deltaY < 0 ? 1 : -1))) });
    },
    { passive: false },
  );
  doc.addEventListener('keydown', (e) => {
    if ((e.target as Element).closest('input, select')) return;
    const step = e.shiftKey ? 1 : 0.25;
    const t = get(current());
    const move: Record<string, Partial<Tune>> = {
      ArrowLeft: { x: t.x - step },
      ArrowRight: { x: t.x + step },
      ArrowUp: { y: t.y - step },
      ArrowDown: { y: t.y + step },
    };
    if (!move[e.key]) return;
    e.preventDefault();
    set(move[e.key]);
  });
  win.addEventListener('resize', () => {
    applyAll();
    show();
  });

  applyAll();
  show();
}
