import { describe, it, expect } from 'vitest';
import { createRun, reduce, reduceWithPresentation, type Action, type RunState } from './index';
import type { SourceTriggerEvent, StatsChangedConsequence } from '@game/core';
import { CARD_INDEX } from '@game/content';

/**
 * BEAT SYSTEM PR 3 — the recruit pipeline. `reduceWithPresentation` must (a) leave gameplay byte-identical to
 * plain `reduce` and (b) emit a source-attributed batch for the one migrated trigger (a Shout / onPlay buff).
 *
 * The representative Shout is Hoard Cleric (`battlecryBuffTribe` — "give your other Dragons +3/+3").
 */
const SHOUT = 'cleric';

/** A recruit state with Hoard Cleric in hand and two other Dragons on board for it to buff. */
function handState(cardId: string): RunState {
  const run = createRun(3, 'warden');
  const def = CARD_INDEX[cardId]!;
  return {
    ...run,
    phase: 'recruit',
    hand: [{ uid: 'h1', cardId, tribe: def.tribe, attack: def.attack, health: def.health, keywords: [...def.keywords], golden: false }],
    board: [
      { uid: 'b1', cardId: 'cleric', tribe: 'dragon', attack: 2, health: 2, keywords: [], golden: false },
      { uid: 'b2', cardId: 'cleric', tribe: 'dragon', attack: 3, health: 3, keywords: [], golden: false },
    ],
  } as RunState;
}

const buffOthersCard = CARD_INDEX[SHOUT];
const playHand: Action = { type: 'play', uid: 'h1' } as Action;

describe('reduceWithPresentation — gameplay equivalence', () => {
  it('produces byte-identical state to plain reduce (capture off)', () => {
    const s = handState(buffOthersCard?.id ?? 'stray');
    const plain = reduce(s, playHand);
    const wrapped = reduceWithPresentation(s, playHand, false);
    expect(JSON.stringify(wrapped.state)).toBe(JSON.stringify(plain));
    expect(wrapped.batch).toBeNull();
  });

  it('produces byte-identical state WITH capture on (the collector never mutates)', () => {
    const s = handState(buffOthersCard?.id ?? 'stray');
    const plain = reduce(s, playHand);
    const captured = reduceWithPresentation(s, playHand, true);
    expect(JSON.stringify(captured.state)).toBe(JSON.stringify(plain));
  });
});

describe('reduceWithPresentation — Shout emission', () => {
  it('emits a source-attributed onPlay trigger with the buff as a statsChanged consequence', () => {
    expect(buffOthersCard, 'a buffOthers Shout exists in content').toBeTruthy();
    const s = handState(buffOthersCard!.id);
    const { batch } = reduceWithPresentation(s, playHand, true);
    expect(batch, 'a batch was captured').toBeTruthy();

    const triggers = batch!.events.filter((e): e is SourceTriggerEvent => e.type === 'sourceTrigger');
    const onPlay = triggers.find((t) => t.trigger === 'onPlay');
    expect(onPlay, 'an onPlay trigger fired').toBeTruthy();
    expect(onPlay!.source).toMatchObject({ kind: 'minion', id: buffOthersCard!.id, uid: 'h1', side: 'player' });

    const stats = batch!.events.filter(
      (e): e is StatsChangedConsequence => e.type === 'statsChanged' && e.parentId === onPlay!.id,
    );
    expect(stats.length, 'the buff landed on other minions as consequences').toBeGreaterThan(0);
    // buffOthers buffs OTHER minions — never the source itself.
    expect(stats.every((c) => c.target.uid !== 'h1')).toBe(true);
    expect(stats.every((c) => c.attack > 0 || c.health > 0)).toBe(true);
  });

  it('is deterministic — the same play yields identical batches', () => {
    const s = handState(buffOthersCard!.id);
    const a = reduceWithPresentation(s, playHand, true).batch;
    const b = reduceWithPresentation(s, playHand, true).batch;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
