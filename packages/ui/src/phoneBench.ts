/**
 * THE ON-DEVICE AUTO-BENCH (R-PHONE-BENCH-01, owner 2026-10-26: "make this game run flawlessly on mobile devices ...
 * performance is a pillar"; no Mac and no device farm, so every number has to come from the phone itself).
 *
 * Open the game with `?phonebench=1` (Netlify, or the LAN build from `npm run phone:preview`) and touch nothing. For
 * about two minutes the page drives itself through the same sequence every time:
 *   title + mode home (menus) -> a God Mode Practice game (never saved: the player's own save is untouched) -> hero
 *   select -> the hero ceremony -> the first shop (idle) -> scripted drags (buy, play, reorder) -> End Turn -> the
 *   falling gate -> the fight -> the trip back, for BENCH_ROUNDS rounds (God Mode's 999 Gold buys a full board, so the
 *   later fights carry the heavy FX) -> Leave God Mode -> the title.
 * The phone perf log (phonePerfLog.ts) records it like any session (frames per scene, WebGL / Pixi / images / audio,
 * the FX ledger), and at the end ONE report is uploaded (`payload.bench`) and a summary card shows on screen with
 * Copy. The same link on the same build gives comparable numbers.
 *
 * Everything is driven through the DOM the way a finger would (pointer events on the real controls, so the drag, the
 * gate and the ceremony all run their real code), plus three store calls to open God Mode Practice. A step that cannot
 * find its control waits a little and moves on; the card says which steps were skipped. Loaded only with the flag
 * (Game.tsx imports it on demand): a normal load never fetches this file.
 */
import { useGame } from './store';
import { perfLogActive, perfLogView, uploadPerfNow, setPerfBenchInfo } from './phonePerfLog';

export const BENCH_ROUNDS = 4;
const sleep = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));

/** True when this load asked for the bench. */
export function benchRequested(): boolean {
  try { return new URLSearchParams(window.location.search).get('phonebench') === '1'; } catch { return false; }
}

function visible(sel: string): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>(sel)).find((e) => e.getClientRects().length > 0) ?? null;
}
function byText(t: string): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>('button,[role=button],.btn,a'))
    .find((x) => x.getClientRects().length > 0 && (x.innerText || '').trim().toUpperCase() === t.toUpperCase()) ?? null;
}
function centre(e: Element): { x: number; y: number } {
  const r = e.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
const ptr = (type: string, p: { x: number; y: number }): PointerEvent => new PointerEvent(type, {
  bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
  clientX: p.x, clientY: p.y,
});
/** A tap: pointerdown / pointerup / click on the element. */
function tap(e: HTMLElement | null): boolean {
  if (!e) return false;
  const p = centre(e);
  e.dispatchEvent(ptr('pointerdown', p));
  e.dispatchEvent(ptr('pointerup', p));
  e.click();
  return true;
}
/** A finger drag from `from` to `to` over `ms`, one move a frame, with a sideways wander (the drag scene). */
async function drag(from: HTMLElement | null, to: { x: number; y: number } | null, ms = 900): Promise<boolean> {
  if (!from || !to) return false;
  const a = centre(from);
  from.dispatchEvent(ptr('pointerdown', a));
  const t0 = performance.now();
  await new Promise<void>((done) => {
    const step = (now: number): void => {
      const t = Math.min(1, (now - t0) / ms);
      const p = { x: a.x + (to.x - a.x) * t + Math.sin(t * 10) * 30, y: a.y + (to.y - a.y) * t };
      window.dispatchEvent(ptr('pointermove', p));
      if (t < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });
  window.dispatchEvent(ptr('pointerup', to));
  await sleep(1200);
  return true;
}
async function waitFor(cond: () => boolean, ms: number): Promise<boolean> {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) { if (cond()) return true; await sleep(200); }
  return cond();
}

export interface BenchResult { ok: boolean; secs: number; skipped: string[]; summary: string; sent: boolean }

/** Run the sequence. Resolves with the summary (also shown on the card). Never throws. */
export async function runPhoneBench(onStep: (s: string) => void): Promise<BenchResult> {
  const skipped: string[] = [];
  const t0 = performance.now();
  const step = (s: string): void => { onStep(s); setPerfBenchInfo({ step: s }); };
  const need = (ok: boolean, name: string): void => { if (!ok) skipped.push(name); };
  const g = useGame.getState;
  // The bench writes three player preferences on the way (God Mode on the Practice setup, its remembered round, the
  // Practice timer): put them back as they were at the end.
  const KEYS = ['ascent.practiceconfig', 'ascent.godmode.round', 'ascent.practicetimer'];
  const saved = KEYS.map((k) => { try { return localStorage.getItem(k); } catch { return null; } });
  try {
    step('menus');
    await waitFor(() => !document.getElementById('bootsplash'), 120_000);
    await sleep(4000);
    need(tap(byText('PLAY')), 'Play');
    await sleep(3000);
    // God Mode Practice: never saved, every hero, 999 Gold (store.ts GOD MODE). The player's save is not touched.
    step('hero select');
    g().startPractice();
    g().setPracticeDraft({ godMode: true });
    await sleep(800);
    g().confirmPracticeSetup();
    need(await waitFor(() => !!visible('.herocard.big'), 15_000), 'hero select');
    await sleep(4000);
    need(tap(visible('.herocard.big')), 'hero pick');
    await sleep(2500);
    step('ceremony');
    need(tap(visible('.hsc-start')), 'Start Game');
    const inShop = (): boolean => document.querySelectorAll('[data-zone=tavern] .card[data-uid]').length > 0;
    for (let i = 0; i < 80 && !inShop(); i++) { if (tap(byText('Play anyway'))) await sleep(1000); else await sleep(500); }
    need(inShop(), 'first shop');
    for (let round = 1; round <= BENCH_ROUNDS; round++) {
      step(`shop ${round}`);
      // A turn-1 Discover / quest offer over the Shop: take its first choice.
      for (let i = 0; i < 4 && visible('.discover-ov'); i++) { tap(visible('.discover-ov .card')); await sleep(2000); }
      await sleep(round === 1 ? 6000 : 2500);
      // Tier up and a fresh Shop each round (God Mode's Gold pays), so later fights carry bigger boards and their FX.
      if (round > 1) { tap(visible('.tvbwrap')); await sleep(1200); }
      tap(visible('.rfbwrap')); await sleep(1200);
      step(`drags ${round}`);
      const board = (): { x: number; y: number } | null => { const z = visible('[data-zone="warband"]'); return z ? centre(z) : null; };
      for (let k = 0; k < 3; k++) {
        need(await drag(visible('[data-zone="tavern"] .row .card[data-uid]'), board()), `buy r${round}`);
        for (let i = 0; i < 3 && visible('.discover-ov'); i++) { tap(visible('.discover-ov .card')); await sleep(1500); }
        await drag(visible('[data-zone="hand"] .card[data-uid]'), board());
        for (let i = 0; i < 3 && visible('.discover-ov'); i++) { tap(visible('.discover-ov .card')); await sleep(1500); }
      }
      const tavern = visible('[data-zone="tavern"]');
      await drag(visible('[data-zone="warband"] .row .card[data-uid]'), tavern ? { x: centre(tavern).x + 200, y: centre(tavern).y + 60 } : null, 1200);
      step(`fight ${round}`);
      // End Turn, pressed again every 2 s until the fight starts (a drag's drop can still be settling).
      let fought = false;
      for (let i = 0; i < 10 && !fought; i++) {
        const btn = visible('.etbwrap') as HTMLButtonElement | null;
        // God Mode asks which round the opponent board is from: a late one, so the fights carry heavy FX.
        const pick = visible(`.godround-btn[aria-label="Round ${8 + round * 2}"]`) ?? visible('.godround-btn');
        if (pick && !(pick as HTMLButtonElement).disabled) tap(pick);
        else if (btn && !btn.disabled) tap(btn);
        fought = await waitFor(() => g().run.phase === 'combat', 2000);
        if (!fought && i === 9) setPerfBenchInfo({ [`endTurnR${round}`]: btn ? `disabled ${btn.disabled} ${btn.className}` : 'no button' });
      }
      need(fought, `fight r${round}`);
      await waitFor(() => g().run.phase !== 'combat', 90_000);
      await waitFor(() => !!visible('[data-zone=tavern] .card[data-uid]'), 20_000);
      await sleep(2500);
    }
    step('back to the menus');
    g().openTitle(); // Leave God Mode: nothing of the game is saved
    await sleep(5000);
  } catch (e) {
    skipped.push(`error: ${String((e as Error)?.message ?? e).slice(0, 80)}`);
  }
  KEYS.forEach((k, i) => { try { if (saved[i] === null) localStorage.removeItem(k); else localStorage.setItem(k, saved[i]!); } catch { /* blocked */ } });
  const secs = Math.round((performance.now() - t0) / 1000);
  setPerfBenchInfo({ step: 'done', secs, skipped, rounds: BENCH_ROUNDS });
  const v = perfLogView();
  const lines = [
    `ASCENT phone bench ${__APP_VERSION__}+${__BUILD_SHA__} ${secs}s ${Math.round(v.hz)}Hz`,
    ...v.scenes.map(({ scene, sum }) => `${scene}: p50 ${sum.p50} p95 ${sum.p95} p99 ${sum.p99} worst ${Math.round(sum.worst)} >17 ${sum.o17} >33 ${sum.o33} (${Math.round(sum.s)}s)`),
    v.gl ? `WebGL ${v.gl.alive} alive / ${v.gl.made} made, lost ${v.gl.lostEvents}, restored ${v.gl.restoredEvents}` : 'WebGL n/a',
    `images ${v.imgMb} MB (${v.imgUniqueMb} distinct), audio ${v.audioMb ?? '?'} MB${v.heap !== null ? `, heap ${v.heap} MB` : ''}`,
    `FX asked ${v.fx.req}, drew ${v.fx.started}, missed ${v.fx.missed}`,
    ...(skipped.length ? [`skipped: ${skipped.join(', ')}`] : []),
  ];
  const sent = perfLogActive() ? await uploadPerfNow() : false;
  lines.push(sent ? 'report sent' : 'report NOT sent (offline or no backend)');
  return { ok: skipped.length === 0, secs, skipped, summary: lines.join('\n'), sent };
}
