// @vitest-environment jsdom
/**
 * VERSUS PAUSE = NO INPUT (owner 2026-10-14, during the "Test Bot disconnected / Reconnect time 19s" veil: "i was able to
 * hero power during this, fix that"). The rule lives at the ACTION LAYER, not in the veil: while a match is paused every
 * run action is refused by the store (`dispatch`, `preparePresentationAction`, hero power / Equipment arming), so a
 * hotkey or anything drawn above the veil cannot slip through. After the resume every action is accepted again.
 * While the shop is merely HELD (waiting on the other player) the player's own actions are refused and the game's own
 * (the End Turn that lands the fight, the fight's settle and exit) still play.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVersusRun, type Action, type RunState } from '@game/sim';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const { useGame } = await import('../store');
const { installVersusHandlers, versusRefuses } = await import('./versusHooks');
const { versusFreezeOf } = await import('./versusStore');

/** Every action type in the union: a new action type fails to compile here until it is listed (and so gated). */
const EVERY_ACTION: Record<Action['type'], true> = {
  activateEquipment: true, ancientSetMeter: true, battlecryTarget: true, buy: true, buyHenchman: true, buyQuest: true, buyRune: true,
  cancelChoice: true, chooseOne: true, closeScout: true, combatBladeAttackPreview: true, combatEscalationPreview: true,
  combatFriendlyDeathPreview: true, combatScoutPreview: true, combatSpellCastPreview: true, combatSpellPowerPreview: true, devGrant: true,
  devOpenRuneforge: true, discountWindowExpired: true, discover: true, faceOmen: true, freeze: true, godGrantRune: true, godPrint: true,
  heroPower: true, landCombat: true, pickAncient: true, pickPower: true, play: true, reorderHand: true, reorderShop: true,
  reposition: true, rerollRuneforge: true, resolveCombat: true, resolveShopDeath: true, roll: true, selectEquipment: true, sell: true,
  settleCombat: true, shopClockExpired: true, skipRuneforge: true, upgrade: true,
};
const actions = (Object.keys(EVERY_ACTION) as Action['type'][]).map((type) => ({ type }) as Action);
/** The actions the PLAYER makes (refused while held as well as while paused). */
const SYSTEM = new Set(['faceOmen', 'landCombat', 'settleCombat', 'resolveCombat', 'resolveShopDeath', 'shopClockExpired', 'discountWindowExpired']);
const playerActions = actions.filter((a) => !SYSTEM.has(a.type) && !a.type.startsWith('combat'));

let freeze: 'paused' | 'held' | null = null;
const install = (): void => installVersusHandlers({ fightFor: () => null, afterCommit: () => undefined, freeze: () => freeze });
afterEach(() => { installVersusHandlers(null); freeze = null; });

const versusRun = (): RunState => ({ ...createVersusRun(7, 'warden', 'set2'), mode: 'versus' });

describe('the action layer refuses every Versus action while the match is paused', () => {
  it('paused: every action type is refused; resumed: every action type is accepted', () => {
    install();
    const run = versusRun();
    freeze = 'paused';
    for (const a of actions) expect(versusRefuses(run, a), a.type).toBe(true);
    freeze = null;
    for (const a of actions) expect(versusRefuses(run, a), a.type).toBe(false);
  });

  it('held: the player actions are refused, the game\'s own End Turn and fight exit still play', () => {
    install();
    const run = versusRun();
    freeze = 'held';
    for (const a of playerActions) expect(versusRefuses(run, a), a.type).toBe(true);
    for (const t of SYSTEM) expect(versusRefuses(run, { type: t } as Action), t).toBe(false);
  });

  it('outside Versus nothing is ever refused', () => {
    install();
    freeze = 'paused';
    const run = { ...versusRun(), mode: 'lobby' } as RunState;
    for (const a of actions) expect(versusRefuses(run, a), a.type).toBe(false);
  });

  it('through the real store: a roll, hero-power aim, Equipment aim and End Turn do nothing while paused and work after', () => {
    install();
    const run = versusRun();
    useGame.setState({ run, heroArmed: false, equipArmed: false, presentationTx: null });
    freeze = 'paused';
    const g = useGame.getState();
    g.dispatch({ type: 'roll' });
    g.dispatch({ type: 'heroPower' });
    g.dispatch({ type: 'upgrade' });
    expect(useGame.getState().run).toBe(run); // not one action reached the reducer
    g.armHero();
    g.armEquipment();
    expect(useGame.getState().heroArmed).toBe(false);
    expect(useGame.getState().equipArmed).toBe(false);
    expect(g.preparePresentationAction({ type: 'faceOmen' })).toBeNull();
    expect(useGame.getState().presentationTx).toBeNull();

    freeze = null; // the resume
    g.dispatch({ type: 'roll' });
    expect(useGame.getState().run).not.toBe(run);
    expect(useGame.getState().run.shop).not.toEqual(run.shop); // the roll landed
    g.armHero();
    expect(useGame.getState().heroArmed).toBe(true);
    useGame.setState({ heroArmed: false });
  });

  it('the freeze reads the match row: paused_at (the veil and its 3-2-1) is paused, its absence is not', () => {
    const run = versusRun();
    const m = { id: 'm', phase: 'shop', round: 1, paused_at: '2026-10-14T18:00:00Z', resume_at: null } as never;
    expect(versusFreezeOf({ match: m, lockedRound: null, readyRound: null }, run)).toBe('paused');
    const counting = { ...(m as object), resume_at: '2026-10-14T18:00:03Z' } as never; // the 3-2-1 is still paused
    expect(versusFreezeOf({ match: counting, lockedRound: null, readyRound: null }, run)).toBe('paused');
    const done = { ...(m as object), phase: 'complete' } as never;
    expect(versusFreezeOf({ match: done, lockedRound: null, readyRound: null }, run)).toBeNull();
    expect(versusFreezeOf({ match: null, lockedRound: null, readyRound: null }, run)).toBeNull();
  });
});
