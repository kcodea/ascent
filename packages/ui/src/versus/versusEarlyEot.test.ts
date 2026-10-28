/**
 * EARLY END TURN (R-VERSUS-EARLY-EOT-01, owner 2026-10-27: "going back to shop from combat is very quick, but going into
 * combat from shop seems to hang?"). A Versus End Turn now starts when the server CLOSES the round, while the resolver is
 * still settling it; its commit (which lands the fight) waits here until the fight is in, so nothing ever reaches the
 * combat screen without this round's fight.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CombatResult } from '@game/core';
import type { RunState } from '@game/sim';
import { holdUntilVersusFight, installVersusHandlers, releaseVersusFightWait, versusFightWaitHeld } from './versusHooks';

const run = (p: Partial<RunState> = {}): RunState => ({ mode: 'versus', phase: 'recruit', wave: 3, ...p } as RunState);
const fights: Record<number, CombatResult> = {};
const install = (): void => installVersusHandlers({ fightFor: (w) => fights[w] ?? null, afterCommit: () => undefined });

afterEach(() => { installVersusHandlers(null); for (const k of Object.keys(fights)) delete fights[Number(k)]; });

describe('R-VERSUS-EARLY-EOT-01: the early End Turn commits once its fight is in', () => {
  it('no fight yet: the commit is held, then runs once when the fight lands', () => {
    install();
    const go = vi.fn();
    expect(holdUntilVersusFight(run(), { type: 'faceOmen', deferFight: true }, go)).toBe(true);
    expect(versusFightWaitHeld()).toBe(true);
    releaseVersusFightWait(3); // no fight yet: still held
    expect(go).not.toHaveBeenCalled();
    fights[3] = { result: 'win' } as unknown as CombatResult;
    releaseVersusFightWait(2); // another round: still held
    expect(go).not.toHaveBeenCalled();
    releaseVersusFightWait(3);
    releaseVersusFightWait(3);
    expect(go).toHaveBeenCalledTimes(1);
    expect(versusFightWaitHeld()).toBe(false);
  });

  it('the fight is already in: never held (the ordinary path)', () => {
    install();
    fights[3] = { result: 'lose' } as unknown as CombatResult;
    expect(holdUntilVersusFight(run(), { type: 'faceOmen' }, () => undefined)).toBe(false);
  });

  it('only a Versus End Turn on the shop, only while a match is installed', () => {
    const go = (): void => undefined;
    expect(holdUntilVersusFight(run(), { type: 'faceOmen' }, go)).toBe(false); // no match running
    install();
    expect(holdUntilVersusFight(run(), { type: 'roll' } as never, go)).toBe(false);
    expect(holdUntilVersusFight(run({ mode: 'lobby' } as Partial<RunState>), { type: 'faceOmen' }, go)).toBe(false);
    expect(holdUntilVersusFight(run({ phase: 'combat' }), { type: 'faceOmen' }, go)).toBe(false);
  });

  it('a held commit never outlives its match', () => {
    install();
    const go = vi.fn();
    holdUntilVersusFight(run(), { type: 'faceOmen' }, go);
    installVersusHandlers(null);
    expect(versusFightWaitHeld()).toBe(false);
    install();
    fights[3] = { result: 'win' } as unknown as CombatResult;
    releaseVersusFightWait(3);
    expect(go).not.toHaveBeenCalled();
  });
});
