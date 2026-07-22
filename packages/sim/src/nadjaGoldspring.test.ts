import { describe, it, expect } from 'vitest';
import { CONFIG, createRun, reduce, type RunState } from './index';

/**
 * Nadja's Goldspring — "Gain 1 maximum Gold" — must give a PERSISTENT lead above the base cap.
 *
 * The bug (owner report 2026-07-22): it did `s.maxEmbers += 1`, but the per-wave growth line can never push
 * `maxEmbers` above the cap (`Math.max(maxEmbers, min(cap, maxEmbers+1))`). So a Nadja who powered early
 * reached 10 ahead of schedule, then STUCK at 10 — a normal player caught up by ~turn 8 and her whole
 * investment evaporated. Intended: powering turns 1–4 leaves her at 14 on the turn a normal player first hits
 * 10, because each use is +1 ABOVE the cap that the natural curve keeps climbing to underneath.
 *
 * Fixed by routing the power through `maxGoldBonus` (the Shop-License "above the cap" channel) instead of
 * `maxEmbers`.
 */
const clearModals = (s: RunState): RunState => {
  let guard = 0;
  while ((s.discover || s.questOffer || s.chooseOne || s.pendingTarget || s.runeforgeOffer) && guard++ < 40) {
    if (s.discover) s = reduce(s, { type: 'discover', index: 0 });
    else if (s.questOffer) s = reduce(s, { type: 'buyQuest', index: 0 });
    else if (s.chooseOne) s = reduce(s, { type: 'chooseOne', index: 0 });
    else if (s.pendingTarget) s = reduce(s, { type: 'battlecryTarget', targetUid: s.board[0]?.uid ?? s.pendingTarget.uid });
    else if (s.runeforgeOffer) s = reduce(s, { type: 'skipRuneforge' });
  }
  return s;
};

/** Advance one full turn, using Goldspring first iff `power`. Returns the state at the next recruit phase. */
const turn = (s: RunState, power: boolean): RunState => {
  s = clearModals(s);
  if (power) { s = { ...s, embers: Math.max(s.embers, 3), heroReady: true }; s = reduce(s, { type: 'heroPower' }); }
  s = reduce(s, { type: 'faceOmen' });
  let guard = 0;
  while (s.phase !== 'recruit' && guard++ < 40) {
    if (s.phase === 'combat') s = reduce(s, { type: 'resolveCombat' });
    else if (s.discover) s = reduce(s, { type: 'discover', index: 0 });
    else if (s.questOffer) s = reduce(s, { type: 'buyQuest', index: 0 });
    else break;
  }
  return clearModals(s);
};

describe("Nadja's Goldspring gives a persistent lead above the cap", () => {
  it('powering turns 1–4 then stopping leaves her at 14 by the turn a normal player first reaches 10', () => {
    let s: RunState = createRun(1, 'nadja');
    for (let t = 1; t <= 7; t++) s = turn(s, t <= 4); // power turns 1–4, coast 5–7
    // Now at the start of turn 8 — where an un-powered player's gold first tops out at the cap.
    expect(CONFIG.embersCap).toBe(10);
    expect(s.maxEmbers).toBe(CONFIG.embersCap); // the natural curve climbed to 10 on its own, undisturbed
    expect(s.maxGoldBonus).toBe(4);             // her four uses persist ABOVE the cap
    expect(s.embers).toBe(14);                  // 10 + 4 — the lead survived her stopping
  });

  it('the lead does not decay on further turns without powering', () => {
    let s: RunState = createRun(1, 'nadja');
    for (let t = 1; t <= 4; t++) s = turn(s, true);
    for (let t = 5; t <= 12; t++) s = turn(s, false);
    expect(s.maxGoldBonus).toBe(4);
    expect(s.embers).toBe(14); // still 14 many turns later, not clawed back to 10
  });

  it('a non-Nadja run never accrues the bonus (the natural cap is untouched)', () => {
    let s: RunState = createRun(1, 'warden');
    for (let t = 1; t <= 10; t++) s = turn(s, false);
    expect(s.maxGoldBonus ?? 0).toBe(0);
    expect(s.embers).toBe(CONFIG.embersCap); // tops out at 10, as always
  });
});
