// @vitest-environment jsdom
/**
 * THE OPPONENT'S HAND, face down (owner ask 2026-10-23, R-OPP-HAND-01). Pins:
 *   1. The count comes from the served board's recorded hand (minions + spells); an older board shows none.
 *   2. The plate: the foe's equipped card plate whole, else the standard plate (and the standard when opponent
 *      cosmetics are switched off).
 *   3. Mid-fight grants (enemy `toHand`) append in log order as the cursor reaches them, keyed by the event's uid when
 *      it carries one; the player's own grants never land here; a full hand takes nothing more.
 *   4. A copy summoned from a card greys it; a consuming summon removes it.
 *   5. Nothing about a hidden card reaches the DOM: no art, name, text, stats or card id.
 *   6. The foe's hand-summons fly from its face-down card (the 'enemy' source), lifting DOWN toward its board.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import type { CombatEvent } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createLobbyRun, type BoardSnapshot, type RunState } from '@game/sim';
import { mount, type Mounted } from './renderedText.mount';
import { OpponentHand, opponentHandSource } from './OpponentHand';
import { EMPTY_START_HAND, oppHandBackSrc, oppHandFan, oppStartHand, opponentHandCards } from './oppHandModel';
import { CARD_PLATE_LOOKS, cardPlateLookOf } from './cardPlate/cardPlateLook';
import { combatHandSummonOrigins, liftSign } from './handSummonFx';
import { useGame } from './store';

const HAND_MINIONS = [
  { uid: 'eh1', cardId: 'sp3_tidebud', attack: 3, health: 9, keywords: [], golden: false },
  { uid: 'eh2', cardId: 'sp3_kindled', attack: 2, health: 3, keywords: [], golden: false },
];
const toHand = (side: 'player' | 'enemy', cardId: string, uid?: string): CombatEvent =>
  ({ type: 'toHand', cardId, side, ...(uid ? { uid } : {}) }) as CombatEvent;
const summonFrom = (handUid: string, extra: Record<string, unknown> = {}): CombatEvent =>
  ({ type: 'summon', side: 'enemy', index: 0, minion: { uid: `b-${handUid}`, cardId: 'sp3_tidebud' }, fromHandUid: handUid, ...extra }) as unknown as CombatEvent;

describe('opponent hand model', () => {
  it('counts the recorded starting hand: minions then spells; an older board holds nothing', () => {
    const start = oppStartHand({ handMinions: HAND_MINIONS, handSpellIds: ['a', 'b', 'c'] });
    expect(start.minionUids).toEqual(['eh1', 'eh2']);
    expect(start.spells).toBe(3);
    const cards = opponentHandCards(start, [], 0, new Set());
    expect(cards.map((c) => c.key)).toEqual(['eh1', 'eh2', 's0', 's1', 's2']);
    expect(cards.every((c) => !c.spent && !c.grant)).toBe(true);
    expect(oppStartHand({})).toBe(EMPTY_START_HAND);
    expect(oppStartHand(undefined)).toBe(EMPTY_START_HAND);
  });

  it('appends enemy grants in log order as the cursor reaches them, never the player\'s, and caps a full hand', () => {
    const start = oppStartHand({ handMinions: HAND_MINIONS });
    const events = [toHand('enemy', 'heraldapoc', 'hg0'), toHand('player', 'heraldapoc', 'hg0'), toHand('enemy', 'ruby')];
    expect(opponentHandCards(start, events, 0, new Set())).toHaveLength(2);
    const one = opponentHandCards(start, events, 1, new Set());
    expect(one.map((c) => c.key)).toEqual(['eh1', 'eh2', 'hg0']);
    expect(one[2]!.grant).toBe(true);
    const all = opponentHandCards(start, events, 3, new Set());
    expect(all.map((c) => c.key)).toEqual(['eh1', 'eh2', 'hg0', 'g2']); // no uid: keyed by its log position
    expect(opponentHandCards(start, events, 3, new Set(), 3).map((c) => c.key)).toEqual(['eh1', 'eh2', 'hg0']);
  });

  it('greys a card a copy was summoned from, and removes one a consuming summon took', () => {
    const start = oppStartHand({ handMinions: HAND_MINIONS, handSpellIds: ['a'] });
    const grey = opponentHandCards(start, [summonFrom('eh2')], 1, new Set(['eh2']));
    expect(grey.map((c) => [c.key, c.spent])).toEqual([['eh1', false], ['eh2', true], ['s0', false]]);
    const gone = opponentHandCards(start, [summonFrom('eh1', { fromHandConsumed: true })], 1, new Set());
    expect(gone.map((c) => c.key)).toEqual(['eh2', 's0']);
    // A GRANTED card is summonable too (R-HAND-GRANT-SUMMON-01): it greys by its toHand uid.
    const granted = opponentHandCards(start, [toHand('enemy', 'sp3_kindled', 'hg0'), summonFrom('hg0')], 2, new Set(['hg0']));
    expect(granted.find((c) => c.key === 'hg0')?.spent).toBe(true);
  });

  it('wears the equipped plate whole, else the standard plate', () => {
    const look = cardPlateLookOf({ cardPlate: 'plate_galaxy' } as never);
    expect(look).toBe(CARD_PLATE_LOOKS.plate_galaxy);
    expect(oppHandBackSrc(look, 'std.webp')).toBe(CARD_PLATE_LOOKS.plate_galaxy!.thumb);
    expect(oppHandBackSrc(null, 'std.webp')).toBe('std.webp');
  });

  it('fans ten cards inside the span, centred, tilted symmetrically', () => {
    const o = { cardW: 62, maxSpan: 270, maxStep: 34, tiltDeg: 9, arcPx: 6 };
    const xs = Array.from({ length: 10 }, (_, i) => oppHandFan(i, 10, o));
    expect(xs[9]!.x - xs[0]!.x + o.cardW).toBeLessThanOrEqual(o.maxSpan + 1e-9);
    expect(xs[0]!.x).toBeCloseTo(-xs[9]!.x);
    expect(xs[0]!.rot).toBeCloseTo(-xs[9]!.rot);
    expect(oppHandFan(0, 1, o)).toEqual({ x: 0, y: 0, rot: 0 });
  });

  it('matches the foe\'s hand-summons to its hand card, and lifts them DOWN toward its board', () => {
    const origins = combatHandSummonOrigins([summonFrom('eh2')], HAND_MINIONS, 'enemy');
    expect(origins.get('b-eh2')).toBe('eh2');
    expect(combatHandSummonOrigins([summonFrom('eh2')], HAND_MINIONS).size).toBe(0); // the player side ignores it
    expect(liftSign('player')).toBe(1);
    expect(liftSign(undefined)).toBe(1);
    expect(liftSign('enemy')).toBe(-1);
  });
});

describe('OpponentHand (mounted)', () => {
  let ui: Mounted | null = null;
  afterEach(() => {
    act(() => { useGame.setState({ combatStaged: false, showOpponentSkins: true }); });
    ui?.unmount(); ui = null;
  });

  /** A lobby run in combat whose fight is against an authored board holding a hand (the Scene Builder's pin). */
  function stage(cosmetics?: { cardPlate: string }): RunState {
    const base = createLobbyRun(4242, 'warden');
    const snap = {
      v: 1, wave: base.wave, heroId: 'warden', resolve: 30, tier: 4, triples: 0, tribes: [], threat: 'glass', power: 10,
      minions: [{ cardId: 'sp3_seedling', attack: 2, health: 4, keywords: ['RL'] }], seed: 1, origin: 'self',
      handMinions: HAND_MINIONS, handSpellIds: ['x'], ...(cosmetics ? { cosmetics } : {}),
    } as unknown as BoardSnapshot;
    const run: RunState = { ...base, phase: 'combat', servedBoards: { ...(base.servedBoards ?? {}), [base.wave]: snap }, sandboxFoeWave: base.wave };
    act(() => { useGame.setState({ run, combatStaged: true, showOpponentSkins: true }); });
    return run;
  }
  const cardsEl = (): HTMLElement[] => [...document.body.querySelectorAll<HTMLElement>('.opphand > .opphand-card')];

  it('shows one face-down card per recorded hand card, with a count tip and no native tooltip', () => {
    stage();
    ui = mount(<OpponentHand events={[]} through={0} summoned={new Set()} live />);
    expect(cardsEl()).toHaveLength(3);
    const box = document.body.querySelector<HTMLElement>('.opphand')!;
    expect(box.getAttribute('data-tip')).toBe("Opponent's hand: 3 cards");
    expect(box.classList.contains('gtip')).toBe(true);
    expect(document.body.querySelector('.opphand [title]')).toBeNull();
    expect(box.hasAttribute('title')).toBe(false);
  });

  it('wears the foe\'s plate; the standard plate without one, or with opponent cosmetics off', () => {
    stage({ cardPlate: 'plate_galaxy' });
    ui = mount(<OpponentHand events={[]} through={0} summoned={new Set()} live />);
    const src = (): string => cardsEl()[0]!.querySelector('img')!.getAttribute('src')!;
    expect(src()).toBe(CARD_PLATE_LOOKS.plate_galaxy!.thumb);
    act(() => { useGame.setState({ showOpponentSkins: false }); });
    expect(src()).toMatch(/cardplate-standard\.webp$/);
    ui.unmount(); ui = null;
    stage();
    ui = mount(<OpponentHand events={[]} through={0} summoned={new Set()} live />);
    expect(src()).toMatch(/cardplate-standard\.webp$/);
  });

  it('appends a grant as the fight reaches it and greys a summoned-from card', () => {
    stage();
    const events = [toHand('enemy', 'heraldapoc', 'hg0'), summonFrom('eh1')];
    ui = mount(<OpponentHand events={events} through={0} summoned={new Set()} live />);
    expect(cardsEl()).toHaveLength(3);
    ui.render(<OpponentHand events={events} through={1} summoned={new Set()} live />);
    expect(cardsEl()).toHaveLength(4);
    ui.render(<OpponentHand events={events} through={2} summoned={new Set(['eh1'])} live />);
    expect(cardsEl().filter((el) => el.classList.contains('spent'))).toHaveLength(1);
    expect(cardsEl()[0]!.classList.contains('spent')).toBe(true);
  });

  it('leaks nothing about a hidden card into the DOM', () => {
    stage({ cardPlate: 'plate_galaxy' });
    const events = [toHand('enemy', 'heraldapoc', 'hg0')];
    ui = mount(<OpponentHand events={events} through={1} summoned={new Set()} live />);
    const html = document.body.querySelector('.opphand')!.outerHTML;
    for (const id of ['sp3_tidebud', 'sp3_kindled', 'heraldapoc']) {
      expect(html).not.toContain(id);
      expect(html).not.toContain(CARD_INDEX[id]!.name);
    }
    expect(html).not.toContain('eh1'); // not even the opaque hand uid: the source resolves through a map
    for (const el of cardsEl()) {
      expect(el.textContent).toBe('');
      const imgs = el.querySelectorAll('img');
      expect(imgs).toHaveLength(1);
      expect(imgs[0]!.getAttribute('src')).toBe(CARD_PLATE_LOOKS.plate_galaxy!.thumb);
      expect(el.querySelector('.desc, .cname, .art, .stat')).toBeNull();
    }
  });

  it('registers the face-down card as the foe\'s hand-summon origin', () => {
    stage();
    ui = mount(<OpponentHand events={[]} through={0} summoned={new Set()} live />);
    // jsdom has no layout: give the second card a box so the source can measure it.
    const el = cardsEl()[1]!;
    el.getBoundingClientRect = () => ({ left: 100, top: 50, width: 40, height: 62, right: 140, bottom: 112, x: 100, y: 50, toJSON: () => ({}) });
    const o = opponentHandSource('eh2');
    expect(o?.el).toBe(el);
    expect(o?.cx).toBe(120);
    expect(opponentHandSource('nope')).toBeNull();
  });

  it('draws nothing outside a staged fight, or for a foe with no recorded hand', () => {
    const run = stage();
    act(() => { useGame.setState({ combatStaged: false }); });
    ui = mount(<OpponentHand events={[]} through={0} summoned={new Set()} live />);
    expect(document.body.querySelector('.opphand')).toBeNull();
    ui.unmount(); ui = null;
    const snap = { ...run.servedBoards![run.wave]!, handMinions: undefined, handSpellIds: undefined };
    act(() => { useGame.setState({ run: { ...run, servedBoards: { [run.wave]: snap } }, combatStaged: true }); });
    ui = mount(<OpponentHand events={[]} through={0} summoned={new Set()} live />);
    expect(document.body.querySelector('.opphand')).toBeNull();
  });
});
