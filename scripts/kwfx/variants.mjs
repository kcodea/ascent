// The baked keyword auras: one entry per picture, shared by the capture and the comparison (scripts/kwfx/*).

/**
 * One entry per baked picture.
 *  kw / tint  what the capture card carries;  sel  the live aura root inside the card
 *  loop  seconds;  fps;  scale  capture pixels per CSS px at 1920 x 1080 (card art width 138 px)
 *  sym   blades per ring by element class: a ring of k blades repeats k times a turn (flurryConfig `blades`,
 *        executeConfig `arcBlades`; change these with the config)
 *  box   'art' = crop to the largest art window (the card clips it there anyway); otherwise the alpha bounds
 *  crf   AV1 quality (lower = better, larger)
 */
export const VARIANTS = [
  { id: 'rise', kw: ['R'], sel: '.reborn', loop: 9.95, fps: 30, scale: 1, box: 'art', crf: 30 },
  { id: 'rise-blue', kw: ['R'], tint: 'blue', sel: '.reborn', loop: 9.95, fps: 30, scale: 1, box: 'art', crf: 30 },
  { id: 'rise-red', kw: ['R'], tint: 'red', sel: '.reborn', loop: 9.95, fps: 30, scale: 1, box: 'art', crf: 30 },
  { id: 'flurry', kw: ['W'], sel: '.flurry', loop: 6.8, fps: 60, scale: 1, sym: { 'fl-ring': 3 }, crf: 30 },
  { id: 'execute', kw: ['V'], sel: '.execute', loop: 12.15, fps: 30, scale: 1, sym: { 'ex-arc': 6 }, crf: 30 },
  { id: 'rebirth', kw: ['RB'], sel: '.rebirth-crown', loop: 13.75, fps: 30, scale: 1, crf: 30 },
  { id: 'rebirth-shield', kw: ['RB', 'T'], sel: '.rebirth-crown', loop: 13.75, fps: 30, scale: 1, crf: 30 },
];
/** The largest art window around the Rise aura's centre, in card-art widths (measured: the oval's overfilled art box
 *  is -0.467..0.467 x -0.636..0.564, Taunt's heater -0.404..0.404 x -0.52..0.465), kept symmetric. */
export const ART_HALF = [0.48, 0.65];
/** Half-size of the photographed square around the aura's centre, in card-art widths. */
export const REACH = 2.3;

/**
 * Runs in the page. `__kwcap.prep(sel, sym, tint, isolate)` picks the middle board card's live aura, pauses every
 * animation on the page and returns the aura's centre and its animations; `seek(t, L)` puts the aura at loop time t.
 * With `isolate`, everything but the aura is hidden and its ancestors' clips and filters are lifted, so a screenshot
 * with a transparent default background is the aura alone.
 */
export const AURA_PAGE_JS = `(() => {
  const st = document.createElement('style');
  st.textContent = 'html.kwcap-iso, html.kwcap-iso body { background: transparent !important; } html.kwcap-iso * { visibility: hidden !important; } html.kwcap-iso .kwcap-root, html.kwcap-iso .kwcap-root * { visibility: visible !important; } html.kwcap-iso .kwcap-anc { filter: none !important; clip-path: none !important; overflow: visible !important; -webkit-mask: none !important; mask: none !important; opacity: 1 !important; contain: none !important; border-radius: 0 !important; }';
  document.head.appendChild(st);
  window.__kwcap = {
    prep(sel, sym, tint, isolate) {
      document.documentElement.classList.toggle('kwcap-iso', !!isolate);
      document.querySelectorAll('.kwcap-root').forEach((e) => e.classList.remove('kwcap-root'));
      document.querySelectorAll('.kwcap-anc').forEach((e) => e.classList.remove('kwcap-anc'));
      document.querySelectorAll('.card.compact').forEach((e) => e.classList.remove('risetint-blue', 'risetint-red'));
      const cards = [...document.querySelectorAll('[data-zone=warband] .card.compact')];
      const card = cards[Math.floor(cards.length / 2)]; const el = card && card.querySelector(sel);
      if (!el) return null;
      // A Rise tint is a class on the card (in a game the combat replay sets it): the capture card wears it directly.
      if (tint) card.classList.add('risetint-' + tint);
      el.classList.add('kwcap-root');
      for (let e = el.parentElement; e && e !== document.documentElement; e = e.parentElement) e.classList.add('kwcap-anc');
      const all = document.getAnimations(); all.forEach((a) => a.pause());
      this.mine = all.filter((a) => a.effect && a.effect.target && el.contains(a.effect.target)).map((a) => {
        const D = Number(a.effect.getComputedTiming().duration) / 1000; const cls = String(a.effect.target.className || '').split(/\\s+/)[0];
        return { a, D, k: (sym && sym[cls]) || 1, cls, name: a.animationName || '' };
      });
      this.others = all.filter((x) => !this.mine.some((m) => m.a === x));
      const b = el.getBoundingClientRect(); const ccw = parseFloat(getComputedStyle(card).getPropertyValue('--ccw'));
      // An aura root is transformed about its own centre, so the bounding box's centre is the layout box's centre.
      return { cx: b.left + b.width / 2, cy: b.top + b.height / 2, ccw, anims: this.mine.map((m) => ({ cls: m.cls, name: m.name, D: m.D, k: m.k })) };
    },
    /** Put every OTHER animation on the page at its start, so two page loads photograph the same card. */
    zeroOthers() { for (const a of this.others || []) { try { a.currentTime = 0; } catch {} } return 1; },
    seek(t, L) {
      for (const m of this.mine) {
        if (!(m.D > 0) || L / m.D < 0.25) continue; // a "steady" 9999 s placeholder: leave it where it is
        const n = Math.max(1, Math.round(L * m.k / m.D)) / m.k;
        m.a.currentTime = (t * n * m.D / L) * 1000;
      }
      return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))));
    },
  };
})()`;
