import { describe, it, expect } from 'vitest';
import { CARD_INDEX, QUEST_INDEX, RUNE_INDEX } from '@game/content';
import { createRun, reduce, type RunState } from './index';

/**
 * The `devGrant` action backs the Scene Builder's Quests / Runes libraries: drop a quest (optionally already
 * completed) or a rune into the run without playing to the turn that offers it.
 *
 * The contract worth pinning is that it goes through the REAL reward engine rather than faking state — that
 * is the whole reason the rig is useful. If a granted reward stopped conjuring cards, opening its Discover or
 * registering ownership, the sandbox would be testing a mock of the interaction instead of the interaction.
 */
const base = (): RunState => ({ ...createRun(1, 'warden'), phase: 'recruit', hand: [], board: [] });

describe('devGrant: quests', () => {
  it('completing a quest fills its bar and pays the reward', () => {
    // Blood Trail's reward is a combat flag — a clean, observable payout with no RNG.
    const def = QUEST_INDEX['q_blood_trail']!;
    const s = reduce(base(), { type: 'devGrant', kind: 'quest', id: 'q_blood_trail' });
    const q = s.activeQuests?.find((a) => a.questId === 'q_blood_trail');
    expect(q).toBeDefined();
    expect(q!.completed).toBe(true);
    expect(q!.progress).toBe(def.objective.count); // bar full, as a real completion leaves it
    expect(q!.completionCount).toBe(1);
    expect(s.questFlags?.bloodTrail).toBeTruthy(); // the reward actually applied
  });

  it('adds a quest un-started when completed:false, with no reward', () => {
    const s = reduce(base(), { type: 'devGrant', kind: 'quest', id: 'q_blood_trail', completed: false });
    const q = s.activeQuests?.find((a) => a.questId === 'q_blood_trail');
    expect(q!.completed).toBe(false);
    expect(q!.progress).toBe(0);
    expect(s.questFlags?.bloodTrail).toBeFalsy(); // not completed → not paid
  });

  it('a REPEATABLE quest re-arms rather than freezing done', () => {
    // Forest Grove is repeatable: a real completion bumps completionCount but never sets `completed`,
    // or it could never fire again. The grant must mirror that, not stamp it finished.
    expect(QUEST_INDEX['q_forest_grove']!.repeatable).toBe(true);
    const s = reduce(base(), { type: 'devGrant', kind: 'quest', id: 'q_forest_grove' });
    const q = s.activeQuests?.find((a) => a.questId === 'q_forest_grove');
    expect(q!.completed).toBe(false);
    expect(q!.completionCount).toBe(1);
    expect(s.hand.length).toBeGreaterThan(0); // its grant reward conjured a Beast
  });

  it('ignores an unknown quest id', () => {
    const before = base();
    expect(reduce(before, { type: 'devGrant', kind: 'quest', id: 'nope' })).toBe(before);
  });
});

describe('devGrant: runes', () => {
  it('grants ownership and applies the rune reward', () => {
    const s = reduce(base(), { type: 'devGrant', kind: 'rune', id: 'rune_warding' });
    expect(s.ownedRunes).toContain('rune_warding');
    expect(RUNE_INDEX['rune_warding']).toBeDefined();
  });

  it('is free — unlike the Runeforge, it never charges Gold', () => {
    const before = base();
    const s = reduce(before, { type: 'devGrant', kind: 'rune', id: 'rune_warding' });
    expect(s.embers).toBe(before.embers);
  });

  it('ignores an unknown rune id', () => {
    const before = base();
    expect(reduce(before, { type: 'devGrant', kind: 'rune', id: 'nope' })).toBe(before);
  });
});

describe('devGrant works while a modal owns the screen', () => {
  it('is not swallowed by the modal action gate', () => {
    // The Scene Builder must stay responsive with an overlay up; every other board action is blocked there.
    const s = reduce({ ...base(), questOffer: ['q_blood_trail'] }, { type: 'devGrant', kind: 'rune', id: 'rune_warding' });
    expect(s.ownedRunes).toContain('rune_warding');
    expect(s.questOffer).toEqual(['q_blood_trail']); // the open modal is left alone
  });
});

// ── RUNE OF THE LONG SHIFT ───────────────────────────────────────────────────────────────────────────────────
// Owner reword 2026-08-17: "Discover 2 Shop Spells. Repeat every start of turn." The first pair now fires the
// moment you take the rune — before, a 2-cost epic did nothing at all until the following turn.
describe('Rune of the Long Shift — the first pair is immediate, then it repeats', () => {
  const grant = () => reduce(base(), { type: 'devGrant', kind: 'rune', id: 'rune_long_shift' });

  it('taking it queues two Shop-spell Discovers straight away', () => {
    const s = grant();
    expect(s.runeLongShift, 'the repeat flag must still be armed').toBe(true);
    // The first Discover is already OPEN (a list of offered card ids) and the second waits in the queue.
    expect(s.discover?.length, 'the first Discover should be open, not merely queued').toBeGreaterThan(0);
    for (const id of s.discover ?? []) expect(CARD_INDEX[id]?.spell, `${id} should be a spell`).toBe(true);
    expect(s.discoverQueue ?? [], 'the second Discover waits behind the first').toEqual([{ kind: 'spell' }]);
  });

  it('the text says what it does', () => {
    expect(RUNE_INDEX['rune_long_shift']!.text).toBe('Discover **2 Shop Spells**. Repeat every **Start of Turn**.');
  });
});
