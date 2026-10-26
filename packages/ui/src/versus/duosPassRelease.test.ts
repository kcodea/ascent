/**
 * R-DUOS-PASS-03 (owner 2026-10-25: "Passing a minion or spell should require the player to release it over their
 * teammates frame"). A pass happens ONLY on a real release (pointerup, mouse or touch) over the teammate portrait's
 * visible frame, the round disc. Hovering never passes; a release anywhere else (near it, its box corners, the board,
 * the rail) never passes; a cancelled pointer never passes.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { overMateFrame, passOnRelease } from './duosPassUi';

// The portrait's box: a 200 x 200 square at (1600, 800); its frame is the inscribed circle (centre 1700, 900, radius 100).
const box = { left: 1600, top: 800, right: 1800, bottom: 1000 };
const up = (x: number, y: number, pointerType = 'mouse') => ({ type: 'pointerup', clientX: x, clientY: y, pointerType });

describe('passing needs a release over the teammate frame (R-DUOS-PASS-03)', () => {
  it('a release inside the frame passes', () => {
    expect(passOnRelease(box, up(1700, 900))).toBe(true);
    expect(passOnRelease(box, up(1790, 900))).toBe(true); // near the rim, still on the disc
  });

  it('a release just outside the frame never passes (its box corners and a near miss included)', () => {
    expect(passOnRelease(box, up(1801, 900))).toBe(false); // one pixel past the rim
    expect(passOnRelease(box, up(1605, 805))).toBe(false); // inside the box, outside the round frame
    expect(passOnRelease(box, up(1795, 995))).toBe(false);
    expect(passOnRelease(box, up(1500, 900))).toBe(false); // the board side
    expect(passOnRelease(null, up(1700, 900))).toBe(false); // no portrait (not Duos / not a hand drag)
  });

  it('hovering then moving away and releasing never passes: only the release point decides', () => {
    const path = [up(1700, 900), up(1720, 880), up(1400, 600)];
    expect(overMateFrame(box, path[0]!.clientX, path[0]!.clientY)).toBe(true); // the hover glows
    expect(passOnRelease(box, path[path.length - 1]!)).toBe(false);
  });

  it('touch: a finger lifted on the frame passes; a cancelled touch over it never does', () => {
    expect(passOnRelease(box, up(1700, 900, 'touch'))).toBe(true);
    expect(passOnRelease(box, { type: 'pointercancel', clientX: 1700, clientY: 900 })).toBe(false);
  });

  it('the shop drag has exactly one pass path, and it is the release test', () => {
    const src = readFileSync(join(__dirname, '../Recruit.tsx'), 'utf8');
    expect(src.match(/type: 'passCard'/g)).toHaveLength(1);
    const i = src.indexOf("type: 'passCard'");
    const gate = src.lastIndexOf('passOnRelease(mateRect, e)', i);
    expect(gate).toBeGreaterThan(0);
    expect(i - gate).toBeLessThan(900);
    expect(src).not.toMatch(/inRect\(/); // the old square box hit test is gone
  });
});

describe('hand cards only, and the held card glows (owner 2026-10-25)', () => {
  const src = readFileSync(join(__dirname, '../Recruit.tsx'), 'utf8');
  const css = readFileSync(join(__dirname, 'versus.css'), 'utf8');

  it('"you aren\'t supposed to be able to pass a card off your board, only from hand": only a hand drag measures the portrait', () => {
    const i = src.indexOf('duosMateRectRef.current = run.duos');
    expect(i).toBeGreaterThan(0);
    const line = src.slice(i, src.indexOf('\n', i));
    expect(line).toContain("drag.source === 'hand'");
    expect(line).not.toContain("'board'");
  });

  it('"have the card\'s border glow blue/green" when it will pass, red when it cannot: the drag card mirrors the portrait', () => {
    expect(src).toMatch(/\$\{passOver && drag\.source === 'hand' \? ` pass-\$\{passOver\}` : ''\}/);
    const ok = /\.dragcard\.pass-ok \.card\.plated \.plateglow:not\(\.bothglow\) \{([^}]*)\}/.exec(css)?.[1] ?? '';
    const no = /\.dragcard\.pass-no \.card\.plated \.plateglow:not\(\.bothglow\) \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(ok).toMatch(/rgba\(64, 214, 236/); // the portrait's teal
    expect(no).toMatch(/rgba\(214, 70, 60/); // the portrait's red
    // The kwglow rule: the shadow is static; the only animation is an opacity one.
    expect(ok).toMatch(/animation: duospassglow/);
    expect(no).not.toMatch(/animation/);
    const kf = /@keyframes duospassglow \{([^]*?)\}\s*\n/.exec(css)?.[1] ?? '';
    expect(kf).toMatch(/opacity/);
    expect(kf).not.toMatch(/filter|box-shadow|background/);
  });
});
