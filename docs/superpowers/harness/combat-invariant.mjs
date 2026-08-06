/**
 * COMBAT INVARIANT — the Task 4 merge gate for the combat/shop stat-hold unification.
 *
 * `useCombatReplay` / `Unit` / `Card` have no DOM harness (they're React + GSAP + rAF timing), so no unit
 * test can see a wrong number mid-fight. This drives a REAL fight (Scene Builder → a real buff source + a
 * real enemy → `faceOmen`) and samples every visible combat badge every frame, proving three properties:
 *
 *   1. INVARIANT (load-bearing): no combat badge ever prints a number below that unit's true floor or above
 *      its true ceiling, for ANY uid, at ANY sampled frame across the whole fight.
 *   2. BUFF = withheld then ROLLED: a buffed ally's badge holds its pre-buff number until the strike, then
 *      counts up through genuine intermediate values (not a snap at the reducer beat).
 *   3. DAMAGE = instant: a damaged unit's health updates with no withhold — no intermediate values, ever.
 *
 * ── the scenario ─────────────────────────────────────────────────────────────────────────────────────────
 * Board: Supporter (`supporter`, dragon, tier 2, "Rally: give 2 friendly Dragons +1/+2" on `onAttack`) +
 * Bard (`frontdrake`, dragon, tier 1). Real cards, read off `packages/content/src/cards/set1/dragons.ts` —
 * not synthetic. `faceOmen` serves a real (procedural) enemy board and resolves a real fight; Supporter's
 * own attack fires `rallyBuff` (a genuine source→target ally buff, routed through combat's `fireBuffCasts` /
 * `driveRoll`) in the SAME beat it deals real damage (routed through nothing — damage is unheld by design).
 * `run.seed` is pinned AFTER `startSceneBuilder()` so the procedural opponent + all combat RNG (attack
 * order, crit rolls) are byte-identical on every run of this exact scenario — required because the buff and
 * control runs must be the SAME fight (same beat timeline, same wall-clock choreography) for the timing
 * comparison in Case 2's control to mean anything; confirmed empirically below (`assertDeterminism`).
 *
 * ── what "seed the per-uid baseline from the first frame" means here ────────────────────────────────────
 * `shapes-verify.mjs`/`cascade-verify.mjs` bound a single event's before/after. A whole fight has several
 * stat-changing events per uid, so the invariant here bounds each uid against the full TRUE TRAJECTORY —
 * every checkpoint value the sim ever gave that uid (initial, then each `buff`/`dmg`/`summon`/`reborn`
 * event in order, replayed from `lastCombat.events` + `lastCombat.initial`) — floor = min of that trajectory,
 * ceiling = max. Any live sample outside `[floor, ceiling]` is a number the unit never had. This generalizes
 * shapes-verify's `[min(before,final), max(before,final)]` from one change to the whole sequence; since the
 * store's own delta-hold arithmetic only ever prints something between two ADJACENT trajectory checkpoints,
 * the full-trajectory min/max is a valid (if slightly looser) superset bound — never missable by a real
 * over/undershoot bug, exactly the kind Task 3's own review caught (a below-floor print on a same-beat
 * re-seek, see progress.md).
 *
 * ── anchoring (no fixed-ms assertions) ───────────────────────────────────────────────────────────────────
 * Property 2 is proven two ways, NEITHER a hardcoded clock:
 *   (a) "genuine roll, not a snap" — the buff's health delta is +2 (decisive: the store's rounding odometer
 *       MUST pass through an intermediate integer for any |delta| >= 2 over a real multi-frame reveal; a
 *       delta of 1 can't tell a roll from a snap apart, which is why the delta is chosen, not assumed).
 *       Verified empirically against a KNOWN-good shop roll first (`probe-shop-roll` during development)
 *       to confirm this environment's rAF sampling resolves a real 420ms roll's intermediate steps cleanly.
 *   (b) "withheld UNTIL THE STRIKE, not just withheld" — proven by COMPARISON, not a clock: the primary run
 *       and the origin-patched control run are the SAME pinned-seed fight, so the moment the beat commits is
 *       the same wall-clock instant in both. The control (origin `intrinsic` instead of `effect`) makes the
 *       shared ticker auto-reveal the hold starting at commit; the primary is supposed to hold until the
 *       strike's `driveRoll`, scheduled hundreds of ms later. `moveStart` (the first sampled frame the badge
 *       deviates from its pre-buff value) is read live off the DOM in both runs and compared — no ms figure
 *       is asserted as a required delay, only that the control's moveStart lands meaningfully earlier than
 *       the primary's, sized against `BUFF_PRESETS['dragon-tribe'].travelMs` (read from source, not
 *       hardcoded — this IS `shapes-verify.mjs`'s own `readDefaultRollMs` technique, generalized).
 *
 * Property 3 needs no clock either: damage's delta on the chosen event is >= 2 too, so "instant" = zero
 * intermediate values observed for that transition, full stop.
 *
 * ── NEGATIVE CONTROLS (Step 3 of the task) ───────────────────────────────────────────────────────────────
 * Each property is broken on purpose, on a FRESH page, and reverted in a `finally`, exactly like
 * `shapes-verify.mjs`'s fodder/ripple/volley controls:
 *   - INVARIANT: `combatBuffDeltas`'s returned delta is inflated ×8 — the install effect withholds far more
 *     than the beat actually granted, printing a number below the true floor.
 *   - BUFF (withheld-until-strike): the install effect's `holdStat` origin is downgraded `effect` →
 *     `intrinsic` — the shared ticker now auto-reveals at commit instead of waiting for the strike.
 *   - DAMAGE (instant): `combatBuffDeltas` is patched to also fold `dmg` events into the withheld delta —
 *     routing damage through the same hold machinery buffs use. Nothing schedules an explicit release for
 *     this synthetic hold (no `fireBuffCasts` tendril targets a plain damage event), so it doesn't come back
 *     as a rolled reveal — it comes back late, via the store's own `HOLD_TTL_MS` fail-open. The catch signal
 *     is therefore comparative (like the BUFF control): the target's `moveStart` under the patch lands well
 *     after its unpatched (truly instant) moveStart, proving "instant" broke.
 *
 * ── A REAL FINDING, not a harness bug (see the report) ──────────────────────────────────────────────────
 * Running this scenario unmodified found property 2's "then rolls" half genuinely failing against real,
 * merged combat: `runAttackExchangeCues`'s `advance()` (engine.ts) fires unconditionally AT LUNGE CONTACT —
 * "the beat clock stays welded to connection", by its own comment — completely decoupled from
 * `fireBuffCasts`'s strike-scheduled `driveRoll` (`window.setTimeout(strikeMs)`, `strikeMs` = the tribe's
 * `BUFF_PRESETS[...].travelMs`, 620ms for dragons). The next beat's install-effect cleanup unconditionally
 * clears every pending timer in that beat's `windupTimers` (`useCombatReplay.ts` ~line 1422's cleanup). When
 * contact happens before the buff's travelMs elapses (verified below: it does, by single-digit-to-tens-of-ms
 * margins — this is not a landslide, it is a coin-flip-close race), the scheduled `driveRoll` gets cancelled
 * before it ever fires, and the hold is delivered instead by the OTHER release path — the plain
 * `releaseStat` at the top of the next beat's install-effect pass (`useCombatReplay.ts` ~line 1486) — a
 * SNAP, not a roll. The number is never wrong (the invariant holds — `releaseStat` shows the true value, and
 * only after the true withhold window, never early) but the promised strike-timed COUNT-UP silently does not
 * happen. This is architectural (two independently-clocked timers racing with no synchronization), not a
 * fluke of this one fight — a second, longer multi-round scenario (Supporter + two Haven Drakes vs a bigger
 * procedural board) showed the identical race with only a ~44ms margin, resolved the other way. See the
 * task-4 report for the full timing trace.
 */
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.URL ?? 'http://localhost:5205';
const REPO = 'C:/Users/micha/Desktop/ascent/.claude/worktrees/ruby-fx';
const REPLAY_TS = `${REPO}/packages/ui/src/useCombatReplay.ts`;
const ROLL_TS = `${REPO}/packages/ui/src/fx/combatBuffRoll.ts`;
const STAT_HOLD_TS = `${REPO}/packages/ui/src/fx/statHold.ts`;
const BUFF_PRESETS_TS = `${REPO}/packages/ui/src/buffPresets.ts`;

// The exact deterministic scenario: Supporter (dragon, Rally buffs an ally on attack) + Bard/frontdrake
// (dragon, the buff's target) vs whatever procedural threat this pinned seed serves. Found by scanning a
// few seeds during development for one that (a) gives Supporter a live ally-buff target and (b) deals real
// (>=2) damage in the same beat, so both decisive properties are provable in one fight.
const PRIMARY_SEED = 424242;

// Read tunables from SOURCE rather than hardcoding them (shapes-verify.mjs's own technique) — both are used
// only to size comparison margins / report context, never asserted as a required absolute delay.
function readConst(file, re, label) {
  const src = readFileSync(file, 'utf8');
  const m = src.match(re);
  if (!m) throw new Error(`${label} not found in ${file} — harness needs updating, not the product code`);
  return Number(m[1]);
}
const DEFAULT_ROLL_MS = readConst(STAT_HOLD_TS, /export const DEFAULT_ROLL_MS = (\d+);/, 'DEFAULT_ROLL_MS');
const HOLD_TTL_MS = readConst(STAT_HOLD_TS, /export const HOLD_TTL_MS = (\d+);/, 'HOLD_TTL_MS');
const DRAGON_TRAVEL_MS = readConst(
  BUFF_PRESETS_TS,
  /"dragon-tribe":\s*\{[\s\S]*?travelMs:\s*(\d+)/,
  'dragon-tribe travelMs',
);

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

async function withFreshPage(fn) {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=swiftshader'],
    defaultViewport: { width: 1600, height: 900 },
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
    await page.goto(URL, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1800));
    return await fn(page);
  } finally {
    await browser.close();
  }
}

/**
 * Build Supporter + Bard on the board, pin `seed`, dispatch `faceOmen`, sample EVERY visible combat badge
 * (`.card[data-uid]` under the tavern/warband zones) every rAF frame for the whole fight, and return the raw
 * events + initial board + per-uid sample series. All in-page — a single `page.evaluate` round trip.
 */
async function runFight(page, seed) {
  return page.evaluate(async (seed) => {
    const G = () => window.useGame.getState();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    G().startSceneBuilder();
    // Pin the seed AFTER creation — `nextOpponent`/`buildEnemyBoard` read `s.seed` fresh at faceOmen time, so
    // this alone determines the procedural opponent + all combat RNG for a byte-identical fight every run.
    window.useGame.setState((s) => ({ run: { ...s.run, seed } }));
    // Deterministic wall-clock choreography (no user-speed jitter) — required for the Case 2 control's
    // moveStart comparison to mean anything (see the header).
    window.useGame.setState({ combatSpeed: 1 });

    async function playCard(uid, cardId) {
      window.useGame.setState((s) => ({ run: { ...s.run, shop: [{ uid, cardId }] } }));
      await sleep(80);
      G().dispatch({ type: 'buy', uid });
      await sleep(80);
      const h = G().run.hand;
      G().dispatch({ type: 'play', uid: h[h.length - 1].uid });
      await sleep(150);
    }
    await playCard('sup0', 'supporter');
    await playCard('fd0', 'frontdrake');

    const t0 = performance.now();
    G().dispatch({ type: 'faceOmen' });
    const lc = G().run.lastCombat;
    if (!lc) return { ok: false, reason: 'no lastCombat after faceOmen' };

    const samples = new Map(); // uid -> [{t, atk, hp}]
    const readAll = () => {
      const els = document.querySelectorAll('[data-zone="tavern"] .card[data-uid], [data-zone="warband"] .card[data-uid]');
      const now = Math.round(performance.now() - t0);
      for (const el of els) {
        const uid = el.getAttribute('data-uid');
        const atkEl = el.querySelector('.badge.atk .value');
        const hpEl = el.querySelector('.badge.hp .value');
        const atk = atkEl ? Number(atkEl.textContent) : NaN;
        const hp = hpEl ? Number(hpEl.textContent) : NaN;
        if (!samples.has(uid)) samples.set(uid, []);
        samples.get(uid).push({ t: now, atk, hp });
      }
    };
    let running = true;
    const tick = () => { readAll(); if (running) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);

    // This exact fight (Supporter one-shots the procedural threat) fully resolves its one beat within ~2.2s;
    // 6s is generous headroom without waiting for the "click Continue" gate combat leaves `phase` parked on.
    await sleep(6000);
    running = false;

    return {
      ok: true,
      events: lc.events,
      initial: lc.initial,
      samples: Object.fromEntries(samples),
    };
  }, seed);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// ANALYSIS — pure functions over the raw {events, initial, samples}, no page access.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════

/** Per-uid TRUE checkpoint trajectory: initial value, then every buff/dmg/summon/reborn event in order. See
 *  the header for why the full-trajectory min/max is the right (a valid superset) invariant bound. */
function buildTrajectories(initial, events) {
  const traj = new Map();
  for (const u of [...initial.player, ...initial.enemy]) traj.set(u.uid, { attack: [u.attack], health: [u.health] });
  for (const e of events) {
    if (e.type === 'summon') {
      if (!traj.has(e.minion.uid)) traj.set(e.minion.uid, { attack: [e.minion.attack], health: [e.minion.health] });
    } else if (e.type === 'buff') {
      const t = traj.get(e.target);
      if (t) {
        t.attack.push(t.attack[t.attack.length - 1] + e.attack);
        t.health.push(t.health[t.health.length - 1] + e.health);
      }
    } else if (e.type === 'dmg') {
      const t = traj.get(e.target);
      if (t) t.health.push(e.remainingHp);
    } else if (e.type === 'reborn') {
      const t = traj.get(e.target);
      if (t) { t.attack.push(e.attack); t.health.push(e.hp); }
    }
  }
  return traj;
}

function boundsOf(arr) { return { lo: Math.min(...arr), hi: Math.max(...arr) }; }

/** Property 1 — THE INVARIANT. Every live sample, every uid, both stats, bounded by that uid's full true
 *  trajectory (see header). Returns every violation found (empty = held). */
function checkInvariant(samples, traj) {
  const violations = [];
  for (const [uid, series] of Object.entries(samples)) {
    const t = traj.get(uid);
    if (!t) continue; // an untracked uid (shouldn't happen for this scenario — initial + summon cover it)
    const a = boundsOf(t.attack);
    const h = boundsOf(t.health);
    for (const s of series) {
      if (Number.isFinite(s.atk) && (s.atk < a.lo || s.atk > a.hi)) violations.push({ uid, stat: 'atk', printed: s.atk, lo: a.lo, hi: a.hi, t: s.t });
      if (Number.isFinite(s.hp) && (s.hp < h.lo || s.hp > h.hi)) violations.push({ uid, stat: 'hp', printed: s.hp, lo: h.lo, hi: h.hi, t: s.t });
    }
  }
  return violations;
}

function seriesFor(samples, uid, stat) {
  return (samples[uid] ?? [])
    .map((p) => ({ t: p.t, v: p[stat] }))
    .filter((p) => Number.isFinite(p.v));
}

/** The true value of `uid`'s health/attack immediately BEFORE event index `idx` in `events` — replay the
 *  trajectory truncated to `events.slice(0, idx)` and read its last checkpoint. */
function trueValueBefore(initial, events, uid, idx, stat) {
  const traj = buildTrajectories(initial, events.slice(0, idx));
  const arr = traj.get(uid)?.[stat];
  return arr ? arr[arr.length - 1] : undefined;
}

/**
 * Generic transition analysis for one uid/stat across a whole fight's samples, scoped to ONE specific
 * pre→post change. No fixed-ms assertions — everything here is relative to the samples themselves.
 */
function analyzeTransition(series, pre, post) {
  if (series.length === 0) return { ok: false, reason: 'no samples' };
  let moveStart = null, moveIdx = -1;
  for (let i = 0; i < series.length; i++) {
    if (series[i].v !== pre) { moveStart = series[i].t; moveIdx = i; break; }
  }
  const heldClean = moveIdx <= 0 ? moveIdx === -1 || series[0].v === pre : series.slice(0, moveIdx).every((p) => p.v === pre);
  const lo = Math.min(pre, post), hi = Math.max(pre, post);
  const boundsOk = series.every((p) => p.v >= lo && p.v <= hi);
  const firstPostIdx = series.findIndex((p) => p.v === post);
  const settled = firstPostIdx !== -1 && series.slice(firstPostIdx).every((p) => p.v === post);
  const landed = settled ? series[firstPostIdx].t : null;
  const intermediateValues = [...new Set(series.map((p) => p.v))].filter((v) => v > lo && v < hi);
  return { moveStart, heldClean, boundsOk, settled, landed, intermediateValues, samples: series.length };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// SCENARIO PICKING — locate the ally-buff event and a decisive (>=2) damage event in a fight's event log.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════

function pickBuffEvent(events) {
  const idx = events.findIndex((e) => e.type === 'buff' && e.source !== e.target);
  return idx === -1 ? null : { idx, event: events[idx] };
}
/**
 * The first `dmg` event whose ACTUAL health delta (true-before minus `remainingHp`) is >= 2 in magnitude —
 * decisive for roll-detection (see header). NOT `amount >= 2`: `amount` is the raw damage dealt, but
 * `remainingHp` floors at 0, so a 1-health unit taking 2 damage only ever shows a delta of 1 (indistinguishable
 * from a snap, per the same ambiguity `shapes-verify.mjs` hit with a +1 fodder gain) — the health actually
 * lost is what has to be >= 2, not the raw hit.
 */
function pickDmgEvent(initial, events) {
  for (let idx = 0; idx < events.length; idx++) {
    const e = events[idx];
    if (e.type !== 'dmg') continue;
    const pre = trueValueBefore(initial, events, e.target, idx, 'health');
    if (pre !== undefined && Math.abs(pre - e.remainingHp) >= 2) return { idx, event: e };
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// RUN — primary (unmodified product code)
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════

console.log(`(DEFAULT_ROLL_MS=${DEFAULT_ROLL_MS}ms, dragon-tribe travelMs=${DRAGON_TRAVEL_MS}ms — read from source)`);
console.log('══ PRIMARY — real fight, unmodified product code ══');

const primary = await withFreshPage((page) => runFight(page, PRIMARY_SEED));
if (!primary.ok) {
  report('primary fight resolved', false, [primary.reason]);
  console.log(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}

// Determinism self-check: re-run the identical scenario and confirm a byte-identical event log — required
// for the Case 2 control's cross-run moveStart comparison to be apples-to-apples (see header).
const determinismRun = await withFreshPage((page) => runFight(page, PRIMARY_SEED));
const deterministic = determinismRun.ok && JSON.stringify(determinismRun.events) === JSON.stringify(primary.events);
report('scenario is deterministic under the pinned seed (byte-identical event log on rerun)', deterministic, [
  `primary events: ${primary.events.length}, rerun events: ${determinismRun.events?.length}`,
]);
if (!deterministic) {
  console.log('\nCannot proceed — the Case 2 control depends on cross-run determinism. STOPPING.');
  process.exit(1);
}

const traj = buildTrajectories(primary.initial, primary.events);
const buffPick = pickBuffEvent(primary.events);
const dmgPick = pickDmgEvent(primary.initial, primary.events);
report('scenario produced a real ally-buff event (Supporter\'s Rally) and a >=2 damage event', !!buffPick && !!dmgPick, [
  `buff event: ${JSON.stringify(buffPick?.event)}`,
  `dmg event (first >=2): ${JSON.stringify(dmgPick?.event)}`,
  `full event log: ${JSON.stringify(primary.events)}`,
]);
if (!buffPick || !dmgPick) {
  console.log('\nScenario did not produce the events this harness needs — STOPPING (not tuning the assertion away).');
  process.exit(1);
}

// ── Property 1: THE INVARIANT ────────────────────────────────────────────────────────────────────────────
const invViolations = checkInvariant(primary.samples, traj);
const uidBounds = [...traj.entries()].map(([uid, t]) => {
  const a = boundsOf(t.attack), h = boundsOf(t.health);
  return `${uid}: atk∈[${a.lo},${a.hi}] hp∈[${h.lo},${h.hi}]`;
});
report('PROPERTY 1 — INVARIANT: no badge ever printed outside its true per-uid floor/ceiling', invViolations.length === 0, [
  `per-uid true bounds (seeded from the full trajectory): ${uidBounds.join('; ')}`,
  invViolations.length ? `violations: ${JSON.stringify(invViolations.slice(0, 10))}` : 'no violations across the whole sampled fight',
]);

// ── Property 2: BUFF = withheld then ROLLED ──────────────────────────────────────────────────────────────
const buffTarget = buffPick.event.target;
const buffPreHp = trueValueBefore(primary.initial, primary.events, buffTarget, buffPick.idx, 'health');
const buffPostHp = buffPreHp + buffPick.event.health;
const buffSeries = seriesFor(primary.samples, buffTarget, 'hp');
const buffAnalysis = analyzeTransition(buffSeries, buffPreHp, buffPostHp);
const buffRolled = buffAnalysis.heldClean && buffAnalysis.boundsOk && buffAnalysis.settled && buffAnalysis.intermediateValues.length > 0;
report('PROPERTY 2 — BUFF: withheld pre-buff then delivered via a genuine ROLL (not a snap)', buffRolled, [
  `target ${buffTarget} (source ${buffPick.event.source}), health ${buffPreHp} -> ${buffPostHp} (delta ${buffPick.event.health}, decisive for roll-detection since |delta|>=2)`,
  `withheld cleanly at ${buffPreHp} until moveStart=${buffAnalysis.moveStart}ms: ${buffAnalysis.heldClean}`,
  `never printed outside [${buffPreHp},${buffPostHp}]: ${buffAnalysis.boundsOk}`,
  `settled at true final value: ${buffAnalysis.settled} (landed ${buffAnalysis.landed}ms)`,
  `genuine intermediate (rolled, not snapped) values observed: ${JSON.stringify(buffAnalysis.intermediateValues)}`,
  `${buffSeries.length} live samples`,
]);
const primaryMoveStart = buffAnalysis.moveStart;

// ── Property 3: DAMAGE = instant ─────────────────────────────────────────────────────────────────────────
const dmgTarget = dmgPick.event.target;
const dmgPreHp = trueValueBefore(primary.initial, primary.events, dmgTarget, dmgPick.idx, 'health');
const dmgPostHp = dmgPick.event.remainingHp;
const dmgSeries = seriesFor(primary.samples, dmgTarget, 'hp');
const dmgAnalysis = analyzeTransition(dmgSeries, dmgPreHp, dmgPostHp);
const dmgInstant = dmgAnalysis.boundsOk && dmgAnalysis.settled && dmgAnalysis.intermediateValues.length === 0;
report('PROPERTY 3 — DAMAGE: updates instantly, no withhold (zero intermediate/rolling values)', dmgInstant, [
  `target ${dmgTarget}, health ${dmgPreHp} -> ${dmgPostHp} (delta -${dmgPick.event.amount}, decisive since |delta|>=2)`,
  `never printed outside [${Math.min(dmgPreHp, dmgPostHp)},${Math.max(dmgPreHp, dmgPostHp)}]: ${dmgAnalysis.boundsOk}`,
  `settled at true final value: ${dmgAnalysis.settled} (landed ${dmgAnalysis.landed}ms)`,
  `intermediate (rolled) values observed (must be NONE for "instant"): ${JSON.stringify(dmgAnalysis.intermediateValues)}`,
  `${dmgSeries.length} live samples`,
]);

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// NEGATIVE CONTROLS — break each property in turn, confirm the harness catches it, revert.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════

console.log('\n══ NEGATIVE CONTROLS ══');

/** Applies a source patch, waits for Vite to pick it up, runs `fn`, and restores the file (even on throw). */
async function withPatch(file, find, replace, fn) {
  const original = readFileSync(file, 'utf8');
  if (!original.includes(find)) throw new Error(`patch anchor not found in ${file} — harness needs updating: ${find}`);
  writeFileSync(file, original.replace(find, replace));
  console.log(`  (patched ${file.split('/').pop()}, waiting for Vite to pick it up)`);
  await new Promise((r) => setTimeout(r, 1500));
  try {
    return await fn();
  } finally {
    writeFileSync(file, original);
    await new Promise((r) => setTimeout(r, 800));
  }
}

// Control A — INVARIANT: inflate the withheld delta so the badge prints below the true floor.
{
  const result = await withPatch(
    ROLL_TS,
    'out.push({ uid, attack: t.attack, health: t.health });',
    'out.push({ uid, attack: t.attack * 8, health: t.health * 8 }); // NEGATIVE CONTROL (combat-invariant.mjs): inflated 8x',
    async () => {
      const run = await withFreshPage((page) => runFight(page, PRIMARY_SEED));
      if (!run.ok) return { ok: false };
      const t = buildTrajectories(run.initial, run.events);
      const violations = checkInvariant(run.samples, t);
      return { ok: true, violations };
    },
  );
  const clean = gitDiffEmpty(ROLL_TS);
  const caught = result.ok && result.violations.length > 0;
  report('Control A (invariant): inflating the withheld delta 8x is CAUGHT as a below-floor/above-ceiling print', caught, [
    result.ok ? `violations found: ${result.violations.length} (sample: ${JSON.stringify(result.violations.slice(0, 3))})` : 'fight did not resolve under the control',
  ]);
  report('combatBuffRoll.ts reverted after Control A (git diff empty)', clean);
}

// Control B — BUFF withheld-until-strike: downgrade the install hold's origin so the shared ticker
// auto-reveals at commit instead of waiting for the strike's `driveRoll`.
{
  const result = await withPatch(
    REPLAY_TS,
    "holdStat(d.uid, { attack: d.attack, health: d.health }, { origin: 'effect' });",
    "holdStat(d.uid, { attack: d.attack, health: d.health }, { origin: 'intrinsic' }); // NEGATIVE CONTROL (combat-invariant.mjs): downgraded from 'effect'",
    async () => {
      const run = await withFreshPage((page) => runFight(page, PRIMARY_SEED));
      if (!run.ok) return { ok: false };
      const pick = pickBuffEvent(run.events);
      if (!pick) return { ok: false };
      const pre = trueValueBefore(run.initial, run.events, pick.event.target, pick.idx, 'health');
      const post = pre + pick.event.health;
      const series = seriesFor(run.samples, pick.event.target, 'hp');
      return { ok: true, analysis: analyzeTransition(series, pre, post) };
    },
  );
  const clean = gitDiffEmpty(REPLAY_TS);
  const controlMoveStart = result.ok ? result.analysis.moveStart : null;
  // No fixed clock asserted: the control must move MEANINGFULLY earlier than the primary run's own
  // measured moveStart, in the SAME pinned-seed fight — sized against the sourced dragon travelMs, not a
  // literal constant. (Also works structurally even though the primary run's OWN roll got raced away by the
  // advance()/driveRoll timer race — see the header: the control's failure mode, an early auto-reveal at
  // commit, is a different, independently-provable break from the primary's late-snap-via-cancelled-timer.)
  const caught = result.ok && controlMoveStart !== null && primaryMoveStart !== null
    && controlMoveStart < primaryMoveStart - DRAGON_TRAVEL_MS / 2;
  report("Control B (buff withheld-until-strike): origin 'intrinsic' is CAUGHT — badge moves far earlier (auto-reveals at commit, not the strike)", caught, [
    `primary run moveStart: ${primaryMoveStart}ms`,
    `control run moveStart: ${controlMoveStart}ms`,
    `required margin (dragon travelMs / 2, sourced): ${DRAGON_TRAVEL_MS / 2}ms`,
  ]);
  report('useCombatReplay.ts reverted after Control B (git diff empty)', clean);
}

// Control C — DAMAGE instant: route damage through the same withhold-and-roll machinery buffs use.
{
  const result = await withPatch(
    ROLL_TS,
    "if (!e || e.type !== 'buff') continue;",
    `if (e && e.type === 'dmg') { // NEGATIVE CONTROL (combat-invariant.mjs): route damage through the hold too
      const t = totals.get(e.target) ?? { attack: 0, health: 0 };
      totals.set(e.target, { attack: t.attack, health: t.health - e.amount });
      continue;
    }
    if (!e || e.type !== 'buff') continue;`,
    async () => {
      const run = await withFreshPage((page) => runFight(page, PRIMARY_SEED));
      if (!run.ok) return { ok: false };
      const pick = pickDmgEvent(run.initial, run.events);
      if (!pick) return { ok: false };
      const pre = trueValueBefore(run.initial, run.events, pick.event.target, pick.idx, 'health');
      const post = pick.event.remainingHp;
      const series = seriesFor(run.samples, pick.event.target, 'hp');
      return { ok: true, analysis: analyzeTransition(series, pre, post) };
    },
  );
  const clean = gitDiffEmpty(ROLL_TS);
  // Nothing in combat schedules an explicit release for a plain dmg-derived hold (no `fireBuffCasts` tendril
  // targets it) — so unlike the buff case, this doesn't come back as a rolled reveal, it comes back as the
  // store's own TTL fail-open (`HOLD_TTL_MS`, read from source) delivering it late. So the catch signal is
  // comparative, like Control B: the target's health `moveStart` must land meaningfully LATER under the
  // patch than it did in the unpatched primary run (where damage updates with no withhold at all) — proving
  // "instant" broke, without asserting any absolute clock value.
  const controlMoveStart = result.ok ? result.analysis.moveStart : null;
  const caught = result.ok && controlMoveStart !== null
    && controlMoveStart > dmgAnalysis.moveStart + DEFAULT_ROLL_MS;
  report('Control C (damage instant): routing damage through a hold is CAUGHT — the badge is now withheld (moveStart lands much later than the unpatched instant update)', caught, [
    `primary (unpatched) moveStart: ${dmgAnalysis.moveStart}ms`,
    `control (damage-through-hold) moveStart: ${controlMoveStart}ms`,
    `required margin (DEFAULT_ROLL_MS, sourced): ${DEFAULT_ROLL_MS}ms`,
    result.ok ? `control's own intermediate values (expected none — nothing drives a roll for this hold, it just fails open late via HOLD_TTL_MS=${HOLD_TTL_MS}ms): ${JSON.stringify(result.analysis.intermediateValues)}` : 'fight did not resolve under the control',
  ]);
  report('combatBuffRoll.ts reverted after Control C (git diff empty)', clean);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASS' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
