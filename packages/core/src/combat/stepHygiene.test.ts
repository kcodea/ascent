import { describe, expect, it } from 'vitest';
import { makeRng, simulate, combatSide, type BoardMinion } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * STEP-HYGIENE INVARIANTS (2026-07-18 pacing audit): the UI renders everything sharing a `step` as ONE
 * instantaneous beat, so two DISTINCT triggers must never share a step — each `questTrigger` opens its
 * own resolution moment (`withBeat`), and its badge pulse rides the same step as its effect. These
 * invariants hold across heavily-modded fights so a future hand-ordered `fireTrigger` can't regress them.
 */
const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon'];

const FIGHTS: [string, () => ReturnType<typeof simulate>][] = [
  ['SoC rune stack', () => simulate(
    [{ cardId: 'gnash', attack: 5, health: 8 }, { cardId: 'cleric', attack: 3, health: 5 }],
    [{ cardId: 'sandbag', attack: 0, health: 6 }], makeRng(1), CARD_INDEX,
    combatSide({ tier: 6, tribes: ALL_TRIBES, spellsCast: 3, questMods: {
      runeWarden: true, runeWarding: true, runeMirrorMarch: true, umbralEnergy: true, doubleLeftmostAttack: true,
    } }))],
  ['death-driven triggers (boneThrone + assemblyLine + pit)', () => simulate(
    Array.from({ length: 4 }, (): BoardMinion => ({ cardId: 'sandbag', attack: 1, health: 1 })),
    [{ cardId: 'gnash', attack: 6, health: 40 }], makeRng(5), CARD_INDEX,
    combatSide({ tier: 6, tribes: ALL_TRIBES, questMods: { boneThroneStep: 2, assemblyLineStep: 2, pitWithoutEndImps: 2 } }))],
];

describe('step hygiene — distinct triggers never share a resolution step', () => {
  for (const [name, run] of FIGHTS) {
    it(`${name}: at most one questTrigger per step`, () => {
      const events = run().events;
      const triggersByStep = new Map<number, string[]>();
      for (const e of events) {
        if (e.type !== 'questTrigger' || e.step === undefined) continue;
        const list = triggersByStep.get(e.step) ?? [];
        list.push(e.flag);
        triggersByStep.set(e.step, list);
      }
      expect(triggersByStep.size).toBeGreaterThan(0); // the fixture actually armed triggers
      for (const [step, flags] of triggersByStep) {
        expect(flags.length, `step ${step} carries ${flags.length} triggers (${flags.join(', ')}) — each trigger needs its own withBeat`).toBe(1);
      }
    });

    it(`${name}: a trigger's effect events ride ITS step (badge pulses on the right beat)`, () => {
      const events = run().events;
      for (const e of events) {
        if (e.type !== 'questTrigger' || e.step === undefined) continue;
        // Every OTHER event on this trigger's step must come AFTER the trigger in log order —
        // i.e. the pulse opens the beat, the effect fills it (never a pulse stamped onto a prior beat).
        const idx = events.indexOf(e);
        const early = events.filter((o, i) => o.step === e.step && i < idx);
        expect(early.length, `trigger '${e.flag}' fired mid-step — withBeat opens the step BEFORE the effect`).toBe(0);
      }
    });
  }
});
