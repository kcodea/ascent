import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOCK_DEFAULTS, DOCK_TEAM_GAP, GEM_REF_H, dockedLayout, type DockAnchors } from './lobbyRailDockedLayout';
import { duosRailTeamOf } from './versus/duosRailTeams';
import { parseRailStatusKey, railStatusKey, versusRailStatuses } from './versus/versusRailStatus';

/**
 * EVERY MODE ON THE DOCKED RAIL (owner 2026-10-31: "I think we should move all modes to this rail type. 1v1, even 3 and 4
 * player group games"; R-RAIL-DOCKED-ALLMODES-01). The layout's half: a 1v1 / Group table is a few slices capped at the
 * max slice height (never stretched down the whole span), a Duos table is laid out in teams (a wider gap between pairs,
 * one box per team), and the Versus state each slice shows comes from one rule.
 */
const A: DockAnchors = {
  refresh: { left: 1437, top: 134, right: 1700, bottom: 246 },
  gem: { left: 1517, top: 382, right: 1669, bottom: 548 },
  gold: { left: 1535, top: 662, right: 1648, bottom: 775 },
  view: { left: 0, top: 0, right: 1920, bottom: 1080 },
};
const s = (A.gem.bottom - A.gem.top) / GEM_REF_H;
const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `s${i}`);
const apart = (a: { y: number; h: number }, b: { y: number; h: number }): boolean => a.y + a.h <= b.y + 0.5 || b.y + b.h <= a.y + 0.5;

describe('the Docked rail in every mode: layout', () => {
  it.each([2, 3, 4])('a %i-player Versus table: slices capped at the max height, anchored under the round slice, apart', (n) => {
    const L = dockedLayout(A, ids(n), [])!;
    expect(L.panels).toHaveLength(n);
    for (const p of L.panels) {
      expect(p.h).toBeLessThanOrEqual(DOCK_DEFAULTS.panelMax * s + 0.01); // never one huge stretched slice
      expect(p.y).toBeGreaterThanOrEqual(L.head.y + L.head.h - 0.01);
    }
    for (let i = 1; i < n; i++) expect(apart(L.panels[i - 1]!, L.panels[i]!)).toBe(true);
    expect(L.teams).toBeUndefined();
  });

  it('a Duos table (4 seats) is laid out in teams: a wider gap between the pairs, one box round each pair', () => {
    const order = ['s0', 's1', 's2', 's3'];
    const L = dockedLayout(A, order, [], DOCK_DEFAULTS, order.map(duosRailTeamOf))!;
    const [a, b, c, d] = L.panels;
    const inGap = b!.y - (a!.y + a!.h), between = c!.y - (b!.y + b!.h);
    expect(inGap).toBeCloseTo(DOCK_DEFAULTS.gap * s, 3);
    expect(between).toBeCloseTo((DOCK_DEFAULTS.gap + DOCK_TEAM_GAP) * s, 3);
    expect(d!.y - (c!.y + c!.h)).toBeCloseTo(inGap, 3);
    expect(L.teams?.map((t) => t.ids)).toEqual([['s0', 's1'], ['s2', 's3']]);
    const t0 = L.teams![0]!;
    expect(t0.y).toBeCloseTo(a!.y, 5);
    expect(t0.y + t0.h).toBeCloseTo(b!.y + b!.h, 5);
  });

  it('Ranked Duos (8 seats, four teams) still fits the span, the fallen team keeping its place at the foot', () => {
    const live = ['s0', 's1', 's4', 's5', 's2', 's3'], dead = ['s6', 's7'];
    const L = dockedLayout(A, live, dead, DOCK_DEFAULTS, [...live, ...dead].map(duosRailTeamOf))!;
    expect(L.panels).toHaveLength(8);
    expect(L.teams?.map((t) => t.team)).toEqual([0, 2, 1, 3]);
    const last = L.panels[7]!;
    expect(last.dead).toBe(true);
    expect(last.y + last.h).toBeLessThanOrEqual(Math.max((A.gold.top + A.gold.bottom) / 2 + ((A.gold.right - A.gold.left) / 2) * 1.21, A.gem.bottom) + 0.5);
    for (let i = 1; i < 8; i++) expect(apart(L.panels[i - 1]!, L.panels[i]!)).toBe(true);
  });
});

const m1v1 = (p: Record<string, unknown>) => ({
  phase: 'shop', p1_user: 'me', p2_user: 'them', paused_seat: null,
  p1_locked: false, p2_locked: false, p1_ready: false, p2_ready: false, p1_auto: false, p2_auto: false, ...p,
}) as never;
const seat = (seat: string, p: Record<string, unknown> = {}) => ({ seat, userId: seat, name: seat, health: 30, armor: 0, hero: null, locked: false, ready: false, intro: false, auto: false, missed: 0, eliminatedRound: null, outReason: null, placement: null, ...p });
const group = (phase: string, seats: ReturnType<typeof seat>[], extra: Record<string, unknown> = {}) => ({
  phase, group: { raw: { phase, paused_at: null, paused_seat: null, options: {}, seats, ...extra } },
}) as never;

describe('the Docked rail in every mode: Versus player state on the slice', () => {
  it('1v1: the opponent is s1; Locked in in the shop, Ready after the fight, Away / Disconnected over both', () => {
    expect(versusRailStatuses(m1v1({}), 'p1')).toEqual({});
    expect(versusRailStatuses(m1v1({ p2_locked: true }), 'p1')).toEqual({ s1: { label: 'Locked in', tone: 'ready' } });
    expect(versusRailStatuses(m1v1({ p1_locked: true }), 'p2')).toEqual({ s1: { label: 'Locked in', tone: 'ready' } });
    expect(versusRailStatuses(m1v1({ phase: 'combat', p2_ready: true }), 'p1')).toEqual({ s1: { label: 'Ready', tone: 'ready' } });
    expect(versusRailStatuses(m1v1({ p2_auto: true, p2_locked: true }), 'p1').s1).toEqual({ label: 'Away', tone: 'away' });
    expect(versusRailStatuses(m1v1({ paused_seat: 'p2' }), 'p1').s1).toEqual({ label: 'Disconnected', tone: 'away' });
    // Your own state is included (the rail draws it only on others' slices); a finished match shows nothing.
    expect(versusRailStatuses(m1v1({ p1_locked: true }), 'p1').s0?.label).toBe('Locked in');
    expect(versusRailStatuses(m1v1({ phase: 'complete', p2_locked: true }), 'p1')).toEqual({});
  });

  it('Group: each player on their own rail slice (s0 = the viewer, the others in seat order); the out and recorded never show', () => {
    const g = group('shop', [seat('p1'), seat('p2', { locked: true }), seat('p3', { auto: true }), seat('p4', { locked: true, eliminatedRound: 3 })]);
    // From p3's side the others are p1, p2, p4 = s1, s2, s3.
    expect(versusRailStatuses(g, 'p3')).toEqual({ s2: { label: 'Locked in', tone: 'ready' }, s0: { label: 'Away', tone: 'away' } });
    const paused = group('shop', [seat('p1'), seat('p2')], { paused_at: 'now', paused_seat: 'p2' });
    expect(versusRailStatuses(paused, 'p1')).toEqual({ s1: { label: 'Disconnected', tone: 'away' } });
    const served = group('shop', [seat('p1'), seat('p2'), seat('p3', { locked: true, served: true })]);
    expect(versusRailStatuses(served, 'p1')).toEqual({});
  });

  it('Duos: the teammate is s1 whatever its seat number (the rail lists the teammate first)', () => {
    const g = group('shop', [seat('p1'), seat('p2'), seat('p3', { locked: true }), seat('p4')], { options: { mode: 'duos' } });
    expect(Object.keys(versusRailStatuses(g, 'p3'))).toEqual(['s0']);
    // p4 is p3's teammate: s1 from p3's side.
    const g2 = group('shop', [seat('p1'), seat('p2'), seat('p3'), seat('p4', { locked: true })], { options: { mode: 'duos' } });
    expect(versusRailStatuses(g2, 'p3')).toEqual({ s1: { label: 'Locked in', tone: 'ready' } });
    const mate = versusRailStatuses(group('shop', [seat('p1'), seat('p2', { locked: true }), seat('p3'), seat('p4')], { options: { mode: 'duos' } }), 'p1');
    expect(mate).toEqual({ s1: { label: 'Locked in', tone: 'ready' } });
  });

  it('the store key round-trips', () => {
    const map = versusRailStatuses(group('combat', [seat('p1', { ready: true }), seat('p2', { ready: true })]), 'p1');
    expect(parseRailStatusKey(railStatusKey(map))).toEqual(map);
    expect(parseRailStatusKey('')).toEqual({});
  });
});

describe('the Docked Health bar on a cut slice (R-RAIL-DOCKED-BAR-01)', () => {
  // Lead 2026-10-31: the Gold coin's cut hid the start of the red, so a player beside the coin read as nearly dead. Owner
  // 2026-10-31: the bar must still follow the cut ("adhered to the cutout"). So the track runs under the cut, clipped to the
  // slice's outline, and the scaled fills start where the foot is clear of the cut (`footX`, the CSS `--fx`): the visible
  // fill past the cut over the bar past the cut is exactly Health / max.
  const css = readFileSync(join(__dirname, 'lobbyRailDocked.css'), 'utf8');
  const tsx = readFileSync(join(__dirname, 'LobbyPanel.tsx'), 'utf8');
  it('the track follows the cut (outline clip), the fills start at --fx', () => {
    const bar = css.split('}').find((r) => r.includes('.lobbyseat .lrv-bar {') && r.includes('left:'))!;
    expect(bar).toMatch(/left:\s*calc\(var\(--rim\)/);
    const fills = css.split('}').find((r) => r.includes('.lobbyseat .lrv-bar > span {'))!;
    expect(fills).toMatch(/left:\s*var\(--fx, 0px\)/);
    expect(fills).toMatch(/width:\s*calc\(100% - var\(--fx, 0px\)\)/);
    expect(tsx).toMatch(/className="lrv-barclip" style=\{dp\?\.cut \? \{ clipPath: outlineClip\(insetOutline\(/);
  });
  it.each([['8 seats', ids(8)], ['4 seats', ids(4)], ['2 seats', ids(2)]])('%s: no cut reaches into the bar band right of footX; fill / visible bar = Health / max', (_n, live) => {
    const L = dockedLayout(A, live, [])!;
    const cut = L.panels.filter((p) => p.cut);
    expect(cut.length).toBeGreaterThan(0);
    for (const p of cut) {
      const bh = Math.max(8, p.h * 0.22); // Tuner 2 "Bar height" default (22% of the slice)
      // The bar spans [footX + rim, w - rim] (rim = the slice's 3px edge + 1px); the outline (the cut, and the slice's own
      // corner rounding of 3px) never reaches past its left end inside the bar's band.
      const rim = 3 * L.s + 1;
      const band = p.outline.filter(([x, y]) => y >= p.h - bh - 1 && x < p.w * 0.9);
      for (const [x] of band) expect(x, `${p.id}: the cut reaches into the bar`).toBeLessThan(p.footX + rim);
      const barW = p.w - p.footX - 2 * rim;
      expect(barW).toBeGreaterThan(p.w * 0.25);
      for (const hp of [0.1, 0.5, 0.9]) expect((hp * barW) / barW).toBeCloseTo(hp, 2);
    }
  });
});
