/**
 * PARKED CLASSES + the 2026-08-28 tombstones — the registry-side half of the owner's triage.
 *
 * The sim side (conventionCohesion.test.ts) proves the generator honours parking. This side proves the
 * REGISTRY stays honest about it: the superseded ids are tombstoned with the owner's wording, nothing
 * recycles them, no parked class can be quietly approved, and the parked contracts are stamped (visible in
 * the counts) rather than dropped.
 */
import { describe, expect, it } from 'vitest';
import { CONVENTION_PENDING, DECISIONS } from './index';
import { RETIRED_IDS, RETIRED_RULES } from './registry/retired';
import { AUTO_RETIRED_IDS } from './registry/retired.generated';
import { PARKED_CLASSES, PARKED_REASON, PARKED_RETIRED_RULE_IDS, isParked, parkedClassOf, parkedSkipReason } from './parked';
import { EXTRACTED_CONTRACTS } from './contracts/extracted.generated';
import { contractErrors } from './contracts/schema';

/** The five convention ids the 2026-08-28 triage superseded — split or parked. */
const SUPERSEDED = [
  'q-conv-family-economy',
  'q-conv-family-economyReact',
  'q-conv-family-react',
  'q-conv-family-orbit',
  'q-conv-family-orbitReact',
] as const;

describe('the 2026-08-28 convention triage: tombstones', () => {
  it('every superseded id is hand-tombstoned with a disposition', () => {
    for (const id of SUPERSEDED) {
      expect(RETIRED_IDS.has(id), `${id} left the deck without a tombstone — decided ids must never vanish`).toBe(true);
      const row = RETIRED_RULES.find((r) => r.id === id)!;
      expect(row.retiredAt).toBe('2026-08-28');
      expect(row.why.length, `${id}'s disposition is too thin to audit`).toBeGreaterThan(120);
      expect(row.enforcement?.refs.length, `${id} retired with no pin`).toBeGreaterThan(0);
    }
  });

  it('the three OWNER-DECIDED tombstones quote the owner\'s wording verbatim', () => {
    const decided: Array<[string, string]> = [
      ['q-conv-family-economy', 'this does not seem like a cohesive family of cards or rulings to me'],
      ['q-conv-family-orbit', 'orbit is extremely work in progress and should not receive any true rules yet'],
      ['q-conv-family-orbitReact', 'orbit and celestials are masssive works in progress right now'],
    ];
    for (const [id, quote] of decided) {
      expect(DECISIONS[id]?.decision, `${id} must carry the owner's REVISE`).toBe('revise');
      expect(DECISIONS[id]?.note ?? '', `${id}'s decision must carry the owner's note`).toContain(quote);
      expect(RETIRED_RULES.find((r) => r.id === id)!.why, `${id}'s tombstone must cite the owner`).toContain(quote);
    }
  });

  it('none of the superseded ids is ever re-emitted, and their replacements carry NEW ids', () => {
    const live = new Set(CONVENTION_PENDING.map((r) => r.id));
    for (const id of SUPERSEDED) expect(live.has(id), `${id} resurrected on the board`).toBe(false);
    for (const id of SUPERSEDED) expect(AUTO_RETIRED_IDS.has(id), `${id} tombstoned in BOTH files`).toBe(false);
    // The split's replacements exist and are new ids (never recycled from the retired set).
    const replacements = CONVENTION_PENDING.filter((r) => r.id.startsWith('q-conv-trigger-')).map((r) => r.id);
    expect(replacements.length, 'the economy/react split produced no replacement cards').toBeGreaterThan(0);
    for (const id of replacements) expect(RETIRED_IDS.has(id), `${id} recycles a retired id`).toBe(false);
  });

  it('the parked classes name the rule ids they retired, and those tombstones exist', () => {
    expect(PARKED_RETIRED_RULE_IDS.length).toBeGreaterThan(0);
    for (const id of PARKED_RETIRED_RULE_IDS) expect(RETIRED_IDS.has(id), `${id} parked but not tombstoned`).toBe(true);
  });
});

describe('the parked registry', () => {
  it('every class carries the owner wording, a since date, and a usable skip reason', () => {
    for (const p of PARKED_CLASSES) {
      expect(p.why.length).toBeGreaterThan(20);
      expect(p.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(parkedSkipReason(p)).toContain(PARKED_REASON);
      expect(parkedSkipReason(p)).toContain(p.why);
    }
  });

  it('the predicates catch what the owner parked and nothing else', () => {
    expect(isParked({ families: ['orbit'] })).toBe(true);
    expect(isParked({ families: ['orbitReact'] })).toBe(true);
    expect(isParked({ triggers: ['orbit'] })).toBe(true);
    expect(isParked({ triggers: ['orbitFired'] })).toBe(true);
    expect(isParked({ tribes: ['celestial'] })).toBe(true);
    expect(isParked({ flags: ['celestial'] })).toBe(true);
    expect(parkedClassOf({ tribes: ['celestial'] })?.id).toBe('celestial');
    expect(parkedClassOf({ families: ['orbit'] })?.id).toBe('orbit');
    // Live design space stays live.
    expect(isParked({ families: ['shout'], tribes: ['dragon'], triggers: ['onPlay'] })).toBe(false);
    expect(isParked({})).toBe(false);
  });
});

describe('parked contracts are stamped, counted, and never approved', () => {
  const parked = EXTRACTED_CONTRACTS.filter((c) => c.parked);

  it('the parked contracts exist in the registry (visible in the counts, never dropped)', () => {
    expect(parked.length, 'no contract carries a parked stamp — regenerate with `npm run contracts:extract`').toBeGreaterThan(10);
  });

  it('every stamp is structurally valid and cites the owner', () => {
    for (const c of parked) {
      expect(c.parked!.reason).toBe(PARKED_REASON);
      expect(c.parked!.why.length).toBeGreaterThan(20);
      expect(c.parked!.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(contractErrors(c), `${c.contentId} has an invalid parked stamp`).toEqual([]);
    }
  });

  it('a parked contract can never be stored as approved (the validator refuses it)', () => {
    const sabotage = { ...parked[0]!, reviewStatus: 'approved' as const };
    expect(contractErrors(sabotage).join(' ')).toContain('never be \'approved\'');
  });

  it('every parked stamp names a class that still exists (deleting a class un-parks cleanly)', () => {
    const ids = new Set(PARKED_CLASSES.map((p) => p.id));
    for (const c of parked) expect(ids.has(c.parked!.classId), `${c.contentId} cites a vanished parked class`).toBe(true);
  });
});
