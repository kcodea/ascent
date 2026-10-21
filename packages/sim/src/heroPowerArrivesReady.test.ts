/**
 * A HERO POWER ARRIVES READY (owner report 2026-10-20, R-HERO-POWER-FRESH-01): "copy machine came spent - i had
 * used masterwork before this, maybe that's why? it should reset from finding a new hero power tho".
 *
 * The once-per-game latch (`heroPowerSpent`) and the whole-game use count (`heroPowerUses`) are SLOT fields. They
 * used to be reset only on the FIRST adoption of each hero (inside `seedAdoptedPower`'s once-per-run guard), so a
 * power found a second time inherited whatever the power it replaced had spent. Now every gain path swaps
 * per-power latches (`swapPowerLatch`): the arriving power loads its OWN state, fresh when it was never spent.
 */
import { describe, expect, it } from 'vitest';
import { activePowers, createRun, reduce, type BoardCard, type RunState } from './index';

const body = (uid: string): BoardCard => ({ uid, cardId: 'stray', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false });

/** A Mimic mid-shop picking `heroId` from a rigged turn-start power Discover (the real `pickPower` path). */
function mimicPicks(s: RunState, heroId: string): RunState {
  return reduce({ ...s, powerOffer: { heroIds: [heroId, 'warden'], slot: 'mimic' }, discover: undefined } as RunState, { type: 'pickPower', index: 0 });
}

function mimicRun(): RunState {
  return {
    ...createRun(7, 'mimic'), phase: 'recruit', wave: 3, embers: 50, maxEmbers: 50,
    board: [body('a'), body('b')], hand: [], powerOffer: undefined, discover: undefined,
  } as RunState;
}

/** A plain hero casting Power Shifter with the Discover rigged to `heroId`. */
function shift(s: RunState, heroId: string): RunState {
  s = { ...s, hand: [...s.hand, { uid: 'ps', cardId: 'powershifter', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] };
  s = reduce(s, { type: 'play', uid: 'ps' } as never);
  s = { ...s, powerOffer: { heroIds: [heroId, 'nadja', 'merrin'], slot: 'shifter' } } as RunState;
  return reduce(s, { type: 'pickPower', index: 0 });
}

describe('Masterwork then Copy Machine (the owner report)', () => {
  it('a Mimic who held Copy Machine before, then used Masterwork, finds Copy Machine READY', () => {
    let s = mimicPicks(mimicRun(), 'xerox'); // Copy Machine first (unused): seeds xerox
    s = mimicPicks(s, 'indy');
    s = reduce(s, { type: 'heroPower', uid: 'a' }); // Masterwork
    expect(s.board.find((c) => c.uid === 'a')!.golden, 'Masterwork fired').toBe(true);
    expect(s.heroPowerSpent).toBe(true);

    s = mimicPicks(s, 'xerox');
    expect(activePowers(s)[0]!.kind).toBe('copyMachine');
    expect(s.heroPowerSpent, 'Copy Machine arrives ready').toBe(false);
    const before = s.board.length;
    s = reduce(s, { type: 'heroPower', uid: 'b' });
    expect(s.board.length, 'Copy Machine fires').toBe(before + 1);
  });

  it('Indy uses Masterwork, Power Shifter into Copy Machine: ready, with no Masterwork recharge pill', () => {
    let s: RunState = { ...createRun(5, 'indy'), phase: 'recruit', embers: 50, maxEmbers: 50, board: [body('a'), body('b')], hand: [], powerOffer: undefined, discover: undefined } as RunState;
    s = reduce(s, { type: 'heroPower', uid: 'a' });
    expect(s.heroPowerSpent).toBe(true);
    s = shift(s, 'xerox');
    expect(s.heroPowerSpent).toBe(false);
    const before = s.board.length;
    s = reduce(s, { type: 'heroPower', uid: 'b' });
    expect(s.board.length).toBe(before + 1);
  });
});

describe('a power you already spent stays spent when found again (no farming)', () => {
  it('a Mimic re-finding a used Masterwork does not get a free Gild', () => {
    let s = mimicPicks(mimicRun(), 'indy');
    s = reduce(s, { type: 'heroPower', uid: 'a' });
    s = mimicPicks(s, 'xerox');
    expect(s.heroPowerSpent).toBe(false);
    s = mimicPicks(s, 'indy');
    expect(s.heroPowerSpent, 'Masterwork keeps its own spent latch').toBe(true);
    expect(s.indyGildRearmAt, 'and its own recharge threshold').toBeDefined();
  });

  it('a Mimic re-finding a used Copy Machine finds it spent', () => {
    let s = mimicPicks(mimicRun(), 'xerox');
    s = reduce(s, { type: 'heroPower', uid: 'a' });
    expect(s.heroPowerSpent).toBe(true);
    s = mimicPicks(s, 'indy');
    expect(s.heroPowerSpent, 'Masterwork arrives ready').toBe(false);
    s = mimicPicks(s, 'xerox');
    expect(s.heroPowerSpent).toBe(true);
  });
});

describe('whole-game use counts belong to their own power', () => {
  it("Jenkins's dig count and Gildmaster's budget never leak into each other across re-adoptions", () => {
    let s = mimicPicks(mimicRun(), 'jenkins');
    s = mimicPicks(s, 'gildmaster');
    s = { ...s, heroPowerUses: 2 }; // two Gildcrafter uses spent
    s = mimicPicks(s, 'jenkins');
    expect(s.heroPowerUses, "Jenkins's own count (never dug)").toBe(0);
    s = { ...s, heroPowerUses: 1 }; // one dig
    s = mimicPicks(s, 'gildmaster');
    expect(s.heroPowerUses, "Gildmaster's own 2").toBe(2);
    s = mimicPicks(s, 'jenkins');
    expect(s.heroPowerUses, "Jenkins's own 1").toBe(1);
  });
});

describe("a native quest finishing after a Power Shifter spends the quest, not the shifted-in power", () => {
  it('Drakko shifts to Copy Machine, then completes his Battlecry quest: Copy Machine stays ready', () => {
    let s: RunState = { ...createRun(1, 'drakko'), phase: 'recruit', embers: 99, maxEmbers: 99, board: [body('a')], hand: [], shop: [], powerOffer: undefined, discover: undefined } as RunState;
    s = shift(s, 'xerox');
    for (let i = 0; i < 5; i++) {
      s = { ...s, shop: [{ uid: `x${i}`, cardId: 'alley' }] };
      s = reduce(s, { type: 'buy', uid: `x${i}` });
    }
    expect(s.hand.some((c) => c.cardId === 'drummer'), 'the quest still pays out').toBe(true);
    expect(s.heroPowerSpent, 'Copy Machine untouched').toBe(false);
    expect(s.powerLatches?.drakko?.spent, "the quest's own latch").toBe(true);
  });
});
