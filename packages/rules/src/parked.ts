/**
 * PARKED CLASSES — design surfaces the owner has explicitly declared WORK IN PROGRESS, so the rulebook
 * refuses to rule on them (owner triage 2026-08-28).
 *
 * The doctrine this file serves: undefined behaviour is `needs-ruling`, never silently inferred correct —
 * but a surface the OWNER says is unfinished must not even be ASKED about, because a ruling on a moving
 * target is worse than no ruling. Parking is therefore a third state alongside "approved" and
 * "needs-ruling": **not asked, not approved, and never silently dropped.**
 *
 * What parking does, mechanically:
 *  · `conventionQuestions.ts` emits NO convention card for a parked family/trigger, and strips parked
 *    content from every surviving card's member list (so approving a family card can never bind a parked
 *    member by inheritance);
 *  · `contractExtract.ts` stamps every parked contract with `parked: { reason: 'parked-wip', … }` — the
 *    contract still EXISTS and still counts in the inventory (visible, never dropped);
 *  · `contractCorroboration.ts` keeps measuring parked contracts on every aspect (verification continues)
 *    but downgrades any 'disagree' to 'uncovered' with the parked reason — the machine never asserts INTENT
 *    about a surface the owner has not designed yet.
 *
 * UN-PARKING IS ONE EDIT: delete the class's entry from `PARKED_CLASSES` below. Nothing else references a
 * parked id by hand — the questions regenerate, the contract stamps disappear, the lanes re-arm. That is
 * the whole contract; keep it that way (no parked ids hardcoded anywhere else).
 *
 * This module is a LEAF on purpose: zero imports, so `@game/sim` can take it at runtime through the
 * '@game/rules/parked' subpath without dragging the registry toward the web bundle.
 */

/** The single machine-readable reason string every parked skip/downgrade cites. */
export const PARKED_REASON = 'parked-wip' as const;
export type ParkedReason = typeof PARKED_REASON;

export interface ParkedClass {
  /** Stable class id, cited in skip reasons and contract stamps. */
  id: string;
  label: string;
  /** Presentation-policy family names (PRESENTATION_POLICIES `family`) that are parked. */
  families: readonly string[];
  /** Effect trigger events (`EffectDef.on`) that are parked. */
  triggers: readonly string[];
  /** Tribes (core `Tribe` values) whose content is parked. */
  tribes: readonly string[];
  /** CardDef boolean flags that mark membership even when the tribe field does not (e.g. `celestial`). */
  flags: readonly string[];
  /** The owner's own words — the record of WHY, carried into every stamp and tombstone. */
  why: string;
  /** ISO date the owner parked it. */
  since: string;
  /** Rule ids retired because of this parking (tombstoned in registry/retired.ts). */
  retiredRuleIds: readonly string[];
}

/**
 * The parked registry. ONE entry per owner-declared WIP surface. Delete an entry to un-park it.
 */
export const PARKED_CLASSES: readonly ParkedClass[] = [
  {
    id: 'orbit',
    label: 'Orbit (the Celestial trigger)',
    families: ['orbit', 'orbitReact'],
    triggers: ['orbit', 'orbitFired'],
    tribes: [],
    flags: [],
    why: 'Owner ruling 2026-08-28: "orbit is extremely work in progress and should not receive any true rules '
      + 'yet, neither should any celestial as they are temp minions" / "as stated before, orbit and celestials '
      + 'are masssive works in progress right now."',
    since: '2026-08-28',
    retiredRuleIds: ['q-conv-family-orbit', 'q-conv-family-orbitReact'],
  },
  {
    id: 'celestial',
    label: 'the Celestial tribe',
    families: [],
    triggers: [],
    tribes: ['celestial'],
    flags: ['celestial'],
    why: 'Owner ruling 2026-08-28: "neither should any celestial as they are temp minions" — the whole tribe '
      + 'is temporary scaffolding, so no convention question may bind it and no contract may claim its intent.',
    since: '2026-08-28',
    retiredRuleIds: [],
  },
];

export const PARKED_CLASS_IDS: ReadonlySet<string> = new Set(PARKED_CLASSES.map((p) => p.id));

const findBy = (pick: (p: ParkedClass) => readonly string[], value: string): ParkedClass | undefined =>
  PARKED_CLASSES.find((p) => pick(p).includes(value));

/** The parked class owning a presentation family, or undefined. */
export const parkedClassForFamily = (family: string): ParkedClass | undefined => findBy((p) => p.families, family);
/** The parked class owning a trigger event, or undefined. */
export const parkedClassForTrigger = (event: string): ParkedClass | undefined => findBy((p) => p.triggers, event);
/** The parked class owning a tribe, or undefined. */
export const parkedClassForTribe = (tribe: string): ParkedClass | undefined => findBy((p) => p.tribes, tribe);
/** The parked class owning a CardDef membership flag, or undefined. */
export const parkedClassForFlag = (flag: string): ParkedClass | undefined => findBy((p) => p.flags, flag);

/** The shape a caller describes a piece of content with, so parking is decided in ONE place. */
export interface ParkedSubject {
  tribes?: readonly (string | undefined)[];
  /** CardDef boolean flags that are TRUE for this subject. */
  flags?: readonly string[];
  /** Effect trigger events this subject carries. */
  triggers?: readonly string[];
  /** Presentation families this subject dispatches through. */
  families?: readonly string[];
}

/** The parked class a piece of content belongs to, or undefined when it is live design space. */
export function parkedClassOf(subject: ParkedSubject): ParkedClass | undefined {
  for (const t of subject.tribes ?? []) if (t) { const p = parkedClassForTribe(t); if (p) return p; }
  for (const f of subject.flags ?? []) { const p = parkedClassForFlag(f); if (p) return p; }
  for (const e of subject.triggers ?? []) { const p = parkedClassForTrigger(e); if (p) return p; }
  for (const f of subject.families ?? []) { const p = parkedClassForFamily(f); if (p) return p; }
  return undefined;
}

export const isParked = (subject: ParkedSubject): boolean => !!parkedClassOf(subject);

/** The one-line reason a lane prints when it skips or downgrades on account of parking. */
export const parkedSkipReason = (p: ParkedClass): string =>
  `${PARKED_REASON} (${p.id}): ${p.label} is owner-declared work in progress since ${p.since} — no rules, no intent claims. ${p.why}`;

/** Every rule id retired because its subject was parked (used by the tombstone integrity test). */
export const PARKED_RETIRED_RULE_IDS: readonly string[] = PARKED_CLASSES.flatMap((p) => p.retiredRuleIds);
