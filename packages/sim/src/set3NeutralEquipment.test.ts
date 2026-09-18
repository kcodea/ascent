import { describe, it, expect } from 'vitest';
import { CARD_INDEX, CALIBRATION_WRENCH, EQUIPMENT_INDEX, poolFor } from '@game/content';
import {
  createRun, reduce, equipmentState, equipmentAmplifiedOf, calibrationPendingOf, equipmentWillAmplify, unusedEquipmentCount,
  type Action, type BoardCard, type RunState,
} from './index';
import { applyEndOfTurn } from './recruit';
import { shredderText } from '../../ui/src/cardText';

/**
 * SET 3 — NEUTRALS, the Equipment trio (owner handoff 2026-09-18):
 *  - Shredder: End of Turn, the left-most + right-most minions gain +4/+4 per held Equipment whose charge went
 *    UNUSED this turn (`usedThisTurn`, read before `expireEquipmentTurn` clears it). Golden doubles. Live text.
 *  - Calibration Master → the Calibration Wrench: the NEXT Equipment activation (never the Wrench's own) is
 *    Amplified — a pending count beside the per-id Amplified stack, carried across the turn like the stack.
 *  - Rig: whenever you ACTIVATE an Equipment (the Wrench included), each Rig on the BOARD gains +4/+4.
 *  - Tauntbreaker left set 3.
 */
const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7), setId: 'set3', phase: 'recruit', embers: 40, ...over } as RunState);
const act = (s: RunState, a: Action): RunState => reduce(s, a);
const play = (s: RunState, uid: string, toIndex = s.board.length): RunState => act(s, { type: 'play', uid, toIndex } as Action);
const select = (s: RunState, equipmentId: string): RunState => act(s, { type: 'selectEquipment', equipmentId } as Action);
const activate = (s: RunState, targetUid?: string): RunState => act(s, { type: 'activateEquipment', ...(targetUid ? { targetUid } : {}) });
const statsOf = (s: RunState, uid: string): [number, number] => { const c = s.board.find((b) => b.uid === uid)!; return [c.attack, c.health]; };
const nextTurn = (s: RunState): RunState => {
  const next = act(act(act(s, { type: 'faceOmen' }), { type: 'settleCombat' }), { type: 'resolveCombat' });
  expect(next.phase, 'the run never came back to a shop').toBe('recruit');
  return next;
};

describe('roster', () => {
  it('the three ship in set 3; Tauntbreaker left it (and still resolves for the other sets)', () => {
    const ids = poolFor('set3').buyable.map((c) => c.id);
    for (const id of ['n3_shredder', 'n3_calibration', 'n3_rig']) expect(ids, id).toContain(id);
    expect(ids).not.toContain('tauntbreaker');
    expect(poolFor('set2').buyable.map((c) => c.id), 'set 2 keeps it').toContain('tauntbreaker');
    expect(CARD_INDEX['tauntbreaker']).toBeTruthy();
    expect(CARD_INDEX['n3_shredder']).toMatchObject({ tier: 4, attack: 8, health: 4, tribe: 'neutral' });
    expect(CARD_INDEX['n3_calibration']).toMatchObject({ tier: 5, attack: 9, health: 6, tribe: 'neutral' });
    expect(CARD_INDEX['n3_rig']).toMatchObject({ tier: 3, attack: 4, health: 4, tribe: 'neutral' });
    expect(EQUIPMENT_INDEX['calibration_wrench']).toBe(CALIBRATION_WRENCH);
    expect(CALIBRATION_WRENCH).toMatchObject({ baseCost: 1, targetMode: 'none', effectId: 'equipmentCalibrate' });
  });
});

describe('Shredder — End of Turn: the ends gain +4/+4 per Equipment UNUSED this turn', () => {
  /** Frank (Bloodpot) + Sculptor (Titan Hammer) on the board with a Shredder between them: two held Equipment. */
  const armed = (golden = false): RunState => {
    let s = run({ hand: [body('f', 'e3_frank', { health: 400 }), body('g', 'e3_sculptor', { health: 400 })], board: [body('sh', 'n3_shredder', { golden })] });
    s = play(s, 'f', 0);
    s = play(s, 'g', 2);
    expect(s.board.map((c) => c.uid)).toEqual(['f', 'sh', 'g']);
    expect(equipmentState(s).available.map((g) => g.equipmentId).sort()).toEqual(['bloodpot', 'titan_hammer']);
    return s;
  };

  it('no Equipment held → nothing happens', () => {
    const s = run({ board: [body('a', 'u3_poochy', { keywords: [] }), body('sh', 'n3_shredder')] });
    const before = [statsOf(s, 'a'), statsOf(s, 'sh')];
    applyEndOfTurn(s);
    expect([statsOf(s, 'a'), statsOf(s, 'sh')]).toEqual(before);
  });

  it('two unused → +8/+8 on both ends; the middle body untouched', () => {
    const s = armed();
    expect(unusedEquipmentCount(s)).toBe(2);
    const [fa, fh] = statsOf(s, 'f'), [ga, gh] = statsOf(s, 'g'), mid = statsOf(s, 'sh');
    applyEndOfTurn(s);
    expect(statsOf(s, 'f')).toEqual([fa + 8, fh + 8]);
    expect(statsOf(s, 'g')).toEqual([ga + 8, gh + 8]);
    expect(statsOf(s, 'sh'), 'the middle is neither end').toEqual(mid);
  });

  it('using one before End of Turn → +4/+4 (only the unused one counts)', () => {
    let s = armed();
    s = select(s, 'bloodpot');
    s = activate(s, 'g'); // Frank cannot Bloodpot himself (R-TARGET-03); the Sculptor is a fine target
    expect(unusedEquipmentCount(s)).toBe(1);
    const [fa, fh] = statsOf(s, 'f'), [ga, gh] = statsOf(s, 'g');
    applyEndOfTurn(s);
    expect(statsOf(s, 'f')).toEqual([fa + 4, fh + 4]);
    expect(statsOf(s, 'g')).toEqual([ga + 4, gh + 4]);
  });

  it('gilded doubles: two unused → +16/+16', () => {
    const s = armed(true);
    const [fa, fh] = statsOf(s, 'f');
    applyEndOfTurn(s);
    expect(statsOf(s, 'f')).toEqual([fa + 16, fh + 16]);
  });

  it('a one-minion board is both ends and is buffed ONCE', () => {
    let s = run({ hand: [body('f', 'e3_frank', { health: 400 })], board: [] });
    s = play(s, 'f', 0);
    // Frank alone holds Bloodpot; give him Shredder's ability by putting Shredder alone instead: sell Frank's
    // grant persists within the turn (a grant outlives its source), so swap the board to just the Shredder.
    s.board = [body('sh', 'n3_shredder')];
    expect(unusedEquipmentCount(s), 'the grant outlives its source within the turn').toBe(1);
    applyEndOfTurn(s);
    expect(statsOf(s, 'sh')).toEqual([8 + 4, 4 + 4]);
  });

  it('the real turn boundary: End of Turn reads the marks BEFORE they expire, and the buff is permanent', () => {
    let s = armed();
    const [fa, fh] = statsOf(s, 'f');
    s = nextTurn(s);
    expect(statsOf(s, 'f')).toEqual([fa + 8, fh + 8]);
  });

  it('live text prints the current total on the card, both variants', () => {
    expect(shredderText('n3_shredder', false, 0)).toContain('{{+0/+0}}');
    expect(shredderText('n3_shredder', false, 2)).toContain('{{+8/+8}}');
    expect(shredderText('n3_shredder', true, 2)).toContain('{{+16/+16}}');
    expect(shredderText('n3_shredder', false, 2)).toContain('**2**');
    expect(shredderText('n3_defender', false, 2), 'only Shredder').toBeNull();
  });
});

describe('Calibration Wrench — your next Equipment activation is Amplified', () => {
  /** Master (Wrench) + Frank (Bloodpot) + a victim. */
  const armed = (golden = false): RunState => {
    let s = run({ hand: [body('m', 'n3_calibration', { health: 400, golden }), body('f', 'e3_frank', { health: 400 })], board: [body('t', 'u3_poochy', { health: 400, keywords: [] })] });
    s = play(s, 'm', 1);
    s = play(s, 'f', 2);
    expect(equipmentState(s).available.map((g) => g.equipmentId).sort()).toEqual(['bloodpot', 'calibration_wrench']);
    return s;
  };

  it('Wrench, then Bloodpot → Bloodpot resolves Amplified (twice); the charge is spent', () => {
    let s = armed();
    s = select(s, 'calibration_wrench');
    expect(equipmentWillAmplify(s, 'bloodpot')).toBe(false);
    s = activate(s);
    expect(calibrationPendingOf(s)).toBe(1);
    expect(s.embers, 'the Wrench costs 1').toBe(39);
    expect(equipmentWillAmplify(s, 'bloodpot'), 'the slot paints Bloodpot blue').toBe(true);
    expect(equipmentWillAmplify(s, 'calibration_wrench'), 'never the Wrench itself').toBe(false);
    expect(equipmentAmplifiedOf(s, 'bloodpot'), 'no per-id stack — the pending count is the Wrench channel').toBe(0);
    s = select(s, 'bloodpot');
    const [a, h] = statsOf(s, 't');
    s = activate(s, 't');
    expect(statsOf(s, 't'), 'Bloodpot +3/+3, twice').toEqual([a + 6, h + 6]);
    expect(calibrationPendingOf(s)).toBe(0);
    expect(equipmentWillAmplify(s, 'bloodpot')).toBe(false);
  });

  it('the Wrench cannot Amplify itself: two Wrench presses bank two, not three', () => {
    let s = armed();
    s.equipment!.bonusActivations = 1; // a pool charge so the Wrench can fire twice this turn
    s = select(s, 'calibration_wrench');
    s = activate(s);
    s = activate(s);
    expect(calibrationPendingOf(s), 'the second press was not Amplified by the first').toBe(2);
  });

  it('the pending charge survives the turn boundary (Amplification carries, like a stack)', () => {
    let s = armed();
    s = select(s, 'calibration_wrench');
    s = activate(s);
    s = nextTurn(s);
    expect(calibrationPendingOf(s)).toBe(1);
    s = select(s, 'bloodpot');
    const [a, h] = statsOf(s, 't');
    s = activate(s, 't');
    expect(statsOf(s, 't')).toEqual([a + 6, h + 6]);
  });

  it('gilded Master → the next TWO activations', () => {
    let s = armed(true);
    expect(equipmentState(s).available.find((g) => g.equipmentId === 'calibration_wrench')!.version).toBe('gilded');
    s = select(s, 'calibration_wrench');
    s = activate(s);
    expect(calibrationPendingOf(s)).toBe(2);
    s.equipment!.bonusActivations = 1;
    s = select(s, 'bloodpot');
    const [a, h] = statsOf(s, 't');
    s = activate(s, 't');
    expect(calibrationPendingOf(s)).toBe(1);
    s = activate(s, 't');
    expect(statsOf(s, 't'), 'both Bloodpots Amplified').toEqual([a + 12, h + 12]);
    expect(calibrationPendingOf(s)).toBe(0);
  });

  it('an Equipment already Amplified by its own stack spends the stack, not the Wrench (nothing wasted)', () => {
    let s = armed();
    s = select(s, 'calibration_wrench');
    s = activate(s);
    s.equipment!.amplified = { bloodpot: 1 };
    s = select(s, 'bloodpot');
    const [a, h] = statsOf(s, 't');
    s = activate(s, 't');
    expect(statsOf(s, 't'), 'still ×2, never ×4').toEqual([a + 6, h + 6]);
    expect(equipmentAmplifiedOf(s, 'bloodpot')).toBe(0);
    expect(calibrationPendingOf(s), 'kept for the next press').toBe(1);
  });
});

describe('Rig — when you use Equipment, this gains +4/+4', () => {
  const armed = (rigGolden = false): RunState => {
    let s = run({ hand: [body('f', 'e3_frank', { health: 400 })], board: [body('t', 'u3_poochy', { health: 400, keywords: [] }), body('r', 'n3_rig', { golden: rigGolden, ...(rigGolden ? { attack: 8, health: 8 } : {}) })] });
    s = play(s, 'f', 2);
    return s;
  };

  it('one activation → 8/8; two → 12/12', () => {
    let s = armed();
    s.equipment!.bonusActivations = 1;
    s = activate(s, 't');
    expect(statsOf(s, 'r')).toEqual([8, 8]);
    s = activate(s, 't');
    expect(statsOf(s, 'r')).toEqual([12, 12]);
  });

  it('gilded: +8/+8 per activation (a gilded 8/8 Rig reads 16/16 after one)', () => {
    let s = armed(true);
    s = activate(s, 't');
    expect(statsOf(s, 'r')).toEqual([16, 16]);
  });

  it('a Rig in hand is untouched', () => {
    let s = armed();
    s.hand.push(body('h', 'n3_rig'));
    s = activate(s, 't');
    expect(s.hand.find((c) => c.uid === 'h')).toMatchObject({ attack: 4, health: 4 });
    expect(statsOf(s, 'r')).toEqual([8, 8]);
  });

  it('a refused activation (no charge) fires nothing; the Wrench activation counts', () => {
    let s = armed();
    s = activate(s, 't');
    s = activate(s, 't'); // no charge left → refused
    expect(statsOf(s, 'r')).toEqual([8, 8]);
    s.hand.push(body('m', 'n3_calibration', { health: 400 }));
    s = play(s, 'm', 0);
    s = select(s, 'calibration_wrench');
    s = activate(s);
    expect(statsOf(s, 'r'), 'the Wrench is an Equipment activation too').toEqual([12, 12]);
  });
});
