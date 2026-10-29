import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * THE CURTAIN OUTRANKS THE WHOLE GAME (owner 2026-10-19, R-PRESENT-17): "if i provided PNG's instead, would that improve
 * anything? it seems to work perfectly for the gate animation". The ranked gate was never better because of its PNG
 * art; it sits at z700, over nearly everything, while the combat <-> shop curtain sat at z250 and a band of in-game
 * layers above that (the Rebirth pillar z2000, the rune lock-in z640, the tutorial spotlight z600-620, emotes z900, the
 * FX screen flash z99999) painted over the blue whenever one was alive as the wipe ran.
 *
 * The curtain now sits ABOVE every in-game layer by construction, so a new layer is under it by default. This
 * tripwire reads every stylesheet and inline z-index in the UI and fails on anything at or above the curtain that is
 * not on the short list below (dev tools, boot / rotate screens, prompts that must block a stale run). A new in-game
 * layer that needs to be that high is a design question for the owner, not a number to bump.
 */
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'styles.css'), 'utf8');

function files(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p, ext));
    else if (ext.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Every `selector { … z-index: N … }` rule with a numeric z-index, comments stripped. */
function zRules(text: string): Array<{ selectors: string[]; z: number }> {
  const out: Array<{ selectors: string[]; z: number }> = [];
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const z = /(?:^|;|\s)z-index:\s*(\d+)/.exec(m[2]!);
    if (!z) continue;
    out.push({ selectors: m[1]!.split(',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean), z: Number(z[1]) });
  }
  return out;
}

const curtainZ = Number(/\.wipecurtain \{ position: fixed; inset: 0; z-index: (\d+);/.exec(css)?.[1]);

/** The ONLY selectors allowed at or above the curtain, each with why. Everything else in the game must be under it. */
const ABOVE_CURTAIN: Record<string, string> = {
  '.wipecurtain': 'the curtain itself',
  '.wipefront': 'the ring riding the bloom (same layer, later in the tree)',
  '.wipebar': 'the bar riding the reveal (same layer, later in the tree)',
  '.wipevista': 'the vista of the return trip (the curtain coming back to the Shop, 2026-10-23)',
  '.wipecurtain.preview': 'the Screen wipe tuner preview (DEV), plays over any screen',
  '.wipefront.preview': 'the Screen wipe tuner preview (DEV)',
  '.wipebar.preview': 'the Screen wipe tuner preview (DEV)',
  '.bootload': 'the boot loader, before any run exists',
  '.drag-cursor-veil': 'a transparent cursor veil during a drag; paints nothing',
  '.fxflash': 'the FX screen flash; `body.wipe-up .fxflash` drops it under the curtain while it is up',
  '.devmenu-btn': 'dev tools',
  '.devmenu': 'dev tools',
  '.sb-dock': 'dev tools (Scene Builder dock)',
  '.uned': 'dev tools (UI editor)',
  '.bl-overlay': 'dev tools (Beat Lab)',
  '.crashlog': 'the crash log, which must show over anything',
  '.perflog': 'the phone perf log readout (R-PHONE-PERFLOG-01), which must show over anything',
  '.nrw-scrim.cloudmoved-scrim': '"your game moved": blocks a stale run above every HUD and menu',
};

/** Inline z-indexes at or above the curtain, by file: all dev tools or system layers. */
const INLINE_ABOVE_CURTAIN = new Set([
  'BugBoard.tsx', 'DevMenu.tsx', 'QaWorkbench.tsx', 'RulebookTriage.tsx', 'touchKeyboard.ts', 'uiEditor/EditorOverlay.tsx',
]);

describe('the combat <-> shop curtain outranks every in-game layer (R-PRESENT-17)', () => {
  it('sits at z3000, with its ring and bar on the same layer', () => {
    expect(curtainZ).toBe(3000);
    const zOf = (sel: string): number | undefined => zRules(css).find((r) => r.selectors.includes(sel))?.z;
    expect(zOf('.wipefront')).toBe(curtainZ);
    expect(zOf('.wipebar')).toBe(curtainZ);
  });

  it('no stylesheet puts an in-game layer at or above it', () => {
    const offenders: string[] = [];
    for (const f of files(here, /\.css$/)) {
      for (const r of zRules(readFileSync(f, 'utf8'))) {
        if (r.z < curtainZ) continue;
        for (const s of r.selectors) {
          if (s.startsWith('body.wipe-up ') || s in ABOVE_CURTAIN) continue;
          offenders.push(`${relative(here, f).replace(/\\/g, '/')}: ${s} (z${r.z})`);
        }
      }
    }
    expect(offenders, 'these layers would paint over the curtain; put them under z3000 or ask the owner').toEqual([]);
  });

  it('no inline style outside the dev tools puts a layer at or above it', () => {
    const offenders: string[] = [];
    for (const f of files(here, /\.tsx?$/)) {
      const rel = relative(here, f).replace(/\\/g, '/');
      if (INLINE_ABOVE_CURTAIN.has(rel)) continue;
      for (const m of readFileSync(f, 'utf8').matchAll(/(?:zIndex\s*[:=]\s*['"]?|z-index:\s*)(\d+)/g)) {
        if (Number(m[1]) >= curtainZ) offenders.push(`${rel}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('while it is up, the wipe FX ride ON it and the screen flash drops UNDER it', () => {
    const fx = /body\.wipe-up \.wipefx-canvas \{ z-index: (\d+); \}/.exec(css);
    expect(fx).not.toBeNull();
    expect(Number(fx![1])).toBeGreaterThan(curtainZ);
    const flash = /body\.wipe-up \.fxflash \{ z-index: (\d+); \}/.exec(css);
    expect(flash).not.toBeNull();
    expect(Number(flash![1])).toBeLessThan(curtainZ);
  });

  it('while it is up, the menus and replay controls rise over it at their own z + 2600, under the dev tools', () => {
    const rules = zRules(css);
    const zOf = (sel: string): number | undefined => rules.find((r) => r.selectors.includes(sel))?.z;
    for (const sel of ['.gmenu', '.inspect-ov', '.disc-toggle.disc-peek.inspect-act', '.replay-cursor', '.acctpanel',
      '.roundrail-wrap', '.bgrov', '.replaybar', '.bgrtoast']) {
      const base = zOf(sel);
      const lifted = zOf(`body.wipe-up ${sel}`);
      expect(base, sel).toBeDefined();
      expect(lifted, `body.wipe-up ${sel}`).toBe(base! + 2600);
      expect(lifted!).toBeGreaterThan(curtainZ);
      expect(lifted!).toBeLessThan(4000); // the dev tools (BugBoard / QA workbench) stay on top
    }
  });
});
