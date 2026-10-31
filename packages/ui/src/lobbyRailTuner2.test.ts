// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LR2_DEFAULTS, LR2_LAYOUT, LR2_SPEC, LR2_VARS, dockCfgOf, getLobbyRailTuner2, resetLobbyRailTuner2, setLobbyRailTuner2, type LobbyRailTuner2Config } from './lobbyRailTuner2Config';
import { dockedLayout, type DockAnchors } from './lobbyRailDockedLayout';

/**
 * LOBBY RAIL TUNER 2's contract (owner 2026-10-30: "a lot of the tuner things dont seem to work"; 2026-10-31: "every
 * control must visibly work"): every PAINT control is written to its own var, that var is read by the rule that paints
 * the element the control names, and nothing else in the stylesheets can shadow it; every LAYOUT control (the Docked
 * geometry) moves the docked layout. (The live check, in a real browser, is in the PR's verification notes: jsdom does
 * not resolve `calc()` / `var()`.)
 */
const SRC = __dirname;
const sheet = readFileSync(join(SRC, 'lobbyRailDocked.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.css') ? [p] : [];
});

type NumKey = keyof typeof LR2_VARS;
/** Which element each PAINT control must reach: a fragment of the selector of the rule that reads its var. */
const TARGET: Partial<Record<NumKey, string>> = {
  dkHeadFont: '.lobbyrailhead.lrv-docked',
  barH: '.lrv-bar', barOverlap: '.lrv-bar', barInset: '.lrv-bar',
  artZoom: '.lobbyface', artFx: '.lobbyface', artFy: '.lobbyface', artW: '.lrv-docked .lobbyseat', fadeStart: '.lrv-docked .lobbyseat', fadeLen: '.lrv-docked .lobbyseat', fadeStr: '.lrv-docked .lobbyseat', artBright: '.lobbyface',
  nameSize: '.lrv-name', nameWeight: '.lrv-name', nameLines: '.lrv-name', nameX: '.lrv-name', nameY: '.lrv-name', nameShadow: '.lrv-name',
  headX: '.lobbyrailhead', headY: '.lobbyrailhead', headShadow: '.lobbyrailhead',
  pulseRing: '.lrv-foering', pulseGlow: '.lrv-foering', pulseMin: '0%, 100%', pulseMax: '50%', pulsePeriod: '.lrv-foering',
  cardW: '.lobbyscout.lrv-scout', cardX: '.lobbyscout.lrv-scout', cardY: '.lobbyscout.lrv-scout', cardFont: '.lobbyscout.lrv-scout',
};

// A 1080p board, in the numbers measured off the live game (Refresh / gem / Gold), as the layout's anchors.
const A: DockAnchors = {
  refresh: { left: 1437, top: 134, right: 1700, bottom: 246 },
  gem: { left: 1517, top: 382, right: 1669, bottom: 548 },
  gold: { left: 1535, top: 662, right: 1648, bottom: 775 },
  view: { left: 0, top: 0, right: 1920, bottom: 1080 },
};
const LIVE = ['s0', 's1', 's2', 's3', 's4'];
const DEAD = ['s5', 's6', 's7'];

describe('Lobby Rail Tuner 2', () => {
  it('has a control for every value, and every control writes its own var onto :root', () => {
    const keys = Object.keys(LR2_VARS) as NumKey[];
    expect(new Set(Object.values(LR2_VARS)).size, 'one var per control').toBe(keys.length);
    expect(LR2_SPEC.controls.map((c) => c.key).sort()).toEqual(['barStyle', 'dkTop', 'artLayout', 'nameSide', 'nameShow', ...keys].sort());
    for (const k of keys) {
      const c = LR2_SPEC.controls.find((x) => x.key === k)!;
      const before = document.documentElement.style.getPropertyValue(LR2_VARS[k]);
      const next = (LR2_DEFAULTS[k] as number) === c.max ? c.min : c.max;
      setLobbyRailTuner2(k, next);
      expect(getLobbyRailTuner2()[k as keyof LobbyRailTuner2Config]).toBe(next);
      expect(document.documentElement.style.getPropertyValue(LR2_VARS[k]), `${k} must change ${LR2_VARS[k]}`).not.toBe(before);
    }
    setLobbyRailTuner2('barStyle', 'smooth');
    expect(document.documentElement.getAttribute('data-lr2-bar')).toBe('smooth');
    setLobbyRailTuner2('artLayout', 'center');
    expect(document.documentElement.getAttribute('data-lr2-art')).toBe('center');
    setLobbyRailTuner2('nameSide', 'left');
    expect(document.documentElement.getAttribute('data-lr2-name-side')).toBe('left');
    setLobbyRailTuner2('nameShow', 'off');
    expect(document.documentElement.getAttribute('data-lr2-name')).toBe('off');
    resetLobbyRailTuner2();
    expect(getLobbyRailTuner2()).toEqual(LR2_DEFAULTS);
  });

  it('every paint var is read by the rule that paints the element its control names', () => {
    for (const [k, v] of Object.entries(LR2_VARS) as [NumKey, string][]) {
      if (LR2_LAYOUT[k]) continue; // a layout dial: checked below
      const target = TARGET[k];
      expect(target, `${k} has no paint target`).toBeTruthy();
      const readers = rules.filter((r) => r.body.includes(`var(${v}`));
      expect(readers.length, `${v} (${k}) is read nowhere`).toBeGreaterThan(0);
      expect(readers.some((r) => r.sel.includes(target!)), `${v} (${k}) must reach ${target}; read by: ${readers.map((r) => r.sel).join(' | ')}`).toBe(true);
    }
    expect(sheet).toContain('[data-lr2-bar="smooth"]');
    for (const a of ['full', 'right', 'center']) expect(sheet).toContain(`[data-lr2-art="${a}"]`);
    expect(sheet).toContain('[data-lr2-name-side="left"]');
    expect(sheet).toContain('[data-lr2-name="off"]');
  });

  it('every layout dial moves the docked layout', () => {
    // Three tables (a full one, a 2-seat table whose slices reach "Max slice height", and an ultrawide one where the width cap binds), so every dial has a say somewhere.
    const lay = (c: LobbyRailTuner2Config): string => JSON.stringify([dockedLayout(A, LIVE, DEAD, dockCfgOf(c)), dockedLayout(A, ['s0', 's1'], [], dockCfgOf(c)), dockedLayout({ ...A, view: { ...A.view, right: 2560 } }, LIVE, DEAD, dockCfgOf(c)), dockedLayout({ ...A, view: { ...A.view, right: 1790 } }, LIVE, DEAD, dockCfgOf(c)), dockedLayout(A, LIVE, DEAD, { ...dockCfgOf(c), topMode: 'eclipse' })]);
    const base = lay(LR2_DEFAULTS);
    for (const k of Object.keys(LR2_LAYOUT) as NumKey[]) {
      const c = LR2_SPEC.controls.find((x) => x.key === k)!;
      for (const v of [c.min, c.max]) {
        if (v === LR2_DEFAULTS[k]) continue;
        const moved = lay({ ...LR2_DEFAULTS, [k]: v });
        expect(moved, `${k} = ${v} must change the docked layout`).not.toBe(base);
      }
    }
  });

  it('no stylesheet declares a Tuner 2 var, so nothing can shadow the tuner', () => {
    const vars = Object.values(LR2_VARS);
    for (const file of walk(SRC)) {
      const css = readFileSync(file, 'utf8');
      for (const v of vars) expect(css.includes(`${v}:`), `${file} declares ${v}`).toBe(false);
    }
  });
});
