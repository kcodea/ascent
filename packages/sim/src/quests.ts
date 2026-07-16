import { makeRng, type QuestDef, type Tribe } from '@game/core';
import { CARD_INDEX, QUEST_DEFS } from '@game/content';
import { CONFIG } from './config';
import { getHero } from './heroes';
import { mixSeed, TAG, type RunState } from './state';

/** The two quest-turn buckets (owner 2026-07-13 — consolidated from three tiers/turns to two). Turn 5 = the
 *  "early" pool (Lesser + most Greater quests); turn 11 = the "late" pool (Capstones, plus the two Greater
 *  neutrals — Ancient Runes & Last Rites — promoted into the late slot per the owner's table). The quest's
 *  `tier` field is retained for other semantics (Fi's Lesser-only filter, reward pools). */
export function questBucketFor(q: QuestDef): 5 | 11 {
  return q.wave ?? (q.tier === 'capstone' ? 11 : 5);
}

/** The quest-offer plan for the current turn: which bucket to draw from, and whether it's restricted to Lesser
 *  quests (Fi's bonus turn-4 offer). Null = not a quest turn for this run/hero.
 *
 *  `CONFIG.questsEnabled = false` is the master off-switch for the UNIVERSAL quest turns (waves 5 & 11) — the
 *  ones every hero gets. The quest-NATIVE hero powers (Fi's Errand, Coran's Pathfinder) are checked ABOVE that
 *  gate, so those heroes keep their own quest access even when the universal system is off (mirrors how the
 *  runeforge system leaves Runesmith/Runeguard native access intact). Chronos's quest-flavoured power isn't
 *  here at all — it's a buy-counter reward, unaffected either way. */
export type QuestOfferPlan = { bucket: 5 | 11; lesserOnly?: boolean };
export function questOfferPlan(s: RunState): QuestOfferPlan | null {
  const hp = getHero(s.heroId).power.kind;
  // Quest-native hero powers — kept above the master gate so they survive `questsEnabled = false`.
  // Fi's Errand: a bonus LESSER-only offer on turn 4 (from the turn-5 bucket), ON TOP of the normal turns 5 & 11.
  if (hp === 'lesserQuest' && s.wave === 4) return { bucket: 5, lesserOnly: true };
  // Coran (Pathfinder): a bonus CAPSTONE (turn-11 bucket) quest on turn 10, ON TOP of the normal 5 & 11 turns —
  // so he falls through to the universal logic below for those (an early return only on turn 10).
  if (hp === 'pathfinder' && s.wave === 10) return { bucket: 11 };
  // The universal quest turns — gated by the master switch.
  if (!CONFIG.questsEnabled) return null;
  if (s.wave === 5) return { bucket: 5 };
  if (s.wave === 11) return { bucket: 11 };
  return null;
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
 * Generate the quest offer for a quest turn: always a **neutral** quest plus **3 distinct-tribe** quests (4
 * total) drawn from the plan's bucket. Seeded off (seed, wave) in its own RNG stream (`TAG.QUEST`) so it's
 * reproducible and never perturbs the shop roll. The two main quest turns (5 & 11) force at least one tribe slot
 * to the player's most-played board tribe (a chance at the second, once a tribe has ≥2 quests in the bucket);
 * Fi's bonus Lesser-only turn-4 offer is free-steering (random distinct tribes). Quests you've ALREADY taken this
 * run are excluded, and no quest can appear twice in one offer. Returns quest ids (0–4). An EMPTY result signals
 * "no quest phase" — the caller falls through to a normal turn, so a content gap can't soft-lock.
 */
export function generateQuestOffer(s: RunState, plan: QuestOfferPlan): string[] {
  const rng = makeRng(mixSeed(s.seed, s.wave, TAG.QUEST));
  // Never re-offer a quest you already hold (taken/active/completed), and never repeat a quest within one offer.
  const taken = new Set((s.activeQuests ?? []).map((aq) => aq.questId));
  const pool = QUEST_DEFS.filter(
    (q) => questBucketFor(q) === plan.bucket && (!plan.lesserOnly || q.tier === 'lesser') && !taken.has(q.id),
  );
  const used = new Set<string>();
  const idsOf = (t: Tribe): string[] => pool.filter((q) => q.tribe === t && !used.has(q.id)).map((q) => q.id);
  const pick = (ids: string[]): string | null => (ids.length ? ids[rng.int(ids.length)]! : null);
  const offer: string[] = [];
  const take = (ids: string[]): void => { const id = pick(ids); if (id) { used.add(id); offer.push(id); } };

  // 1) Neutral — the always-offered, build-agnostic slot.
  take(idsOf('neutral'));

  // 2) Three tribe slots (distinct non-neutral tribes).
  const tribes: Tribe[] = [...new Set(pool.map((q) => q.tribe))].filter((t) => t !== 'neutral');
  const chosen: Tribe[] = [];
  // Guarantee the player's dominant tribe on the two main quest turns; Fi's bonus Lesser offer stays free-steering.
  const dom = plan.lesserOnly ? null : dominantTribe(s);
  if (dom && tribes.includes(dom)) {
    chosen.push(dom);
    // Chance at a 2nd dominant slot — only bites once a tribe has ≥2 quests of the tier.
    if (idsOf(dom).length >= 2 && rng.int(2) === 0) chosen.push(dom);
  }
  // Fill the remaining tribe slots with random DISTINCT tribes (seeded Fisher–Yates over the leftovers).
  const rest = tribes.filter((t) => !chosen.includes(t));
  for (let i = rest.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  const TRIBE_SLOTS = 3;
  while (chosen.length < TRIBE_SLOTS && rest.length) chosen.push(rest.shift()!);
  // `take` marks each picked id used, so a second dominant slot draws a DIFFERENT quest of that tribe.
  for (const t of chosen) take(idsOf(t));
  return offer;
}
