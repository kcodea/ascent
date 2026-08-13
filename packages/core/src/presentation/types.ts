/**
 * BEAT SYSTEM — shared presentation-policy vocabulary (PR 1 of the beat-system arc; see the owner's handoff
 * docs `beat-system-and-dev-tuner-handoff.md` / `beat-system-implementation-blueprint.md`).
 *
 * A *beat* is a readable presentation unit: source → trigger → consequence → hold. Before any event plumbing
 * or Beat Lab tooling exists, every automatic effect must DECLARE how it wants to be presented — that
 * declaration is this module's whole job. The registry itself lives in `policies.ts`; the enumeration +
 * coverage tripwire live content-side (core cannot import content).
 */

/** How an automatic effect presents itself. */
export type PresentationPolicy =
  /** The source gets a readable beat of its own before its consequences (End of Turn, Start of Combat,
   *  Avenge, quest/rune payouts, Shouts/Rallies/Echoes). */
  | 'ownBeat'
  /** The source reacts INSIDE another beat without adding a pause — it claims credit, not time (King Oona
   *  doubling a summon, Rune of the Hatchery modifying an arrival). */
  | 'foldedCue'
  /** A continuously-applied rule; repeated pulses would be noise. Communicated on acquisition + inspection,
   *  never as a per-application pause (standing auras, cost replacements). */
  | 'passive'
  /** No presentation is desired. A reason is MANDATORY — the registry test rejects a silent entry without one. */
  | 'intentionallySilent';

/** What kind of object owns an automatic effect. */
export type TriggerSourceKind = 'minion' | 'rune' | 'quest' | 'spell' | 'hero' | 'system';

/**
 * A registry key. Minion/spell card effects key by FACTORY × TRIGGER (every content effect names one, so new
 * cards reusing a classified factory inherit its policy deliberately); runes/quests/heroes key by id +
 * mechanic-phase. Never key by display name — ids survive copy changes.
 */
export type EffectPresentationKey =
  | `factory:${string}:${string}`
  | `rune:${string}:${string}`
  | `quest:${string}:${string}`
  | `hero:${string}:${string}`
  | `system:${string}`;

/** One classified effect. */
export interface PresentationPolicyEntry {
  policy: PresentationPolicy;
  /** Coarse timing bucket the future timing resolver will key on ('shout', 'echo', 'endOfTurn', 'avenge',
   *  'summonReact', 'economy', …). PR 1 records it; nothing consumes it yet. */
  family: string;
  /** MANDATORY for `intentionallySilent`; optional context elsewhere. */
  reason?: string;
  /** Marked by the classifier when the heuristic default deserves an owner look (PR-1 review workflow:
   *  the owner skims the audit table; flagged rows are the ones to actually weigh). */
  flagged?: boolean;
}
