import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOCK_DEFAULTS, dockedLayout, teamPlatePath, type DockAnchors } from './lobbyRailDockedLayout';
import { duosRailTeamOf } from './versus/duosRailTeams';

/**
 * R-DUOS-RAIL-PLATE-01 (owner 2026-11-02: "the shadows are cropping over, which we dont want. they should follow the exact
 * shape of the lobby rail navy blue part"; "i want the team name to be right aligned, but with some padding from the right
 * so it isnt covered by the YOU or now facing corner icon. i want to put a black 2px stroke around the font as well").
 */
const A: DockAnchors = {
  refresh: { left: 1437, top: 134, right: 1700, bottom: 246 },
  gem: { left: 1517, top: 382, right: 1669, bottom: 548 },
  gold: { left: 1535, top: 662, right: 1648, bottom: 775 },
  view: { left: 0, top: 0, right: 1920, bottom: 1080 },
};
const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
const css = strip(readFileSync(join(__dirname, 'lobbyRailDocked.css'), 'utf8'));
const rule = (sel: string): string => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => m[1]!.trim() === sel)?.[2] ?? '';

/** The sub-paths of a `path('…')` as point lists. */
const subpaths = (p: string): [number, number][][] =>
  p.slice(6, -2).split('Z').filter(Boolean).map((sp) => {
    const pts: [number, number][] = [];
    let x = 0, y = 0;
    for (const m of sp.matchAll(/([MLHV])([-\d. ]+)/g)) {
      const n = m[2]!.trim().split(/\s+/).map(Number);
      if (m[1] === 'H') x = n[0]!; else if (m[1] === 'V') y = n[0]!; else { x = n[0]!; y = n[1]!; }
      pts.push([x, y]);
    }
    return pts;
  });

describe('R-DUOS-RAIL-PLATE-01: the Duos team plate takes the slices\x27 shape', () => {
  const live = ['s0', 's1', 's4', 's5', 's2', 's3'], dead = ['s6', 's7'];
  const L = dockedLayout(A, live, dead, DOCK_DEFAULTS, [...live, ...dead].map(duosRailTeamOf))!;

  it('every team plate is clipped to its slices\x27 outlines, the gap between them and the bracket strip', () => {
    expect(L.teams).toHaveLength(4);
    for (const t of L.teams!) {
      const parts = subpaths(teamPlatePath(t, L.panels, 8));
      expect(parts).toHaveLength(t.ids.length * 2); // each outline, one bridge per pair, the bracket strip
      const [p0, p1] = t.ids.map((id) => L.panels.find((p) => p.id === id)!);
      // The outlines are the slices' own, moved into the team box.
      expect(parts[0]).toHaveLength(p0!.outline.length);
      parts[0]!.forEach(([x, y], i) => {
        expect(x).toBeCloseTo(p0!.outline[i]![0] + p0!.x - t.x, 0);
        expect(y).toBeCloseTo(p0!.outline[i]![1] + p0!.y - t.y, 0);
      });
      // The bridge starts where both edges are clear of a cut, so it never shows past a board piece.
      const bridgeLeft = Math.min(...parts[1]!.map(([x]) => x));
      expect(bridgeLeft).toBeGreaterThanOrEqual(Math.max(p0!.footX, p1!.topX) - 0.1);
    }
  });

  it('the plate is clipped in the rail (the clip is set inline from teamPlatePath)', () => {
    const src = readFileSync(join(__dirname, 'LobbyPanel.tsx'), 'utf8');
    expect(src).toMatch(/className=\{`lrv-team\$\{mod\}`\}[\s\S]{0,200}clipPath: teamPlatePath\(/);
  });

  it('the team name is right-aligned, clear of the corner chip, with a black outline', () => {
    const body = rule('html:root .lobbyrail.lrv-docked .lrv-teamname');
    expect(body).toMatch(/text-align:\s*right/);
    expect(body).toMatch(/padding-right:\s*calc\(2[1-9]px/); // the 30px chip reaches 21px in from the corner
    expect(body).toMatch(/--wk-stroke:\s*calc\(4px[^;]*#000/); // under the fill: a 2px outline
    expect(body).toMatch(/-webkit-text-stroke:\s*var\(--wk-stroke\)/);
    expect(body).toMatch(/paint-order:\s*stroke fill/);
  });
});

/**
 * R-RAIL-CHIP-TOP-01 (owner 2026-11-02: "these icon circles need to be above the rest of the rail UI elements, not
 * behind"). A slice is a stacking context (z 1), so its corner chip only clears the placement column (z 2) when the slice
 * itself is lifted above it, by a rule as specific as the slice's own z rule.
 */
describe('R-RAIL-CHIP-TOP-01: the corner chips sit above the placement column', () => {
  const z = (sel: string): number => Number(rule(sel).match(/z-index:\s*(\d+)/)?.[1] ?? NaN);
  const base = 'html:root .lobbyrail.lrv-docked .lobbyseat:is(.you.foe.ghost.dead, *)';
  const lifted = `${base}:has(> .lrv-you, > .lrv-vs, > .lrv-ready)`;
  it('a slice carrying YOU, the swords or the ready check is lifted over the placement column', () => {
    expect(z(base)).toBe(1);
    expect(z('html:root .lobbyrail.lrv-docked .lrv-rank')).toBe(2);
    expect(z(lifted)).toBeGreaterThan(2); // same base selector, so it is at least as specific as the slice's own z
  });
});
