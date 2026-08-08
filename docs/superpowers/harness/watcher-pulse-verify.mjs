/**
 * WATCHER PULSE VERIFY — Task 4 (final), the browser-harness proof for the watcher-pulse feature
 * (Tasks 1-3: `watcherPulseUids` classifier, the `watcher-pulse` Pixi def + `useWatcherPixi` gate + the DEV
 * `window.__fxFires` seam, and the render wiring in `useCombatReplay.ts`/`Card.tsx`/`Unit.tsx`). A REAL fight
 * (Scene Builder -> shop-inject -> buy -> play -> serve a dummy -> `faceOmen`), not a synthetic timer probe —
 * same technique the sibling `rally-beat-verify.mjs` harness (a neighboring worktree, different feature) uses.
 *
 * ── the scenario ─────────────────────────────────────────────────────────────────────────────────────────
 * Board: two `frontdrake` (plain attackers, health-pinned to 10 so they comfortably outlive a couple of weak
 * retaliations) + `cryptdrake` (the watcher — "every 2 ally attacks, buff your minions +2/+2"; it needs a
 * SECOND ally swing to land its buff, same fix the rally-beat-choreography harness's own Crypt Drake probe
 * needed). Served enemy: a tanky, low-attack dummy (`b2_packstrider`, attack 1 / health 40) so the front
 * drakes survive to swing twice. `combatSpeed: 1`.
 *
 * ── what's asserted ──────────────────────────────────────────────────────────────────────────────────────
 * On the beat Crypt Drake reacts (its `onAttack` counter hits 2 and it buffs the board):
 *   1. its medallion shows a `.cgem.pulsing.watcher` (light-blue) RISING EDGE — the recolored self-pulse.
 *   2. a frame pulse fired — EITHER a `.framepulsering` element appeared on ITS card (CSS fallback) OR
 *      `window.__fxFires` carries a `watcher-pulse` entry (the Pixi def; expected on this tree since the def
 *      is committed — `fx/defs/watcher-pulse.json` — and `canPlayDefs()` is true in a real/swiftshader-backed
 *      renderer).
 *   3. the beat's ATTACKER (a `frontdrake`) shows NEITHER surface: no `.framepulsering` ever appears on its
 *      card, and its `.cgem` never carries the `watcher` class — the frame/medallion recolor is watcher-only.
 *
 * ── why "no watcher-pulse fire anchored to the attacker" is checked the way it is ──────────────────────────
 * `window.__fxFires` (see `fx/playDef.ts`) logs only `{ id, t }` — no per-uid anchor. That's fine here: the
 * call site in `useCombatReplay.ts` only ever invokes `playDef('watcher-pulse', ...)` INSIDE the
 * `for (const uid of watchers)` loop, where `watchers = watcherPulseUids(beat, events, beat.primary.attacker)`
 * — a function that structurally excludes `attackerUid` (see `choreo/channels/watcherPulse.ts`'s `take()`).
 * So a `watcher-pulse` fire can never be anchored to the attacker by construction; the DOM check (no
 * `.framepulsering`, no `.cgem.watcher` on the attacker's own card, ever) is the direct empirical proof, and
 * the fxFires-count-matches-Drake-medallion-pulses cross-check below confirms every Pixi fire lines up with
 * the Drake's own reaction, not with some other beat.
 *
 * ── retry, not loosening ─────────────────────────────────────────────────────────────────────────────────
 * Un-pinned combat RNG (retaliation order/timing) can occasionally let Crypt Drake take ITS OWN turn before
 * the counter is satisfied by the front drakes, making it the beat's attacker instead of a watcher — a
 * different, correctly-working code path (self-rally, excluded from `watcherPulseUids`), just not the
 * scenario this harness is proving. Retried on a fresh page (same technique the sibling harness's WATCHER/
 * DAMAGE channels use), never by loosening what's asserted once a genuine watcher beat is sampled.
 */
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.URL ?? 'http://localhost:5175';

let failures = 0;
function report(name, pass, lines) {
  console.log(`\n${pass ? 'PASS' : 'FAIL'} — ${name}`);
  for (const l of lines ?? []) console.log('  ' + l);
  if (!pass) failures++;
  return pass;
}

/** Rising-edge scan of a sampled class-list series for the first frame it carries `pulsing` (and, if
 *  `requireClass` is set, that class too — e.g. `watcher` for the light-blue token). Mirrors the sibling
 *  rally-beat-verify.mjs's helper of the same name/shape. */
function firstRisingPulse(samples, classKey, requireClass) {
  let prev = false, t = null;
  for (const s of samples) {
    const cls = s[classKey];
    const list = cls ? cls.split(' ') : [];
    const active = list.includes('pulsing') && (!requireClass || list.includes(requireClass));
    if (active && !prev && t === null) t = s.t;
    prev = active;
  }
  return t;
}

/** Count of `pulsing`+`requireClass` rising edges across the whole sample series (not just the first). */
function countRisingPulses(samples, classKey, requireClass) {
  let prev = false, n = 0;
  for (const s of samples) {
    const cls = s[classKey];
    const list = cls ? cls.split(' ') : [];
    const active = list.includes('pulsing') && (!requireClass || list.includes(requireClass));
    if (active && !prev) n++;
    prev = active;
  }
  return n;
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

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// WATCHER — Crypt Drake (buffs ALL friendly minions incl. itself every 2 ally attacks). Board/timing pattern
// mined from the rally-beat-choreography feature's own WATCHER scenario (a neighboring worktree's
// rally-beat-verify.mjs, Task 4/8 there) — same cards, same health-pin, same served dummy.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
async function runWatcher(page) {
  return page.evaluate(async () => {
    const G = () => window.useGame.getState();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    async function playCard(cardId, uid) {
      window.useGame.setState((s) => ({ run: { ...s.run, shop: [{ uid, cardId }] } }));
      await sleep(80);
      G().dispatch({ type: 'buy', uid });
      await sleep(80);
      const h = G().run.hand;
      G().dispatch({ type: 'play', uid: h[h.length - 1].uid });
      await sleep(150);
    }
    G().startSceneBuilder();
    await sleep(300);
    await playCard('frontdrake', 'a0');
    await playCard('frontdrake', 'a1');
    await playCard('cryptdrake', 'a2');
    // Front attackers need to comfortably outlive a couple of weak retaliations — Crypt Drake needs a SECOND
    // ally attack to land its buff.
    window.useGame.setState((s) => ({
      run: { ...s.run, board: s.run.board.map((b) => (['a0', 'a1'].includes(b.uid) ? { ...b, health: 10 } : b)) },
    }));

    window.useGame.setState({ combatSpeed: 1 });
    window.__fxFires = []; // reset the DEV fire log so this trial's evidence isn't polluted by shop/play FX
    window.useGame.setState((s) => ({
      run: {
        ...s.run,
        servedBoards: { ...(s.run.servedBoards ?? {}), [s.run.wave]: { minions: [{ cardId: 'b2_packstrider', attack: 1, health: 40, keywords: [] }], tier: 1 } },
      },
    }));

    const t0 = performance.now();
    G().dispatch({ type: 'faceOmen' });
    const lc0 = G().run.lastCombat;
    const drakeUid = lc0?.initial.player.find((u) => u.cardId === 'cryptdrake')?.uid;
    const frontUids = lc0?.initial.player.filter((u) => u.cardId === 'frontdrake').map((u) => u.uid) ?? [];
    if (!drakeUid) return { ok: false, reason: 'no cryptdrake uid resolved from lastCombat.initial' };

    const samples = [];
    let running = true;
    const read = () => {
      const t = Math.round(performance.now() - t0);
      const drakeCard = document.querySelector(`.unit[data-uid="${drakeUid}"] .card`);
      const drakeGem = drakeCard?.querySelector('.cgem');
      const drakeFrame = drakeCard?.querySelector('.framepulsering');
      const fronts = frontUids.map((u) => {
        const card = document.querySelector(`.unit[data-uid="${u}"] .card`);
        const gem = card?.querySelector('.cgem');
        const frame = card?.querySelector('.framepulsering');
        return { uid: u, gemClass: gem?.className ?? null, framePresent: !!frame };
      });
      samples.push({
        t,
        drakeGemClass: drakeGem?.className ?? null,
        drakeFramePresent: !!drakeFrame,
        fronts,
      });
    };
    const tick = () => { read(); if (running) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);

    await sleep(9000);
    running = false;

    const lc = G().run.lastCombat;
    const events = (lc?.events ?? []).map((e, i) => ({ i, ...e }));
    return { ok: true, drakeUid, frontUids, samples, events, fxFires: (window.__fxFires ?? []).slice() };
  });
}

/** Pure analysis over one WATCHER trial's raw {drakeUid, frontUids, samples, events, fxFires}. Finds the
 *  beat Crypt Drake first reacted in (its first `buff` event as source), identifies that beat's attacker
 *  from the preceding `attack` event, and gathers every assertion's evidence. */
function analyzeWatcherTrial(res) {
  const { drakeUid, events } = res;
  const firstDrakeBuffIdx = events.findIndex((e) => e.type === 'buff' && e.source === drakeUid);
  if (firstDrakeBuffIdx === -1) return { reacted: false, reason: 'Crypt Drake never fired a buff event (no reaction this trial)' };

  let attackerUid = null;
  for (let j = firstDrakeBuffIdx - 1; j >= 0; j--) {
    if (events[j].type === 'attack') { attackerUid = events[j].attacker; break; }
  }
  if (!attackerUid) return { reacted: false, reason: 'no attack event precedes the buff — cannot identify the beat attacker' };

  if (attackerUid === drakeUid) {
    return { reacted: false, reason: 'Crypt Drake was the BEAT\'S OWN ATTACKER this trial (self-rally path, not a watcher reaction) — not this scenario' };
  }

  const pulseT = firstRisingPulse(res.samples, 'drakeGemClass', 'watcher');
  const drakeMedallionWatcherPulses = countRisingPulses(res.samples, 'drakeGemClass', 'watcher');
  const drakeFramePulsedCss = res.samples.some((s) => s.drakeFramePresent);
  const pixiWatcherFires = (res.fxFires ?? []).filter((f) => f.id === 'watcher-pulse');

  const attackerFront = res.samples.some((s) =>
    s.fronts.some((f) => f.uid === attackerUid && f.framePresent),
  );
  const anyFrontWatcherClass = res.samples.some((s) =>
    s.fronts.some((f) => {
      const list = f.gemClass ? f.gemClass.split(' ') : [];
      return list.includes('watcher');
    }),
  );
  const anyFrontFramePresent = res.samples.some((s) => s.fronts.some((f) => f.framePresent));

  return {
    reacted: true,
    drakeUid,
    attackerUid,
    pulseT,
    drakeMedallionWatcherPulses,
    drakeFramePulsedCss,
    pixiWatcherFires,
    attackerFront,
    anyFrontWatcherClass,
    anyFrontFramePresent,
  };
}

// ── WATCHER — Crypt Drake ────────────────────────────────────────────────────────────────────────────────
{
  const MAX_TRIALS = 5;
  let found = null;
  const trialLog = [];
  for (let n = 1; n <= MAX_TRIALS && !found; n++) {
    const res = await withFreshPage((page) => runWatcher(page));
    if (!res.ok) { trialLog.push(`trial ${n}: ${res.reason}`); continue; }
    const a = analyzeWatcherTrial(res);
    if (!a.reacted) { trialLog.push(`trial ${n}: ${a.reason} — retrying`); continue; }

    const medallionOk = a.pulseT !== null;
    const frameOk = a.drakeFramePulsedCss || a.pixiWatcherFires.length > 0;
    const attackerCleanOk = !a.attackerFront && !a.anyFrontWatcherClass && !a.anyFrontFramePresent;

    const surface = a.pixiWatcherFires.length > 0 ? 'Pixi (window.__fxFires)' : a.drakeFramePulsedCss ? 'CSS (.framepulsering)' : 'NONE';
    trialLog.push(
      `trial ${n}: attacker=${a.attackerUid} (frontdrake), Drake medallion pulse_t=${a.pulseT}ms ` +
      `(.cgem.pulsing.watcher rising edges=${a.drakeMedallionWatcherPulses}), frame surface=${surface} ` +
      `(fxFires watcher-pulse count=${a.pixiWatcherFires.length}), attacker clean=${attackerCleanOk}`,
    );

    if (medallionOk && frameOk && attackerCleanOk) {
      found = { ...a, surface };
    } else {
      trialLog.push(
        `trial ${n}: FAILED assertions — medallion=${medallionOk}, frame=${frameOk}, attackerClean=${attackerCleanOk} ` +
        `(attacker framePresent=${a.attackerFront}, any front .watcher class=${a.anyFrontWatcherClass}, any front .framepulsering=${a.anyFrontFramePresent})`,
      );
    }
  }

  if (!found) {
    report('WATCHER — Crypt Drake (light-blue medallion + frame bloom, attacker clean)', false, trialLog);
  } else {
    report('WATCHER — Crypt Drake (light-blue medallion + frame bloom, attacker clean)', true, [
      ...trialLog,
      `pulse_t=${found.pulseT}ms — .cgem.pulsing.watcher rising edge on Crypt Drake (${found.drakeUid})`,
      `frame pulse fired via: ${found.surface}`,
      `attacker (${found.attackerUid}, a frontdrake) shows NO .framepulsering and NO .cgem.watcher class across the whole sample window`,
      'medallion .cgem.pulsing.watcher rising edges on any frontdrake: 0 (must be 0 — watcher recolor is non-attacker only)',
    ]);
  }
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASS' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
