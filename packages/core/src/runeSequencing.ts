import type { CardDef } from './types';
import { NO_COPY_SPELL_IDS } from './effects/factories';

/**
 * RUNE OF SEQUENCING (Set 2 Epic Dragon rune, owner design 2026-11-14): "When you cast 3 different spells, get a copy
 * of the first one."
 *
 * ONE sequence per run, shared by every phase (R-PHASE-01, R-REALTIME-01): a Shop cast, an End of Turn cast and a combat
 * cast all advance the SAME list. The run holds it (`RunState.runeSequence`), the fight receives it on the side's mods
 * (`QuestCombatMods.runeSequence`), advances it per combat cast and hands the final list home
 * (`ShoutCarry.runeSequence`). This module is the one rule both phases call, so the Shop and combat cannot drift:
 *
 *  - a spell whose id is NOT in the sequence joins it; a repeat does nothing (it neither counts nor resets);
 *  - the third different spell pays: a copy of the FIRST spell of the sequence (one per copy of the rune held), and
 *    the sequence starts over empty;
 *  - a spell that can never be copied joins nothing: a reward token, a Gift (a Clue included; the standing
 *    "a Gift is never copy food" rule) and `NO_COPY_SPELL_IDS` (Second Draft). So a sequence never pays a dud.
 */
export const SEQUENCING_DISTINCT = 3;

/** Can this spell join a Sequencing sequence? */
export function sequencingCounts(def: CardDef | undefined): def is CardDef {
  return !!def && !def.token && !def.gift && !NO_COPY_SPELL_IDS.has(def.id);
}

/**
 * One cast against the current sequence. Returns null when the cast changes nothing (an uncountable spell, or a
 * repeat). Otherwise the new sequence, and `pay` = the id of the spell to copy when this cast completed it (the new
 * sequence is then empty).
 */
export function advanceSequence(seq: readonly string[] | undefined, def: CardDef | undefined): { seq: string[]; pay?: string } | null {
  if (!sequencingCounts(def)) return null;
  const cur = seq ?? [];
  if (cur.includes(def.id)) return null;
  const next = [...cur, def.id];
  if (next.length < SEQUENCING_DISTINCT) return { seq: next };
  return { seq: [], pay: next[0]! };
}
