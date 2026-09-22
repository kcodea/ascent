// @vitest-environment jsdom
/**
 * THE AMPLIFIED LOOP on the Equipment slot (owner ask 2026-09-22): *"i created an amplified effect that should
 * play on equipment when amplified. it should only play when a usable equipment is equipped/selected. if an
 * equipment has 0 charges it should not show the animation."*
 *
 * The owner-authored `amplified-slot` def is a LOOP — a looping player never retires on its own — so what is
 * pinned here is the caller-owned lifetime, driven through the real StatusBar + store so a change to how the
 * slot reads `run.equipment` fails here rather than passing against a stub:
 *
 *   1. it STARTS (once, `loop: true`, on the slot button's centre) only when the SELECTED Equipment will
 *      Amplify AND has a charge to spend, in the shop phase — for every `equipmentWillAmplify` branch (own
 *      stack, a pending Calibration, Rune of Empty Hands), and never for the Wrench on its own Calibration;
 *   2. it never starts TWICE — not on an unrelated re-render, not on a swap between two Amplified Equipment;
 *   3. it STOPS, exactly once, on each way the condition ends: the stack spent, the charge spent, the
 *      selection moved to an unamplified Equipment, the phase leaving the shop, the Equipment state gone, a
 *      board-covering overlay, a hidden tab, and unmount;
 *   4. the "can't start yet" waits (FX runtime not ready, slot not painted) re-check the LATEST condition and
 *      are bounded, so a stale start can never fire and nothing retries forever;
 *   5. `follow` hands the player a CACHED point — re-measured on resize, once per frame — never a live read.
 *
 * The FX layer needs a live Pixi renderer, which jsdom has none of, so `playDef` is stubbed and the assertions
 * are about WHETHER a loop started and whether its disposer ran — which is the rule under test.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRun, type BoardCard, type RunState } from '@game/sim';
import { StatusBar } from './StatusBar';
import { useGame } from './store';
import { mount, type Mounted } from './renderedText.mount';
import { AMPLIFIED_RETRY_FRAMES, AMPLIFIED_SLOT_SELECTOR } from './useAmplifiedSlotFx';

type Point = { x: number; y: number };
interface Play { id: string; anchors: { source: Point; target: Point; cursor: Point }; opts: { loop?: boolean; follow?: () => Point | null }; dispose: ReturnType<typeof vi.fn> }

/** Every stubbed `playDef` call, in order — the slot also fires one-shots through the same door (the
 *  `equipment-used-up` puff when a charge count hits zero), so the assertions below read the LOOPS only. */
const fired: Play[] = [];
let canPlay = true;
vi.mock('./fx/playDef', () => ({
  playDef: (id: string, anchors: Play['anchors'], opts: Play['opts']) => {
    const dispose = vi.fn();
    fired.push({ id, anchors, opts, dispose });
    return dispose;
  },
  canPlayDefs: () => canPlay,
  ensureDefsReady: () => Promise.resolve(),
}));
/** The `amplified-slot` loops started so far. */
const plays = (): Play[] => fired.filter((p) => p.id === 'amplified-slot');
/** How many times each loop's caller-owned disposer has run. */
const disposed = (): number[] => plays().map((p) => p.dispose.mock.calls.length);

/** The slot button's box. jsdom lays nothing out, so every element reports THIS rect; the hook only ever
 *  measures the slot button, and the tests that care assert the selector resolves to exactly one element. */
let rect = { left: 100, top: 600, width: 128, height: 128 };
const centre = (): Point => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });

const frame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));
const frames = async (n: number): Promise<void> => { for (let i = 0; i < n; i++) await frame(); };

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

/** Bloodpot Amplified by its own stack — the plainest "glow" state. */
const amplifiedRun = (equip: EquipOver = {}, over: Partial<RunState> = {}): RunState =>
  shopRun({ amplified: { bloodpot: 1 }, ...equip }, over);

/** Bloodpot's own charge spent with an empty pool — the selected Equipment reads 0. */
const spent = (): EquipOver['available'] => [
  { equipmentId: 'bloodpot', version: 'plain', sourceUids: ['f'], sourceCardIds: ['e3_frank'], grantedTurn: 1, ownChargeSpent: true },
  { equipmentId: 'titan_hammer', version: 'plain', sourceUids: ['s'], sourceCardIds: ['e3_sculptor'], grantedTurn: 1, ownChargeSpent: false },
];

let ui: Mounted;
const show = (run: RunState, extra: Record<string, unknown> = {}): void => {
  act(() => { useGame.setState({ run, equipArmed: false, heroArmed: false, ...extra }); });
  ui.render(<StatusBar />);
};

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
  delete (document as { hidden?: boolean }).hidden;
});

describe('the Amplified loop — when it STARTS', () => {
  it('starts ONE looping amplified-slot play, centred on the slot button, when the selected Equipment is Amplified and charged', () => {
    show(amplifiedRun());
    expect(document.querySelectorAll(AMPLIFIED_SLOT_SELECTOR).length, 'exactly one live slot button').toBe(1);
    expect(plays().map((p) => p.id)).toEqual(['amplified-slot']);
    const [p] = plays();
    expect(p!.opts.loop, 'a persistent marker, so the caller owns teardown').toBe(true);
    expect(p!.anchors.source).toEqual(centre());
    expect(p!.anchors.target).toEqual(centre());
    expect(p!.opts.follow?.(), 'follow hands back the cached slot centre').toEqual(centre());
    expect(disposed()).toEqual([0]);
  });

  it('starts nothing when the Equipment has no charge — owner: "if an equipment has 0 charges it should not show the animation"', () => {
    show(amplifiedRun({ available: spent() }));
    expect(plays()).toEqual([]);
    // A bonus charge granted mid-turn (Equipment Charger) puts a use back — and the glow with it.
    show(amplifiedRun({ available: spent(), bonusActivations: 1 }));
    expect(plays().map((p) => p.id)).toEqual(['amplified-slot']);
  });

  it('is about the SELECTED Equipment — another held Equipment being Amplified starts nothing until it is picked', () => {
    show(shopRun({ amplified: { titan_hammer: 1 } }));
    expect(plays()).toEqual([]);
    show(shopRun({ amplified: { titan_hammer: 1 }, selectedEquipmentId: 'titan_hammer' }));
    expect(plays().map((p) => p.id)).toEqual(['amplified-slot']);
  });

  it('starts nothing when the selected Equipment is not Amplified at all', () => {
    show(shopRun());
    expect(plays()).toEqual([]);
  });

  it('starts nothing outside the shop phase — End of Turn hands every own charge back in the same action that starts combat', () => {
    show(amplifiedRun({}, { phase: 'combat' }));
    expect(plays()).toEqual([]);
  });

  it('starts for a pending Calibration on any held Equipment — but never for the Wrench itself', () => {
    const held = [
      { equipmentId: 'bloodpot', version: 'plain' as const, sourceUids: ['f'], sourceCardIds: ['e3_frank'], grantedTurn: 1, ownChargeSpent: false },
      { equipmentId: 'calibration_wrench', version: 'plain' as const, sourceUids: ['w'], sourceCardIds: ['n3_calibration'], grantedTurn: 1, ownChargeSpent: false },
    ];
    show(shopRun({ available: held, calibrationPending: 1, selectedEquipmentId: 'calibration_wrench' }));
    expect(plays(), 'the Wrench does not Amplify itself').toEqual([]);
    show(shopRun({ available: held, calibrationPending: 1, selectedEquipmentId: 'bloodpot' }));
    expect(plays().map((p) => p.id)).toEqual(['amplified-slot']);
  });

  it('starts for a permanently Amplified Equipment (Rune of Empty Hands)', () => {
    show(shopRun({}, { equipmentAmplifiedCards: ['e3_frank'] }));
    expect(plays().map((p) => p.id)).toEqual(['amplified-slot']);
  });

  it('starts nothing while a board-covering overlay is open, and starts once it closes', () => {
    show(amplifiedRun({}, { discover: ['alley', 'alley', 'alley'] }));
    expect(plays(), 'the FX canvas sits beneath the Discover').toEqual([]);
    show(amplifiedRun());
    expect(plays().map((p) => p.id)).toEqual(['amplified-slot']);
  });
});

describe('the Amplified loop — never TWICE', () => {
  it('an unrelated re-render (Gold changing) starts no second loop', () => {
    show(amplifiedRun());
    show(amplifiedRun({}, { embers: 7 }));
    show(amplifiedRun({}, { embers: 3 }));
    expect(plays().length).toBe(1);
    expect(disposed(), 'and the first loop is still running').toEqual([0]);
  });

  it('a swap between two Amplified Equipment keeps the one loop running — same slot, same point', () => {
    const both = { amplified: { bloodpot: 1, titan_hammer: 1 } };
    show(shopRun(both));
    show(shopRun({ ...both, selectedEquipmentId: 'titan_hammer' }));
    show(shopRun({ ...both, selectedEquipmentId: 'bloodpot' }));
    expect(plays().length).toBe(1);
    expect(disposed()).toEqual([0]);
  });
});

describe('the Amplified loop — when it STOPS (exactly once each)', () => {
  const ends: [string, () => RunState][] = [
    ['the Amplified stack is spent', () => shopRun()],
    ['the charge is spent (the Equipment was used)', () => amplifiedRun({ available: spent() })],
    ['the selection moves to an unamplified Equipment', () => amplifiedRun({ selectedEquipmentId: 'titan_hammer' })],
    ['the phase leaves the shop', () => amplifiedRun({}, { phase: 'combat' })],
    ['the Equipment state is gone', () => amplifiedRun({}, { equipment: undefined })],
    ['a board-covering overlay opens', () => amplifiedRun({}, { chooseOne: { uid: 'x', cardId: 'alley' } as RunState['chooseOne'] })],
  ];
  for (const [what, next] of ends) {
    it(`stops when ${what}, and restarts when the condition returns`, () => {
      show(amplifiedRun());
      expect(plays().length).toBe(1);
      show(next());
      expect(disposed(), 'the loop was disposed once').toEqual([1]);
      expect(plays().length, 'and nothing else started').toBe(1);
      show(next());
      expect(disposed(), 'a second render of the same off-state disposes nothing again').toEqual([1]);
      show(amplifiedRun());
      expect(plays().length, 'back on: a fresh loop').toBe(2);
      expect(disposed()).toEqual([1, 0]);
    });
  }

  it('tears down when the tab is hidden and restarts when it is visible again', () => {
    show(amplifiedRun());
    expect(plays().length).toBe(1);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(disposed()).toEqual([1]);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(plays().length, 'visible again, still Amplified and charged: restarted').toBe(2);
    expect(disposed()).toEqual([1, 0]);
  });

  it('a tab hidden while the loop is OFF starts nothing when it becomes visible with the condition false', () => {
    show(shopRun());
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(plays()).toEqual([]);
  });

  it('tears down on unmount', () => {
    show(amplifiedRun());
    expect(plays().length).toBe(1);
    ui.unmount();
    expect(disposed()).toEqual([1]);
    ui = mount(<div />); // for afterEach
  });
});

describe('the Amplified loop — the "can\'t start yet" waits', () => {
  it('waits for the FX runtime and starts once it is ready — re-checking the condition, not replaying a stale start', async () => {
    canPlay = false;
    show(amplifiedRun());
    expect(plays(), 'no renderer yet: nothing fired').toEqual([]);
    canPlay = true;
    await frames(2); // the readiness promise resolves, then one frame to re-sync
    expect(plays().map((p) => p.id)).toEqual(['amplified-slot']);
  });

  it('a readiness wait whose condition went false in the meantime fires nothing', async () => {
    canPlay = false;
    show(amplifiedRun());
    show(shopRun()); // the stack was spent before the runtime came up
    canPlay = true;
    await frames(3);
    expect(plays()).toEqual([]);
  });

  it('a slot with no layout box yet is retried on the next frames, not dropped', async () => {
    rect = { left: 0, top: 0, width: 0, height: 0 };
    show(amplifiedRun());
    expect(plays()).toEqual([]);
    rect = { left: 100, top: 600, width: 128, height: 128 };
    await frames(2);
    expect(plays().map((p) => p.id)).toEqual(['amplified-slot']);
    expect(plays()[0]!.anchors.source).toEqual(centre());
  });

  it('gives up on a slot that never gets a box — bounded, so nothing retries forever', async () => {
    rect = { left: 0, top: 0, width: 0, height: 0 };
    show(amplifiedRun());
    await frames(AMPLIFIED_RETRY_FRAMES + 3);
    expect(plays()).toEqual([]);
  });

  it('a pending retry is cancelled when the condition ends before it fires', async () => {
    rect = { left: 0, top: 0, width: 0, height: 0 };
    show(amplifiedRun());
    show(shopRun());
    rect = { left: 100, top: 600, width: 128, height: 128 };
    await frames(3);
    expect(plays()).toEqual([]);
  });
});

describe('the Amplified loop — follow reads a cache, re-measured on resize', () => {
  it('hands the player the cached centre, and moves it one frame after a resize', async () => {
    show(amplifiedRun());
    const follow = plays()[0]!.opts.follow!;
    const before = centre();
    expect(follow()).toEqual(before);
    rect = { left: 300, top: 900, width: 96, height: 96 };
    expect(follow(), 'no resize yet: the cache is untouched however the box moved').toEqual(before);
    window.dispatchEvent(new Event('resize'));
    expect(follow(), 'debounced to a frame').toEqual(before);
    await frame();
    expect(follow()).toEqual(centre());
    expect(plays().length, 'a resize re-measures; it does not restart').toBe(1);
  });
});
