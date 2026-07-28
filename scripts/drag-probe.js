/*  ASCENT — drag-feel probe.
 *
 *  Measures what "snappy" actually IS: the pixel gap between your cursor and the card that's chasing it,
 *  sampled every frame. Two machines with identical tuner values can still feel different, and this says
 *  which of the three possible reasons it is — the display, the mouse, or the frame budget.
 *
 *  USAGE
 *    1. Open the game on the Recruit screen (dev server is fine).
 *    2. Paste this whole file into the console (F12) and press Enter.
 *    3. Pick up a card and drag it around in circles for ~5 seconds, then drop it.
 *    4. Read the table. Run it on both machines and compare.
 *
 *  WHAT THE NUMBERS MEAN
 *    medianGapPx  — how far the card trails the cursor in steady motion. THIS is the feel. Bigger = heavier.
 *    frameMs      — your display's frame budget (16.7 = 60Hz, 6.9 = 144Hz).
 *    longFrames   — frames that overran badly. High here = the page is janking, not the drag config.
 *    pointerHz    — how often the OS gives the page a new cursor position. A 125Hz mouse feeds the drag
 *                   8ms-stale targets; a 1000Hz mouse feeds fresh ones. No tuner value can compensate.
 *    gapAtSameSpeed — the gap normalised by how fast you were actually moving, so a gentle drag on one
 *                   machine and a fast one on the other stay comparable. Compare THIS across machines.
 */
(() => {
  const S = { pts: 0, t0: performance.now(), samples: [], dts: [], lastPointer: null, lastCard: null,
              firstMove: 0, lastMove: 0 };

  const onMove = (e) => {
    // Rate is measured over the MOVING window, not the probe's lifetime — dividing by idle time before you
    // picked a card up under-reported it badly (it read 4Hz on a 60Hz stream in testing).
    const t = performance.now();
    if (!S.firstMove) S.firstMove = t;
    S.lastMove = t;
    S.pts++;
    S.lastPointer = { x: e.clientX, y: e.clientY };
  };
  window.addEventListener('pointermove', onMove, { passive: true });

  let last = performance.now();
  let raf = 0;
  const tick = (now) => {
    const dt = now - last;
    last = now;
    raf = requestAnimationFrame(tick);
    S.dts.push(dt);
    const card = document.querySelector('.dragcard');
    if (!card || !S.lastPointer) { S.lastCard = null; return; }
    const r = card.getBoundingClientRect();
    const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    // Cursor speed this frame, so a slow drag and a fast drag stay comparable between machines.
    const speed = S.lastCard ? Math.hypot(c.x - S.lastCard.x, c.y - S.lastCard.y) / Math.max(dt, 1) : 0;
    S.lastCard = c;
    S.samples.push({ gap: Math.hypot(S.lastPointer.x - c.x, S.lastPointer.y - c.y), speed });
  };
  raf = requestAnimationFrame(tick);

  const pct = (arr, p) => (arr.length ? arr.slice().sort((a, b) => a - b)[Math.floor(arr.length * p)] : 0);

  const report = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', onMove);
    const moveSecs = Math.max(0.001, (S.lastMove - S.firstMove) / 1000);
    // Only frames where the card was actually moving — a parked card has a ~0 gap and would flatter everyone.
    const moving = S.samples.filter((s) => s.speed > 0.05);
    const gaps = moving.map((s) => s.gap);
    const out = {
      draggedFrames: moving.length,
      medianGapPx: +pct(gaps, 0.5).toFixed(1),
      p90GapPx: +pct(gaps, 0.9).toFixed(1),
      gapAtSameSpeed: +(pct(gaps, 0.5) / Math.max(pct(moving.map((s) => s.speed), 0.5), 0.001)).toFixed(1),
      frameMs: +pct(S.dts, 0.5).toFixed(1),
      p95FrameMs: +pct(S.dts, 0.95).toFixed(1),
      longFrames: S.dts.filter((d) => d > 30).length,
      pointerHz: Math.round(S.pts / moveSecs),
      dpr: window.devicePixelRatio,
      zoom: +(window.outerWidth / window.innerWidth).toFixed(2),
    };
    if (!moving.length) {
      console.warn('No drag detected — pick up a card and move it, then call __dragProbe.report() again.');
      return out;
    }
    console.log('%cASCENT drag probe', 'font-size:14px;font-weight:bold;color:#6cf');
    console.table(out);
    console.log(JSON.stringify(out));
    return out;
  };

  window.__dragProbe = { report, state: S };
  console.log('%cDrag probe armed.', 'color:#6f6;font-weight:bold',
    'Drag a card around for ~5s, drop it, then run: __dragProbe.report()');
})();
