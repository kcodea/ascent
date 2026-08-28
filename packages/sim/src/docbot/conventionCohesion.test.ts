/**
 * CONVENTION COHESION — the machine-checkable form of the owner's 2026-08-28 complaint.
 *
 * Verbatim, on `q-conv-family-economy` (REVISE): "this family seems extremely varied. there are cards that
 * proc on sell in this category, there are some shouts, there are cards that trigger from buying x cards,
 * there are cards that learn other spells etc. this does not seem like a cohesive family of cards or rulings
 * to me."
 *
 * A convention card that says "all N of these trigger the same way" is a CLAIM, and until now nothing
 * checked it. These tests check it: every emitted family/trigger card's members must genuinely share the
 * trigger the card names, or the card must be the residual — which says out loud that they do not.
 *
 * Second half: the parked classes (Orbit + the Celestial tribe, owner-declared WIP the same day) generate no
 * questions and bind no members anywhere in the deck.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { PRESENTATION_POLICIES } from '@game/core';
import { PARKED_CLASSES, parkedClassOf } from '@game/rules/parked';
import { buildConventionQuestions, conventionClusters, triggerGroupOf } from './conventionQuestions';

const clusterPlan = conventionClusters();
const deck = buildConventionQuestions();

describe('convention clustering is keyed on the TRIGGER (owner ruling 2026-08-28)', () => {
  it('every non-residual cluster spans exactly ONE trigger group — no more grab-bag families', () => {
    const incoherent = clusterPlan.clusters
      .filter((c) => c.kind !== 'residual')
      .map((c) => ({ id: c.ruleId, groups: [...new Set(c.events.map((e) => triggerGroupOf(e)?.id ?? `ungrouped:${e}`))] }))
      .filter((x) => x.groups.length > 1)
      .map((x) => `${x.id} spans ${x.groups.join(' + ')}`);
    expect(
      incoherent,
      'a convention card claims its members share a trigger — these do not. Split them by trigger, or move '
      + `them to the residual card, but never print a false family: ${incoherent.join('; ')}`,
    ).toEqual([]);
  });

  it('every member of a non-residual cluster actually carries the trigger its card names', () => {
    const liars: string[] = [];
    for (const c of clusterPlan.clusters) {
      if (c.kind === 'residual') continue;
      const events = new Set(c.events);
      const factories = new Set(c.factories);
      for (const id of c.memberIds) {
        const def = CARD_INDEX[id];
        const fires = !!def?.effects.some((e) => factories.has(e.do) && events.has(e.on));
        if (!fires) liars.push(`${c.ruleId} lists '${id}', which fires on none of [${c.events.join(', ')}]`);
      }
    }
    expect(liars, `member lists must be true of every member: ${liars.join('; ')}`).toEqual([]);
  });

  it('the residual card is honest about being incoherent rather than forcing a false family', () => {
    for (const c of clusterPlan.clusters.filter((x) => x.kind === 'residual')) {
      const card = deck.find((r) => r.id === c.ruleId)!;
      expect(card, `${c.ruleId} planned but never emitted`).toBeTruthy();
      expect(card.statement.toLowerCase(), `${c.ruleId} must say its members are unrelated`).toContain('unrelated');
      expect(card.statement.toLowerCase(), `${c.ruleId} must offer individual rulings as the honest option`)
        .toContain('individually');
    }
  });

  it('the dissolved families are gone from the deck and their trigger replacements are present', () => {
    const ids = new Set(deck.map((r) => r.id));
    for (const dead of ['q-conv-family-economy', 'q-conv-family-economyReact', 'q-conv-family-react']) {
      expect(ids.has(dead), `${dead} was superseded by the trigger split — it must never regenerate`).toBe(false);
    }
    expect([...ids].some((id) => id.startsWith('q-conv-trigger-')), 'the trigger-keyed cards must exist').toBe(true);
  });

  it('every card the deck emits corresponds to a planned cluster (no orphan family ids)', () => {
    const planned = new Set(clusterPlan.clusters.map((c) => c.ruleId));
    const orphans = deck
      .filter((r) => r.id.startsWith('q-conv-family-') || r.id.startsWith('q-conv-trigger-'))
      .map((r) => r.id)
      .filter((id) => !planned.has(id));
    expect(orphans, `emitted without a cluster: ${orphans.join(', ')}`).toEqual([]);
  });
});

describe('parked WIP classes generate no questions and bind no members (owner ruling 2026-08-28)', () => {
  const parkedCardIds = Object.values(CARD_INDEX)
    .filter((d): d is NonNullable<typeof d> => !!d)
    .filter((d) => parkedClassOf({
      tribes: [d.tribe, d.tribe2],
      flags: d.celestial ? ['celestial'] : [],
      triggers: d.effects.map((e) => e.on),
    }))
    .map((d) => d.id);

  it('the registry is non-empty and every class carries the owner wording + an un-park date', () => {
    expect(PARKED_CLASSES.length).toBeGreaterThan(0);
    for (const p of PARKED_CLASSES) {
      expect(p.why.length, `${p.id} parked with no owner wording`).toBeGreaterThan(20);
      expect(p.since, `${p.id} has no since date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.families.length + p.tribes.length + p.triggers.length + p.flags.length,
        `${p.id} matches nothing — a parked class that catches no content is dead config`).toBeGreaterThan(0);
    }
  });

  it('Orbit and the Celestial tribe are the classes the owner parked', () => {
    const ids = PARKED_CLASSES.map((p) => p.id).sort();
    expect(ids).toContain('orbit');
    expect(ids).toContain('celestial');
    expect(PARKED_CLASSES.find((p) => p.id === 'orbit')!.families).toEqual(['orbit', 'orbitReact']);
    expect(PARKED_CLASSES.find((p) => p.id === 'celestial')!.tribes).toEqual(['celestial']);
  });

  it('the parking actually catches live content (it is not a no-op)', () => {
    expect(parkedCardIds.length, 'no card matched a parked class — the predicates have drifted').toBeGreaterThan(10);
  });

  it('no convention card is generated for a parked family or trigger', () => {
    for (const p of PARKED_CLASSES) {
      for (const fam of p.families) {
        expect(deck.some((r) => r.id === `q-conv-family-${fam}`), `parked family '${fam}' still asks a question`).toBe(false);
      }
    }
    const parkedEvents = new Set(PARKED_CLASSES.flatMap((p) => p.triggers));
    for (const c of clusterPlan.clusters) {
      for (const e of c.events) {
        expect(parkedEvents.has(e), `${c.ruleId} clusters the parked trigger '${e}'`).toBe(false);
      }
    }
  });

  it('parked content never appears in ANY convention card\'s member list (an approval can never bind it)', () => {
    const parked = new Set(parkedCardIds);
    const bound: string[] = [];
    for (const r of deck) for (const id of r.contentIds ?? []) if (parked.has(id)) bound.push(`${r.id} → ${id}`);
    expect(bound, `parked content bound by a convention card: ${bound.join(', ')}`).toEqual([]);
  });

  it('the suppression is reported, not silent (a parked class stays visible in the counts)', () => {
    expect(clusterPlan.parked.length, 'parked classes must be reported by conventionClusters()').toBeGreaterThan(0);
    const orbit = clusterPlan.parked.find((p) => p.classId === 'orbit')!;
    expect(orbit.families.sort()).toEqual(['orbit', 'orbitReact']);
    expect(orbit.membersStripped, 'the orbit cards must be counted, not merely absent').toBeGreaterThan(0);
  });

  it('un-parking is ONE edit: nothing outside parked.ts hardcodes a parked family name', () => {
    // The generator must reach every parked family through the registry — if a family were special-cased in
    // the policy scan instead, deleting the registry entry would not bring it back.
    const policyFamilies = new Set(
      Object.values(PRESENTATION_POLICIES).map((e) => (e as { family?: string }).family).filter(Boolean) as string[],
    );
    for (const p of PARKED_CLASSES) {
      for (const fam of p.families) {
        expect(policyFamilies.has(fam), `parked family '${fam}' no longer exists in PRESENTATION_POLICIES — stale park`).toBe(true);
      }
    }
  });
});
