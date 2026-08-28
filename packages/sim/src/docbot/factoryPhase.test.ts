/**
 * DOC BOT LANE `factoryPhase` — every (trigger, factory) pair is implemented wherever its trigger dispatches.
 *
 * The engine's dispatch shape (`MAP[effect.do]?.(...)`) turns a missing factory into a SILENT no-op — the
 * Conductor-in-combat / Funeral-on-Loan bug class. This test re-derives the question from content on every run
 * (like `tallyCoverage.test.ts`): walk every effect on every card, look its factory up in the phase maps its
 * trigger dispatches through, and demand either an implementation or a registered excuse in
 * `phaseRegistry.ts`. A new card's new factory gets caught HERE, at authoring time, instead of shipping as a
 * shrug in one phase.
 *
 * The 'needs-triage' excuse kind exists so landing this test did not require ruling on ~10 inherited gaps at
 * once — but the test pins their COUNT: resolving one must shrink the registry, and a new gap can never hide
 * as triage (new pairs must add an entry, which shows up in review).
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { FACTORIES, combatCastable } from '@game/core';
import { RECRUIT_FACTORY_IDS } from '../recruit';
import { COMBAT_CASTING_FACTORIES, PHASE_EXCUSED, TRIGGER_PHASES } from './phaseRegistry';

const COMBAT_FACTORY_IDS = new Set(Object.keys(FACTORIES));

/** Every (trigger, factory) pair content actually uses. */
function contentPairs(): Map<string, Set<string>> {
  const pairs = new Map<string, Set<string>>();
  for (const c of Object.values(CARD_INDEX)) {
    for (const e of c?.effects ?? []) {
      if (!pairs.has(e.on)) pairs.set(e.on, new Set());
      pairs.get(e.on)!.add(e.do);
    }
  }
  return pairs;
}

describe('Doc Bot — factory × phase coverage', () => {
  const pairs = contentPairs();

  it('every trigger content uses has a declared phase (a new trigger must be classified, not guessed)', () => {
    const unknown = [...pairs.keys()].filter((on) => !TRIGGER_PHASES[on]);
    expect(unknown, `Unclassified trigger(s): ${unknown.join(', ')} — find their dispatch sites and add them to TRIGGER_PHASES in phaseRegistry.ts`).toEqual([]);
  });

  it('every (trigger, factory) pair is implemented in every phase its trigger dispatches, or excused', () => {
    const holes: string[] = [];
    for (const [on, dos] of pairs) {
      const phase = TRIGGER_PHASES[on];
      if (!phase) continue; // the test above owns this failure
      for (const d of dos) {
        const needRecruit = phase !== 'combat';
        const needCombat = phase !== 'recruit';
        const excuse = PHASE_EXCUSED[d];
        if (needRecruit && !RECRUIT_FACTORY_IDS.has(d) && excuse?.phase !== 'recruit') {
          holes.push(`${on} → ${d}: no RECRUIT factory and no recruit excuse`);
        }
        if (needCombat && !COMBAT_FACTORY_IDS.has(d) && excuse?.phase !== 'combat') {
          holes.push(`${on} → ${d}: no COMBAT factory and no combat excuse — the Conductor bug shape`);
        }
      }
    }
    expect(holes, `Silent-dispatch hole(s):\n  ${holes.join('\n  ')}\nImplement the missing phase, or register a PhaseExcuse in phaseRegistry.ts with a verifiable reason.`).toEqual([]);
  });

  it('excuses are real: each names a factory content uses, for a phase its trigger actually dispatches', () => {
    const usedDos = new Map<string, Set<string>>(); // do → triggers using it
    for (const [on, dos] of pairs) for (const d of dos) {
      if (!usedDos.has(d)) usedDos.set(d, new Set());
      usedDos.get(d)!.add(on);
    }
    const stale: string[] = [];
    for (const [d, ex] of Object.entries(PHASE_EXCUSED)) {
      const triggers = usedDos.get(d);
      if (!triggers) { stale.push(`${d}: excused but no content uses it any more — delete the entry`); continue; }
      const dispatchesThere = [...triggers].some((on) => TRIGGER_PHASES[on] === 'both' || TRIGGER_PHASES[on] === ex.phase);
      if (!dispatchesThere) stale.push(`${d}: excused for '${ex.phase}' but none of its triggers (${[...triggers].join(', ')}) dispatch there — delete or fix the entry`);
      // An excused factory that HAS since been implemented in the excused phase: the excuse is stale praise.
      const implemented = ex.phase === 'recruit' ? RECRUIT_FACTORY_IDS.has(d) : COMBAT_FACTORY_IDS.has(d);
      if (implemented && ex.kind !== 'outside-map') stale.push(`${d}: excused for '${ex.phase}' but a ${ex.phase} factory now EXISTS — delete the entry (the implementation wins)`);
    }
    expect(stale, `Stale excuse(s):\n  ${stale.join('\n  ')}`).toEqual([]);
  });

  it('the needs-triage backlog can only shrink (ratchet: 0 after the owner triage session, 2026-08-26)', () => {
    const triage = Object.entries(PHASE_EXCUSED).filter(([, e]) => e.kind === 'needs-triage');
    expect(triage.length, `needs-triage entries: ${triage.map(([d]) => d).join(', ')} — resolving one? lower this ratchet. Adding one? that needs an owner ruling, not a bigger number.`).toBeLessThanOrEqual(0);
  });

  it('cast lane: every spell a combat-capable caster names is combat-castable (the Beefy fizzle class)', () => {
    const fizzles: string[] = [];
    for (const c of Object.values(CARD_INDEX)) {
      for (const e of c?.effects ?? []) {
        if (!COMBAT_CASTING_FACTORIES.has(e.do)) continue;
        const spellId = typeof e.params?.spellId === 'string' ? e.params.spellId : undefined;
        if (!spellId) continue;
        const spell = CARD_INDEX[spellId];
        if (!spell) { fizzles.push(`${c!.id}: names unknown spell '${spellId}'`); continue; }
        if (!combatCastable(spell)) {
          fizzles.push(`${c!.id} (${e.on} → ${e.do}) casts '${spellId}', which fails combatCastable — it will FIZZLE WITHOUT COUNTING in combat. Add its cast dos to COMBAT_CASTABLE_SPELL_DOS (with a combat implementation) like Beefy/Lantern Light (2026-08-19).`);
        }
      }
    }
    expect(fizzles, fizzles.join('\n')).toEqual([]);
  });
});
