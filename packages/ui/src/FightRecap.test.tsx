// @vitest-environment jsdom
/**
 * FIGHT RECAP (owner ask 2026-09-24, condensed 2026-09-25), rendered. Pins: no Stars of the fight section at
 * all; ONE damage line (You dealt on a win, You took on a loss); the Fight outcome odds title with the average
 * win / loss damage flanking the bar; empty sections HIDE (no "What you keep" and never the old "No lasting
 * gains" line); Details is one drawer, closed by
 * default, holding Procs + Log; the Upset / Heartbreaker tag renders; Watch replay renders only when offered;
 * no `title=` anywhere (native tooltips are banned).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { CombatResult, MinionSnapshot } from '@game/core';
import { createLobbyRun, getHero, playerOpponent } from '@game/sim';
import { mount, type Mounted } from './renderedText.mount';
import { FightRecap, type FightRecapProps } from './FightRecap';

/** Stage 1 wears a portrait card and stage 2 has none, regardless of what the shipped stage files carry (the test owns its fixture). */
vi.mock('@game/content', async (importOriginal) => {
  const m = await importOriginal<typeof import('@game/content')>();
  return {
    ...m,
    gauntletStage: (n: number) => {
      const s = m.gauntletStage(n);
      if (n === 1) return { ...s!, portraitCardId: 'dm_grobbus' };
      if (n === 2) return { ...s!, portraitCardId: undefined }; // stage 2 has no portrait card -> tribe-emblem fallback
      return s;
    },
  };
});

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
  it('hides What you keep when there is nothing to show, and shows ONE damage line', () => {
    ui = mount(<FightRecap {...props()} />);
    expect(text()).toContain('Defeated by:');
    expect(text()).toContain('Round 3');
    expect(ui.container.querySelectorAll('.fr-dmgline')).toHaveLength(1);
    expect(ui.container.querySelector('.fr-dmgline.taken')?.textContent).toBe('You took4');
    expect(text()).not.toContain('Armor');
    expect(text()).not.toContain('You dealt');
    expect(text()).not.toContain('What you keep');
    expect(text()).not.toContain('No lasting gains');
    expect(ui.container.querySelector('[title]')).toBeNull();
  });

  it('never shows Stars of the fight; a win shows You dealt; What you keep shows when the fight has it', () => {
    const r: CombatResult = {
      ...empty, result: 'win', enemyDamage: 5,
      events: [{ type: 'dmg', target: 'e1', amount: 6, remainingHp: 0, source: 'p1' }, { type: 'death', target: 'e1', side: 'enemy' }],
      playerFreeRolls: 2,
    };
    ui = mount(<FightRecap {...props({ result: 'win', lastCombat: r })} />);
    expect(text()).not.toContain('Stars of the fight');
    expect(text()).toContain('Won against:');
    expect(ui.container.querySelector('.fr-dmgline.dealt')?.textContent).toBe('You dealt5');
    expect(text()).not.toContain('You took');
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
    ui = mount(<FightRecap {...props({ result: 'win', lastCombat: { ...empty, result: 'win' }, combatOdds: { win: 0.3, draw: 0, lose: 0.7, avgLossDamage: 4, avgWinDamage: 6.2 } })} />);
    expect(text()).toContain('Upset!');
    expect(text()).toContain('Fight outcome odds');
    expect(text()).not.toContain('chance to win');
    expect(text()).not.toContain('usually costs');
    // The average damage flanks the bar: a win's on the left, a loss's on the right.
    expect(ui.container.querySelector('.fr-odds-dmg.win .fr-odds-dmg-num')?.textContent).toBe('6');
    expect(ui.container.querySelector('.fr-odds-dmg.lose .fr-odds-dmg-num')?.textContent).toBe('4');
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

describe('FightRecap vs the Gauntlet opponent (invulnerable, R-GAUNTLET-02)', () => {
  const winFight: CombatResult = { ...empty, result: 'win', enemyDamage: 5 };
  const odds = { win: 0.6, draw: 0, lose: 0.4, avgLossDamage: 3, avgWinDamage: 5 };
  const gauntletLobby = () => {
    const lobby = createLobbyRun(11, 'aster', {}, 'lobby').lobby!;
    const foe = playerOpponent(lobby)!;
    foe.seat.invulnerable = true;
    foe.seat.label = 'The Demon Host';
    return { lobby, heroName: getHero(foe.seat.heroId)?.name };
  };

  it('never shows damage dealt, nor an average dealt, and wears the stage tribe emblem with no hero name', () => {
    const { lobby, heroName } = gauntletLobby();
    ui = mount(<FightRecap {...props({ result: 'win', lastCombat: winFight, combatOdds: odds, lobby, mode: 'gauntlet', gauntletStage: 2 })} />);
    expect(text()).toContain('Won against:');
    expect(text()).toContain('The Demon Host');
    expect(text()).not.toContain('You dealt');
    expect(ui.container.querySelector('.fr-dmgline.zero')?.textContent).toBe('No damage');
    expect(text()).not.toContain('avg dealt');
    expect(text()).toContain('avg taken');
    expect(ui.container.querySelector('.fr-foe-pic img')).toBeNull();
    expect(ui.container.querySelector('.fr-foe-pic .fr-foe-emblem svg')).not.toBeNull();
    expect(ui.container.querySelector('.fr-foe-hero')).toBeNull();
    if (heroName) expect(text()).not.toContain(heroName);
  });

  it('a stage with a portrait card shows that card art in the foe disc instead of the emblem', () => {
    const { lobby } = gauntletLobby();
    ui = mount(<FightRecap {...props({ result: 'win', lastCombat: winFight, combatOdds: odds, lobby, mode: 'gauntlet', gauntletStage: 1 })} />);
    const img = ui.container.querySelector<HTMLImageElement>('.fr-foe-pic img.fr-foe-cardart')!;
    expect(img).not.toBeNull();
    expect(img.getAttribute('decoding')).toBe('sync');
    expect(ui.container.querySelector('.fr-foe-emblem')).toBeNull();
  });

  it('a lobby foe is unchanged: its portrait, hero name, You dealt and avg dealt all show', () => {
    const lobby = createLobbyRun(11, 'aster', {}, 'lobby').lobby!;
    const heroName = getHero(playerOpponent(lobby)!.seat.heroId)?.name;
    ui = mount(<FightRecap {...props({ result: 'win', lastCombat: winFight, combatOdds: odds, lobby, mode: 'lobby' })} />);
    expect(ui.container.querySelector('.fr-dmgline.dealt')?.textContent).toBe('You dealt5');
    expect(text()).toContain('avg dealt');
    expect(ui.container.querySelector('.fr-foe-emblem')).toBeNull();
    if (heroName) expect(ui.container.querySelector('.fr-foe-hero')?.textContent).toBe(heroName);
  });
});
