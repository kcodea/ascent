/**
 * R-TOUCH-HOVERGUARD-01 (owner 2026-10-18): hover glows and lifts must not stick after a tap on a phone, and desktop
 * must render exactly as before. The build moves each hover rule into `@media (hover: hover)` (always true for a mouse)
 * without changing the order, the selectors or the declarations; a hover REVEAL with no `.tt-on` tap twin is left alone.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';
import { decorativeTarget, HOVER_MEDIA, hoverGuardPlugin, shouldGuard, splitSelectors } from './hoverGuardPlugin';

const run = async (css: string): Promise<string> => (await postcss([hoverGuardPlugin()]).process(css, { from: undefined })).css;
const norm = (s: string): string => s.replace(/\s+/g, ' ').replace(/\s*([{};])\s*/g, '$1').trim();

describe('the guard', () => {
  it('wraps a hover glow / lift in @media (hover: hover)', async () => {
    expect(norm(await run('.btn:hover { transform: translateY(-2px); filter: brightness(1.1); }')))
      .toBe(norm(`@media ${HOVER_MEDIA} { .btn:hover { transform: translateY(-2px); filter: brightness(1.1); } }`));
  });
  it('splits a mixed selector list in place, the plain half first, so the cascade order is unchanged', async () => {
    expect(norm(await run('.a:hover, .a.on { color: red; } .z { color: blue; }')))
      .toBe(norm(`.a.on { color: red; } @media ${HOVER_MEDIA} { .a:hover { color: red; } } .z { color: blue; }`));
  });
  it('keeps a hover REVEAL with no tap twin (a finger may have no other way in)', async () => {
    const css = '.x:hover .tip { opacity: 1; }';
    expect(norm(await run(css))).toBe(norm(css));
  });
  it('guards a reveal that has a .tt-on tap twin (touchInput opens it on a tap instead)', async () => {
    expect(norm(await run('.x:hover .tip, .x.tt-on .tip { opacity: 1; }')))
      .toBe(norm(`.x.tt-on .tip { opacity: 1; } @media ${HOVER_MEDIA} { .x:hover .tip { opacity: 1; } }`));
  });
  it('guards a decorative glow even though it fades opacity', () => {
    expect(decorativeTarget('.tvbwrap:hover .tvb-glow')).toBe(true);
    expect(decorativeTarget('.runecard:is(:hover, :focus-visible)::after')).toBe(true);
    expect(decorativeTarget('[data-tip]:hover::after')).toBe(false); // a tip, not a glow
    expect(shouldGuard(['.card:hover .cglow'], ['opacity'])).toBe(true);
  });
  it('leaves rules already conditioned on the input device, and keyframes, alone', async () => {
    const css = '@media (hover: none) { .a:hover { color: red; } } @media (pointer: fine) { .b:hover { color: red; } }';
    expect(norm(await run(css))).toBe(norm(css));
  });
  it('splits selector lists only on top-level commas', () => {
    expect(splitSelectors('.a:is(:hover, :focus), .b[data-x="1,2"]')).toEqual(['.a:is(:hover, :focus)', '.b[data-x="1,2"]']);
  });
});

describe('desktop is unchanged: on a hover-capable device the guarded sheet is the same sheet', () => {
  // Flatten a sheet as a mouse sees it: `@media (hover: hover)` always matches, so its rules apply in place.
  const flatten = (css: string): string[] => {
    const out: string[] = [];
    postcss.parse(css).walk((n) => {
      if (n.type !== 'rule') return;
      const r = n as Rule;
      if (r.parent?.type === 'atrule' && /keyframes$/i.test((r.parent as { name: string }).name)) return;
      const ctx: string[] = [];
      for (let p = r.parent; p && p.type === 'atrule'; p = p.parent) {
        const a = p as unknown as { name: string; params: string };
        if (!(a.name === 'media' && a.params === HOVER_MEDIA)) ctx.unshift(`@${a.name} ${a.params}`);
      }
      const decls = (r.nodes ?? []).map((d) => d.toString()).join(';');
      for (const s of splitSelectors(r.selector)) out.push(`${ctx.join(' ')}|${s}|${decls}`);
    });
    return out;
  };
  it('every UI stylesheet: same (selector, declarations) in the same cascade order, per selector', async () => {
    const root = fileURLToPath(new URL('../../packages/ui/src/', import.meta.url));
    // Node 20 (CI) has no fs.globSync: walk the tree.
    const files = (readdirSync(root, { recursive: true }) as string[]).map((p) => p.split('\\').join('/')).filter((p) => p.endsWith('.css'));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const css = readFileSync(root + f, 'utf8');
      const before = flatten(css);
      const after = flatten(await run(css));
      // Same multiset, and every selector's own rules keep their relative order (the cascade between selectors that
      // can match the same element is decided by specificity then order; a split keeps both halves adjacent).
      expect([...after].sort()).toEqual([...before].sort());
      const bySel = (xs: string[]): Map<string, string[]> => { const m = new Map<string, string[]>(); for (const x of xs) { const k = x.split('|')[1]!; m.set(k, [...(m.get(k) ?? []), x]); } return m; };
      const b = bySel(before); const a = bySel(after);
      for (const [k, v] of b) expect(a.get(k)).toEqual(v);
    }
  });
});
