// @vitest-environment jsdom
/**
 * THE EQUIPMENT BEAM CASCADE, wired (`useEquipBeamCascade`) — owner ruling 2026-09-22: "spiritbinder one beam
 * per fire".
 *
 * `spiritbinderBeamCues.test.ts` (sim) pins that N fires stamp N cues. This file pins what the screen does with
 * them, through a real mounted component and the real stat-hold store, with `playDef` recorded:
 *   · two cues play two beams on two beats, `EQUIP_BEAM_STAGGER_MS` apart, each on ITS recipient;
 *   · both recipients' badges are held BEFORE any timer runs, each scheduled to its own beam's contact;
 *   · two fires on the SAME body are two beams and ONE hold of the sum spanning both contacts (the store keeps
 *     one hold per uid — see `equipBeamHoldPlan`);
 *   · one cue is exactly the single beam and hold it always was;
 *   · a body gone before its beam is skipped, never redirected to the slot;
 *   · a later action never cuts a pending beam (owner 2026-09-09); leaving the shop retires everything;
 *   · the real sim's cues, driven through `reduce`, play in cue order on the cues' recipients.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, useRef } from 'react';
import { CARD_INDEX, poolFor } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from '@game/sim';
import { mount } from './renderedText.mount';

const plays: { id: string; anchors: { source: unknown; target: unknown }; opts: { uids?: { source?: string | null; target?: string | null } } }[] = [];
const stopped: string[] = [];
vi.mock('./fx/playDef', () => ({
  playDef: (id: string, anchors: { source: unknown; target: unknown }, opts: { uids?: { target?: string | null } }) => {
    plays.push({ id, anchors, opts });
    return () => { stopped.push(`${id}:${opts.uids?.target ?? ''}`); };
  },
  canPlayDefs: () => true,
}));

import {
  useEquipBeamCascade, equipBeamsOf, equipBeamSchedule, equipBeamHoldPlan,
  EQUIP_BEAM_STAGGER_MS, EQUIP_BUFF_LAND_MS, type EquipBeamAnchors, type EquipCue,
} from './equipBeamCascade';
import { heldFor, scheduleFor, releaseAllStats, DEFAULT_ROLL_MS } from './fx/statHold';
import { LASSO_STAGGER_MS } from './lassoHolds';

const SLOT = { x: 10, y: 10 };
const cue = (targetUid: string, attack = 6, health = attack, uid = 'bw'): EquipCue =>
  ({ kind: 'use', uid, cardId: 'sp3_bondweaver', equipmentId: 'spiritbringer', targetUid, buffAttack: attack, buffHealth: health });

/** A stand-in for the recruit screen: the slot is always on screen; a body is on screen iff it is in `bodies`. */
function Harness(props: { seq: number; cues: readonly EquipCue[]; phase: RunState['phase']; bodies: readonly string[]; launched?: string[] }): JSX.Element {
  const anchors = useRef<EquipBeamAnchors>({ slot: () => null, body: () => null });
  anchors.current = {
    slot: () => SLOT,
    body: (uid) => (props.bodies.includes(uid) ? { x: 100 + props.bodies.indexOf(uid) * 120, y: 300 } : null),
    onLaunch: (beam, i) => { props.launched?.push(`${i}:${beam.targetUid}`); },
  };
  useEquipBeamCascade({ seq: props.seq, cues: props.cues, phase: props.phase, baseDelayMs: () => 0, anchors });
  return <div />;
}

const targets = (): (string | null | undefined)[] => plays.map((p) => p.opts.uids?.target);

describe('useEquipBeamCascade — one beam per fire, each on its own beat', () => {
  beforeEach(() => { plays.length = 0; stopped.length = 0; vi.useFakeTimers(); });
  afterEach(() => { releaseAllStats(); vi.useRealTimers(); });

  const view = (seq: number, cues: readonly EquipCue[], bodies: readonly string[], phase: RunState['phase'] = 'recruit', launched?: string[]): JSX.Element =>
    <Harness seq={seq} cues={cues} phase={phase} bodies={bodies} launched={launched} />;

  it('two cues on two bodies: two beams, EQUIP_BEAM_STAGGER_MS apart, and both badges held to their OWN contact before any timer runs', () => {
    const launched: string[] = [];
    const m = mount(view(0, [], ['x', 'y'], 'recruit', launched));
    // ONE action stamped two cues, so the seq moved by two — that is one cascade, not two.
    act(() => { m.render(view(2, [cue('x'), cue('y')], ['x', 'y'], 'recruit', launched)); });
    expect(targets(), 'the first beam leaves inside the commit').toEqual(['x']);
    expect(plays[0]!.id).toBe('spiritbinder');
    expect(plays[0]!.anchors.source, 'every beam leaves the slot').toEqual(SLOT);
    expect(plays[0]!.anchors.target).toEqual({ x: 100, y: 300 });
    // BOTH holds are already placed — pre-paint, in the same layout effect — each scheduled to its own contact.
    expect(heldFor('x')).toEqual({ attack: 6, health: 6 });
    expect(heldFor('y')).toEqual({ attack: 6, health: 6 });
    expect(scheduleFor('x')).toEqual({ startAt: EQUIP_BUFF_LAND_MS, rollMs: DEFAULT_ROLL_MS });
    expect(scheduleFor('y')).toEqual({ startAt: EQUIP_BEAM_STAGGER_MS + EQUIP_BUFF_LAND_MS, rollMs: DEFAULT_ROLL_MS });
    act(() => { vi.advanceTimersByTime(EQUIP_BEAM_STAGGER_MS - 1); });
    expect(targets(), 'not yet').toEqual(['x']);
    act(() => { vi.advanceTimersByTime(1); });
    expect(targets(), 'the second beam leaves one stagger later, on ITS recipient').toEqual(['x', 'y']);
    expect(plays[1]!.anchors.target, 'measured at launch, not at the press').toEqual({ x: 220, y: 300 });
    expect(launched, 'the launch hook fires once per beam, in order').toEqual(['0:x', '1:y']);
    expect(stopped, 'nothing was cut').toEqual([]);
    // The `beamedNow` predicate covers every recipient of every cue (the in-line filter in Recruit.tsx is pinned
    // by spiritbinderBeamGuard.test.ts; this is the same predicate over the same cues).
    expect(equipBeamsOf([cue('x'), cue('y')]).map((b) => b.targetUid)).toEqual(['x', 'y']);
    m.unmount();
  });

  it('the stagger is the lasso\'s gap, and the schedule is launch = i × gap, contact = launch + the beam\'s travel', () => {
    expect(EQUIP_BEAM_STAGGER_MS).toBe(LASSO_STAGGER_MS);
    expect(equipBeamSchedule(3, 50)).toEqual([
      { launchAt: 50, contactAt: 250 }, { launchAt: 350, contactAt: 550 }, { launchAt: 650, contactAt: 850 },
    ]);
    expect(equipBeamSchedule(0)).toEqual([]);
  });

  it('two fires on the SAME body: two beams, and ONE hold of the sum that opens at the first contact and rolls to the last', () => {
    const m = mount(view(0, [], ['x']));
    act(() => { m.render(view(2, [cue('x'), cue('x')], ['x'])); });
    expect(heldFor('x'), 'the whole gain is withheld from the first frame').toEqual({ attack: 12, health: 12 });
    expect(scheduleFor('x')).toEqual({ startAt: EQUIP_BUFF_LAND_MS, rollMs: EQUIP_BEAM_STAGGER_MS + DEFAULT_ROLL_MS });
    act(() => { vi.advanceTimersByTime(EQUIP_BEAM_STAGGER_MS); });
    expect(targets(), 'still two beams').toEqual(['x', 'x']);
    // The pure plan says the same thing, so the aggregation rule is pinned without a mount too.
    expect(equipBeamHoldPlan(equipBeamsOf([cue('x'), cue('x')]))).toEqual([
      { uid: 'x', attack: 12, health: 12, startAt: EQUIP_BUFF_LAND_MS, rollMs: EQUIP_BEAM_STAGGER_MS + DEFAULT_ROLL_MS },
    ]);
    m.unmount();
  });

  it('x, y, x: three beams; x is held once for both its fires (first contact to last), y once for its own', () => {
    expect(equipBeamHoldPlan(equipBeamsOf([cue('x'), cue('y'), cue('x')]), 40)).toEqual([
      { uid: 'x', attack: 12, health: 12, startAt: 40 + EQUIP_BUFF_LAND_MS, rollMs: 2 * EQUIP_BEAM_STAGGER_MS + DEFAULT_ROLL_MS },
      { uid: 'y', attack: 6, health: 6, startAt: 40 + EQUIP_BEAM_STAGGER_MS + EQUIP_BUFF_LAND_MS, rollMs: DEFAULT_ROLL_MS },
    ]);
  });

  it('ONE cue is exactly the single beam and hold it always was', () => {
    const m = mount(view(0, [], ['x']));
    act(() => { m.render(view(1, [cue('x')], ['x'])); });
    expect(targets()).toEqual(['x']);
    expect(heldFor('x')).toEqual({ attack: 6, health: 6 });
    expect(scheduleFor('x')).toEqual({ startAt: EQUIP_BUFF_LAND_MS, rollMs: DEFAULT_ROLL_MS });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(targets(), 'and nothing else ever plays').toEqual(['x']);
    m.unmount();
  });

  it('a gilded pair owes +12/+12 per beam', () => {
    const m = mount(view(0, [], ['x', 'y']));
    act(() => { m.render(view(2, [cue('x', 12), cue('y', 12)], ['x', 'y'])); });
    expect(heldFor('x')).toEqual({ attack: 12, health: 12 });
    expect(heldFor('y')).toEqual({ attack: 12, health: 12 });
    m.unmount();
  });

  it('a target-less cue (no board Spirit) and a foreign Equipment\'s cue are not beams', () => {
    const aimless: EquipCue = { kind: 'use', uid: 'eq:spiritbringer', cardId: 'spiritbringer', equipmentId: 'spiritbringer' };
    const bloodpot: EquipCue = { kind: 'use', uid: 'f', cardId: 'e3_frank', equipmentId: 'bloodpot', targetUid: 't' };
    const equip: EquipCue = { kind: 'equip', uid: 'bw', cardId: 'sp3_bondweaver' };
    expect(equipBeamsOf([aimless, bloodpot, equip])).toEqual([]);
    const m = mount(view(0, [], ['t']));
    act(() => { m.render(view(3, [aimless, bloodpot, equip], ['t'])); });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(targets(), 'the cascade plays none of them (the loop in Recruit owns the aimed and equip cues)').toEqual([]);
    expect(heldFor('t')).toBeNull();
    m.unmount();
  });

  it('a body gone before its beam: that beam is skipped, never redirected to the slot; the others still fly', () => {
    const m = mount(view(0, [], ['x', 'y', 'z']));
    act(() => { m.render(view(3, [cue('x'), cue('y'), cue('z')], ['x', 'y', 'z'])); });
    expect(targets()).toEqual(['x']);
    // `y` is sold between the first and second beam.
    act(() => { m.render(view(3, [cue('x'), cue('y'), cue('z')], ['x', 'z'])); });
    act(() => { vi.advanceTimersByTime(2 * EQUIP_BEAM_STAGGER_MS); });
    expect(targets(), 'y skipped, z on its own beat').toEqual(['x', 'z']);
    expect(plays.every((p) => p.anchors.target !== SLOT && (p.anchors.target as { y: number }).y === 300), 'no beam ever aimed at the slot').toBe(true);
    m.unmount();
  });

  it('a LATER action never cuts a pending beam or a playing def (owner 2026-09-09)', () => {
    const m = mount(view(0, [], ['x', 'y', 'z']));
    act(() => { m.render(view(2, [cue('x'), cue('y')], ['x', 'y', 'z'])); });
    act(() => { vi.advanceTimersByTime(100); });
    // A second press, mid-cascade: its own beam launches now, and the first cascade's second beam still comes.
    act(() => { m.render(view(3, [cue('z')], ['x', 'y', 'z'])); });
    expect(targets()).toEqual(['x', 'z']);
    act(() => { vi.advanceTimersByTime(EQUIP_BEAM_STAGGER_MS); });
    expect(targets(), 'the first cascade finished on its own clock').toEqual(['x', 'z', 'y']);
    expect(stopped).toEqual([]);
    m.unmount();
  });

  it('LEAVING THE SHOP retires every pending launch and every playing def; nothing launches after the flip', () => {
    const m = mount(view(0, [], ['x', 'y', 'z']));
    act(() => { m.render(view(3, [cue('x'), cue('y'), cue('z')], ['x', 'y', 'z'])); });
    act(() => { vi.advanceTimersByTime(EQUIP_BEAM_STAGGER_MS); });
    expect(targets()).toEqual(['x', 'y']);
    act(() => { m.render(view(3, [cue('x'), cue('y'), cue('z')], ['x', 'y', 'z'], 'combat')); });
    expect(stopped.sort(), 'both playing defs were retired').toEqual(['spiritbinder:x', 'spiritbinder:y']);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(targets(), 'the third beam never leaves').toEqual(['x', 'y']);
    m.unmount();
  });

  it('a cascade that arrives while the shop is not on screen plays nothing', () => {
    const m = mount(view(0, [], ['x'], 'combat'));
    act(() => { m.render(view(1, [cue('x')], ['x'], 'combat')); });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(targets()).toEqual([]);
    expect(heldFor('x')).toBeNull();
    m.unmount();
  });

  it('UNMOUNT retires everything', () => {
    const m = mount(view(0, [], ['x', 'y']));
    act(() => { m.render(view(2, [cue('x'), cue('y')], ['x', 'y'])); });
    m.unmount();
    expect(stopped).toEqual(['spiritbinder:x']);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(targets(), 'the pending launch was cleared').toEqual(['x']);
  });

  it('the REAL sim: an extra-trigger Spiritbinder press cascades its cues in cue order onto the cues\' recipients', () => {
    const body = (uid: string, cardId: string): BoardCard => {
      const d = CARD_INDEX[cardId]!;
      return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
    };
    let s: RunState = { ...createRun(1), setId: 'set3', phase: 'recruit', embers: 20, tier: 6, tribes: ['spirit', 'undead', 'kobold'],
      pool: Object.fromEntries(poolFor('set3').buyable.map((c) => [c.id, 5])),
      board: [body('x', 'sp3_kindled'), body('y', 'sp3_tidebud')], hand: [body('bw', 'sp3_bondweaver')] } as RunState;
    s = reduce(s, { type: 'play', uid: 'bw', toIndex: 2 } as Action);
    const m = mount(view(s.equipFxSeq ?? 0, s.equipFx ?? [], s.board.map((c) => c.uid)));
    expect(targets(), 'the play action\'s equip cue is not a beam').toEqual([]);
    s.equipmentExtraTriggers = 1;
    s = reduce(s, { type: 'activateEquipment' } as Action);
    const cues = (s.equipFx ?? []).filter((f) => f.kind === 'use');
    expect(cues).toHaveLength(2);
    act(() => { m.render(view(s.equipFxSeq ?? 0, s.equipFx ?? [], s.board.map((c) => c.uid))); });
    act(() => { vi.advanceTimersByTime(EQUIP_BEAM_STAGGER_MS); });
    expect(targets(), 'one beam per cue, in cue order, on the cue\'s recipient').toEqual(cues.map((c) => c.targetUid));
    // What the holds withhold is what the bodies actually gained this press — by uid, summed over its cues.
    for (const uid of new Set(cues.map((c) => c.targetUid!))) {
      const n = cues.filter((c) => c.targetUid === uid).length;
      expect(scheduleFor(uid)?.startAt, `${uid} opens at its FIRST beam's contact`).toBe(cues.findIndex((c) => c.targetUid === uid) * EQUIP_BEAM_STAGGER_MS + EQUIP_BUFF_LAND_MS);
      expect(heldFor(uid), `${uid} withholds ${n} × 6`).toEqual({ attack: 6 * n, health: 6 * n });
    }
    m.unmount();
  });
});
