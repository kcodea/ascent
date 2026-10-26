import type { Tribe } from '@game/core';
import { SETS, activeSet, type SetId } from '@game/content';
import { PLAYABLE_TRIBES, runTribesForSeed, type PracticeConfig, type PracticeTribe, type RunState } from './state';

/**
 * PRACTICE TRIBES (owner 2026-09-27: "change tribe surge to that tribe's cards plus neutral cards, and all spells
 * associated, but make it multi select. so i can choose demons + dragons and have demons/dragons/neutrals in the
 * game. reword 'none' to 'Normal'").
 *
 * The Practice "Tribes" row picks the run's ACTIVE TRIBES outright. Everything that already follows
 * `RunState.tribes` (the stocked pool, every shop roll, Discovers and generated cards, the spell pool, the rune
 * and quest tribe gates, and the hero offer's TRIBE GATE) then yields only those tribes plus neutral. An empty
 * pick is "Normal": the usual random roll from the run's seed.
 */

/** The tribes the Practice row offers: the tribes of the set a NEW run is created on (the same `activeSet()`
 *  `createRun` defaults to), in that set's order, so the row never offers another set's tribe (owner
 *  2026-09-27: "practice tribe surge should only have the active set's tribes"). */
export function practiceTribeOptions(setId: SetId = activeSet().id): PracticeTribe[] {
  return (SETS[setId]?.tribes ?? PLAYABLE_TRIBES).filter((t): t is PracticeTribe => t !== 'neutral');
}

/** A picked list cleaned against the set: only the set's tribes, each once, in the set's order. Anything else
 *  (a tribe from another set, junk from an old saved draft) is dropped; an empty result means Normal. */
export function normalizePracticeTribes(raw: unknown, setId: SetId = activeSet().id): PracticeTribe[] {
  if (!Array.isArray(raw)) return [];
  const picked = new Set(raw.filter((t): t is string => typeof t === 'string'));
  return practiceTribeOptions(setId).filter((t) => picked.has(t));
}

/**
 * One click on the row. `null` is Normal and is exclusive: picking it clears every tribe. Picking a tribe
 * clears Normal (adds the tribe); picking a lit tribe unpicks it, and unpicking the last returns to Normal.
 * The result is kept in the set's order.
 */
export function togglePracticeTribe(current: readonly PracticeTribe[], pick: PracticeTribe | null, setId: SetId = activeSet().id): PracticeTribe[] {
  if (pick === null) return [];
  const next = current.includes(pick) ? current.filter((t) => t !== pick) : [...current, pick];
  return normalizePracticeTribes(next, setId);
}

/** The tribes a Practice run created from `seed` plays with: the picked tribes when there are any, else the usual
 *  seeded roll. Shared by the hero offer (rolled before the run exists) and `createLobbyRun`, so the heroes the
 *  picker shows are gated by the same tribes the run then gets. */
export function practiceRunTribes(seed: number, config: Pick<PracticeConfig, 'tribes' | 'setId'> | undefined, setId: SetId = practiceSetOf(config)): Tribe[] {
  const picked = normalizePracticeTribes(config?.tribes, setId);
  return picked.length > 0 ? picked : runTribesForSeed(seed, setId);
}

/**
 * PRACTICE'S DEV SET PICKER (owner 2026-10-26: "can you add a dev only practice option in sandbox to select the set to
 * practice with? this would then just use the bot runs for that sandbox test environment.").
 *
 * The set a Practice game is created on: the config's `setId` when it names a defined set, else the live one (the same
 * `activeSet()` `createRun` defaults to). A NEW-RUN question only, like `practiceTribeOptions`: a run already created
 * reads its pinned set through `poolOf(state)`.
 */
export function practiceSetOf(config: Pick<PracticeConfig, 'setId'> | undefined): SetId {
  const id = config?.setId;
  return id && Object.prototype.hasOwnProperty.call(SETS, id) ? id : activeSet().id;
}

/** Every defined set for the dev-only Set row, in registry order, labelled by its display name; `live` marks the one
 *  new runs use today. */
export function practiceSetOptions(): { id: SetId; name: string; live: boolean }[] {
  const live = activeSet().id;
  return Object.values(SETS).map((s) => ({ id: s.id, name: s.name, live: s.id === live }));
}

/** Was this run created as a DEV-SET Practice game (a set other than the live one)? `createLobbyRun` keeps
 *  `practiceConfig.setId` on the run only then, so this stays true for the run's life whatever the live switch does
 *  later. Such a game writes nothing: no Practice row, no XP (its seats are generated bots on an unreleased set). */
export function isPracticeDevSetRun(run: Pick<RunState, 'mode' | 'practiceConfig'>): boolean {
  return run.mode === 'practice' && !!run.practiceConfig?.setId;
}
