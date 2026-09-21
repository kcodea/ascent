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
afterEach(() => { ui?.unmount(); ui = null; });
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
  ui = mount(<RankScreen {...props} />);
  return { onContinue, onRetry, props };
}

describe('every fixture state renders its labels, and Continue is always there', () => {
  it.each(RANK_FIXTURES.map((f) => [f.id, f] as const))('%s', (_id, f) => {
    const { onContinue } = render(f);
    const c = ui!.container;
    // Placement headline: VICTORY for 1st, the ordinal otherwise.
    expect(text('.rankend-place-text')).toBe(f.placement === 1 ? 'VICTORY' : `${f.placement}${['', 'ST', 'ND', 'RD'][f.placement] ?? 'TH'}`);
    // Continue: present, focused, and fires exactly once.
    const cont = c.querySelector<HTMLButtonElement>('.rankend-continue')!;
    expect(cont).not.toBeNull();
    expect(document.activeElement).toBe(cont);
    act(() => cont.click());
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
    expect(text('.rankend-live')).toBe('Finished 3rd. +16 RP. Now Gold I, 0 / 100. Promoted to Gold I.');
  });

  it('the final warband is a secondary, expandable section; Rewatch is a secondary action', () => {
    const onRewatch = vi.fn();
    render(fixtureById('gain')!, { onRewatch, warband: <div className="fake-warband">seven minions</div> });
    expect(ui!.container.querySelector('.fake-warband')).toBeNull();
    const links = [...ui!.container.querySelectorAll<HTMLButtonElement>('.rankend-link')];
    expect(links.map((b) => b.textContent)).toEqual(['Rewatch', 'Final warband']);
    act(() => links[1]!.click());
    expect(ui!.container.querySelector('.fake-warband')).not.toBeNull();
    act(() => links[0]!.click());
    expect(onRewatch).toHaveBeenCalledTimes(1);
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
    expect(text('.rankend-outcome')).toBe('Demoted to Gold III');
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

  it('the consumed marker survives a reload (localStorage) and dedupes in memory', () => {
    markRankPresented('run:a');
    markRankPresented('run:a');
    expect(JSON.parse(localStorage.getItem('ascent.rank.presented')!)).toEqual(['run:a']);
    resetRankPresented();
    expect(wasRankPresented('run:a')).toBe(false);
  });
});
