// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LR2_DEFAULTS, LR2_SPEC, LR2_VARS, getLobbyRailTuner2, resetLobbyRailTuner2, setLobbyRailTuner2, type LobbyRailTuner2Config } from './lobbyRailTuner2Config';

/**
 * LOBBY RAIL TUNER 2's contract (owner 2026-10-30: "a lot of the tuner things dont seem to work"): every control is
 * written to its own var, that var is read by the rule that paints the element the control names, and nothing else in
 * the stylesheets can shadow it. (The live check, dragging each control in a real browser and reading the computed style
 * of its target, is in the PR's verification notes: jsdom does not resolve `calc()` / `var()`.)
 */
const SRC = __dirname;
const sheet = (readFileSync(join(SRC, 'lobbyRailMedallions.css'), 'utf8') + readFileSync(join(SRC, 'lobbyRailTiles.css'), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.css') ? [p] : [];
});

type NumKey = keyof typeof LR2_VARS;
/** Which element each control must reach: a fragment of the selector of the rule that reads its var. */
const TARGET: Record<NumKey, string> = {
  eTile: '.lobbyseat', eGap: '.lobbyseats', eRailW: '.lobbyrail', eRailPad: '.lobbyrail', eSlide: '.lobbyseat.foe', eBadge: '.lrv-rank', eHp: '.lrv-tilehp',
  railX: '.lobbyrail', railY: '.lobbyrail', railScale: '.lobbyrail',
  phoneY: '.lobbyrail', phoneScale: '.lobbyrail',
  headX: '.lobbyrailhead', headY: '.lobbyrailhead', headFont: '.lobbyrailhead', headGap: '.lobbyrailhead', headShadow: '.lobbyrailhead',
  tabX: '.lobbyrailtab', tabY: '.lobbyrailtab', tabScale: '.lobbyrailtab',
  medSize: '.lobbyrail', ringSize: '.pframe-box', medGap: '.lobbyseat + .lobbyseat', medCol: '.lobbyseat', nameFont: '.lobbyname',
  nameX: '.lobbynameline', nameY: '.lobbynameline',
  ovScale: '.lrv-hpplaque', ovY: '.lrv-hpplaque', ovFace: '.lobbyface', ovNameGap: '.lobbynameline',
  seatPad: '.lobbyseat', seatGap: '.lobbyseat + .lobbyseat', seatRadius: '.lobbyseat', faceNameGap: '.lobbyseat', nameLines: '.lobbyname',
  hpScale: '.lobbyhp', hpX: '.lobbyhp', hpY: '.lobbyhp', hpFont: '.lobbyhp',
  deadScale: '.lobbyrail', deadOpacity: '.lobbyseat.dead', deadGap: '.lobbyseat.dead',
  bgOpacity: '.lobbyrail', bgPad: '.lobbyrail', bgRadius: '.lobbyrail', bgW: '.lobbyrail', bgH: '.lobbyrail',
  pulseRing: '.lobbyface::before', pulseGlow: '.lobbyface::before', pulseMin: '0%, 100%', pulseMax: '50%', pulsePeriod: '.lobbyface::before',
  cardW: '.lrv-scout-medallion', cardX: '.lrv-scout-medallion', cardY: '.lrv-scout-medallion', cardFont: '.lrv-scout-medallion',
};

describe('Lobby Rail Tuner 2', () => {
  it('has a control for every var, and every control writes its own var onto :root', () => {
    const keys = Object.keys(LR2_VARS) as NumKey[];
    expect(new Set(Object.values(LR2_VARS)).size, 'one var per control').toBe(keys.length);
    expect(LR2_SPEC.controls.map((c) => c.key).sort()).toEqual(['anchor', 'dHp', 'eNames', ...keys].sort());
    for (const k of keys) {
      const c = LR2_SPEC.controls.find((x) => x.key === k)!;
      const before = document.documentElement.style.getPropertyValue(LR2_VARS[k]);
      const next = (LR2_DEFAULTS[k] as number) === c.max ? c.min : c.max;
      setLobbyRailTuner2(k, next);
      expect(getLobbyRailTuner2()[k as keyof LobbyRailTuner2Config]).toBe(next);
      expect(document.documentElement.style.getPropertyValue(LR2_VARS[k]), `${k} must change ${LR2_VARS[k]}`).not.toBe(before);
    }
    setLobbyRailTuner2('dHp', 'overlap');
    expect(document.documentElement.getAttribute('data-lr2-dhp')).toBe('overlap');
    setLobbyRailTuner2('anchor', 'left');
    expect(document.documentElement.getAttribute('data-lr2-anchor')).toBe('left');
    resetLobbyRailTuner2();
    expect(getLobbyRailTuner2()).toEqual(LR2_DEFAULTS);
  });

  it('every var is read by the rule that paints the element its control names', () => {
    for (const [k, v] of Object.entries(LR2_VARS) as [NumKey, string][]) {
      const readers = rules.filter((r) => r.body.includes(`var(${v}`) || r.body.includes(`var(${v},`));
      expect(readers.length, `${v} (${k}) is read nowhere`).toBeGreaterThan(0);
      expect(readers.some((r) => r.sel.includes(TARGET[k])), `${v} (${k}) must reach ${TARGET[k]}; read by: ${readers.map((r) => r.sel).join(' | ')}`).toBe(true);
    }
    // The anchor switch has its own rules.
    expect(sheet).toContain('[data-lr2-anchor="left"]');
    expect(sheet).toContain('[data-lr2-dhp="overlap"]');
  });

  it('no stylesheet declares a Tuner 2 var, so nothing can shadow the tuner', () => {
    const vars = Object.values(LR2_VARS);
    for (const file of walk(SRC)) {
      const css = readFileSync(file, 'utf8');
      for (const v of vars) expect(css.includes(`${v}:`), `${file} declares ${v}`).toBe(false);
    }
  });
});
