/**
 * THE VERSUS ROOM GEOMETRY (owner bug 2026-10-14: the arena art "zoomy", windowed vs fullscreen off). The painting and
 * every overlay laid onto it must live in ONE coordinate space: the painting is sized from the 16:9 stage box (--gh,
 * offset by --bar-y, never the window), and every overlay inside `.vsarena` is placed in % of the painting, so the
 * frames / VS / bench and the avatars / banners / gems / bench slots / Start game can never drift apart at any aspect.
 * This pins the CSS contract, then checks the model across the five owner-named window sizes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fitStage } from '../stage';

const css = readFileSync(join(__dirname, 'versus.css'), 'utf8');
const rule = (sel: string): string => {
  const m = new RegExp(`(^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`no rule ${sel}`);
  return m[2]!;
};
const OVERLAYS = ['.vsframe', '.vsframe-p1', '.vsframe-p2', '.vsbanner', '.vsbanner-p1', '.vsbanner-p2', '.vsgatebox', '.vsgatebox-p1', '.vsgatebox-p2', '.vscenter', '.vsbenchslot'];
const PAINT_W = 2560;
const PAINT_H = 1086;

describe('Versus room: painting and overlays share one stage-box coordinate space', () => {
  it('the painting is sized from the stage box (--gh, --bar-y), keeping its own aspect', () => {
    const a = rule('.vsarena');
    expect(a).toMatch(/height:\s*var\(--gh/);
    expect(a).toMatch(/top:\s*var\(--bar-y/);
    expect(a).toContain(`aspect-ratio: ${PAINT_W} / ${PAINT_H}`);
    expect(a).toContain('left: calc(50% - var(--_vs-w) / 2)');
    expect(rule('.vsroomstage')).toContain('overflow: clip');
    expect(a).not.toMatch(/translate:\s/);
    expect(a).not.toMatch(/\b(vw|vh|dvh)\b/);
  });

  it('every overlay on the painting is placed in % of the painting (no px, --u or viewport units)', () => {
    for (const sel of OVERLAYS) {
      const body = rule(sel);
      for (const prop of ['left', 'top', 'width', 'height']) {
        const m = new RegExp(`(?:^|;|\\s)${prop}:\\s*([^;]+);`).exec(body);
        if (m) expect(m[1]!.trim(), `${sel} ${prop}`).toMatch(/^-?[\d.]+%$/);
      }
    }
  });

  it('the margins are covered (no letterbox colour bands) and the corner chrome is pinned to the stage box', () => {
    expect(rule('.vsarena-ext')).toMatch(/cover/);
    expect(rule('.vsroomtop')).toMatch(/var\(--bar-y[\s\S]*var\(--bar-x/);
    expect(rule('.vsroomctl')).toMatch(/var\(--bar-y[\s\S]*var\(--bar-x/);
  });

  it('across 1920x1080, 2560x1440, 2560x1080, 1366x768 and 1280x800 a seat keeps its exact place on the painting', () => {
    // The CSS model: layout viewport from fitStage, --gh = min(lvh, lvw * 9/16, 1440) (the 2560 cap), painting
    // height = --gh, centred, top at --bar-y. A frame at (29.0%, 17.7%) of the painting must land at the same
    // fraction of the painting, and the painting's height must equal the stage box height, at every size.
    const frame = { x: 0.2898, y: 0.1768 };
    for (const [w, h] of [[1920, 1080], [2560, 1440], [2560, 1080], [1366, 768], [1280, 800]] as const) {
      const fit = fitStage(w, h);
      const lvw = fit.lw;
      const lvh = fit.lh;
      const gh = Math.min(lvh, (lvw * 9) / 16, 1440);
      const barY = (lvh - gh) / 2;
      const paintH = gh;
      const paintW = (paintH * PAINT_W) / PAINT_H;
      const left = lvw / 2 - paintW / 2;
      const fx = left + frame.x * paintW;
      const fy = barY + frame.y * paintH;
      expect((fx - left) / paintW, `${w}x${h}`).toBeCloseTo(frame.x, 9);
      expect((fy - barY) / paintH, `${w}x${h}`).toBeCloseTo(frame.y, 9);
      // The painting always spans the full stage-box height, so its scale relative to the UI is constant.
      expect(paintH / gh).toBe(1);
    }
  });
});
