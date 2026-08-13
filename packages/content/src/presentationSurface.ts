/**
 * BEAT SYSTEM — the live presentation SURFACE: every automatic-effect key the current content produces,
 * enumerated from the real card/rune/quest data. The single enumerator shared by the coverage tripwire
 * (`presentationPolicies.test.ts`) and the audit report (`npm run beats:audit`), so the two can never
 * disagree about what exists. MUST bucket exactly like the registry generator did (see policies.ts header) —
 * a bucketing change here without regenerating the registry reads as mass ghosts/missing.
 */
import type { QuestDef, RuneDef } from '@game/core';
import { ALL_CARDS } from './index';
import { EPIC_RUNES, RUNES } from './runes';
import { QUEST_DEFS } from './quests';

export interface SurfaceEntry {
  key: string;
  /** Content ids that produce this key (cards for factory keys; the rune/quest itself otherwise). */
  users: string[];
}

const walkKinds = (r: unknown): string[] => {
  const rw = r as { kind: string; rewards?: unknown[] };
  return rw.kind === 'multi' ? (rw.rewards ?? []).flatMap(walkKinds) : [rw.kind];
};

const runeKey = (r: RuneDef): string => {
  const kinds = walkKinds(r.reward);
  // CHOREOGRAPHER PR 1: `runeCoffers` / `runeShopkeep` fire at End of Turn (their card text says so, and
  // `applyEndOfTurn` is where they emit) but bucketed as `:recruit`, so the key gameplay emits didn't match
  // the key the registry classified. Phase must be TRUTHFUL — an emitter cannot stamp a phase-lie just to
  // find a registry row.
  if (kinds.includes('recurringEndOfTurn') || kinds.some((k) => /lapidary|crucibleChoir|runeCoffers|runeShopkeep/i.test(k))) return `rune:${r.id}:endOfTurn`;
  if (kinds.includes('combatFlag')) return `rune:${r.id}:combat`;
  if (kinds.every((k) => k === 'grant' || k === 'gildRandom' || k === 'gold' || k === 'discover')) return `rune:${r.id}:onAcquire`;
  return `rune:${r.id}:recruit`;
};

const questKey = (q: QuestDef): string => {
  const kinds = walkKinds(q.reward);
  if (kinds.includes('recurringEndOfTurn')) return `quest:${q.id}:endOfTurn`;
  if (kinds.includes('combatFlag')) return `quest:${q.id}:combat`;
  return `quest:${q.id}:onComplete`;
};

/**
 * CHOREOGRAPHER PR 1 — effect-name → owning registry key, for the RECURRING End-of-Turn effects.
 *
 * A recurring effect is stored on the run as a bare effect name ('runeLapidary', 'triggerLeftmostShout'),
 * so the End-of-Turn emitter knows WHAT fires but not WHO owns it — and it was guessing `kind: 'rune'` for
 * all of them, which mis-groups the quests. Derived from the same content walk that builds the surface, so
 * it can never drift from the registry keys (hand-written, it would rot the first time a rune moved).
 */
let recurringOwners: Map<string, { key: string; kind: 'rune' | 'quest'; id: string }> | null = null;

export function recurringEotOwner(effect: string): { key: string; kind: 'rune' | 'quest'; id: string } | undefined {
  if (!recurringOwners) {
    recurringOwners = new Map();
    const scan = (reward: unknown, kind: 'rune' | 'quest', id: string, key: string): void => {
      const rw = reward as { kind: string; effect?: string; rewards?: unknown[] };
      if (rw.kind === 'multi') { for (const r of rw.rewards ?? []) scan(r, kind, id, key); return; }
      if (rw.kind === 'recurringEndOfTurn' && rw.effect) recurringOwners!.set(rw.effect, { key, kind, id });
    };
    for (const r of [...RUNES, ...EPIC_RUNES]) scan(r.reward, 'rune', r.id, runeKey(r));
    for (const q of QUEST_DEFS) scan(q.reward, 'quest', q.id, questKey(q));
    // The two flag-armed rune recurrences are stored as booleans (save compatibility) rather than as
    // `recurringEndOfTurn` rewards, so the walk above cannot see them — named here, and asserted against
    // the registry by the identity test.
    for (const [effect, id] of [['runeLapidary', 'rune_lapidary'], ['runeCrucibleChoir', 'rune_crucible_choir']] as const) {
      recurringOwners.set(effect, { key: `rune:${id}:endOfTurn`, kind: 'rune', id });
    }
  }
  return recurringOwners.get(effect);
}

/**
 * CHOREOGRAPHER PR 7 — the DERIVED/SYSTEM manifest (blueprint §15.2).
 *
 * Not every automatic effect is a row in card/rune/quest data. Some are moments the ENGINE derives: a spell
 * banked last shop that pays out at Start of Combat, keyword grants held for the next fight, summons queued
 * for the coming combat. They have no `EffectDef` to enumerate, so the content walk cannot see them — and
 * because the surface is what the coverage tripwire checks, "cannot see them" meant they could never be
 * classified, never be emitted, and never show up as missing. That is precisely how Fleeting Vigor ended up
 * with no beat while the audit stayed green.
 *
 * Listing them explicitly makes them first-class: classified in the registry, emitted by gameplay, and
 * visible in the Beat Lab as real sources rather than as an unexplained EMPTY row.
 */
export const SYSTEM_SURFACE: SurfaceEntry[] = [
  { key: 'system:startOfCombat:fleetingVigor', users: ['fleeting-vigor'] },
  { key: 'system:startOfCombat:pendingKeywords', users: ['field-maneuvers', 'last-stand', 'executioners-edge'] },
  { key: 'system:startOfCombat:pendingImps', users: ['open-the-gates'] },
];

/** Every presentation key the live content produces, with its producers. Deterministic order (sorted). */
export function presentationSurface(): SurfaceEntry[] {
  const map = new Map<string, Set<string>>();
  const add = (key: string, user: string): void => {
    (map.get(key) ?? map.set(key, new Set()).get(key)!).add(user);
  };
  for (const c of ALL_CARDS) {
    for (const e of [...c.effects, ...(c.chooseOne?.flatMap((o) => o.effects) ?? [])]) {
      add(`factory:${e.do}:${e.on}`, c.id);
    }
  }
  for (const r of [...RUNES, ...EPIC_RUNES]) add(runeKey(r), r.id);
  for (const q of QUEST_DEFS) add(questKey(q), q.id);
  for (const e of SYSTEM_SURFACE) for (const u of e.users) add(e.key, u);
  return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, users]) => ({ key, users: [...users].sort() }));
}
