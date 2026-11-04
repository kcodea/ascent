import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRun, type RunState } from '@game/sim';
import { shopDecisionOpen, turnClockMayTick } from './turnClock';
import { chooseOneHeldSlot } from './chooseOneHold';

/**
 * R-TIMER-AIM-01 (owner 2026-11-03): "shop time should not pause while choosing a minion in a case lke this, it doesnt
 * count as a discover situation where shop should be paused." And R-TARGET-CANCEL-01's input half.
 */

const run = (over: Partial<RunState>): RunState => ({ ...createRun(1), ...over });
const ticks = (r: RunState): boolean => turnClockMayTick({
  recruitPhase: true, decisionOpen: shopDecisionOpen(r), heroSelecting: false, overlayOpen: false, introPlaying: false,
});
const recruit = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'Recruit.tsx'), 'utf8');

describe('the Shop clock and an aim', () => {
  it('runs under every kind of aim', () => {
    expect(ticks(run({ pendingTarget: { uid: 'a', cardId: 'dm_agent', deferredPlay: true, shoutAim: true } }))).toBe(true);
    expect(ticks(run({ pendingTarget: { uid: 'a', cardId: 'beetle', deferredPlay: true, optionIndex: 0 } }))).toBe(true);
  });

  it('still stops for a Discover and the other overlay decisions', () => {
    expect(ticks(run({ discover: ['stray'] }))).toBe(false);
    expect(ticks(run({ chooseOne: { uid: 'a', cardId: 'beetle' } }))).toBe(false);
    expect(ticks(run({ questOffer: ['q'] }))).toBe(false);
    expect(ticks(run({ runeforgeOffer: ['r'] }))).toBe(false);
  });

  it('the countdown reads the shared gate, and has no aim dependency to restart on', () => {
    const at = recruit.indexOf('if (!turnClockMayTick({');
    expect(recruit.slice(at, at + 200)).toContain('decisionOpen: shopDecisionOpen(run)');
    const deps = recruit.slice(recruit.indexOf('}, [run.phase,', at), recruit.indexOf(']);', recruit.indexOf('}, [run.phase,', at)));
    expect(deps).not.toContain('run.pendingTarget');
  });
});

describe('R-TARGET-CANCEL-01: the aim line and the slot', () => {
  it('a held Shout minion stands in the slot it was dropped on, like a Choose One', () => {
    expect(chooseOneHeldSlot({ pendingTarget: { uid: 'a', cardId: 'dm_agent', deferredPlay: true, shoutAim: true, toIndex: 2 } })).toEqual({ uid: 'a', toIndex: 2 });
  });

  it('a spell takes no slot', () => {
    expect(chooseOneHeldSlot({ pendingTarget: { uid: 'c', cardId: 'commonground', spell: true, spellFirstUid: 'x', deferredPlay: true } })).toBeNull();
  });

  it('click away, right-click and Esc all cancel, for cards and for powers', () => {
    const aim = recruit.slice(recruit.indexOf('const cancelAim = ()'), recruit.indexOf('[pendingTarget, timeUp, dispatch'));
    expect(aim).toContain("window.addEventListener('contextmenu', rightClick, true)");
    expect(aim).toContain("window.addEventListener('keydown', escape, true)");
    expect(aim).toContain('escapeHasOwner(useGame.getState())');
    const power = recruit.slice(recruit.indexOf('const disarm = ()'), recruit.indexOf('[heroArmed, equipArmed, armEquipment'));
    expect(power).toContain("window.addEventListener('contextmenu', rightClick, true)");
    expect(power).toContain("window.addEventListener('keydown', escape, true)");
  });
});
