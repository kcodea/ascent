// @vitest-environment jsdom
/**
 * FIGHT RECAP (owner ask 2026-09-24), rendered. Pins: empty sections HIDE (no "Stars of the fight" row with no
 * data, no "What you keep" and never the old "No lasting gains" line); Details is one drawer, closed by
 * default, holding Procs + Log; the Upset / Heartbreaker tag renders; Watch replay renders only when offered;
 * no `title=` anywhere (native tooltips are banned).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { CombatResult, MinionSnapshot } from '@game/core';
import { mount, type Mounted } from './renderedText.mount';
import { FightRecap, type FightRecapProps } from './FightRecap';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

const snap = (uid: string, name: string): MinionSnapshot =>
  ({ uid, cardId: `card_${uid}`, name, tribe: 'neutral', attack: 1, health: 1, keywords: [] } as MinionSnapshot);

const empty: CombatResult = {
  events: [], result: 'lose', playerDamage: 4, playerDeathrattles: 0, enemyDeaths: 0,
  initial: { player: [snap('p1', 'Brute')], enemy: [snap('e1', 'Foe')] },
};

const props = (over: Partial<FightRecapProps> = {}): FightRecapProps => ({
  result: 'lose', combatOdds: null, lastCombat: empty, lobby: undefined, wave: 3, mode: 'lobby' as FightRecapProps['mode'],
  procs: [{ text: '0 attacks', kind: 'total' }], fullLog: [], onClose: () => {}, ...over,
});

const text = (): string => ui!.container.textContent ?? '';
const click = (el: Element | null): void => { act(() => { (el as HTMLElement).click(); }); };

describe('FightRecap', () => {
  it('hides the Stars and What you keep sections when there is nothing to show', () => {
    ui = mount(<FightRecap {...props()} />);
    expect(text()).toContain('Defeat');
    expect(text()).toContain('Round 3');
    expect(text()).not.toContain('Stars of the fight');
    expect(text()).not.toContain('What you keep');
    expect(text()).not.toContain('No lasting gains');
    expect(ui.container.querySelector('[title]')).toBeNull();
  });

  it('shows the Stars and What you keep rows when the fight has them', () => {
    const r: CombatResult = {
      ...empty, result: 'win',
      events: [{ type: 'dmg', target: 'e1', amount: 6, remainingHp: 0, source: 'p1' }, { type: 'death', target: 'e1', side: 'enemy' }],
      playerFreeRolls: 2,
    };
    ui = mount(<FightRecap {...props({ result: 'win', lastCombat: r })} />);
    expect(text()).toContain('Stars of the fight');
    expect(text()).toContain('6 damage');
    expect(text()).toContain('1 kill');
    expect(text()).toContain('What you keep');
    expect(text()).toContain('Free rerolls');
  });

  it('keeps Procs + Log in one Details drawer, closed by default', () => {
    ui = mount(<FightRecap {...props()} />);
    const toggle = ui.container.querySelector('.fr-details-toggle');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(ui.container.querySelector('.fr-lines')).toBeNull();
    click(toggle);
    expect(ui.container.querySelector('.fr-details-toggle')?.getAttribute('aria-expanded')).toBe('true');
    expect(text()).toContain('0 attacks');
    click([...ui.container.querySelectorAll('[role="tab"]')].find((t) => t.textContent === 'Log') ?? null);
    expect(text()).toContain('No blows were struck.');
  });

  it('tags an upset and a heartbreaker from the odds', () => {
    ui = mount(<FightRecap {...props({ result: 'win', lastCombat: { ...empty, result: 'win' }, combatOdds: { win: 0.3, draw: 0, lose: 0.7, avgLossDamage: 4 } })} />);
    expect(text()).toContain('Upset!');
    expect(text()).toContain('You had a 30% chance to win');
    // The bar is always there, with all three numbers.
    expect(ui.container.querySelector('.fr-oddsbar')).not.toBeNull();
    expect(text()).toContain('30% Win');
    expect(text()).toContain('0% Draw');
    expect(text()).toContain('70% Loss');
    ui.render(<FightRecap {...props({ combatOdds: { win: 0.8, draw: 0, lose: 0.2, avgLossDamage: 4 } })} />);
    expect(text()).toContain('Heartbreaker');
  });

  it('offers Watch replay only when a replay is available', () => {
    ui = mount(<FightRecap {...props()} />);
    expect(text()).not.toContain('Watch replay');
    const onWatch = vi.fn();
    ui.render(<FightRecap {...props({ onWatchReplay: onWatch })} />);
    click([...ui.container.querySelectorAll('button')].find((b) => b.textContent?.includes('Watch replay')) ?? null);
    expect(onWatch).toHaveBeenCalledOnce();
  });
});
