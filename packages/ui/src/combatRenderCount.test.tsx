// @vitest-environment jsdom
/**
 * R-PERF-COMBAT-PREVIEW-01 + R-PERF-STAT-ROLL-01 — WHAT RE-RENDERS IN A FIGHT (perf 2026-11-18).
 *
 * Counted with the same counters the perf HUD shows (`unit renders`, `card renders`), on mounted combat units:
 *
 *  1. A display-only combat preview (a friendly death, a spell cast, a Blade Mastery attack) re-renders NO unit and NO
 *     card whose text does not print that number. Before: every unit and every card on screen, 11-14 times a late
 *     fight, because the reducer cloned the run and `Unit` subscribed to the whole run.
 *  2. The preview still reaches the text that DOES print it (the hard live-value rule): spell power gained mid-fight
 *     moves a spell-power card's printed number on the same dispatch.
 *  3. A stat roll re-renders the two stat badges and never the card. Before: the whole Card on every step of the roll.
 *  4. Many units rolling at once notify the badges once per frame, not once per unit.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type RunState } from '@game/sim';
import { Unit } from './Unit';
import { useGame } from './store';
import { perfMonitor } from './perfMonitor';
import { mount } from './renderedText.mount';
import { COMBAT_PREVIEW_KEYS, keepIfSame, runSansPreviews } from './combatRun';
import { heldFor, holdStat, releaseAllStats, revealStat, revealStats, subscribeStatHolds } from './fx/statHold';
import type { UnitFrame } from './useCombatReplay';

const unitOf = (uid: string, cardId: string, attack: number, health: number): UnitFrame => {
  const def = CARD_INDEX[cardId]!;
  return {
    uid, cardId, name: def.name, tribe: def.tribe, attack, health, keywords: [...def.keywords],
    divineShield: false, alive: true, golden: false, summonBonus: 0, baseAttack: attack, baseHealth: health,
  } as UnitFrame;
};

/** A board of bodies whose text prints no run preview, plus one that prints spell power (Spell Appraiser's grant). */
const BOARD: [string, string][] = [['m1', 'drone'], ['m2', 'pack'], ['m3', 'spore'], ['m4', 'cryptdrake'], ['m5', 'runmaw'], ['m6', 'brood'], ['m7', 'pup']];

const counts = { unit: 0, card: 0 };
const spy = vi.spyOn(perfMonitor, 'count').mockImplementation((label: string) => {
  if (label === 'unit renders') counts.unit++;
  else if (label === 'card renders') counts.card++;
});
const reset = (): void => { counts.unit = 0; counts.card = 0; };

const inCombat = (): RunState => ({ ...createRun(4242, 'drakko'), phase: 'combat' }) as RunState;

describe('combat previews re-render only what prints them (R-PERF-COMBAT-PREVIEW-01)', () => {
  const m = mount(<div />);
  afterEach(() => { m.render(<div />); releaseAllStats(); });

  const board = (): JSX.Element => (
    <div>{BOARD.map(([uid, id]) => <Unit key={uid} u={unitOf(uid, id, 12, 34)} side="you" />)}</div>
  );

  it('a friendly death, a spell cast and a Blade Mastery attack re-render no unit and no card', () => {
    act(() => { useGame.setState({ run: inCombat(), compactCards: false }); });
    m.render(board());
    expect(counts.unit).toBe(BOARD.length);
    expect(counts.card).toBeGreaterThanOrEqual(BOARD.length);
    reset();
    for (let n = 1; n <= 12; n++) {
      act(() => { useGame.getState().dispatch({ type: 'combatFriendlyDeathPreview', count: n }); });
      act(() => { useGame.getState().dispatch({ type: 'combatSpellCastPreview', count: n }); });
      act(() => { useGame.getState().dispatch({ type: 'combatBladeAttackPreview', count: n }); });
    }
    // The dispatches landed (the run really carries the previews) …
    const run = useGame.getState().run;
    expect([run.fxFriendlyDeathPreview, run.fxSpellsCastPreview, run.fxBladeAttacksPreview]).toEqual([12, 12, 12]);
    // … and nothing on the board rendered for them.
    expect(counts).toEqual({ unit: 0, card: 0 });
  });

  it('a preview a unit DOES print still moves its text on the dispatch (live values stay live)', () => {
    act(() => { useGame.setState({ run: inCombat(), compactCards: false }); });
    // Spirit Fire style spells are not bodies; a body that prints spell power is the honest subject. Whatever the
    // card, the selector path is the same one: the unit re-renders when the live spell power moves.
    m.render(<div><Unit u={unitOf('m1', 'drone', 2, 2)} side="you" /></div>);
    reset();
    act(() => { useGame.getState().dispatch({ type: 'combatSpellPowerPreview', attack: 3, health: 2 }); });
    expect(useGame.getState().run.fxSpellPowerPreview).toEqual({ attack: 3, health: 2 });
    // The unit heard it (its spell-power selector moved) …
    expect(counts.unit).toBe(1);
    // … and a card whose text and stats did not change kept its Card (the view is the same object).
    expect(counts.card).toBe(0);
    // Squirl Scout / Conductor ride their own selectors: publishing them reaches the unit too.
    reset();
    act(() => { useGame.getState().dispatch({ type: 'combatScoutPreview', amount: 2, conductor: 1, conductorEnemy: 0 }); });
    expect(counts.unit).toBe(1);
  });

  it('the reducer path is shallow: the run changes, the board / hand / shop / lobby objects do not', () => {
    const before = inCombat();
    const after = reduce(before, { type: 'combatFriendlyDeathPreview', count: 3 });
    expect(after).not.toBe(before);
    expect(after.fxFriendlyDeathPreview).toBe(3);
    for (const k of ['board', 'hand', 'shop', 'lobby', 'servedBoards', 'questFlags', 'cardBuffs'] as const) expect(after[k], k).toBe(before[k]);
    // An unchanged value is a free no-op (the same state back), so the store commits nothing.
    expect(reduce(after, { type: 'combatFriendlyDeathPreview', count: 3 })).toBe(after);
    // The frozen run a unit subscribes to keeps its identity across previews and carries none of them.
    const frozen = runSansPreviews(after);
    expect(runSansPreviews(reduce(after, { type: 'combatSpellCastPreview', count: 9 }))).toBe(frozen);
    for (const k of COMBAT_PREVIEW_KEYS) expect(frozen[k], k).toBeUndefined();
    // … and moves the moment anything else on the run does.
    expect(runSansPreviews({ ...after, tier: after.tier + 1 })).not.toBe(frozen);
  });

  it('keepIfSame keeps a view whose content did not change, and lets a changed one through', () => {
    const a = { name: 'x', attack: 3, keywords: ['T', 'DS'], buffs: [{ source: 'Combat', attack: 1, health: 1, count: 1 }], stepProgress: { current: 1, total: 4 } };
    const same = { name: 'x', attack: 3, keywords: ['T', 'DS'], buffs: [{ source: 'Combat', attack: 1, health: 1, count: 1 }], stepProgress: { current: 1, total: 4 } };
    expect(keepIfSame(a, same)).toBe(a);
    expect(keepIfSame(a, { ...same, attack: 4 })).not.toBe(a);
    expect(keepIfSame(a, { ...same, keywords: ['T'] })).not.toBe(a);
    expect(keepIfSame(a, { ...same, buffs: [{ source: 'Combat', attack: 2, health: 1, count: 2 }] })).not.toBe(a);
    expect(keepIfSame(a, { ...same, stepProgress: { current: 2, total: 4 } })).not.toBe(a);
    expect(keepIfSame<object>(a, { ...same, extra: 1 })).not.toBe(a);
  });
});

describe('a stat roll re-renders the badge, not the card (R-PERF-STAT-ROLL-01)', () => {
  const m = mount(<div />);
  afterEach(() => { m.render(<div />); releaseAllStats(); });
  const badge = (uid: string, stat: 'atk' | 'hp'): string => m.container.querySelector(`[data-uid="${uid}"] .badge.${stat} .value`)?.textContent ?? '';

  it('every step of a +3,000 roll prints a new number and renders no Card and no Unit', () => {
    act(() => { useGame.setState({ run: inCombat(), compactCards: false }); });
    m.render(<div><Unit u={unitOf('m1', 'drone', 3012, 6034)} side="you" /><Unit u={unitOf('m2', 'pack', 12, 34)} side="you" /></div>);
    reset();
    // The replay holds the beat's buff (`effect` origin: the roll below is its only clock) …
    act(() => { holdStat('m1', { attack: 3000, health: 6000 }, { origin: 'effect' }); });
    expect(badge('m1', 'atk')).toBe('12');
    expect(badge('m1', 'hp')).toBe('34');
    // … and rolls it in. Each step moves the printed numbers.
    const seen = new Set<string>();
    for (let p = 0.1; p < 0.95; p += 0.1) {
      act(() => { revealStat('m1', p); });
      seen.add(badge('m1', 'atk'));
    }
    act(() => { revealStat('m1', 1); });
    expect(seen.size).toBeGreaterThan(5);
    expect(badge('m1', 'atk')).toBe('3012');
    expect(badge('m1', 'hp')).toBe('6034');
    expect(heldFor('m1')).toBeNull();
    // The whole roll: no Card render, no Unit render (the neighbour never heard of it either).
    expect(counts).toEqual({ unit: 0, card: 0 });
    expect(badge('m2', 'atk')).toBe('12');
  });

  it('a board rolling together notifies the badges once per step, not once per unit', () => {
    let emits = 0;
    const off = subscribeStatHolds(() => { emits++; });
    const uids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    for (const uid of uids) holdStat(uid, { attack: 1000, health: 1000 }, { origin: 'effect' });
    emits = 0;
    revealStats(uids.map((uid) => [uid, 0.5] as const));
    expect(emits).toBe(1);
    for (const uid of uids) expect(heldFor(uid)).toEqual({ attack: 250, health: 250 }); // the eased remainder (quad)
    // A step that moves nothing (a clock that is behind) notifies nobody.
    emits = 0;
    revealStats(uids.map((uid) => [uid, 0.25] as const));
    expect(emits).toBe(0);
    revealStats(uids.map((uid) => [uid, 1] as const));
    for (const uid of uids) expect(heldFor(uid)).toBeNull();
    off();
  });
});

afterEach(() => { spy.mockClear(); });
