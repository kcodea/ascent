// @vitest-environment jsdom
/**
 * GRANTED RISE prints in the card text (owner ask 2026-09-26: "do you think we should add Rise as text when a
 * minion is given it? i think so"). A minion that HAS Rise right now but whose printed card does not leads its
 * text ending "**Rise.**", on the shop/board/hand chain (`liveCardText` via `instView`) AND in combat (`Unit`).
 * A printed Rise is never doubled, and a spent Rise (the body already Rose) drops it again.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { act } from 'react';
import type { Keyword } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun, type BoardCard, type RunState } from '@game/sim';
import { Unit } from './Unit';
import { instView, liveCardText } from './instView';
import { withGrantedRise } from './cardText';
import { useGame } from './store';
import { descTextOf, mount, plainOf } from './renderedText.mount';

const base = { tier: 1, golden: false, spellBonus: 0, spellBonusH: 0, frontToBackBonus: 0, spellsThisTurn: 0, spellsCast: 0, deathrattlesTriggered: 0, undeadBuyAtk: 0, soulsmanGold: 0 };
const SWARM = CARD_INDEX['deathswarmer']!;

const instOf = (id: string, keywords: Keyword[], golden = false): BoardCard => ({
  uid: `u-${id}`, cardId: id, tribe: CARD_INDEX[id]!.tribe,
  attack: CARD_INDEX[id]!.attack, health: CARD_INDEX[id]!.health, keywords, golden,
});

describe('granted Rise — the text helper', () => {
  it('a minion GIVEN Rise ends its text with **Rise.**', () => {
    expect(liveCardText('deathswarmer', { ...base, keywords: ['R'] }).text).toBe(`${SWARM.text} **Rise.**`);
  });

  it('golden too: the golden variant carries it', () => {
    const t = liveCardText('deathswarmer', { ...base, golden: true, keywords: ['R'] });
    expect(t.goldenText).toBe(`${SWARM.goldenText} **Rise.**`);
  });

  it('a card with no printed text reads just **Rise.**', () => {
    expect(CARD_INDEX['drone']!.text).toBe('');
    expect(liveCardText('drone', { ...base, keywords: ['DS', 'R'] }).text).toBe('**Rise.**');
  });

  it('a printed Rise is not doubled', () => {
    for (const id of ['u3_poochy']) {
      const printed = CARD_INDEX[id]!.text;
      expect(liveCardText(id, { ...base, keywords: ['T', 'R'] }).text, id).toBe(printed);
    }
    expect(withGrantedRise('u3_poochy', '**Taunt. Rise.**', ['T', 'R'])).toBe('**Taunt. Rise.**');
  });

  it('no Rise (never given, or already spent) prints the plain text', () => {
    expect(liveCardText('deathswarmer', { ...base, keywords: [] }).text).toBe(SWARM.text);
    expect(liveCardText('deathswarmer', base).text).toBe(SWARM.text);
  });

  it('the board chain (instView) reads the instance keywords', () => {
    const run = createRun(21, 'drakko');
    const given = instView(instOf('deathswarmer', ['R']), run.tier);
    expect(given.text).toBe(`${SWARM.text} **Rise.**`);
    const plain = instView(instOf('deathswarmer', []), run.tier);
    expect(plain.text).toBe(SWARM.text);
  });
});

describe('granted Rise — the combat chain (Unit)', () => {
  const m = mount(<div />);
  afterEach(() => { m.render(<div />); });

  const unitOf = (keywords: Keyword[]) => ({
    uid: 'u-swarm', cardId: 'deathswarmer', name: SWARM.name, tribe: SWARM.tribe, attack: SWARM.attack, health: SWARM.health,
    keywords, divineShield: false, alive: true, golden: false, summonBonus: 0,
    baseAttack: SWARM.attack, baseHealth: SWARM.health,
  });

  it('prints Rise while the body has it, and drops it once spent', () => {
    const run = { ...createRun(21, 'drakko') } as RunState;
    act(() => { useGame.setState({ run, compactCards: false }); });
    m.render(<Unit u={unitOf(['R'])} side="you" />);
    expect(descTextOf(m.container)).toBe(plainOf(`${SWARM.text} **Rise.**`));
    // Rose: the snapshot loses R, the memo comparator sees new keywords, the text follows.
    m.render(<Unit u={unitOf([])} side="you" />);
    expect(descTextOf(m.container)).toBe(plainOf(SWARM.text));
    // Regained (Ancient of Death): back again.
    m.render(<Unit u={unitOf(['R'])} side="you" />);
    expect(descTextOf(m.container)).toBe(plainOf(`${SWARM.text} **Rise.**`));
  });
});
