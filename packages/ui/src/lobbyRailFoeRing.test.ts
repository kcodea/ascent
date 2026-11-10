/**
 * THE NEXT FOE RING BREATHES ON A PLAIN BOX (perf, the Duos audit of 2026-11-09).
 *
 * The ring's svg carried its glow (two stacked drop-shadows), `will-change` AND the looping animation. Measured on an
 * idle round-3 shop, that one element restyled and re-layerized the page on the main thread every frame: 124 of the 200 ms
 * of main-thread work a second. The breath now runs on `.lrv-foering-breath` (opacity + scale, no filter) and the svg
 * inside stands still, its glow drawn once (the kwglow rule in CLAUDE.md). These pin that split.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sheet = readFileSync(join(__dirname, 'lobbyRailDocked.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
const panel = readFileSync(join(__dirname, 'LobbyPanel.tsx'), 'utf8');

describe('the next foe ring: the breath and the glow are on different elements', () => {
  it('the element that animates has no filter, and animates opacity + transform only', () => {
    const breath = rules.filter((r) => /animation:[^;]*lr2FoePulse/.test(r.body));
    expect(breath.length).toBe(1);
    expect(breath[0]!.sel).toMatch(/\.lrv-foering-breath$/);
    expect(breath[0]!.body).not.toMatch(/filter\s*:/);
    const frames = sheet.match(/@keyframes lr2FoePulse\s*\{([\s\S]*?\})\s*\}/)![1]!;
    const props = [...frames.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
    expect([...new Set(props)].sort()).toEqual(['opacity', 'transform']);
  });

  it('the glow is the POLYGON\'s own static filter, never one on the svg root (that one re-layerized the page every frame)', () => {
    expect(rules.filter((r) => /svg\.lrv-foering$/.test(r.sel) && /filter\s*:/.test(r.body))).toEqual([]);
    const svg = rules.filter((r) => /svg\.lrv-foering polygon$/.test(r.sel) && /filter\s*:/.test(r.body));
    expect(svg.length).toBe(1);
    expect(svg[0]!.body).toMatch(/drop-shadow\(.*drop-shadow\(/); // the same two-layer glow
    expect(svg[0]!.body).not.toMatch(/animation|will-change/);
    // No rule animates the filtered ring svg any more.
    for (const r of rules) if (/svg\.lrv-foering\b/.test(r.sel)) expect(r.body).not.toMatch(/animation\s*:\s*lr2/);
  });

  it('the same look: period, range, scale and origin are the tuned values', () => {
    const breath = rules.find((r) => /animation:[^;]*lr2FoePulse/.test(r.body))!;
    expect(breath.body).toContain('animation: lr2FoePulse calc(var(--lr2-pulse-period, 2.2) * 1s) ease-in-out infinite');
    expect(breath.body).toContain('transform-origin: 50% 50%');
    expect(sheet).toContain('0%, 100% { opacity: var(--lr2-pulse-min, 0.53); transform: scale(0.985); }');
    expect(sheet).toContain('50% { opacity: var(--lr2-pulse-max, 1); transform: scale(1.02); }');
    expect(sheet).toContain('drop-shadow(0 0 calc(5px * var(--dk-s, 1) * var(--lr2-pulse-glow, 3)) var(--lr2-pc)) drop-shadow(0 0 calc(12px * var(--dk-s, 1) * var(--lr2-pulse-glow, 3)) var(--lr2-pc))');
  });

  it('the rail wraps the ring svg in the breathing box', () => {
    expect(panel).toMatch(/ring \? <span className="lrv-foering-breath" aria-hidden="true">\{edge\}<\/span> : edge/);
  });
});
