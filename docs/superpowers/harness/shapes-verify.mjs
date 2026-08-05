/**
 * SHAPES — three landing shapes `cascade-verify.mjs` does not cover.
 *
 *  1. FODDER: the tendril cue adopter (mid-shop Demon-eats-Fodder), never proven in a browser before this.
 *  2. RIPPLE: a `react` layer's `reach`/`order`/`gap` staggering across MULTIPLE recipients (has only ever
 *     run once, with a single recipient, since `claimStat` landed).
 *  3. VOLLEY: the degenerate order where every recipient lands together — the control that proves the
 *     grouping logic isn't accidentally staggering everything.
 *
 * Cases 2 and 3 need a `react` layer, which no shipped def carries. One is armed TEMPORARILY onto
 * `packages/ui/src/fx/defs/ruby-gem-apply.json` for the duration of this script and reverted in a `finally`
 * — the file's content is asserted byte-identical to its original before this script exits with 0.
 *
 * Every case gets a NEGATIVE CONTROL: the same measurement/assertion pipeline run against data (or code) that
 * SHOULD fail it, to prove the assertion isn't vacuous. Ripple's and volley's controls are free — each is the
 * other's dataset run through the wrong checker — so no extra browser launches or file edits are needed for
 * them. Fodder's control temporarily neutralizes the hold call in `Recruit.tsx` (also reverted + diffed).
 */
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.URL ?? 'http://localhost:5205';
const REPO = 'C:/Users/micha/Desktop/ascent/.claude/worktrees/ruby-fx';
const RECRUIT_TSX = `${REPO}/packages/ui/src/Recruit.tsx`;
const RUBY_DEF = `${REPO}/packages/ui/src/fx/defs/ruby-gem-apply.json`;
const STAT_HOLD_TS = `${REPO}/packages/ui/src/fx/statHold.ts`;

// A few frames of rAF/setTimeout jitter, applied at BOTH edges of the fodder gap window below.
const GAP_SLACK_MS = 120;

// The badge's roll duration for a 'cue'-ranked hold that doesn't specify its own `rollMs` (fodder's holds
// don't) — read from the SOURCE rather than hardcoded, because it's `fx/statHold.ts`'s own constant, shared
// by every stat hold in the game. This is deliberately NOT one of the fodder-specific tendril constants
// (`CRUMBLE_MS`/`travelMs`) the owner is about to retune — it's the generic odometer-roll length, needed to
// size how long AFTER the wiggle starts a fully-synced badge is still allowed to still be mid-roll.
function readDefaultRollMs() {
  const src = readFileSync(STAT_HOLD_TS, 'utf8');
  const m = src.match(/export const DEFAULT_ROLL_MS = (\d+);/);
  if (!m) throw new Error('DEFAULT_ROLL_MS not found in fx/statHold.ts — harness needs updating, not the product code');
  return Number(m[1]);
}
const FODDER_ROLL_MS = readDefaultRollMs();

let failures = 0;
function report(name, pass, lines) {
  console.log(`\n${pass ? 'PASS' : 'FAIL'} — ${name}`);
  for (const l of lines ?? []) console.log('  ' + l);
  if (!pass) failures++;
  return pass;
}

function gitDiffEmpty(file) {
  const out = execSync(`git diff -- "${file}"`, { cwd: REPO }).toString();
  return out.trim().length === 0;
}

async function freshPage(browser) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1800));
  await page.evaluate(() => window.useGame.getState().startSceneBuilder());
  await new Promise((r) => setTimeout(r, 900));
  return page;
}

async function withFreshPage(fn) {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=swiftshader'],
    defaultViewport: { width: 1600, height: 900 },
  });
  try {
    const page = await freshPage(browser);
    return await fn(page);
  } finally {
    await browser.close();
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// CASE 1 — FODDER TENDRIL ADOPTER
//
// DESIGN CHOICE (do not hardcode CRUMBLE_MS/travelMs): the owner intends to retune the fodder consume
// effect's timing, so this anchors to the EFFECT ITSELF rather than to a clock value. `playFodderEat`
// (Recruit.tsx) plays an impact-WIGGLE — a WAAPI `element.animate(...)` on the eater's own `.card` element —
// the instant the tendril lands, on the SAME `startAt` schedule (`CRUMBLE_MS + icfg.travelMs`, measured from
// the commit) that `holdFodderGains` uses to release the badge. The wiggle's actual on-screen start is
// measured live via `getAnimations()` (a fresh animation appearing on that element, diffed against whatever
// was already running on it), never read from source — so a retune of the tendril's flight time moves BOTH
// the wiggle and this test's anchor together, and the assertion cannot go stale.
//
// What's asserted is the RELATIONSHIP: the badge must reach its true post-consume value at or shortly after
// the wiggle starts — never before it (that would be some OTHER clock delivering the number, not the
// tendril), and never so long after that it reads as unrelated. "Shortly after" is bounded by the badge's
// own roll length (`FODDER_ROLL_MS`, read from `fx/statHold.ts` above — see the badge-odometer note in
// `analyzeFodder` for why the badge can't literally land in the same frame the wiggle starts).
//
// Real path, found by reading Recruit.tsx (holdFodderGains, the `fodderEatenSeq` layout effect) and
// packages/sim/src/reducer.ts (`injectPendingTavern` → `consumeTavernFodder`): Demons only ever eat Fodder
// that ENTERS the tavern via `pendingTavern` (Fred is `token: true`, never in the roll pool — grepped
// `packages/content/src/cards/set1/demons.ts`). `pendingTavern` is the exact mechanism Soulfeeder/Maw-of-the
// -Pit use, so seeding it and dispatching a real `roll` drives the genuine reducer path — `rollShop` →
// `injectPendingTavern` (pushes the queued Fred into `state.shop`) → `consumeTavernFodder` (the lone Demon on
// board auto-eats it, in the SAME commit) — not a synthetic mutation of `fodderEaten`/`fodderEatenSeq`.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════

async function runFodderCase(page) {
  return page.evaluate(async () => {
    const G = () => window.useGame.getState();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // A Demon eater with no battlecry/on-consume complications (Sword and Bored, tier 2, plain Slaughter
    // keyword — irrelevant here since nothing dies).
    window.useGame.setState((s) => ({ run: { ...s.run, shop: [{ uid: 'demon0', cardId: 'swordbored' }] } }));
    await sleep(150);
    G().dispatch({ type: 'buy', uid: 'demon0' });
    await sleep(150);
    const hand = G().run.hand;
    G().dispatch({ type: 'play', uid: hand[hand.length - 1].uid });
    await sleep(350);

    const eaterUid = G().run.board[0].uid;
    const readAtk = () => {
      const el = document.querySelector(`.card[data-uid="${eaterUid}"] .badge.atk .value`);
      return el ? Number(el.textContent) : NaN;
    };
    const readHp = () => {
      const el = document.querySelector(`.card[data-uid="${eaterUid}"] .badge.hp .value`);
      return el ? Number(el.textContent) : NaN;
    };
    const before = { attack: readAtk(), health: readHp() };

    // The eater's OWN card element — this is exactly what `playFodderEat`'s impact-wiggle calls
    // `.animate(...)` on (Recruit.tsx: `[data-zone="warband"] .row .card[data-uid=...]`), the observable
    // DOM signature of "the tendril landed". Snapshot whatever WAAPI animations are already running on it
    // (expected: none, at this point in the scenario) so a NEW one appearing is unambiguous.
    const eaterEl = document.querySelector(`[data-zone="warband"] .row .card[data-uid="${eaterUid}"]`);
    const baselineAnims = new Set(eaterEl ? eaterEl.getAnimations() : []);

    const samples = [];
    let wiggleAtMs = null;      // rAF-detection frame (~1 frame of quantization)
    let wiggleStartAbs = null;  // resolved 1+ frame later: the animation's own WAAPI `startTime`, sub-frame precise
    let freshAnim = null;
    const t0 = performance.now();
    const tick = () => {
      const now = performance.now();
      samples.push([Math.round(now - t0), readAtk(), readHp()]);
      if (wiggleAtMs === null && eaterEl) {
        const fresh = eaterEl.getAnimations().find((a) => !baselineAnims.has(a));
        if (fresh) { wiggleAtMs = Math.round(now - t0); freshAnim = fresh; }
      } else if (freshAnim && wiggleStartAbs === null && freshAnim.startTime != null) {
        wiggleStartAbs = freshAnim.startTime;
      }
      if (now - t0 < 3000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    // Queue a Fred into the next tavern (the real Soulfeeder/Maw mechanism) and roll — the reducer's own
    // `injectPendingTavern` → `consumeTavernFodder` path does the rest, in this one dispatch's commit.
    window.useGame.setState((s) => ({ run: { ...s.run, pendingTavern: ['fred'] } }));
    G().dispatch({ type: 'roll' });
    await sleep(3050);

    const eaten = G().run.fodderEaten ?? [];
    const gain = eaten.find((e) => e.eaterUid === eaterUid);
    const finalCard = G().run.board.find((c) => c.uid === eaterUid);

    // Prefer the WAAPI-resolved absolute start time (sub-frame precise) once it's available; both it and
    // the rAF-detection frame are measured against the same `t0`, so they agree to within ~1 frame.
    const wiggleMs = wiggleStartAbs !== null ? Math.round(wiggleStartAbs - t0) : wiggleAtMs;

    return {
      eaterUid,
      before,
      gain: gain ?? null,
      final: finalCard ? { attack: finalCard.attack, health: finalCard.health } : null,
      samples,
      wiggleMs,
      hasEaterEl: !!eaterEl,
    };
  });
}

function analyzeFodder(data) {
  const { before, gain, final, samples, wiggleMs, hasEaterEl } = data;
  if (!gain || !final) {
    return { ok: false, reason: 'no shop consume was recorded (fodderEaten never fired)' };
  }
  if (!hasEaterEl) {
    return { ok: false, reason: "eater's card element not found in the DOM — cannot anchor to the wiggle" };
  }
  const trueFinalAtk = before.attack + gain.gainA;
  const trueFinalHp = before.health + gain.gainH;
  // sim-state cross-check: the board's authoritative post-consume value must equal before + recorded gain.
  const stateConsistent = final.attack === trueFinalAtk && final.health === trueFinalHp;

  const wiggleFound = wiggleMs !== null;
  const landedSample = samples.find(([, a, h]) => a === trueFinalAtk && h === trueFinalHp);
  const landed = landedSample ? landedSample[0] : null;

  // THE ANCHOR CHECK. The badge is a rounding odometer (`fx/statHold.ts` `heldFor`): with `reel:0` (fodder's
  // holds carry no wobble) and an integer delta, the displayed value is `round(delta * (1 - revealed))` —
  // it physically cannot move until the continuous `revealed` ramp crosses the 0.5 threshold, so a
  // genuinely-synced badge lands somewhat AFTER the wiggle starts, not in the same frame — by up to one full
  // roll (`FODDER_ROLL_MS`). What must NEVER happen is the badge reaching its final value BEFORE the wiggle
  // has even started (that's a different, unrelated clock — see the negative control below) or so long
  // after that the two are no longer plausibly the same event.
  const gap = landed !== null && wiggleFound ? landed - wiggleMs : null;
  const gapOk = gap !== null && gap >= -GAP_SLACK_MS && gap <= FODDER_ROLL_MS + GAP_SLACK_MS;

  // invariant: never below `before`, never above true final, at every sampled frame.
  const invariant = samples.every(([, a, h]) =>
    a >= before.attack && a <= trueFinalAtk && h >= before.health && h <= trueFinalHp);

  return {
    ok: stateConsistent && wiggleFound && landed !== null && gapOk && invariant,
    stateConsistent, wiggleFound, wiggleMs, landed, gap, gapOk, invariant,
    before, trueFinalAtk, trueFinalHp, gain,
  };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// CASES 2 & 3 — RIPPLE and VOLLEY
//
// A carrying `react` layer is armed TEMPORARILY on `ruby-gem-apply.json` (reach:'allies' so it spreads across
// every board minion, `carries:true`, a non-zero `roll`, `reel:0` for a deterministic — no-wobble — landing
// reading). Fired with a SINGLE `rubyLandedFx` entry (the middle board minion as subject) so exactly one
// `playDef` call happens and `reach` alone does the spreading — NOT four separate cascading fires, which
// would overlap four independent ripples on the same uids and make the ring measurement meaningless.
//
// The other four minions still have something to reveal because ANY attack/health change places an
// `intrinsic` hold automatically (`Card.tsx`, unconditional on any buff — see fx/statHold.ts's `HoldOrigin`
// doc) — so bumping every board minion's stats via `setState` is enough; `claimStat` promotes each live hold
// (whatever rank) to `effect` as the layer's `build()` walks the reach's rings.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════

const REACT_GAP = 150;
const REACT_HOLD = 200;
const REACT_PEAK = 0.35;
const REACT_ROLL = 250;

function reactLayer(order) {
  return {
    primitive: 'react',
    name: `shapes-verify ${order} probe`,
    anchor: 'target',
    at: 0,
    params: {
      part: 'card', reach: 'allies', order, gap: REACT_GAP, carries: true,
      roll: REACT_ROLL, reel: 0, falloff: 0, hold: REACT_HOLD, peak: REACT_PEAK,
      scale: 1, squash: 0, lift: 0, nudge: 0, shakes: 0, spin: 0, dip: 0, ease: 'out',
    },
  };
}

async function runShapeCase(order) {
  const original = readFileSync(RUBY_DEF, 'utf8');
  const def = JSON.parse(original);
  def.duration = Math.max(def.duration, 2200); // headroom so nothing tears the layer down early
  def.layers = [...def.layers, reactLayer(order)];
  writeFileSync(RUBY_DEF, JSON.stringify(def, null, 2) + '\n');
  console.log(`  (armed a '${order}' react layer on ruby-gem-apply.json, waiting for HMR)`);
  await new Promise((r) => setTimeout(r, 3000));

  try {
    return await withFreshPage(async (page) => page.evaluate(async () => {
      const G = () => window.useGame.getState();
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

      const distinctIds = new Set();
      for (let rolls = 0; distinctIds.size < 5 && rolls < 14; rolls++) {
        for (const o of G().run.shop) distinctIds.add(o.cardId);
        if (distinctIds.size < 5) { G().dispatch({ type: 'roll' }); await sleep(120); }
      }
      const cardIds = [...distinctIds].slice(0, 5);
      for (let i = 0; i < 5; i++) {
        window.useGame.setState((s) => ({ run: { ...s.run, shop: [{ uid: 'e' + i, cardId: cardIds[i] }] } }));
        await sleep(150);
        G().dispatch({ type: 'buy', uid: 'e' + i });
        await sleep(150);
        const h = G().run.hand;
        G().dispatch({ type: 'play', uid: h[h.length - 1].uid });
        await sleep(350);
      }

      const uids = G().run.board.map((m) => m.uid);
      const subject = uids[2]; // middle of 5 — symmetric rings both directions
      const readAtk = (u) => {
        const el = document.querySelector(`.card[data-uid="${u}"] .badge.atk .value`);
        return el ? Number(el.textContent) : NaN;
      };
      const before = Object.fromEntries(uids.map((u) => [u, readAtk(u)]));

      const samples = [];
      const t0 = performance.now();
      const tick = () => {
        const row = {};
        for (const u of uids) row[u] = readAtk(u);
        samples.push([Math.round(performance.now() - t0), row]);
        if (performance.now() - t0 < 2600) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);

      window.useGame.setState((s) => ({
        run: {
          ...s.run,
          board: s.run.board.map((c) => ({ ...c, attack: c.attack + 3, health: c.health + 3 })),
          rubyLandedFx: [{ uid: subject, count: 1 }],
          rubyLandedFxSeq: (s.run.rubyLandedFxSeq ?? 0) + 1,
        },
      }));
      await sleep(2700);

      const finalBoard = Object.fromEntries(G().run.board.map((c) => [c.uid, c.attack]));
      return { uids, subject, before, finalBoard, samples };
    }));
  } finally {
    writeFileSync(RUBY_DEF, original);
  }
}

function analyzeShape(data) {
  const { uids, before, finalBoard, samples } = data;
  const settledAt = {};
  for (const [t, row] of samples) {
    for (const u of uids) {
      if (settledAt[u] === undefined && row[u] === finalBoard[u]) settledAt[u] = t;
    }
  }
  const invariantOk = uids.every((u) => {
    const lo = Math.min(before[u], finalBoard[u]);
    const hi = Math.max(before[u], finalBoard[u]);
    return samples.every(([, row]) => {
      const v = row[u];
      return !Number.isFinite(v) || (v >= lo && v <= hi);
    });
  });
  const allSettled = uids.every((u) => settledAt[u] !== undefined);
  return { settledAt, invariantOk, allSettled };
}

// ring membership for a 5-wide board, subject at index 2: [d2, d1, d0, d1, d2]
function ringGroups(uids) {
  return { ring0: [uids[2]], ring1: [uids[1], uids[3]], ring2: [uids[0], uids[4]] };
}

/** Ripple check: within-ring members land together; ring-to-ring gap is close to REACT_GAP. */
function checkRipple(uids, settledAt) {
  const { ring0, ring1, ring2 } = ringGroups(uids);
  const t0 = settledAt[ring0[0]];
  const t1a = settledAt[ring1[0]], t1b = settledAt[ring1[1]];
  const t2a = settledAt[ring2[0]], t2b = settledAt[ring2[1]];
  if ([t0, t1a, t1b, t2a, t2b].some((t) => t === undefined)) return { ok: false, reason: 'not everyone settled' };
  const withinRing1 = Math.abs(t1a - t1b);
  const withinRing2 = Math.abs(t2a - t2b);
  const ring1avg = (t1a + t1b) / 2, ring2avg = (t2a + t2b) / 2;
  const gap01 = ring1avg - t0, gap12 = ring2avg - ring1avg;
  const gapOk = (g) => g > REACT_GAP * 0.5 && g < REACT_GAP * 1.6;
  const ok = withinRing1 < REACT_GAP * 0.5 && withinRing2 < REACT_GAP * 0.5 && gapOk(gap01) && gapOk(gap12);
  return { ok, t0, ring1avg, ring2avg, withinRing1, withinRing2, gap01, gap12 };
}

/** Volley check: everyone (whole board, not just rings) lands within a small spread of each other. */
function checkVolley(uids, settledAt) {
  const ts = uids.map((u) => settledAt[u]);
  if (ts.some((t) => t === undefined)) return { ok: false, reason: 'not everyone settled' };
  const spread = Math.max(...ts) - Math.min(...ts);
  return { ok: spread < REACT_GAP * 0.6, spread, ts };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// RUN
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════

console.log('══ CASE 1 — fodder tendril adopter ══');
{
  const primary = await withFreshPage((page) => runFodderCase(page));
  const a = analyzeFodder(primary);
  report('fodder: badge lands in sync with the impact-wiggle (tendril arrival), invariant held', a.ok, [
    `eater ${primary.eaterUid}: before ${JSON.stringify(a.before)}, true final atk=${a.trueFinalAtk} hp=${a.trueFinalHp}`,
    `gain recorded by sim: ${JSON.stringify(a.gain)}`,
    `state-consistent (final == before+gain): ${a.stateConsistent}`,
    `impact-wiggle observed (getAnimations() diff) at: ${a.wiggleMs}ms`,
    `badge reached true final value at: ${a.landed}ms`,
    `gap (badge − wiggle): ${a.gap}ms — required window [${-GAP_SLACK_MS}, ${FODDER_ROLL_MS + GAP_SLACK_MS}]ms`,
    `invariant (never below before, never above final) held: ${a.invariant}`,
  ]);

  // Negative control: disable the hold call in Recruit.tsx and confirm the same case FAILS.
  const originalTsx = readFileSync(RECRUIT_TSX, 'utf8');
  const NEEDLE = "    for (const g of gains) holdStat(g.uid, { attack: g.attack, health: g.health }, { origin: 'cue', startAt });";
  const patched = originalTsx.split(NEEDLE);
  if (patched.length !== 2) {
    report('fodder negative control (hold disabled)', false, ['could not find the expected holdFodderGains line to patch — harness needs updating, not the product code']);
  } else {
    writeFileSync(RECRUIT_TSX, patched.join("    void gains; void startAt; // NEGATIVE CONTROL (shapes-verify.mjs): hold intentionally disabled\n"));
    console.log('  (disabled the fodder hold call, waiting for HMR)');
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const negative = await withFreshPage((page) => runFodderCase(page));
      const na = analyzeFodder(negative);
      // PRIOR HARNESS CORRECTION (kept for history — not a product fix, see the report): the FIRST version of
      // this control asserted `!withheld-through-150ms`, expecting the badge to snap instantly once
      // `holdFodderGains` was disabled. It didn't, because `Card.tsx` places its OWN unconditional
      // `intrinsic`-rank hold on ANY attack/health change (see its "ANY stat change rolls the badge"
      // comment) — disabling only the fodder-specific `cue` hold doesn't remove withholding, it falls back
      // to that universal safety net, which starts revealing at COMMIT (startAt 0) on `DEFAULT_ROLL_MS`
      // instead of the tendril-synced schedule. Real, intentional product behaviour (statHold.ts's "fail
      // OPEN" design), not a bug — so the correction was to the assertion, not the product.
      //
      // WIGGLE-ANCHORED VERSION: disabling `holdFodderGains`'s hold call does NOT touch the wiggle — that's
      // still scheduled by `playFodderEat`'s own `wiggleT` timeout, unrelated code. So the wiggle fires at
      // roughly the SAME time as in the primary run, but the badge is now delivered by the generic fallback
      // on its OWN clock (from commit, not from the tendril's arrival) — which lands the badge LONG BEFORE
      // the wiggle even starts. The correct failure signature here is `gap` deeply NEGATIVE (badge finished
      // well before the wiggle fired) — a full `FODDER_ROLL_MS` more negative than the passing window's own
      // floor, so it can't be mistaken for ordinary jitter around a borderline-passing gap.
      const controlFailsForRightReason =
        na.wiggleFound && na.landed !== null && na.gap !== null && na.gap < -FODDER_ROLL_MS;
      const controlWorks = !na.ok && controlFailsForRightReason;
      report('fodder negative control correctly FAILS (badge lands well BEFORE the wiggle — the generic fallback clock, not the tendril-synced one)', controlWorks, [
        `primary (hold enabled): wiggle at ${a.wiggleMs}ms, badge landed at ${a.landed}ms, gap ${a.gap}ms`,
        `control (hold disabled): wiggle at ${na.wiggleMs}ms, badge landed at ${na.landed}ms, gap ${na.gap}ms — expected well under -${FODDER_ROLL_MS}ms (badge finishes before the wiggle even starts)`,
      ]);
    } finally {
      writeFileSync(RECRUIT_TSX, originalTsx);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  const clean = gitDiffEmpty(RECRUIT_TSX);
  report('Recruit.tsx reverted (git diff empty)', clean);
}

console.log('\n══ CASES 2 & 3 — ripple and volley ══');
{
  const rippleData = await runShapeCase('ripple');
  const rippleClean1 = gitDiffEmpty(RUBY_DEF);
  report('ruby-gem-apply.json reverted after ripple run (git diff empty)', rippleClean1);

  const volleyData = await runShapeCase('volley');
  const rippleClean2 = gitDiffEmpty(RUBY_DEF);
  report('ruby-gem-apply.json reverted after volley run (git diff empty)', rippleClean2);

  const rippleAnalysis = analyzeShape(rippleData);
  const volleyAnalysis = analyzeShape(volleyData);

  const rippleCheck = checkRipple(rippleData.uids, rippleAnalysis.settledAt);
  report('ripple: rings land together, ring-to-ring gap ≈ gap', rippleAnalysis.invariantOk && rippleCheck.ok, [
    `uids in board order: ${JSON.stringify(rippleData.uids)}, subject: ${rippleData.subject}`,
    `settledAt: ${JSON.stringify(rippleAnalysis.settledAt)}`,
    `ring0 settle: ${rippleCheck.t0}ms`,
    `ring1 avg settle: ${rippleCheck.ring1avg}ms (within-ring spread ${rippleCheck.withinRing1}ms, gap from ring0: ${rippleCheck.gap01}ms)`,
    `ring2 avg settle: ${rippleCheck.ring2avg}ms (within-ring spread ${rippleCheck.withinRing2}ms, gap from ring1: ${rippleCheck.gap12}ms)`,
    `invariant held: ${rippleAnalysis.invariantOk}`,
  ]);

  const volleyCheck = checkVolley(volleyData.uids, volleyAnalysis.settledAt);
  report('volley: every recipient lands together (spread near zero)', volleyAnalysis.invariantOk && volleyCheck.ok, [
    `uids in board order: ${JSON.stringify(volleyData.uids)}, subject: ${volleyData.subject}`,
    `settledAt: ${JSON.stringify(volleyAnalysis.settledAt)}`,
    `spread across all 5: ${volleyCheck.spread}ms`,
    `invariant held: ${volleyAnalysis.invariantOk}`,
  ]);

  // Negative controls — free, reusing the other run's data against the wrong checker.
  const rippleControl = checkRipple(volleyData.uids, volleyAnalysis.settledAt);
  report('ripple negative control: volley data correctly FAILS the ring-gap check', !rippleControl.ok, [
    `volley data through ripple\u2019s ring-gap check: ${JSON.stringify(rippleControl)}`,
  ]);

  const volleyControl = checkVolley(rippleData.uids, rippleAnalysis.settledAt);
  report('volley negative control: ripple data correctly FAILS the near-zero-spread check', !volleyControl.ok, [
    `ripple data through volley\u2019s spread check: ${JSON.stringify(volleyControl)}`,
  ]);
}

console.log(`\n${failures === 0 ? 'ALL SHAPES PASS' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
