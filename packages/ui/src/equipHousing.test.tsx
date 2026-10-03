// @vitest-environment jsdom
/**
 * THE EQUIPMENT HOUSING (owner ask 2026-10-03: "rebuild the equipment housing from scratch. make it more
 * modern/sleek/cozy and fit our aesthetic. note that it needs to be able to fit all names etc for the equipment").
 *
 *  1. Every Equipment name fits its plate: the fit helper, and a conservative width budget over the real roster
 *     (jsdom has no layout; the browser sweep in the devlog measured the real thing: no name needs to shrink).
 *  2. Every state still lands on the slot in every look: ready / armed / spent, the green / blue charge, the
 *     green coin, and Classic alone draws the bitmap frame.
 *  3. The theme guard: equipSlot.css paints the new looks from the `--ui-*` tokens only, and nothing loops.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { EQUIPMENT } from '@game/content';
import { createRun, type BoardCard, type RunState } from '@game/sim';
import { StatusBar } from './StatusBar';
import { useGame } from './store';
import { mount, type Mounted } from './renderedText.mount';
import { EQ_LOOKS, EQUIP_LOOK_DEFAULTS, NAME_FIT_MIN, nameFitScale, setEquipLook, type EqLook } from './equipLookConfig';

vi.mock('./fx/playDef', () => ({ playDef: vi.fn(), canPlayDefs: () => true }));

const CSS = readFileSync(join(__dirname, 'equipSlot.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const NEW_LOOKS = EQ_LOOKS.filter((l) => l !== 'classic');

describe('the name plate fits every Equipment name', () => {
  it('the fit helper: 1 when it fits, the ratio when it does not, never below the floor', () => {
    expect(nameFitScale(100, 130)).toBe(1);
    expect(nameFitScale(140, 130)).toBeCloseTo((130 * 0.98) / 140, 2);
    expect(nameFitScale(400, 130)).toBe(NAME_FIT_MIN);
    expect(nameFitScale(0, 130)).toBe(1);
  });

  it('every name fits the narrowest plate at the floor size, on a generous glyph budget', () => {
    // The plate widths and the base size, read from the stylesheet so a resize here cannot pass silently.
    const base = Number(/font-size: calc\(([\d.]+) \* var\(--u\) \* var\(--eqn-fit/.exec(CSS)?.[1]);
    const pad = Number(/\.hplabel\.eqname \{[^}]*padding: 0 calc\(([\d.]+) \* var\(--u\)\)/.exec(CSS)?.[1]);
    const widths = [...CSS.matchAll(/\.hplabel\.eqname \{[^}]*?width: calc\(([\d.]+) \* var\(--u\)\)/g)].map((m) => Number(m[1]));
    expect(base).toBeGreaterThan(0);
    expect(pad).toBeGreaterThan(0);
    expect(widths.length).toBeGreaterThanOrEqual(2);
    const avail = Math.min(...widths) - 2 * pad;
    // Outfit 800 averages ~0.54em a glyph on these names in the browser; 0.62em is the safety margin.
    const EM_PER_CHAR = 0.62;
    const longest = [...EQUIPMENT].sort((a, b) => b.name.length - a.name.length);
    expect(longest.slice(0, 3).map((e) => e.name)).toEqual(['Calibration Wrench', 'Deathfibrillator', 'Magnifying Glass']);
    for (const e of EQUIPMENT) {
      const atFloor = e.name.length * EM_PER_CHAR * base * NAME_FIT_MIN;
      expect(atFloor, `${e.name} must fit the ${avail}u plate at the floor size`).toBeLessThanOrEqual(avail);
    }
  });
});

const minion = (uid: string, cardId: string): BoardCard =>
  ({ uid, cardId, tribe: 'neutral', attack: 3, health: 3, keywords: [], golden: false });

function holding(id: string, over: Partial<RunState> = {}, eq: Partial<NonNullable<RunState['equipment']>> = {}, spent = false): RunState {
  const base = createRun(21, 'warden');
  return {
    ...base,
    phase: 'recruit',
    embers: 20,
    board: [minion('f', 'e3_frank')],
    equipment: {
      available: [{ equipmentId: id, version: 'plain', sourceUids: ['f'], grantedTurn: 1, ownChargeSpent: spent }],
      bonusActivations: 0, bonusSpent: 0, temporaryCostReduction: 0,
      selectedEquipmentId: id, lastUsedEquipmentId: id,
      ...eq,
    },
    ...over,
  } as RunState;
}

let ui: Mounted;
const show = (run: RunState, armed = false): void => {
  act(() => { useGame.setState({ run, equipArmed: armed, heroArmed: false }); });
  ui.render(<StatusBar />);
};
const q = (sel: string): HTMLElement | null => ui.container.querySelector<HTMLElement>(`.equipslot:not(.leaving) ${sel}`);
const slot = (): HTMLElement => ui.container.querySelector<HTMLElement>('.equipslot:not(.leaving)')!;

beforeEach(() => { ui = mount(<div />); });
afterEach(() => { ui.unmount(); act(() => { setEquipLook(EQUIP_LOOK_DEFAULTS.look); }); });

describe.each(EQ_LOOKS as readonly EqLook[])('every state still lands on the slot (%s)', (look) => {
  beforeEach(() => { act(() => { setEquipLook(look); }); });

  it('stamps the look and draws the bitmap frame only in Classic', () => {
    show(holding('calibration_wrench'));
    expect(document.documentElement.getAttribute('data-eq-look')).toBe(look);
    expect(!!q('.equipframe')).toBe(look === 'classic');
    expect(q('.hplabel.eqname .eqname-t')?.textContent).toBe('Calibration Wrench');
  });

  it('ready, then armed, then spent', () => {
    show(holding('titan_hammer'));
    expect(slot().classList.contains('ready')).toBe(true);
    expect(q('.heropowerbtn')!.classList.contains('ready')).toBe(true);
    show(holding('titan_hammer'), true);
    expect(slot().classList.contains('armed')).toBe(true);
    show(holding('bloodpot', {}, {}, true));
    expect(slot().classList.contains('spent')).toBe(true);
    expect((q('.heropowerbtn') as HTMLButtonElement).disabled).toBe(true);
    expect(q('.hpb-tally')!.textContent).toBe('0');
  });

  it('the charge reads BLUE while Amplified and GREEN with the shared pool; the coin goes green when discounted', () => {
    show(holding('magnifying_glass', {}, { amplified: { magnifying_glass: 1 } }));
    expect(q('.hpb-tally')!.classList.contains('amplified')).toBe(true);
    expect(q('.hpb-tally')!.getAttribute('data-fx')).toBe('equipment-amplified');
    show(holding('pourmans_keg', {}, { bonusActivations: 1, temporaryCostReduction: 1 }));
    expect(q('.hpb-tally')!.classList.contains('boosted')).toBe(true);
    expect(q('.hpb-tally')!.textContent).toBe('2');
    expect(q('.hpcost')!.classList.contains('discounted')).toBe(true);
  });

  it('the Thymepiece readout still renders with the slot', () => {
    show(holding('thymepiece', { cardDiscountWindow: { amount: 1, untilClock: null } }));
    expect(ui.container.querySelector('.equipslot .hplabel.discountwin')?.textContent).toContain('this turn');
  });
});

describe('equipSlot.css follows the UI theme', () => {
  const LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\([^)]*\)|(?<![-\w])(?:white|black|red|gold|orange|purple|silver|gray|grey|yellow|pink|blue|green)(?![-\w])/g;
  const SHADING = /^(#000|#000000|#fff|#ffffff|rgba?\(\s*(0,\s*0,\s*0|255,\s*255,\s*255)\s*(,\s*[\d.]+\s*)?\))$/i;
  const rules = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1]!.trim(), body: m[2]! }));

  it('the production default is a new look', () => {
    expect(NEW_LOOKS).toContain(EQUIP_LOOK_DEFAULTS.look);
  });

  it('paints every new-look rule from the --ui-* tokens (black / white shading allowed)', () => {
    const bad: string[] = [];
    const scoped = rules.filter((r) => NEW_LOOKS.some((l) => r.selector.includes(`[data-eq-look="${l}"]`)));
    expect(scoped.length).toBeGreaterThan(20);
    for (const r of scoped) {
      for (const decl of r.body.split(';')) {
        const i = decl.indexOf(':');
        if (i < 0) continue;
        for (const c of decl.slice(i + 1).match(LITERAL) ?? []) {
          if (!SHADING.test(c.replace(/\s+/g, ' ').trim())) bad.push(`${r.selector.slice(0, 60)} { ${decl.trim().slice(0, 70)} } -> ${c}`);
        }
      }
    }
    expect(bad, 'theme the housing through uiTheme.css (--ui-*), not a literal').toEqual([]);
  });

  it('a literal colour outside the looks is only ever a declared state token', () => {
    const bad: string[] = [];
    for (const r of rules.filter((x) => !x.selector.includes('[data-eq-look='))) {
      for (const decl of r.body.split(';')) {
        const i = decl.indexOf(':');
        if (i < 0 || !(decl.slice(i + 1).match(LITERAL))) continue;
        if (!decl.slice(0, i).trim().startsWith('--eq-')) bad.push(`${r.selector} { ${decl.trim()} }`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('nothing in the housing animates (the existing glow breathes on opacity elsewhere)', () => {
    expect(CSS).not.toMatch(/animation|@keyframes|transition|infinite/);
  });

  it('no plain keyword cursor (the gauntlet cursor paints the button)', () => {
    expect(CSS).not.toMatch(/cursor\s*:/);
  });
});
