/**
 * TUTORIAL — the action gate must never block the verb its own step is teaching.
 *
 * The bug this pins (owner report 2026-08-21, "step 19 is hardlocked with the hero power use"):
 * `allowedKindsFor` switched on the TOP-LEVEL completion predicate, so a composite completion —
 * `any[heroPowerUsed, not heroPowerReady]`, the shape every per-round hero-power reminder uses — fell through
 * to `default: []`. The gate reads `[]` as "no player verb allowed", so the coach asked for the hero power
 * while the gate silently dropped every press. The step could never complete: a hard lock with no way out.
 *
 * The sweep at the bottom is the real guard — it walks EVERY authored step in the shipped course and asserts
 * the gate would admit the verb that step's own predicate needs. A future course step written with a new
 * composite (or a new predicate kind) fails here rather than in a player's hands.
 */
import { describe, expect, it } from 'vitest';
import { LEARN_ASCENT, type TutorialPredicate, type TutorialStep } from '@game/sim';
import { allowedKindsFor, verbsForPredicate } from './TutorialController';

const step = (completion: TutorialPredicate): TutorialStep => ({
  id: 't', phase: 'shop', body: '', anchors: [], gate: 'soft', completion,
});

/** The reducer verb a predicate REQUIRES the player to perform. Null = no verb (observe/flow/positioning:
 *  those pass the gate unconditionally — see `ALWAYS_ALLOWED` in gateBus). */
function verbNeededBy(c: TutorialPredicate): string | null {
  switch (c.kind) {
    case 'bought': case 'gilded': return 'buy';
    case 'played': case 'castSpell': return 'play';
    case 'sold': return 'sell';
    case 'refreshed': return 'roll';
    case 'froze': return 'freeze';
    case 'tierAtLeast': return 'upgrade';
    case 'heroPowerUsed': case 'heroPowerReady': return 'heroPower';
    case 'endedTurn': case 'combatStarted': return 'faceOmen';
    // A composite needs whatever ANY of its branches could need — one satisfiable branch is enough, so the
    // gate must admit the verb of at least one of them.
    case 'any': case 'all': case 'not': return null;
    default: return null;
  }
}

describe('verbsForPredicate recurses into composite predicates', () => {
  it('the hero-power reminder shape admits the hero power (the shipped hard lock)', () => {
    const reminder: TutorialPredicate = {
      kind: 'any',
      of: [{ kind: 'heroPowerUsed' }, { kind: 'not', of: { kind: 'heroPowerReady' } }],
    };
    expect(verbsForPredicate(reminder)).toContain('heroPower');
    // …and the same through the public entry point the gate actually calls.
    expect(allowedKindsFor(step(reminder))).toContain('heroPower');
  });

  it('unions every branch of an `any`, without duplicates', () => {
    const verbs = verbsForPredicate({
      kind: 'any',
      of: [{ kind: 'bought', cardId: 'x' }, { kind: 'played', cardId: 'x' }, { kind: 'bought', cardId: 'y' }],
    });
    expect(new Set(verbs)).toEqual(new Set(['buy', 'play']));
    expect(verbs).toHaveLength(new Set(verbs).size); // de-duplicated
  });

  it('sees through `not` and through nesting', () => {
    expect(verbsForPredicate({ kind: 'not', of: { kind: 'refreshed' } })).toEqual(['roll']);
    expect(verbsForPredicate({
      kind: 'all',
      of: [{ kind: 'any', of: [{ kind: 'not', of: { kind: 'froze' } }] }, { kind: 'tierAtLeast', tier: 2 }],
    })).toEqual(expect.arrayContaining(['freeze', 'upgrade']));
  });

  it('an explicit allowedActionKinds still wins over the derived set', () => {
    expect(allowedKindsFor({ ...step({ kind: 'bought', cardId: 'x' }), allowedActionKinds: ['sell'] })).toEqual(['sell']);
  });

  it('observe-only steps still gate no verb', () => {
    expect(verbsForPredicate({ kind: 'always' })).toEqual([]);
    expect(verbsForPredicate({ kind: 'returnedToShop' })).toEqual([]);
  });
});

describe('every authored step in Learn Ascent admits the verb it asks for', () => {
  const all: { turn: string; step: TutorialStep }[] = [
    ...LEARN_ASCENT.lobbyIntro.map((s) => ({ turn: 'intro', step: s })),
    ...LEARN_ASCENT.turns.flatMap((t) => t.steps.map((s) => ({ turn: `T${t.turn}`, step: s }))),
  ];

  it('covers the whole shipped course', () => {
    expect(all.length).toBeGreaterThan(50); // 12 rounds of coached beats
  });

  it.each(all.map((e) => [`${e.turn}/${e.step.id}`, e.step] as const))(
    '%s is not gated against its own completion',
    (_label, s) => {
      const allowed = allowedKindsFor(s);
      const needed = verbNeededBy(s.completion);
      if (needed) {
        expect(allowed, `step "${s.id}" needs "${needed}" but the gate allows [${allowed.join(', ')}]`).toContain(needed);
        return;
      }
      // Composite: at least ONE branch's verb must be admitted, or the step can only clear by luck.
      if (s.completion.kind === 'any' || s.completion.kind === 'all') {
        const branchVerbs = s.completion.of.map(verbNeededBy).filter((v): v is string => v !== null);
        if (branchVerbs.length > 0) {
          expect(branchVerbs.some((v) => allowed.includes(v)),
            `step "${s.id}" has branches needing [${branchVerbs.join(', ')}] but the gate allows [${allowed.join(', ')}]`).toBe(true);
        }
      }
    },
  );
});
