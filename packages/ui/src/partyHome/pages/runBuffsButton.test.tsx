// @vitest-environment jsdom
/**
 * R-MATCH-SHOPBUFF-01 (owner 2026-11-08, widened 2026-11-16): a game in Match History has a Buffs button that shows EVERY
 * run-wide buff the player had when it ended: the rows the in-game Buffs panel shows (Spell power, Ruby power, the Auras,
 * Shop Stats and its sources, Max Gold...). The final board snapshot stamps them from the panel's own gatherer
 * (`gatherRunBuffs`), always, so a recorded game with none says so. An older board shows what it did store.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { snapshotBoard, createRun, gatherRunBuffs, shopBuffSnapshotOf, type BoardSnapshot } from '@game/sim';
import { RunBuffsButton } from './gameView';
import { finalBoardBuffs } from '../../runBuffs';
import { mount, type Mounted } from '../../renderedText.mount';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });
const press = (el: Element | null): void => { act(() => { (el as HTMLButtonElement).click(); }); };
const rows = (): string[] => [...document.querySelectorAll('.rgp-sbrow')].map((r) => r.textContent ?? '');

describe('the snapshot records every run-wide buff', () => {
  it('stamps the same rows the in-game Buffs panel shows', () => {
    const run = {
      ...createRun(7),
      rubyBonus: { attack: 3, health: 2 },
      clueBonus: 2,
      tavernBuyBonus: { atk: 5, hp: 4 },
      tavernBuyBonusSources: { 'Staff of Guel': { atk: 1, hp: 1 }, 'Contract Butcher': { atk: 4, hp: 3 } },
      rightmostSlotBuff: { attack: 6, health: 6 },
      soulsmanGold: 3,
    };
    const snap = snapshotBoard(run);
    expect(snap.runBuffs).toEqual(gatherRunBuffs(run));
    const labels = (snap.runBuffs ?? []).map((r) => `${r.label} ${r.value}`);
    expect(labels).toEqual(expect.arrayContaining(['Ruby power +3/+2', 'Clue power +2/+2', 'Shop Stats +5/+4', 'Contract Butcher +4/+3', 'Right-most Shop slot +6/+6', 'Max Gold +3']));
    expect(finalBoardBuffs(snap)).toBe(snap.runBuffs);
  });
  it('stamps an empty list when there was none', () => {
    const snap = snapshotBoard(createRun(7));
    expect(snap.runBuffs).toEqual(gatherRunBuffs(createRun(7)));
  });
  it('still stamps the Shop buff total and each source, biggest first', () => {
    const snap = shopBuffSnapshotOf({ tavernBuyBonus: { atk: 5, hp: 4 }, tavernBuyBonusSources: { 'Staff of Guel': { atk: 1, hp: 1 }, 'Contract Butcher': { atk: 4, hp: 3 } } });
    expect(snap).toEqual({ attack: 5, health: 4, sources: [{ source: 'Contract Butcher', attack: 4, health: 3 }, { source: 'Staff of Guel', attack: 1, health: 1 }] });
  });
});

describe('an older recorded board', () => {
  const old = (extra: Partial<BoardSnapshot>): BoardSnapshot => ({ ...snapshotBoard(createRun(7)), runBuffs: undefined, shopBuff: undefined, ...extra });
  it('shows the buffs it did store: the combat ones and the Shop buff', () => {
    const got = finalBoardBuffs(old({ spellPower: { attack: 2, health: 1 }, rubyBonus: { attack: 3, health: 3 }, shopBuff: { attack: 5, health: 4, sources: [{ source: 'Contract Butcher', attack: 5, health: 4 }] } }));
    expect(got?.map((r) => `${r.label} ${r.value}`)).toEqual(['Spell power +2/+1', 'Ruby power +3/+3', 'Shop Stats +5/+4', 'Contract Butcher +5/+4']);
  });
  it('has no button when nothing was recorded', () => {
    expect(finalBoardBuffs(old({}))).toBeNull();
    expect(finalBoardBuffs(null)).toBeNull();
  });
});

describe('the Buffs button', () => {
  it('opens a plate with one row per buff', () => {
    ui = mount(<RunBuffsButton who="Lemon" rows={[{ key: 'spell', label: 'Spell power', value: '+2/+1' }, { key: 'ruby', label: 'Ruby power', value: '+3/+3' }, { key: 'tavern', label: 'Shop Stats', value: '+5/+4' }, { key: 'tavern:Contract Butcher', label: 'Contract Butcher', value: '+5/+4' }]} />);
    const btn = document.querySelector('.rgp-shopbuff button');
    expect(btn?.textContent).toBe('Show Buffs');
    expect(document.querySelector('.rgp-sbpanel')).toBeNull();
    press(btn);
    expect(rows()).toEqual(['Spell power+2/+1', 'Ruby power+3/+3', 'Shop Stats+5/+4', 'Contract Butcher+5/+4']);
    press(btn);
    expect(document.querySelector('.rgp-sbpanel')).toBeNull();
  });
  it('says so when the game had no buffs', () => {
    ui = mount(<RunBuffsButton who="Lemon" rows={[]} />);
    press(document.querySelector('.rgp-shopbuff button'));
    expect(document.querySelector('.rgp-sbnone')?.textContent).toBe('No buffs this game.');
  });
});
