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
  if (kinds.includes('recurringEndOfTurn') || kinds.some((k) => /lapidary|crucibleChoir/i.test(k))) return `rune:${r.id}:endOfTurn`;
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
  return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, users]) => ({ key, users: [...users].sort() }));
}
