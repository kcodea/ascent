// @vitest-environment jsdom
/**
 * R-COMBAT-TIER-GOLD-01 (owner ask 2026-11-20): "make it so that the player's shop tier and gold buttons stay in
 * combat. the player shouldnt be able to press the shop tier up button, but they should be able to see their tier
 * etc, and the gold should show any leftover gold from last turn and mouseover should show the gold for upcoming
 * turns as usual, with real time data so any that gets added in combat also shows".
 *
 * Pins: both pieces render in combat; the stone is inert there (disabled, no cost coin, a click does nothing); the
 * pill shows the left-over Gold; a replayed `maxGold` event moves the forecast at ITS beat, not at settle; a skip
 * (fold to the end) lands on the same number; and after `settleCombat` the reading equals the real run state with
 * no double count.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CombatEvent } from '@game/core';
import { createLobbyRun, reduce, type Action, type RunState } from '@game/sim';
import { mount, type Mounted } from './renderedText.mount';
import { TierGoldControls } from './TierGoldControls';
import { COMBAT_GOLD_FOLD, goldForecastOf, liveCombatGold, type LiveCombatGold } from './goldForecast';
import { foldPrefix } from './choreo/prefixFold';
import { WHOLE_LOG, type HandRange } from './ownHandRange';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

const controls = (combat: boolean, onUpgrade = vi.fn(), over: Partial<{ gold: number; next: number; after: number }> = {}) => (
  <TierGoldControls tier={3} maxTier={6} upgradeCost={4} upgradeDisabled={false} combat={combat} onUpgrade={onUpgrade}
    gold={over.gold ?? 2} nextTurnGold={over.next ?? 7} afterNextGold={over.after ?? 8} wave={5} />
);

describe('Shop tier + Gold in combat', () => {
  it('both render in combat; the stone shows the tier but cannot be pressed', () => {
    const onUpgrade = vi.fn();
    ui = mount(controls(true, onUpgrade));
    const stone = ui.container.querySelector<HTMLButtonElement>('button.tvbwrap')!;
    expect(stone).not.toBeNull();
    expect(stone.disabled).toBe(true);
    expect(stone.classList.contains('combat')).toBe(true);
    expect(stone.querySelector('.tvb-cost'), 'no cost coin inviting a click').toBeNull();
    expect(stone.querySelector('.tvb-tierpill')!.textContent).toBe('Tier 3');
    stone.click();
    expect(onUpgrade).not.toHaveBeenCalled();

    const pill = ui.container.querySelector('.goldpill')!;
    expect(pill.querySelector('.goldpill-v')!.textContent).toBe('2');
    expect(pill.querySelector('.gt-now')!.textContent).toBe('Gold · 2 left over');
    const rows = [...pill.querySelectorAll('.gt-row')].map((r) => r.textContent);
    expect(rows).toEqual(['Next turn7', 'Wave 78']);
    expect(ui.container.querySelector('[title]'), 'no native tooltips').toBeNull();
  });

  it('in the Shop the stone is the live upgrade button (unchanged)', () => {
    const onUpgrade = vi.fn();
    ui = mount(controls(false, onUpgrade));
    const stone = ui.container.querySelector<HTMLButtonElement>('button.tvbwrap')!;
    expect(stone.disabled).toBe(false);
    expect(stone.querySelector('.tvb-cost')!.textContent).toBe('4');
    expect(ui.container.querySelector('.gt-now')!.textContent).toBe('Gold · 2 this turn');
    stone.click();
    expect(onUpgrade).toHaveBeenCalledTimes(1);
  });
});

/** A real lobby fight (empty board, so it resolves fast), with Gold spliced into its log at `at`: the player's +2 max
 *  Gold (a Soulsman Avenge) and +3 Gold next turn (a Bounty Bot kill), then the foe's +5 / +4 (which must never touch
 *  your forecast). The carry-backs say the same, exactly as `simulate` reports them. */
function fightWithGold(): { run: RunState; events: CombatEvent[]; at: number } {
  let s: RunState = { ...createLobbyRun(777, 'warden'), board: [] as never };
  s = reduce(s, { type: 'faceOmen' } as Action);
  expect(s.phase).toBe('combat');
  const lc = s.lastCombat!;
  const at = Math.floor(lc.events.length / 2);
  const events: CombatEvent[] = [
    ...lc.events.slice(0, at),
    { type: 'maxGold', target: 'p1', side: 'player', amount: 2 },
    { type: 'bonusGold', side: 'player', amount: 3, source: 'p1' },
    { type: 'maxGold', target: 'e1', side: 'enemy', amount: 5 },
    { type: 'bonusGold', side: 'enemy', amount: 4 },
    ...lc.events.slice(at),
  ];
  s = { ...s, lastCombat: { ...lc, events, playerMaxGoldGain: 2, playerBonusGold: 3 } };
  return { run: s, events, at };
}

const replayed = (events: CombatEvent[], upto: number, range: HandRange = WHOLE_LOG): LiveCombatGold => foldPrefix(COMBAT_GOLD_FOLD, events, upto, range);

describe('the Gold forecast is live off the replay', () => {
  it('ticks at each Gold event, ignores the foe, and a skip lands on the same number', () => {
    const { run, events, at } = fightWithGold();
    const base = goldForecastOf(run);
    const live = (upto: number) => goldForecastOf(run, liveCombatGold(run.phase, run.combatSettled, replayed(events, upto)));
    expect(live(0)).toEqual(base);
    expect(live(at), 'not yet played').toEqual(base);
    expect(live(at + 1), 'max Gold raises both rows').toEqual({ next: base.next + 2, afterNext: base.afterNext + 2 });
    expect(live(at + 2), 'Gold next turn raises the next row only').toEqual({ next: base.next + 5, afterNext: base.afterNext + 2 });
    expect(live(at + 4), "the foe's Gold is not yours").toEqual(live(at + 2));
    expect(live(events.length), 'skip to the end').toEqual(live(at + 2));

    // The pill shows that reading at that beat.
    const f = live(at + 2);
    ui = mount(controls(true, vi.fn(), { gold: run.embers, next: f.next, after: f.afterNext }));
    expect(ui.container.querySelector('.goldpill-v')!.textContent).toBe(String(run.embers));
    expect(ui.container.querySelectorAll('.gt-row')[0]!.textContent).toBe(`Next turn${base.next + 5}`);
  });

  it("in a Duos fight only the player's own board counts", () => {
    const { events, at } = fightWithGold();
    expect(replayed(events, events.length, [0, at + 1]), 'own board ends after the max Gold').toEqual({ maxGold: 2, nextTurn: 0 });
    expect(replayed(events, events.length, [at + 1, Infinity]), 'the other board').toEqual({ maxGold: 0, nextTurn: 3 });
  });

  it('after settle the reading equals the real run state: no jump, no double count', () => {
    const { run, events } = fightWithGold();
    const all = replayed(events, events.length);
    const beforeSettle = goldForecastOf(run, liveCombatGold(run.phase, run.combatSettled, all));
    const settled = reduce(run, { type: 'settleCombat' } as Action);
    expect(settled.combatSettled).toBe(true);
    const afterSettle = goldForecastOf(settled, liveCombatGold(settled.phase, settled.combatSettled, all));
    expect(afterSettle).toEqual(beforeSettle);
    // Left-over Gold is untouched by the fight; and the next turn really opens with the forecast's Gold.
    expect(settled.embers).toBe(run.embers);
    const next = reduce(settled, { type: 'resolveCombat' } as Action);
    expect(next.phase).toBe('recruit');
    expect(next.embers).toBe(afterSettle.next);
  });
});
