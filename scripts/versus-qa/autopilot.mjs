// A player's autopilot in a real browser: the UI is clicked where a person would click (gate crystal, hero card,
// End Turn / End Combat gem); the shop itself is played through the store's dispatch (buy + play).
import { sleep } from './lib.mjs';

export async function stateOf(p) {
  return p.page.evaluate(async () => {
    const V = await window.__bench.versus();
    const S = await window.__bench.spectate();
    const g = window.__bench.store.getState();
    const v = V.useVersus.getState();
    const m = v.match;
    const vis = (sel) => { const el = document.querySelector(sel); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    return {
      gate: vis('.rgate-crystal'), heroCards: document.querySelectorAll('.herocard.big:not([disabled])').length,
      pendingMode: g.pendingMode, heroChoices: !!g.heroChoices, showTitle: g.showTitle, titleView: g.titleView,
      phase: m?.phase ?? null, round: m?.round ?? null, paused: !!m?.paused_at, matchId: m?.id ?? null,
      runMode: g.run.mode, runPhase: g.run.phase, wave: g.run.wave, settled: !!g.run.combatSettled, runId: g.run.runId,
      etb: vis('.etbwrap'), etbReady: vis('.etbwrap.ready'), etbPressed: !!document.querySelector('.etbwrap.pressed'),
      lockedRound: v.lockedRound, screen: v.screen, err: v.error, spect: S.useSpectate.getState().active, teammate: !!S.useSpectate.getState().teammate,
      resolve: g.run.resolve, mate: m?.group?.duos?.mate ?? null, awaiting: !!m && m.phase === 'hero_select' && v.pickedFor === m.id,
      curtain: !!document.querySelector('.hsc-curtain'), remainingMs: m?.shop_deadline ? V.versusShopRemainingMs(m.shop_deadline) : null, tip: document.querySelector('.etb-tip')?.textContent ?? null, revision: m?.revision ?? null, locked: m?.group?.raw?.seats?.map((x) => x.seat + ':' + (x.locked ? 'L' : '-') + (x.ready ? 'R' : '-')).join(' ') ?? null, waitPanel: [...document.querySelectorAll('.vspanel-title')].map((e) => e.textContent),
    };
  });
}

export async function shopTurn(p, policy) {
  return p.page.evaluate(async (policy) => {
    const sim = await window.__bench.sim();
    const st = window.__bench.store;
    const d = (a) => { const before = st.getState().run; st.getState().dispatch(a); return st.getState().run !== before; };
    if (policy === 'empty') return 0;
    let n = 0;
    for (let i = 0; i < 10; i++) {
      const run = st.getState().run;
      if (sim.modalOpen(run)) { const ans = sim.versusAutoResolve(run, sim.versusTimeoutRng(1, run.wave, 'p1')); if (ans !== run) st.setState({ run: ans }); continue; }
      if (run.hand.length && run.board.length < 7) { const c = run.hand[0]; if (d({ type: 'play', uid: c.uid })) { n++; continue; } if (run.board.length && d({ type: 'play', uid: c.uid, targetUid: run.board[0].uid })) { n++; continue; } }
      const offers = run.shop.filter((o) => sim.offerBuyPrice(run, o).cost <= run.embers);
      if (run.board.length + run.hand.length < 7 && offers.length && d({ type: 'buy', uid: offers[0].uid })) { n++; continue; }
      break;
    }
    return n;
  }, policy);
}

export async function clickSel(p, sel, nth = 0, { touch = false } = {}) {
  const el = p.page.locator(sel).nth(nth);
  const box = await el.boundingBox().catch(() => null);
  if (!box) return false;
  // On the phone layout the help / Compendium / settings squares cover the teammate portrait (a QA finding): a touch
  // there opens the Compendium. `touch` taps the element itself (its own click), so the swap can still be measured.
  if (touch) await el.dispatchEvent('click');
  else await p.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return true;
}

/** One autopilot step. `mem` keeps the player's per-wave memory. */
export async function step(p, mem, opts = {}) {
  const s = await stateOf(p);
  mem.s = s;
  const now = Date.now();
  if (s.gate && !(mem.gateAt > now - 3000)) { mem.gateAt = now; await clickSel(p, '.rgate-crystal'); return s; }
  if (s.heroChoices && s.pendingMode === 'versus' && s.phase === 'hero_select' && s.heroCards && !mem.picked?.[s.matchId]) {
    if (!mem.heroSeen) mem.heroSeen = now;
    if (now - mem.heroSeen > (opts.heroThinkMs ?? 2500)) { (mem.picked ??= {})[s.matchId] = true; mem.heroSeen = 0; await clickSel(p, '.herocard.big:not([disabled])', opts.heroIndex ?? 0); }
    return s;
  }
  if (s.runMode !== 'versus' || s.spect) return s;
  if (s.runPhase === 'recruit' && s.phase === 'shop' && s.round === s.wave && !s.paused) {
    mem.shopAt ??= {};
    mem.shopAt[s.wave] ??= now;
    if (mem.acted !== s.wave && now - mem.shopAt[s.wave] > (opts.thinkMs ?? 1500)) { mem.acted = s.wave; await shopTurn(p, opts.policy ?? 'buyer'); }
    if (mem.acted === s.wave && mem.ended !== s.wave && opts.endTurn !== 'timer' && now - mem.shopAt[s.wave] > (opts.endMs ?? 3000) && !s.etbPressed && !(opts.holdEnd?.(s))) {
      mem.ended = s.wave; await clickSel(p, '.etbwrap');
    }
  }
  if (s.runPhase === 'combat') {
    mem.fightAt ??= {};
    mem.fightAt[s.wave] ??= now;
    if (s.etbReady && mem.endCombat !== s.wave && now - mem.fightAt[s.wave] > (opts.watchMs ?? 1000)) { mem.endCombat = s.wave; await clickSel(p, '.etbwrap.ready'); }
  }
  return s;
}

export { sleep };
