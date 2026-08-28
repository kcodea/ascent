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
  if (kinds.includes('recurringEndOfTurn') || kinds.some((k) => /lapidary|crucibleChoir|runeCoffers|runeShopkeep|lastingCadence|combatProwess/i.test(k))) return `rune:${r.id}:endOfTurn`;
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
 * CHOREOGRAPHER PR 17 — a combat FLAG to the registry key of the rune/quest that owns it.
 *
 * When a rune/quest fires in combat it emits a `questTrigger`/`questComplete` carrying its `combatFlag` value
 * (e.g. `runeAttackingGems`) — a stable, gameplay-stamped identifier. That flag IS the identity; this resolves
 * it to the registry key the surface files that rune/quest under, so the combat adapter can stamp a real
 * `policyKey` instead of leaving the moment identity-less.
 *
 * Derived from the same content walk that builds the surface (exactly like `recurringEotOwner`), so the
 * resolved key can never drift from the classified one. Resolving here rather than in the simulator is
 * deliberate: the flag→key map needs content, and `@game/core` (where combat runs) cannot import content.
 */
let combatFlagOwners: Map<string, { key: string; kind: 'rune' | 'quest'; id: string }> | null = null;

export function combatFlagOwner(flag: string): { key: string; kind: 'rune' | 'quest'; id: string } | undefined {
  if (!combatFlagOwners) {
    combatFlagOwners = new Map();
    const scan = (reward: unknown, kind: 'rune' | 'quest', id: string, key: string): void => {
      const rw = reward as { kind: string; flag?: string; rewards?: unknown[] };
      if (rw.kind === 'multi') { for (const r of rw.rewards ?? []) scan(r, kind, id, key); return; }
      if (rw.kind === 'combatFlag' && rw.flag) combatFlagOwners!.set(rw.flag, { key, kind, id });
    };
    for (const r of [...RUNES, ...EPIC_RUNES]) scan(r.reward, 'rune', r.id, runeKey(r));
    for (const q of QUEST_DEFS) scan(q.reward, 'quest', q.id, questKey(q));
  }
  return combatFlagOwners.get(flag);
}

/**
 * CHOREOGRAPHER PR 15 — a rune/quest id to the registry key the SURFACE files it under.
 *
 * The emitter knows which rune or quest is paying out, but not which bucket the surface chose for it — and
 * guessing (`rune:<id>:onAcquire`) would produce an orphan identity for anything bucketed differently. Reusing
 * the same `runeKey`/`questKey` the surface uses is the only way the emitted key and the classified key can be
 * guaranteed to agree.
 */
export function surfaceKeyForRune(id: string): string | undefined {
  const rune = [...RUNES, ...EPIC_RUNES].find((r) => r.id === id);
  return rune ? runeKey(rune) : undefined;
}
export function surfaceKeyForQuest(id: string): string | undefined {
  const quest = QUEST_DEFS.find((q) => q.id === id);
  return quest ? questKey(quest) : undefined;
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
  // An End-of-Turn Discover that auto-resolves (Moira re-firing Black Belt Brian) grants its pick on this beat,
  // so it coalesces into the hand during End-of-Turn playback instead of at the combat hand-off.
  { key: 'system:eotDiscover:grant', users: ['blackbelt'] },
  // A WELDED rally (Better Bot's Mech Attack / Perfect Core's spell conjure) paying out inside a shop rally
  // (Rune of Lasting Cadence at End of Turn) — folded into the rallying minion's own beat.
  { key: 'system:shopRally:weld', users: ['better_bot', 'perfect_core'] },
  // A minion DESTROYED in the shop — the death, its Echo and any Rise, as one ritual on one beat. Not a card
  // factory: several cards reach the same shared destroy path (`destroyMinionInShop`), and the beat belongs to
  // the body that dies, not to the card that killed it.
  { key: 'system:destroy:shopDeath', users: ['graverobber', 'funeralonloan'] },
  // Funeral on Loan's borrowed body ARRIVING and taking its slot — a beat of its own, so the board is seen
  // to hold it before the death beat takes it away again.
  { key: 'system:destroy:shopArrival', users: ['funeralonloan'] },
  // EQUIPMENT (owner handoff 2026-08-28): the grant as a body enters play / re-equips, and one beat per
  // Equipment TRIGGER (repeats included, each carrying its index).
  { key: 'system:equipment:equip', users: ['e3_frank'] },
  { key: 'system:equipment:trigger', users: ['e3_frank'] },
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
