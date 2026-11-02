// @vitest-environment jsdom
/**
 * THE AMPLIFIED LOOK on the Equipment slot (owner ask 2026-09-22: *"it should only play when a usable equipment is
 * equipped/selected. if an equipment has 0 charges it should not show the animation."*; redone 2026-11-01, the
 * owner-approved "Charged" look).
 *
 * Since 2026-11-01 the look is a CSS state on the slot (`.eq-amp-set`: a breathing halo, an out-of-phase second ring,
 * a rim glint and rising motes) instead of a looping Pixi play, so what is pinned here, through the real StatusBar +
 * store, is WHEN it is mounted (the show rule the loop had, unchanged), that it stays off the art and uses no Pixi,
 * and the RELEASE flourish (`amplified-release`, two soft rings) that plays when the Amplified activation fires.
 *
 *   1. it SHOWS only when the SELECTED Equipment will Amplify AND has a charge to spend, in the Shop, with nothing
 *      covering the slot: for every `equipmentWillAmplify` branch (own stack, a pending Calibration, Rune of Empty
 *      Hands), and never for the Wrench on its own Calibration;
 *   2. it HIDES on each way the condition ends: the stack spent, the charge spent, the selection moved to an
 *      unamplified Equipment, the phase leaving the shop, the Equipment state gone, a run-state overlay, a UI-store
 *      overlay over the slot (the Compendium, the Inspect view, the bug reporter, a ladder page);
 *   3. the release fires ONCE per Amplified press, never on mount, never for an unamplified use, never for the
 *      Amplification ending without a use.
 *
 * `playDef` is stubbed (jsdom has no renderer); the look itself must never call it.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRun, type BoardCard, type RunState } from '@game/sim';
import { StatusBar } from './StatusBar';
import { useGame } from './store';
import { mount, type Mounted } from './renderedText.mount';

type Point = { x: number; y: number };
interface Play { id: string; anchors: { source: Point; target: Point; cursor: Point }; opts?: { loop?: boolean } }

const fired: Play[] = [];
let canPlay = true;
vi.mock('./fx/playDef', () => ({
  playDef: (id: string, anchors: Play['anchors'], opts: Play['opts']) => {
    fired.push({ id, anchors, opts });
    return vi.fn();
  },
  canPlayDefs: () => canPlay,
  ensureDefsReady: () => Promise.resolve(),
}));
const releases = (): Play[] => fired.filter((p) => p.id === 'amplified-release');

let rect = { left: 100, top: 600, width: 128, height: 128 };
const centre = (): Point => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });

const minion = (uid: string, cardId: string): BoardCard =>
  ({ uid, cardId, tribe: 'neutral', attack: 3, health: 3, keywords: [], golden: false });

type EquipOver = Partial<NonNullable<RunState['equipment']>>;

/** A recruit-phase run holding Bloodpot (selected) and Titan Hammer, both charged, with Gold for either. */
function shopRun(equip: EquipOver = {}, over: Partial<RunState> = {}): RunState {
  const base = createRun(21, 'warden');
  return {
    ...base,
    phase: 'recruit',
    embers: 20,
    board: [minion('f', 'e3_frank'), minion('s', 'e3_sculptor')],
    equipment: {
      available: [
        { equipmentId: 'bloodpot', version: 'plain', sourceUids: ['f'], sourceCardIds: ['e3_frank'], grantedTurn: 1, ownChargeSpent: false },
        { equipmentId: 'titan_hammer', version: 'plain', sourceUids: ['s'], sourceCardIds: ['e3_sculptor'], grantedTurn: 1, ownChargeSpent: false },
      ],
      bonusActivations: 0, bonusSpent: 0,
      temporaryCostReduction: 0,
      selectedEquipmentId: 'bloodpot', lastUsedEquipmentId: 'bloodpot',
      ...equip,
    },
    ...over,
  } as RunState;
}
const amplifiedRun = (equip: EquipOver = {}, over: Partial<RunState> = {}): RunState =>
  shopRun({ amplified: { bloodpot: 1 }, ...equip }, over);
const spent = (): EquipOver['available'] => [
  { equipmentId: 'bloodpot', version: 'plain', sourceUids: ['f'], sourceCardIds: ['e3_frank'], grantedTurn: 1, ownChargeSpent: true },
  { equipmentId: 'titan_hammer', version: 'plain', sourceUids: ['s'], sourceCardIds: ['e3_sculptor'], grantedTurn: 1, ownChargeSpent: false },
];

let ui: Mounted;
const show = (run: RunState, extra: Record<string, unknown> = {}): void => {
  act(() => { useGame.setState({ run, equipArmed: false, heroArmed: false, showTitle: false, ...extra }); });
  ui.render(<StatusBar />);
};
const look = (): Element | null => document.querySelector('.statusbar .equipslot:not(.leaving) .eq-amp-set');

beforeEach(() => {
  fired.length = 0;
  canPlay = true;
  rect = { left: 100, top: 600, width: 128, height: 128 };
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const r = rect;
    return { ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => ({}) } as DOMRect;
  });
  ui = mount(<div />);
});
afterEach(() => {
  ui.unmount();
  vi.restoreAllMocks();
  useGame.setState({ showBook: false, bugReportOpen: false, showCareer: false, inspect: null });
});

describe('the Amplified look: when it SHOWS', () => {
  it('shows the Charged set (halo, second ring, rim glint, 8 motes) when the selected Equipment is Amplified and charged', () => {
    show(amplifiedRun());
    const set = look();
    expect(set, 'the look is mounted on the live slot').not.toBeNull();
    expect(set!.querySelector('.eq-amp')).not.toBeNull();
    expect(set!.querySelector('.eq-amp-ring')).not.toBeNull();
    expect(set!.querySelector('.eq-amp-sheen')).not.toBeNull();
    expect(set!.querySelectorAll('.eq-amp-motes > i').length).toBe(8);
    expect(set!.getAttribute('aria-hidden')).toBe('true');
    expect(fired, 'the look plays no Pixi effect').toEqual([]);
  });

  it('shows nothing when the Equipment has no charge, and shows again when a bonus charge puts a use back', () => {
    show(amplifiedRun({ available: spent() }));
    expect(look()).toBeNull();
    show(amplifiedRun({ available: spent(), bonusActivations: 1 }));
    expect(look()).not.toBeNull();
  });

  it('is about the SELECTED Equipment: another held Equipment being Amplified shows nothing until it is picked', () => {
    show(shopRun({ amplified: { titan_hammer: 1 } }));
    expect(look()).toBeNull();
    show(shopRun({ amplified: { titan_hammer: 1 }, selectedEquipmentId: 'titan_hammer' }));
    expect(look()).not.toBeNull();
  });

  it('shows nothing when the selected Equipment is not Amplified, or outside the shop phase', () => {
    show(shopRun());
    expect(look()).toBeNull();
    show(amplifiedRun({}, { phase: 'combat' }));
    expect(look()).toBeNull();
  });

  it('shows for a pending Calibration on any held Equipment, but never for the Wrench itself', () => {
    const held = [
      { equipmentId: 'bloodpot', version: 'plain' as const, sourceUids: ['f'], sourceCardIds: ['e3_frank'], grantedTurn: 1, ownChargeSpent: false },
      { equipmentId: 'calibration_wrench', version: 'plain' as const, sourceUids: ['w'], sourceCardIds: ['n3_calibration'], grantedTurn: 1, ownChargeSpent: false },
    ];
    show(shopRun({ available: held, calibrationPending: 1, selectedEquipmentId: 'calibration_wrench' }));
    expect(look(), 'the Wrench does not Amplify itself').toBeNull();
    show(shopRun({ available: held, calibrationPending: 1, selectedEquipmentId: 'bloodpot' }));
    expect(look()).not.toBeNull();
  });

  it('shows for a permanently Amplified Equipment (Rune of Empty Hands)', () => {
    show(shopRun({}, { equipmentAmplifiedCards: ['e3_frank'] }));
    expect(look()).not.toBeNull();
  });
});

describe('the Amplified look: when it HIDES', () => {
  const ends: [string, () => RunState][] = [
    ['the Amplified stack is spent', () => shopRun()],
    ['the charge is spent (the Equipment was used)', () => amplifiedRun({ available: spent() })],
    ['the selection moves to an unamplified Equipment', () => amplifiedRun({ selectedEquipmentId: 'titan_hammer' })],
    ['the phase leaves the shop', () => amplifiedRun({}, { phase: 'combat' })],
    ['a Discover opens over the board', () => amplifiedRun({}, { discover: ['alley', 'alley', 'alley'] })],
    ['a Choose One opens over the board', () => amplifiedRun({}, { chooseOne: { uid: 'x', cardId: 'alley' } as RunState['chooseOne'] })],
  ];
  for (const [what, next] of ends) {
    it(`hides when ${what}, and shows again when the condition returns`, () => {
      show(amplifiedRun());
      expect(look()).not.toBeNull();
      show(next());
      expect(look()).toBeNull();
      show(amplifiedRun());
      expect(look()).not.toBeNull();
    });
  }

  const covers: [string, Record<string, unknown>, Record<string, unknown>][] = [
    ['the Compendium (Tab)', { showBook: true }, { showBook: false }],
    ['the Inspect view', { inspect: { name: 'Alley Cat', cardId: 'alley', tribe: 'neutral' } }, { inspect: null }],
    ['the bug reporter (Ctrl+B)', { bugReportOpen: true }, { bugReportOpen: false }],
    ['a ladder page (Career)', { showCareer: true }, { showCareer: false }],
  ];
  for (const [what, open, close] of covers) {
    it(`hides while ${what} covers the slot`, () => {
      show(amplifiedRun(), open);
      expect(look()).toBeNull();
      show(amplifiedRun(), close);
      expect(look()).not.toBeNull();
    });
  }
});

describe('the Amplified look: perf (amplifiedSlot.css)', () => {
  const css = readFileSync(join(__dirname, 'amplifiedSlot.css'), 'utf8');
  /** Every `@keyframes name { ... }` block, brace-matched, with the property names its frames set. */
  const keyframes = (): { name: string; props: string[] }[] => {
    const out: { name: string; props: string[] }[] = [];
    const re = /@keyframes\s+([\w-]+)\s*\{/g;
    for (let m = re.exec(css); m; m = re.exec(css)) {
      let depth = 1;
      let j = re.lastIndex;
      for (; j < css.length && depth > 0; j++) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; }
      const body = css.slice(re.lastIndex, j - 1);
      const props = [...body.matchAll(/\{([^{}]*)\}/g)].flatMap((f) => [...f[1]!.matchAll(/([a-z-]+)\s*:/g)].map((p) => p[1]!));
      out.push({ name: m[1]!, props });
    }
    return out;
  };

  it('every looping keyframe animates opacity / transform only (compositor-only, no paint property)', () => {
    const ks = keyframes();
    expect(ks.map((k) => k.name).sort(), 'the breath, the rim glint and the motes').toEqual(['eqampbreathe', 'eqampmote', 'eqampsheen']);
    for (const k of ks) for (const p of k.props) expect(['opacity', 'transform'], `${k.name} animates ${p}`).toContain(p);
  });

  it('nothing outside a keyframe transitions a property (no paint-property transition either)', () => {
    expect(css).not.toMatch(/transition\s*:/);
  });
});

describe('the Amplified RELEASE (two soft rings as the Amplified activation fires)', () => {
  const useCue = (equipmentId: string): RunState['equipFx'] => [{ kind: 'use', uid: 'f', cardId: 'e3_frank', equipmentId }];

  it('fires ONCE on the slot centre when the Amplified Equipment is used', () => {
    show(amplifiedRun({}, { equipFxSeq: 1 }));
    expect(releases(), 'mounting Amplified is not a release').toEqual([]);
    // The press: the Amplification and the charge are spent, and the use cue arrives, in one action.
    show(amplifiedRun({ amplified: {}, available: spent() }, { equipFxSeq: 2, equipFx: useCue('bloodpot') }));
    expect(releases().length).toBe(1);
    expect(releases()[0]!.anchors.source).toEqual(centre());
    expect(releases()[0]!.opts?.loop, 'a one-shot').toBeFalsy();
    show(amplifiedRun({ amplified: {}, available: spent() }, { equipFxSeq: 2, equipFx: useCue('bloodpot'), embers: 3 }));
    expect(releases().length, 'a re-render of the same action does not release again').toBe(1);
  });

  it('fires nothing for a use of an Equipment that was NOT Amplified', () => {
    show(shopRun({}, { equipFxSeq: 1 }));
    show(shopRun({ available: spent() }, { equipFxSeq: 2, equipFx: useCue('bloodpot') }));
    expect(releases()).toEqual([]);
  });

  it('fires nothing when the Amplification ends without a use, or for a use of ANOTHER Equipment', () => {
    show(amplifiedRun({}, { equipFxSeq: 1 }));
    show(amplifiedRun({}, { equipFxSeq: 2, equipFx: [{ kind: 'equip', uid: 's', cardId: 'e3_sculptor' }] }));
    expect(releases(), 'an equip cue is not a use').toEqual([]);
    show(amplifiedRun({}, { equipFxSeq: 3, equipFx: useCue('titan_hammer') }));
    expect(releases(), 'the Hammer was not the Amplified one').toEqual([]);
    show(shopRun({}, { equipFxSeq: 3 }));
    expect(releases(), 'the stack spent with no use').toEqual([]);
  });

  it('a permanently Amplified Equipment (Rune of Empty Hands) releases on every use', () => {
    show(shopRun({}, { equipmentAmplifiedCards: ['e3_frank'], equipFxSeq: 1 }));
    show(shopRun({ bonusActivations: 1 }, { equipmentAmplifiedCards: ['e3_frank'], equipFxSeq: 2, equipFx: useCue('bloodpot') }));
    show(shopRun({ bonusActivations: 1 }, { equipmentAmplifiedCards: ['e3_frank'], equipFxSeq: 3, equipFx: useCue('bloodpot') }));
    expect(releases().length).toBe(2);
  });

  it('fires nothing while the FX runtime is not ready', () => {
    canPlay = false;
    show(amplifiedRun({}, { equipFxSeq: 1 }));
    show(amplifiedRun({ amplified: {}, available: spent() }, { equipFxSeq: 2, equipFx: useCue('bloodpot') }));
    expect(releases()).toEqual([]);
  });
});
