import { describe, it, expect } from 'vitest';
import { simulate, makeRng, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { compileMoments } from '../choreo/compile';
import { adaptCombatMoments, FAMILY_BY_MOMENT } from './adapters/combatMomentAdapter';
import { compileTimeline } from './compileTimeline';
import type { MomentKind } from '../choreo/kinds';

/**
 * BEAT CHOREOGRAPHER PR 16 — the combat adapter, over REAL simulated combat.
 *
 * The adapter is read-only by design (blueprint §17): combat keeps its own runtime, and this only
 * re-describes moments that already happened so they can be inspected on the same timeline as End of Turn.
 * The tests therefore assert two things above all — that it faithfully mirrors the moment stream, and that it
 * does NOT invent the identity gameplay hasn't stamped (the trap PR 1 closed).
 */
const m = (uid: string, cardId: string, attack: number, health: number): BoardMinion =>
  ({ uid, cardId, attack, health, keywords: [] }) as BoardMinion;

/** A real fight with attacks, damage and at least one death — enough to exercise several moment kinds. */
function realCombat(): { moments: ReturnType<typeof compileMoments>; events: CombatEvent[] } {
  const player = [m('p0', 'stray', 4, 4), m('p1', 'stray', 2, 2)];
  const enemy = [m('e0', 'stray', 3, 3), m('e1', 'stray', 1, 1)];
  const result = simulate(player, enemy, makeRng(42), CARD_INDEX);
  const events = result.events as CombatEvent[];
  return { moments: compileMoments(events), events };
}

describe('the adapter mirrors the moment stream', () => {
  it('produces one node per moment, in order', () => {
    const { moments, events } = realCombat();
    const input = adaptCombatMoments(moments, events);
    expect(input.phase).toBe('combat');
    expect(input.nodes).toHaveLength(moments.length);
    expect(input.nodes.map((n) => n.step)).toEqual(moments.map((_, i) => i));
  });

  it('every moment kind maps to a family', () => {
    const { moments, events } = realCombat();
    for (const n of adaptCombatMoments(moments, events).nodes) {
      expect(n.family, `${n.trigger} has no family`).toBeTruthy();
    }
  });

  it('names the CARD when a uid→cardId map is supplied', () => {
    const { moments, events } = realCombat();
    // Combat reassigns uids (m0, m1, …); the point is only that a supplied map renames the source.
    const cardIdOf = (_uid: string) => 'stray';
    const nodes = adaptCombatMoments(moments, events, { cardIdOf }).nodes;
    const named = nodes.find((n) => n.source.uid);
    if (named) expect(named.source.id).toBe('stray');
  });
});

describe('it stamps ONLY the identity gameplay actually carried', () => {
  it('an ordinary attack/damage moment carries no policyKey — it has no factory identity to name', () => {
    const { moments, events } = realCombat();
    // A plain stray-vs-stray fight has no quest/rune flags, so nothing should be keyed.
    const withKey = adaptCombatMoments(moments, events).nodes.filter((n) => n.policyKey);
    expect(withKey, 'a fight with no rune/quest flags should key nothing').toHaveLength(0);
  });

  it('reports how many moments remain un-keyed, as a diagnostic rather than silently', () => {
    const { moments, events } = realCombat();
    const input = adaptCombatMoments(moments, events);
    expect(input.diagnostics.some((d) => d.message.includes('no policyKey'))).toBe(true);
  });

  it('a quest/rune combat trigger IS keyed, from the flag it carries', () => {
    // Synthesize a questTrigger for Rune of Attacking Gems, exactly as the simulator's fireTrigger emits it.
    const events = [{ type: 'questTrigger', flag: 'runeAttackingGems', side: 'player' }] as unknown as CombatEvent[];
    const moments = compileMoments(events);
    const node = adaptCombatMoments(moments, events).nodes.find((n) => n.trigger === 'questTrigger');
    expect(node, 'the trigger became a node').toBeTruthy();
    expect(node!.policyKey, 'resolved from its flag').toBe('rune:rune_attacking_gems:combat');
    expect(node!.source.kind).toBe('rune');
    expect(node!.source.id).toBe('rune_attacking_gems');
  });
});

describe('the adapted input compiles on the shared compiler', () => {
  it('compiles to a timeline with beats and a duration, no structural errors', () => {
    const { moments, events } = realCombat();
    const timeline = compileTimeline(adaptCombatMoments(moments, events));
    expect(timeline.phase).toBe('combat');
    expect(timeline.beats.length).toBe(moments.length);
    expect(timeline.durationMs).toBeGreaterThan(0);
    expect(timeline.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  });

  it('reactions nest under the previous root, not as fresh sequential beats', () => {
    const { moments, events } = realCombat();
    const timeline = compileTimeline(adaptCombatMoments(moments, events));
    const reactions = timeline.beats.filter((b) => b.lane === 'reaction');
    for (const r of reactions) {
      expect(r.parentBeatId, 'a reaction must have a parent').toBeTruthy();
    }
  });

  it('is deterministic — the same combat adapts + compiles byte-identically', () => {
    const a = realCombat();
    const b = realCombat();
    expect(JSON.stringify(compileTimeline(adaptCombatMoments(a.moments, a.events))))
      .toBe(JSON.stringify(compileTimeline(adaptCombatMoments(b.moments, b.events))));
  });
});

describe('the family map is total over MomentKind', () => {
  it('covers every kind the choreo layer can produce', () => {
    const kinds: MomentKind[] = [
      'attackExchange', 'damage', 'shieldPop', 'shieldGain', 'poisonTick', 'venomSpent', 'death', 'riseDeath',
      'scCast', 'scNarrate', 'summon', 'buffWave', 'reborn', 'ascend', 'rally', 'toHand', 'maxGold', 'improve',
      'keyword', 'keywordLost', 'hpGrant', 'spellProgress', 'reveal', 'tribeAura', 'questTrigger', 'questComplete',
    ];
    for (const k of kinds) expect(FAMILY_BY_MOMENT[k], `${k} unmapped`).toBeTruthy();
  });
});
