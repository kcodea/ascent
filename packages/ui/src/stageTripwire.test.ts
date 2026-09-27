import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// TRIPWIRES FOR THE SCALED STAGE (stage.ts, owner ask 2026-09-26). Below 1920×1080 the whole game lays out at the
// design size inside `#stage` and one transform scales it to the window. Four ways new code silently escapes that
// and drifts on a phone or a small window; each is caught here at the source level.

const SRC = __dirname;
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const files = walk(SRC).filter((f) => !/\.test\.tsx?$/.test(f));
const code = files.filter((f) => /\.tsx?$/.test(f));
const css = files.filter((f) => f.endsWith('.css'));
const rel = (f: string): string => relative(SRC, f).replace(/\\/g, '/');
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

describe('the scaled stage: nothing escapes #stage', () => {
  it('portals and imperatively appended layers mount into stageHost(), not document.body', () => {
    // Outside the stage an element is drawn in window px while its sizes (--scale, --u, …) are layout px: on a
    // phone it renders ~3× too big and in the wrong place. The rotate prompt is the one deliberate exception (it
    // must be drawn in real device px), plus the bug reporter's throwaway download link.
    const ALLOW = new Set(['Boot.tsx', 'bug-report/bugReportCapture.ts', 'stage.ts', 'renderedText.mount.tsx' /* jsdom test harness */]);
    const offenders: string[] = [];
    for (const f of code) {
      if (ALLOW.has(rel(f))) continue;
      const src = stripComments(readFileSync(f, 'utf8'));
      if (/document\.body\.(appendChild|append|insertBefore|prepend)\(/.test(src)) offenders.push(`${rel(f)}: body append`);
      if (/createPortal\(/.test(src) && /document\.body\s*[,)]/.test(src)) offenders.push(`${rel(f)}: portal to body`);
    }
    expect(offenders).toEqual([]);
  });

  it('stylesheets use the layout-viewport vars, never raw vw / vh', () => {
    // Inside the transformed stage `100vw` is the WINDOW, not the layout viewport. Use var(--lvw) / var(--lvh) or
    // calc(N * var(--vw)) / calc(N * var(--vh)); the raw unit may only appear as those vars' fallback.
    const offenders: string[] = [];
    for (const f of css) {
      const src = stripComments(readFileSync(f, 'utf8'));
      const bare = src.replace(/var\(--l?v[wh],\s*[\d.]+[dsl]?v[wh]\)/g, '');
      const m = bare.match(/(?<![\w-])-?[\d.]+[dsl]?v[wh]\b/g);
      if (m) offenders.push(`${rel(f)}: ${[...new Set(m)].join(' ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('stylesheets have no viewport-size @media queries (they see the window, not the layout)', () => {
    // Use a `:root[data-lv~=…]` breakpoint from stage.ts instead. Orientation + pointer (the rotate prompt) is fine.
    const offenders: string[] = [];
    for (const f of css) {
      const src = stripComments(readFileSync(f, 'utf8'));
      const m = src.match(/@media[^{]*\((min-|max-)?(width|height|aspect-ratio|device-width|device-height)\s*:[^{]*\{/g);
      if (m) offenders.push(`${rel(f)}: ${m.join(' | ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('every window-sized Pixi canvas wears .pixi-screen (screen-space renderer, stage-sized box)', () => {
    // A `resizeTo: window` renderer is in screen px; without the class its CSS box is the window size INSIDE the
    // scaled stage, so it would be drawn at s × the window and every FX would land off target.
    const offenders = code.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return /resizeTo:\s*window/.test(src) && !src.includes('pixi-screen');
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  it('a Pixi renderer sized to a DOM host folds the stage scale into its resolution', () => {
    // `resizeTo: <element>` sizes the renderer in LAYOUT px; on a phone that is ~2.8x the screen per axis, so a
    // bare devicePixelRatio renders ~8x the pixels shown (the hero ceremony did: 9 ms -> 64 ms a frame).
    const offenders = code.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return /resizeTo:\s*(?!window\b)[A-Za-z_]/.test(src) && !src.includes('stageScale()');
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  it('TSX inline styles do not use raw viewport units', () => {
    const offenders: string[] = [];
    for (const f of code) {
      if (rel(f).startsWith('uiEditor/')) continue; // DEV overlay, not in the stage's layout
      const src = stripComments(readFileSync(f, 'utf8')).replace(/var\(--l?v[wh],\s*[\d.]+[dsl]?v[wh]\)/g, '');
      const m = src.match(/['"`][^'"`\n]*(?<![\w-])[\d.]+[dsl]?v[wh]\b[^'"`\n]*['"`]/g);
      if (m) offenders.push(`${rel(f)}: ${m.join(' | ')}`);
    }
    expect(offenders).toEqual([]);
  });
});
