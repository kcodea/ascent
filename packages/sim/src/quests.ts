import { makeRng, type QuestTier, type Tribe } from '@game/core';
import { CARD_INDEX, QUEST_DEFS } from '@game/content';
import { mixSeed, TAG, type RunState } from './state';

/** The three quest-turns and their tiers: wave 4 → lesser, 8 → greater, 12 → capstone; null otherwise. */
export function questTierForWave(wave: number): QuestTier | null {
  return wave === 4 ? 'lesser' : wave === 8 ? 'greater' : wave === 12 ? 'capstone' : null;
}

/** The player's most-played board tribe (most minions of one non-neutral tribe; dual-types count for both),
 *  or null on an empty/all-neutral board OR a tie at the top. Drives the wave-8/12 "your tribe's quest is
 *  offered" guarantee — a tie means no clear identity yet, so the tribe slots stay random. */
function dominantTribe(s: RunState): Tribe | null {
  const counts = new Map<Tribe, number>();
  for (const c of s.board) {
    const def = CARD_INDEX[c.cardId];
    for (const t of [def?.tribe, def?.tribe2]) {
      if (!t || t === 'neutral') continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  let best: Tribe | null = null;
  let bestN = 0;
  let tied = false;
  for (const [t, n] of counts) {
    if (n > bestN) { best = t; bestN = n; tied = false; }
    else if (n === bestN) tied = true;
  }
  return tied ? null : best;
}

/**
 * Generate the quest offer for a quest-wave (4/8/12): always a **neutral** quest plus **2 distinct-tribe**
 * quests, all of the wave's tier. Seeded off (seed, wave) in its own RNG stream (`TAG.QUEST`) so it's
 * reproducible and never perturbs the shop roll. Waves 8 & 12 force at least one tribe slot to the player's
 * most-played board tribe (a chance at the second, once a tribe has ≥2 quests of the tier); wave 4 is
 * free-steering (random distinct tribes). Returns quest ids (0–3). An EMPTY result (no content for the tier)
 * signals "no quest phase" — the caller falls through to a normal turn, so a content gap can't soft-lock.
 */
export function generateQuestOffer(s: RunState): string[] {
  const tier = questTierForWave(s.wave);
  if (!tier) return [];
  const rng = makeRng(mixSeed(s.seed, s.wave, TAG.QUEST));
  const pool = QUEST_DEFS.filter((q) => q.tier === tier);
  const idsOf = (t: Tribe): string[] => pool.filter((q) => q.tribe === t).map((q) => q.id);
  const pick = (ids: string[]): string | null => (ids.length ? ids[rng.int(ids.length)]! : null);

  const offer: string[] = [];
  // 1) Neutral — the always-offered, build-agnostic slot.
  const neutral = pick(idsOf('neutral'));
  if (neutral) offer.push(neutral);

  // 2) Two tribe slots (distinct non-neutral tribes).
  const tribes: Tribe[] = [...new Set(pool.map((q) => q.tribe))].filter((t) => t !== 'neutral');
  const chosen: Tribe[] = [];
  const dom = tier !== 'lesser' ? dominantTribe(s) : null;
  if (dom && tribes.includes(dom)) {
    chosen.push(dom);
    // Chance at a 2nd dominant slot — only bites once a tribe has ≥2 quests of the tier (skinny pool: off).
    if (idsOf(dom).length >= 2 && rng.int(2) === 0) chosen.push(dom);
  }
  // Fill the remaining tribe slots with random DISTINCT tribes (seeded Fisher–Yates over the leftovers).
  const rest = tribes.filter((t) => !chosen.includes(t));
  for (let i = rest.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  while (chosen.length < 2 && rest.length) chosen.push(rest.shift()!);
  for (const t of chosen) {
    const id = pick(idsOf(t));
    if (id) offer.push(id);
  }
  return offer;
}
