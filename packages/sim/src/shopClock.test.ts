import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { SHOP_CLOCK_POLICY, blockedByShopClock, shopLocked } from './shopClock';
import { equipmentUsesLeft } from './equipment';

/**
 * THE SHOP CLOCK LOCK (owner report 2026-09-30, R-TIMER-LOCK-01): "goldspring is usable after timer ends. make sure
 * hero powers cant be used after timer ends".
 *
 * The UI's tick dispatches `shopClockExpired` as the clock lands on 0:00; from then until the turn flips the reducer
 * refuses every Shop player action `SHOP_CLOCK_POLICY` marks locked. Before this the lock was UI-only, and the
 * hero-power / Equipment buttons never checked it, so Nadja's untargeted Goldspring fired at 0:00.
 */
const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const recruit = (heroId?: string, over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, heroId), phase: 'recruit', embers: 30, heroReady: true, ...over } as RunState);
const expire = (s: RunState): RunState => reduce(s, { type: 'shopClockExpired' });
const nextTurn = (s: RunState): RunState => {
  const next = reduce(reduce(reduce(s, { type: 'faceOmen' }), { type: 'settleCombat' }), { type: 'resolveCombat' });
  expect(next.phase).toBe('recruit');
  return next;
};

describe('the expiry action', () => {
  it('sets the lock in the Shop, and a repeat or out-of-phase expiry is a free no-op', () => {
    const s = recruit('nadja');
    expect(shopLocked(s)).toBe(false);
    const locked = expire(s);
    expect(locked.shopClockExpired).toBe(true);
    expect(shopLocked(locked)).toBe(true);
    expect(expire(locked)).toBe(locked); // repeat: same reference, no clone
    const combat = { ...s, phase: 'combat' } as RunState;
    expect(reduce(combat, { type: 'shopClockExpired' })).toBe(combat);
  });
});

describe('hero powers', () => {
  it("Nadja's Goldspring works before 0:00", () => {
    const s = recruit('nadja');
    const after = reduce(s, { type: 'heroPower' });
    expect(after.maxGoldBonus ?? 0).toBe((s.maxGoldBonus ?? 0) + 1);
    expect(after.heroReady).toBe(false);
  });

  it("Nadja's Goldspring is refused after 0:00 (the owner's report)", () => {
    const locked = expire(recruit('nadja'));
    const after = reduce(locked, { type: 'heroPower' });
    expect(after).toBe(locked); // rejected before the clone: nothing paid, nothing gained
    expect(after.maxGoldBonus ?? 0).toBe(locked.maxGoldBonus ?? 0);
    expect(after.heroReady).toBe(true);
  });

  it("a targeted power (Warden's Aegis) and a second-slot power (Void's slot 1) are refused too", () => {
    const board = [body('a', 'e3_frank')];
    const warden = expire(recruit('warden', { board }));
    expect(reduce(warden, { type: 'heroPower', uid: 'a' })).toBe(warden);
    const voidRun = expire(recruit('void', { board }));
    expect(reduce(voidRun, { type: 'heroPower', slot: 1 })).toBe(voidRun);
  });
});

describe('Equipment', () => {
  it('Bloodpot activates before 0:00 and is refused after it', () => {
    let s = recruit(undefined, { hand: [body('f', 'e3_frank')] });
    s = reduce(s, { type: 'play', uid: 'f', toIndex: 0 });
    expect(equipmentUsesLeft(s)).toBeGreaterThan(0);
    const live = reduce(s, { type: 'activateEquipment', targetUid: 'f' });
    expect(live.board[0]!.attack).toBeGreaterThan(s.board[0]!.attack);
    const locked = expire(s);
    expect(reduce(locked, { type: 'activateEquipment', targetUid: 'f' })).toBe(locked);
  });
});

describe('the other Shop actions follow the same predicate', () => {
  it('buy / sell / play / refresh / upgrade / Henchman are refused after 0:00', () => {
    const s = recruit(undefined, { board: [body('b', 'e3_frank')], hand: [body('h', 'e3_frank')] });
    const locked = expire(s);
    const offer = locked.shop[0]!;
    const refused: Action[] = [
      { type: 'buy', uid: offer.uid }, { type: 'sell', uid: 'b' }, { type: 'play', uid: 'h', toIndex: 0 },
      { type: 'roll' }, { type: 'upgrade' }, { type: 'buyHenchman' },
    ];
    for (const a of refused) expect(reduce(locked, a), a.type).toBe(locked);
    // …and each of them is accepted before 0:00 (the refusal is the clock, not something else).
    for (const a of refused.filter((x) => x.type !== 'buyHenchman')) expect(reduce(s, a), a.type).not.toBe(s);
  });

  it('End Turn, Freeze and arranging the board stay open after 0:00', () => {
    const locked = expire(recruit(undefined, { board: [body('a', 'e3_frank'), body('b', 'e3_frank')] }));
    expect(reduce(locked, { type: 'freeze' }).frozen).toBe(!locked.frozen);
    expect(reduce(locked, { type: 'reposition', uid: 'a', toIndex: 1 }).board.map((c) => c.uid)).toEqual(['b', 'a']);
    expect(reduce(locked, { type: 'faceOmen' }).phase).toBe('combat');
  });

  it('every locked action in the table is refused by the shared predicate, every open one is not', () => {
    const locked = expire(recruit());
    for (const [type, policy] of Object.entries(SHOP_CLOCK_POLICY)) {
      expect(blockedByShopClock(locked, { type } as Action), type).toBe(policy === 'locked');
      expect(blockedByShopClock(recruit(), { type } as Action), type).toBe(false); // nothing locks before 0:00
    }
  });
});

describe('End of Turn is not a player action', () => {
  it('End of Turn triggers resolve identically whether or not the clock ran out', () => {
    // A board carrying End-of-Turn minions; End Turn from the locked and the unlocked Shop must land the same board.
    const eot = Object.values(CARD_INDEX).filter((d) => d.effects.some((e) => e.on === 'endOfTurn') && d.attack > 0).slice(0, 3);
    expect(eot.length).toBeGreaterThan(0);
    const s = recruit(undefined, { board: eot.map((d, i) => body(`e${i}`, d.id)) });
    const free = reduce(s, { type: 'faceOmen' });
    const timed = reduce(expire(s), { type: 'faceOmen' });
    expect(timed.board).toEqual(free.board);
    expect(timed.hand).toEqual(free.hand);
    expect(timed).toEqual(free); // the whole run, the lock included (cleared on combat entry)
  });
});

describe('the lock lasts one turn', () => {
  it('the next Shop turn opens unlocked and Goldspring works again', () => {
    const locked = expire(recruit('nadja'));
    const next = nextTurn(locked);
    expect(next.shopClockExpired).toBeUndefined();
    expect(shopLocked(next)).toBe(false);
    const after = reduce({ ...next, embers: 30 }, { type: 'heroPower' });
    expect(after.maxGoldBonus ?? 0).toBe((next.maxGoldBonus ?? 0) + 1);
  });
});

describe('replays stay deterministic', () => {
  it('a recorded stream replays the lock where it was lived, and an old stream (no expiry) reduces as it always did', () => {
    const s = recruit('nadja');
    const newStream: Action[] = [{ type: 'roll' }, { type: 'shopClockExpired' }, { type: 'heroPower' }];
    const oldStream: Action[] = [{ type: 'roll' }, { type: 'heroPower' }];
    const run = (stream: Action[]): RunState => stream.reduce(reduce, s);
    expect(run(newStream)).toEqual(run(newStream));
    expect(run(newStream).maxGoldBonus ?? 0).toBe(s.maxGoldBonus ?? 0); // the post-expiry press was refused
    expect(run(oldStream).maxGoldBonus ?? 0).toBe((s.maxGoldBonus ?? 0) + 1); // a legacy stream is untouched
  });
});
