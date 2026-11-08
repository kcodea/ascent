// @vitest-environment jsdom
/**
 * R-MATCH-SHOPBUFF-01 (owner 2026-11-08): a game in Match History has a button that shows the Shop buffs the player had when
 * it ended: the total every bought minion got, then each source, biggest first. The final board snapshot carries them
 * (`shopBuffSnapshotOf`), always stamped, so a recorded game with none says so.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { shopBuffSnapshotOf } from '@game/sim';
import { ShopBuffButton } from './gameView';
import { mount, type Mounted } from '../../renderedText.mount';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });
const press = (el: Element | null): void => { act(() => { (el as HTMLButtonElement).click(); }); };
const rows = (): string[] => [...document.querySelectorAll('.rgp-sbrow')].map((r) => r.textContent ?? '');

describe('the snapshot records the Shop buffs', () => {
  it('stamps the total and each source, biggest first', () => {
    const snap = shopBuffSnapshotOf({ tavernBuyBonus: { atk: 5, hp: 4 }, tavernBuyBonusSources: { 'Staff of Guel': { atk: 1, hp: 1 }, 'Contract Butcher': { atk: 4, hp: 3 } } });
    expect(snap).toEqual({ attack: 5, health: 4, sources: [{ source: 'Contract Butcher', attack: 4, health: 3 }, { source: 'Staff of Guel', attack: 1, health: 1 }] });
  });
  it('stamps 0/0 with no sources when there was none', () => {
    expect(shopBuffSnapshotOf({ tavernBuyBonus: { atk: 0, hp: 0 } })).toEqual({ attack: 0, health: 0 });
  });
});

describe('the Shop buffs button', () => {
  it('opens a plate with the total, then each source', () => {
    ui = mount(<ShopBuffButton who="Lemon" buff={{ attack: 5, health: 4, sources: [{ source: 'Contract Butcher', attack: 4, health: 3 }, { source: 'Staff of Guel', attack: 1, health: 1 }] }} />);
    const btn = document.querySelector('.rgp-shopbuff button');
    expect(btn?.textContent).toBe('Shop buffs+5/+4');
    expect(document.querySelector('.rgp-sbpanel')).toBeNull();
    press(btn);
    expect(rows()).toEqual(['Every minion bought from the Shop+5/+4', 'Contract Butcher+4/+3', 'Staff of Guel+1/+1']);
    press(btn);
    expect(document.querySelector('.rgp-sbpanel')).toBeNull();
  });
  it('says so when the game had no Shop buffs', () => {
    ui = mount(<ShopBuffButton who="Lemon" buff={{ attack: 0, health: 0 }} />);
    press(document.querySelector('.rgp-shopbuff button'));
    expect(document.querySelector('.rgp-sbnone')?.textContent).toBe('No Shop buffs this game.');
  });
});
