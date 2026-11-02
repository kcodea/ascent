// @vitest-environment jsdom
/**
 * R-RANKED-DUOS-POSTGAME-01 (owner 2026-11-02: "add a post game screen just like ranked solo's that shows your team's
 * ranked progress/xp etc same flow as solos"; "the continue then returns you to your duos party"):
 *  - after a Ranked Duos game the solo ranked end screen shows over the party: the team's place out of 4, the team's
 *    medal bar and points change, then MY Account XP (the `versus:<match>` settlement), under the team's name and both
 *    teammates' portraits and names (me first);
 *  - an unrated table says "Unrated" and still shows the XP, as solo's does; a result not in yet is "Updating rank";
 *  - Match details opens the match stats; Continue closes the screen onto the party (the room stays).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { ProgressionResult } from '@game/progression';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const { mount } = await import('../renderedText.mount');
const { sfx } = await import('../sfx');
const { useGame } = await import('../store');
const { resetProgressionForTests, useProgression } = await import('../progression/progressionStore');
const { resetRankPresented } = await import('../rank/presented');
const { fixtureById } = await import('../rank/fixtures');
const { DuosResultOverlay } = await import('./DuosParty');
const { duosResultTeam, loadDuosResult, useVersus } = await import('./versusStore');
const { versusRemote } = await import('./versusRemote');
type View = import('./versusStore').DuosResultView;
type Mounted = ReturnType<typeof mount>;

const MATCH = '11111111-2222-3333-4444-555555555555';
const team: View['team'] = [
  { userId: 'kev', name: 'Kevin', hero: 'indy', cosmetics: null, self: true },
  { userId: 'lem', name: 'Lemon', hero: 'fi', cosmetics: null, self: false },
];
const xp = (over: Partial<ProgressionResult> = {}): ProgressionResult => ({
  runId: `versus:${MATCH}`, mode: 'versus', rulesVersion: 1, placement: 2, comeback: false,
  xp: { base: 50, topFour: 30, firstPlace: 0, comeback: 0, total: 80 },
  before: { lifetimeXp: 100, level: 1 }, after: { lifetimeXp: 180, level: 1 }, unlockedTitles: [], cratesAwarded: 0, crateIds: [], revisionAfter: 1,
  settledAt: new Date().toISOString(), achievements: [], achievementXp: 0, aether: null, aetherBalance: null, ...over,
});

let ui: Mounted | null = null;
beforeEach(() => {
  resetRankPresented();
  resetProgressionForTests();
  // Reduced motion: the rank sequence settles at once, so the XP panel's turn comes in the same render.
  window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as never;
  for (const k of ['pulse', 'tick'] as const) vi.spyOn(sfx, k).mockImplementation(() => undefined);
  useGame.setState({ account: { userId: 'kev', email: null, anonymous: false, discriminator: null } } as never);
});
afterEach(() => {
  ui?.unmount(); ui = null;
  for (const ghost of document.querySelectorAll('.rankend-exit')) ghost.remove();
  vi.restoreAllMocks();
  useVersus.setState({ duosResult: null, statsOpen: false, lastMatch: null } as never);
});

const show = (over: Partial<View> = {}): Mounted => {
  const gain = fixtureById('gain')!;
  useVersus.setState({
    duosResult: { matchId: MATCH, placement: 2, result: { ...gain.result!, placement: 2 }, teamName: 'Lemon Squad', pending: false, unrated: false, team, ...over },
  } as never);
  useProgression.setState({ capability: 'on', current: { localKey: `versus:${MATCH}`, mode: 'versus', runId: `versus:${MATCH}`, state: 'confirmed', result: xp(), deduped: false, error: null } });
  return (ui = mount(<DuosResultOverlay />));
};
const q = (sel: string): Element | null => ui!.container.querySelector(sel);
const text = (sel: string): string => (q(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('the Ranked Duos post-game is the solo ranked end screen', () => {
  it('the team (name, both portraits and names, me first), its place out of 4, its medal bar, then my Account XP', () => {
    show();
    expect(text('.vsduosresult-team')).toBe('Lemon Squad');
    const faces = [...ui!.container.querySelectorAll('.vsduosresult-face')];
    expect(faces).toHaveLength(2);
    expect(faces[0]!.classList.contains('self')).toBe(true);
    expect(faces.map((f) => f.querySelector('.vsduosresult-name')?.textContent)).toEqual(['You', 'Lemon']);
    expect(faces.every((f) => f.querySelector('.lb-heroframe img'))).toBe(true);
    expect(q('.rankend-place')?.getAttribute('aria-label')).toBe('Finished 2nd of 4');
    expect(q('.rankend-rank')).not.toBeNull();
    expect(q('.rankend-delta')).not.toBeNull();
    expect(q('.acctxp[aria-label="Account XP"]')).not.toBeNull();
    expect(q('.rankend-continue')?.textContent).toBe('Continue');
  });

  it('an unrated table says so and still shows the XP; a result not in yet waits, XP after it', () => {
    show({ unrated: true, result: null });
    expect(text('.rankend-status.unrated')).toBe('Unrated · No recorded teams');
    expect(q('.acctxp[aria-label="Account XP"]')).not.toBeNull();
    ui!.unmount(); ui = null;
    show({ pending: true, result: null });
    expect(text('.rankend-status.pending')).toContain('Updating rank');
    expect(q('.acctxp')).toBeNull(); // the XP waits its turn, as on the solo screen
  });

  it('Match details opens the match stats; Continue returns to the party (the screen closes, the room stays)', () => {
    useVersus.setState({ lastMatch: { matchId: MATCH } } as never);
    show();
    act(() => { q('.rankend-details')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(useVersus.getState().statsOpen).toBe(true);
    act(() => { q('.rankend-continue')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(useVersus.getState().duosResult).toBeNull();
  });
});

describe('the result it shows', () => {
  it('the team row is the two live seats, me first, with my own cosmetics and my teammate\'s', () => {
    const mine = { v: 1 } as never;
    const theirs = { v: 2 } as never;
    const raw = { seats: [
      { seat: 'p1', userId: 'lem', name: 'Lemon', hero: 'fi' },
      { seat: 'p2', userId: 'kev', name: 'Kevin', hero: 'indy' },
    ] } as never;
    const out = duosResultTeam(raw, 'kev', mine, (uid) => (uid === 'lem' ? theirs : null));
    expect(out.map((m) => [m.name, m.self, m.cosmetics])).toEqual([['Kevin', true, mine], ['Lemon', false, theirs]]);
  });

  it('an unrated match shows at once without asking for a team result; a rated one reads it', async () => {
    const read = vi.spyOn(versusRemote, 'duosResult').mockResolvedValue(fixtureById('gain')!.result as never);
    await loadDuosResult(MATCH, 3, null, { unrated: true, team });
    expect(read).not.toHaveBeenCalled();
    expect(useVersus.getState().duosResult).toMatchObject({ unrated: true, pending: false, placement: 3, team });
    await loadDuosResult(MATCH, 3, 'Lemon Squad', { team });
    expect(read).toHaveBeenCalledTimes(1);
    expect(useVersus.getState().duosResult).toMatchObject({ unrated: false, pending: false, teamName: 'Lemon Squad', team });
  });
});
