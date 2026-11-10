// @vitest-environment jsdom
/**
 * THE TEAM MOMENTS: my team's elimination and my team's result present the pair as a team and
 * ring their cue once. (The Ranked Duos result's rank and XP flow is pinned by rankedDuosPostgame.test.tsx.)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const { mount } = await import('../renderedText.mount');
const { sfx } = await import('../sfx');
const { resetIdentityForTests, setIdentity } = await import('../identity');
const { resetRankPresented } = await import('../rank/presented');
const { DuosResultOverlay } = await import('./DuosParty');
const { KNOCKOUT_NOTICE_MS, KnockoutNotice } = await import('./SpectatorBar');
const { teamMoodOf } = await import('./TeamFaces');
const { useVersus } = await import('./versusStore');
type Mounted = ReturnType<typeof mount>;

const MATCH = 'aaaaaaaa-2222-3333-4444-555555555555';
const seat = (s: string, userId: string, name: string, hero: string, served = false) => ({
  seat: s, userId, name, health: 0, armor: 0, hero, locked: false, ready: false, intro: true, auto: false, missed: 0,
  eliminatedRound: null, outReason: null, placement: null, ...(served ? { served: true } : {}),
});
const duosMatch = (mode: 'duos' | 'ranked_duos') => ({
  id: MATCH, phase: 'shop', round: 6,
  group: { duos: { mate: 'p2' }, raw: { id: MATCH, phase: 'shop', options: { v: 1, mode, modifiers: [] }, seats: [seat('p1', 'kev', 'Kevin', 'indy'), seat('p2', 'lem', 'Lemon', 'fi'), seat('p3', 'x', 'Xan', 'indy'), seat('p4', 'y', 'Yor', 'fi')] } },
});

let ui: Mounted | null = null;
let out: ReturnType<typeof vi.spyOn>;
let result: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers();
  resetRankPresented();
  window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as never;
  out = vi.spyOn(sfx, 'duosTeamOut').mockImplementation(() => undefined);
  result = vi.spyOn(sfx, 'duosTeamResult').mockImplementation(() => undefined);
  for (const k of ['pulse', 'tick'] as const) vi.spyOn(sfx, k).mockImplementation(() => undefined);
  setIdentity({ userId: 'kev', displayName: 'Kevin', anonymous: false, email: null } as never);
});
afterEach(() => {
  ui?.unmount(); ui = null;
  for (const ghost of document.querySelectorAll('.rankend-exit')) ghost.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetIdentityForTests();
  useVersus.setState({ duosResult: null, knockout: null, match: null, room: null, statsOpen: false, lastMatch: null } as never);
});
const q = (sel: string): Element | null => ui!.container.querySelector(sel);
const all = (sel: string): Element[] => [...ui!.container.querySelectorAll(sel)];
const text = (sel: string): string => (q(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('my team is out', () => {
  it('a Duos knockout shows BOTH teammates (me first), the team place out of the teams, and rings the cue once', () => {
    useVersus.setState({ match: duosMatch('ranked_duos'), knockout: { matchId: MATCH, placement: 3, of: 4 } } as never);
    ui = mount(<KnockoutNotice matchId={MATCH} />);
    expect(q('.vsko')?.getAttribute('aria-label')).toBe('Your team is out');
    expect(all('.vsteam-face .vsteam-name').map((e) => e.textContent)).toEqual(['You', 'Lemon']);
    expect(q('.vsteam')?.className).toContain('out');
    expect(text('.endplace-num')).toBe('3RD');
    expect(text('.endplace-of')).toBe('of 4 teams');
    expect(text('.vsko-sub')).toBe('Your team is out. Watch the rest of the match from the stands.');
    expect(out).toHaveBeenCalledTimes(1);
    // a re-render (the placement landing late, a heartbeat) does not ring it again
    act(() => { useVersus.setState({ knockout: { matchId: MATCH, placement: 3, of: 4 } } as never); });
    expect(out).toHaveBeenCalledTimes(1);
  });

  it('stays long enough for the beat, then moves on by itself; the button leaves at once', () => {
    useVersus.setState({ match: duosMatch('duos'), knockout: { matchId: MATCH, placement: 2, of: 2 } } as never);
    ui = mount(<KnockoutNotice matchId={MATCH} />);
    expect(KNOCKOUT_NOTICE_MS).toBeGreaterThanOrEqual(8000);
    act(() => { vi.advanceTimersByTime(KNOCKOUT_NOTICE_MS - 50); });
    expect(q('.vsko')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(100); });
    expect(q('.vsko')).toBeNull();
    expect(useVersus.getState().knockout).toBeNull();
  });

  it('a group match (no teammate) shows me alone and says "You are out"', () => {
    const m = duosMatch('duos');
    (m.group.raw as { options: unknown }).options = { v: 1, mode: 'group', modifiers: [] };
    (m.group as { duos: unknown }).duos = null;
    useVersus.setState({ match: m, knockout: { matchId: MATCH, placement: 4, of: 4 } } as never);
    ui = mount(<KnockoutNotice matchId={MATCH} />);
    expect(q('.vsko')?.getAttribute('aria-label')).toBe('You are out');
    expect(all('.vsteam-face')).toHaveLength(1);
    expect(q('.vsteam')?.className).toContain('solo');
    expect(text('.endplace-of')).toBe('of 4 players');
    expect(text('.vsko-sub')).toBe('You are out. Watch the rest of the match from the stands.');
  });

  it('another match\'s knockout shows nothing and rings nothing', () => {
    useVersus.setState({ match: duosMatch('duos'), knockout: { matchId: 'other', placement: 2, of: 2 } } as never);
    ui = mount(<KnockoutNotice matchId={MATCH} />);
    expect(q('.vsko')).toBeNull();
    expect(out).not.toHaveBeenCalled();
  });
});

describe('my team\'s result', () => {
  const team = [
    { userId: 'kev', name: 'Kevin', hero: 'indy', cosmetics: null, self: true },
    { userId: 'lem', name: 'Lemon', hero: 'fi', cosmetics: null, self: false },
  ];
  const open = (placement: number) => {
    useVersus.setState({ duosResult: { matchId: MATCH, placement, result: null, teamName: 'Lemon Squad', pending: false, unrated: true, team } } as never);
    return (ui = mount(<DuosResultOverlay />));
  };

  it('a win presents the pair lit (the "won" mood) and rings the result cue once, with the place', () => {
    open(1);
    expect(q('.vsteam')?.className).toContain('won');
    expect(all('.vsduosresult-face .vsduosresult-name').map((e) => e.textContent)).toEqual(['You', 'Lemon']);
    expect(result).toHaveBeenCalledTimes(1);
    expect(result).toHaveBeenCalledWith(1);
    // the rating row landing later re-renders the same match: no second ring
    act(() => { useVersus.setState({ duosResult: { ...useVersus.getState().duosResult!, pending: true } } as never); });
    expect(result).toHaveBeenCalledTimes(1);
  });

  it('2nd is "placed", 3rd and 4th are "out"', () => {
    expect([1, 2, 3, 4].map(teamMoodOf)).toEqual(['won', 'placed', 'out', 'out']);
    open(4);
    expect(q('.vsteam')?.className).toContain('out');
    expect(result).toHaveBeenCalledWith(4);
  });
});

describe('the team row\'s motion', () => {
  const css = readFileSync(join(__dirname, 'versus.css'), 'utf8');
  it('the entrance moves transform / opacity only and the win light is a static gradient whose opacity animates', () => {
    for (const name of ['vsteaminl', 'vsteaminr', 'vsteamin', 'vsteamglow', 'vskopanel', 'vskoplace']) {
      const kf = new RegExp(`@keyframes ${name} \\{.*\\}`).exec(css)?.[0] ?? '';
      expect(kf, name).not.toBe('');
      expect(kf, name).not.toMatch(/box-shadow|filter|background|border-radius/);
    }
    // the grey drain is a one-shot filter TRANSITION on the still portrait, never an animation on the moving face
    expect(css).toMatch(/\.vsteam\.out \.lb-heroframe \{ filter: grayscale\(0\.9\) brightness\(0\.72\); transition: filter/);
    expect(css).not.toMatch(/\.vsteam-face \{[^}]*filter/);
    expect(css).not.toMatch(/vsteam[^{]*\{[^}]*infinite/);
  });
  it('reduced motion shows the final state at once', () => {
    const block = /@media \(prefers-reduced-motion: reduce\) \{\s*\.vsteam-face,[\s\S]*?\n\}/.exec(css)?.[0] ?? '';
    expect(block).toContain('animation: none');
    expect(block).toContain('.vsko .vsko-panel');
    expect(block).toContain('.vsteam.out .lb-heroframe { transition: none; }');
  });
});
