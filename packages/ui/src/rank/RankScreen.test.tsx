// @vitest-environment jsdom
/**
 * THE POST-GAME RANK SCREEN, rendered per fixture under jsdom: every state prints its labels + delta text
 * (caps / floors / promotion / demotion / uncapped), Continue is always present and fires exactly once, a
 * skip settles without touching the submission, the reduced-motion path shows everything at once, and the
 * presentation-consumed marker stops a remount from replaying the celebration. The GSAP timeline itself is
 * built over real elements here (jsdom has no paint, but `skip()` drives `progress(1)` and the settle).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from '../renderedText.mount';
import { RANK_FIXTURES, fixtureById, type RankFixture } from './fixtures';
import { RankScreen } from './RankScreen';
import { deltaText, outcomeText, pointsText, rankLabel } from './rankFormat';
import { markRankPresented, resetRankPresented, wasRankPresented } from './presented';

let ui: Mounted | null = null;
afterEach(() => {
  ui?.unmount(); ui = null;
  for (const ghost of document.querySelectorAll('.rankend-exit')) ghost.remove();
});
beforeEach(() => { resetRankPresented(); });

const text = (sel: string): string => (ui!.container.querySelector(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();

function render(f: RankFixture, over: Partial<Parameters<typeof RankScreen>[0]> = {}) {
  const onContinue = vi.fn();
  const onRetry = vi.fn();
  const props = {
    placement: f.placement, seatCount: 8, submission: f.submission, result: f.result, current: f.current,
    error: f.error, unratedReason: f.submission === 'unrated' ? 'Practice' : undefined,
    runId: `run:${f.id}`, onContinue, onRetry, reducedMotion: true, ...over,
  };
  // Inside the same `.rankend` overlay chrome the end screen mounts it in, so the exit fade has its target.
  ui = mount(<div className="heroselect endscreen lobbyend rankend"><RankScreen {...props} /></div>);
  return { onContinue, onRetry, props };
}

describe('every fixture state renders its labels, and Continue is always there', () => {
  it.each(RANK_FIXTURES.map((f) => [f.id, f] as const))('%s', (_id, f) => {
    const { onContinue } = render(f);
    const c = ui!.container;
    // Placement headline: VICTORY for 1st, the ordinal otherwise — and no "of 8" (owner 2026-09-20).
    expect(text('.rankend-place-text')).toBe(f.placement === 1 ? 'VICTORY' : `${f.placement}${['', 'ST', 'ND', 'RD'][f.placement] ?? 'TH'}`);
    expect(text('.rankend-place')).toBe(text('.rankend-place-text'));
    expect(c.querySelector('.rankend-place-of')).toBeNull();
    // Continue: present, focused, and SINGLE-FIRE — a second press (mouse or Enter) does nothing.
    const cont = c.querySelector<HTMLButtonElement>('.rankend-continue')!;
    expect(cont).not.toBeNull();
    expect(document.activeElement).toBe(cont);
    act(() => cont.click());
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(cont.disabled).toBe(true);
    act(() => cont.click());
    act(() => { cont.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(onContinue).toHaveBeenCalledTimes(1);
    if (f.result) {
      // Reduced motion: the after-state, delta and outcome are all present at once.
      expect(text('.rankbar-label')).toBe(rankLabel(f.result.after));
      expect(text('.rankbar-points')).toBe(pointsText(f.result.after));
      expect(text('.rankend-delta')).toBe(deltaText(f.result));
      const outcome = outcomeText(f.result);
      if (outcome) expect(text('.rankend-outcome')).toBe(outcome); else expect(c.querySelector('.rankend-outcome')).toBeNull();
      expect(c.querySelector('.rankend-status')).toBeNull();
      expect(c.querySelector('.rankend-panel')!.className).toContain('settled');
    } else if (f.current) {
      // Pending / retryable / rejected: the CURRENT crest, no delta, the status line.
      expect(text('.rankbar-label')).toBe(rankLabel(f.current));
      expect(c.querySelector('.rankend-delta')).toBeNull();
    }
  });

  it('pending shows "Updating rank…" with Continue usable and no Retry', () => {
    render(fixtureById('pending')!);
    expect(text('.rankend-status')).toBe('Updating rank…');
    expect(ui!.container.querySelector('.rankend-retry')).toBeNull();
  });

  it('retryable shows "Rank update pending" + Retry, which fires the retry once and never Continue', () => {
    const { onRetry, onContinue } = render(fixtureById('retryable')!);
    expect(text('.rankend-status')).toContain('Rank update pending');
    const retry = ui!.container.querySelector<HTMLButtonElement>('.rankend-retry')!;
    act(() => retry.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('rejected prints the truthful error, not "Unrated"', () => {
    render(fixtureById('rejected')!);
    expect(text('.rankend-status')).toContain('season 2 rules are no longer accepted');
    expect(text('.rankend-status')).not.toContain('Unrated');
    expect(ui!.container.querySelector('.rankend-status')!.getAttribute('role')).toBe('alert');
  });

  it('unrated (practice) shows the placement + Unrated and no rank bar', () => {
    render(fixtureById('unrated')!);
    expect(text('.rankend-status')).toBe('Unrated · Practice');
    expect(ui!.container.querySelector('.rankbar')).toBeNull();
    expect(ui!.container.querySelector('.rankend-delta')).toBeNull();
  });

  it('the live region carries one final announcement', () => {
    render(fixtureById('promo-won')!);
    expect(text('.rankend-live')).toBe('Finished 3rd. +16 RP. Now Gold I, 10 / 100. Promoted to Gold I.');
  });

  it('carries NO Rewatch and NO Final warband (owner 2026-09-20) — the settled screen has no secondary links at all', () => {
    render(fixtureById('gain')!);
    const c = ui!.container;
    expect(c.textContent).not.toMatch(/Rewatch|warband/i);
    expect(c.querySelectorAll('.rankend-link')).toHaveLength(0);
    expect(c.querySelector('.endboard')).toBeNull();
  });

  it('reads top → bottom: placement → crest → label → bar → points → delta → outcome → CONTINUE', () => {
    render(fixtureById('gate')!);
    const c = ui!.container;
    const order = ['.rankend-place', '.rankcrest', '.rankbar-label', '.rankbar-track', '.rankbar-points', '.rankend-delta', '.rankend-outcome', '.rankend-continue']
      .map((sel) => c.querySelector(sel)!);
    for (const el of order) expect(el).not.toBeNull();
    for (let i = 1; i < order.length; i++) {
      // DOCUMENT_POSITION_FOLLOWING (4): the previous element precedes this one in the tree.
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & 4, `${i}`).toBe(4);
    }
  });
});

describe('the animated path: skip settles, the marker stops a replay, an arriving result arms it', () => {
  it('starts on the BEFORE state with the Skip action, and a click on the rank display settles it', () => {
    const f = fixtureById('demotion')!;
    render(f, { reducedMotion: false });
    const c = ui!.container;
    expect(c.querySelector('.rankend-panel')!.className).toContain('playing');
    expect(text('.rankbar-label')).toBe(rankLabel(f.result!.before)); // Gold II while playing
    expect(c.querySelector('.rankcrest-next')).not.toBeNull();         // the Gold III crest is staged
    expect([...c.querySelectorAll('.rankend-link')].map((b) => b.textContent)).toContain('Skip animation');
    expect(wasRankPresented('run:demotion')).toBe(false);
    act(() => { (c.querySelector('.rankend-rank') as HTMLElement).click(); });
    expect(c.querySelector('.rankend-panel')!.className).toContain('settled');
    expect(text('.rankbar-label')).toBe('Gold III');
    expect(text('.rankbar-points')).toBe('70 / 100');
    expect(c.querySelector('.rankend-outcome')).toBeNull(); // the crest/label change says it (owner 2026-09-20)
    expect(text('.rankend-live')).toContain('Demoted to Gold III');
    expect(c.querySelector('.rankcrest-next')).toBeNull();
    expect([...c.querySelectorAll('.rankend-link')].map((b) => b.textContent)).not.toContain('Skip animation');
    expect(wasRankPresented('run:demotion')).toBe(true);
  });

  it('Enter / Space on the rank display also skips (keyboard activation)', () => {
    render(fixtureById('gain')!, { reducedMotion: false });
    const rank = ui!.container.querySelector('.rankend-rank') as HTMLElement;
    expect(rank.getAttribute('tabindex')).toBe('0');
    act(() => { rank.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(ui!.container.querySelector('.rankend-panel')!.className).toContain('settled');
  });

  it('a remount of an already-presented run settles instantly — no replayed celebration', () => {
    const f = fixtureById('promo-medal')!;
    markRankPresented('run:promo-medal');
    render(f, { reducedMotion: false });
    const c = ui!.container;
    expect(c.querySelector('.rankend-panel')!.className).toContain('settled');
    expect(text('.rankbar-label')).toBe('Platinum III');
    expect([...c.querySelectorAll('.rankend-link')].map((b) => b.textContent)).not.toContain('Skip animation');
  });

  it('a DEV preview never writes the marker', () => {
    render(fixtureById('gain')!, { reducedMotion: false, preview: true });
    act(() => { (ui!.container.querySelector('.rankend-rank') as HTMLElement).click(); });
    expect(wasRankPresented('run:gain')).toBe(false);
  });

  it('reduced motion never mounts the Skip action and marks the run presented', () => {
    render(fixtureById('gain')!, { reducedMotion: true });
    expect([...ui!.container.querySelectorAll('.rankend-link')].map((b) => b.textContent)).not.toContain('Skip animation');
    expect(wasRankPresented('run:gain')).toBe(true);
  });

  it('a result arriving while pending arms the sequence on the BEFORE state, then skip settles it', () => {
    const f = fixtureById('gain')!;
    const { props } = render({ ...f, submission: 'pending', result: null, current: f.result!.before }, { reducedMotion: false });
    expect(text('.rankend-status')).toBe('Updating rank…');
    ui!.render(<RankScreen {...props} submission="confirmed" result={f.result} />);
    const c = ui!.container;
    expect(c.querySelector('.rankend-status')).toBeNull();
    expect(c.querySelector('.rankend-panel')!.className).toContain('playing');
    expect(text('.rankbar-points')).toBe('60 / 100');
    act(() => { (c.querySelector('.rankend-rank') as HTMLElement).click(); });
    expect(text('.rankbar-points')).toBe('76 / 100');
    expect(c.querySelector('.rankend-panel')!.className).toContain('settled');
  });

  it('Continue cross-fades: a static clone of the overlay is parked above the title and the real one is released', () => {
    render(fixtureById('gain')!);
    act(() => { ui!.container.querySelector<HTMLButtonElement>('.rankend-continue')!.click(); });
    const ghost = document.querySelector('.rankend-exit')!;
    expect(ghost).not.toBeNull();
    expect(ghost.classList.contains('rankend')).toBe(true);
    expect(ghost.getAttribute('aria-hidden')).toBe('true');
    expect(ghost.querySelector('.rankend-place-text')?.textContent).toBe('3RD');
    // The copy can never be a second Continue.
    expect(ghost.querySelector<HTMLButtonElement>('.rankend-continue')!.disabled).toBe(true);
    expect(ghost.querySelector('.rankend-continue')!.getAttribute('tabindex')).toBe('-1');
    expect(document.querySelectorAll('.rankend-exit')).toHaveLength(1);
  });

  it('Continue mid-sequence settles the screen first, so the clone is the after-state', () => {
    render(fixtureById('demotion')!, { reducedMotion: false });
    expect(text('.rankbar-label')).toBe('Gold II');
    act(() => { ui!.container.querySelector<HTMLButtonElement>('.rankend-continue')!.click(); });
    expect(document.querySelector('.rankend-exit .rankbar-label')?.textContent).toBe('Gold III');
    expect(wasRankPresented('run:demotion')).toBe(true);
  });

  it('the consumed marker survives a reload (localStorage) and dedupes in memory', () => {
    markRankPresented('run:a');
    markRankPresented('run:a');
    expect(JSON.parse(localStorage.getItem('ascent.rank.presented')!)).toEqual(['run:a']);
    resetRankPresented();
    expect(wasRankPresented('run:a')).toBe(false);
  });
});
