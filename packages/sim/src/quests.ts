import { makeRng, type QuestDef, type Tribe } from '@game/core';
import { CARD_INDEX, QUEST_DEFS } from '@game/content';
import { setIdOf } from './cardPool';
import { CONFIG, QUESTS_ARCHIVED } from './config';
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
 *  ⚠️ ARCHIVED 2026-08-28 (owner). `QUESTS_ARCHIVED` short-circuits this to `null` before anything below runs;
 *  the rest of this docblock describes the system as it behaves once un-archived.
 *
 *  `CONFIG.questsEnabled = false` is the master off-switch for the UNIVERSAL quest turns (waves 5 & 11) — the
 *  ones every hero gets. The quest-NATIVE hero powers (Fi's Errand, Coran's Pathfinder) are checked ABOVE that
 *  gate, so those heroes keep their own quest access even when the universal system is off (mirrors how the
 *  runeforge system leaves Runesmith/Runeguard native access intact). Chronos's quest-flavoured power isn't
 *  here at all — it's a buy-counter reward, unaffected either way. */
export type QuestOfferPlan = { bucket: 5 | 11; lesserOnly?: boolean } | { heroQuest: string };
export function isHeroQuestPlan(p: QuestOfferPlan): p is { heroQuest: string } {
  return 'heroQuest' in p;
}
export function questOfferPlan(s: RunState): QuestOfferPlan | null {
  // ── THE ARCHIVE GATE (owner ruling 2026-08-28) ─────────────────────────────────────────────────────────
  // The quest system is archived. This is the ONLY function that can mint a quest offer — both mint sites
  // (`createRun` in state.ts for the turn-1 hero quest, and the turn advance in reducer.ts for every other
  // turn) call it and generate nothing when it returns null. So one `return null` here makes the whole
  // system inert in every mode, on every seed, for every hero: no offer → no `questOffer` → the overlay
  // never opens, `buyQuest` never has an index to buy, `activeQuests` stays empty and objectives never tick.
  //
  // It sits ABOVE the hero-native checks on purpose. `CONFIG.questsEnabled` never could archive the system
  // because the quest-NATIVE heroes were checked above it by design; Fi and Coran are now `wip` as well
  // (heroes.ts), so this gate and that flag close the same door from both sides.
  //
  // Everything below is retained verbatim, unreachable, so un-archiving is a one-line revert.
  if (QUESTS_ARCHIVED) return null;
  const hp = getHero(s.heroId).power.kind;
  // HERO QUESTS (Fi / Coran, owner rework 2026-08-21) — a TURN-1 two-option Discover from that hero's own
  // private quest list. This replaced both heroes' old powers outright (Fi's turn-4 Errand, Coran's turn-10
  // Pathfinder), so there is no bonus universal offer left to fall through to: they take the normal turn-5 and
  // turn-11 quests like everyone else, plus this one on turn 1. Above the master gate for the same reason the
  // old quest-native powers were — a hero whose whole power is a quest keeps it when the universal system is off.
  if (hp === 'heroQuest' && s.wave === 1) return { heroQuest: s.heroId };
  // RETIRED quest-native powers. Kept live so a saved/replayed run created before the rework still resolves its
  // offers exactly as it did then — the hero defs no longer produce these kinds.
  if (hp === 'lesserQuest' && s.wave === 4) return { bucket: 5, lesserOnly: true };
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
  if (isHeroQuestPlan(plan)) return heroQuestOffer(plan.heroQuest, taken, rng);
  // SET + TRIBE SCOPING (owner 2026-07-29). Two filters, both guarding against offering a quest that cannot be
  // completed in THIS run:
  //   · `sets` — the set-1 and set-2 quest lists are different, and a quest naming another set's mechanics
  //     (Fodder, Attachments, Rubies, Ales) is unwinnable. Absent = general, offerable anywhere.
  //   · the run's own TRIBES — the offer's tribe slots were drawn from whatever the POOL contained, so a run
  //     could be handed a Mech quest with no Mechs in its roster at all. A quest for a tribe you don't have is
  //     dead on arrival; `neutral` is always allowed because it's the build-agnostic slot.
  const runSet = setIdOf(s);
  const runTribes = new Set<Tribe>([...(s.tribes ?? []), 'neutral']);
  const pool = QUEST_DEFS.filter(
    // A hero quest belongs to ONE hero's turn-1 Discover and is never drawn by the universal offer. Filtered
    // here rather than by tribe/tier so the two systems can share the quest list, the `ActiveQuest` progress
    // machinery, the reward engine and the badge row without either being able to leak into the other.
    (q) => !q.heroQuest
      && questBucketFor(q) === plan.bucket
      && (!plan.lesserOnly || q.tier === 'lesser')
      && !taken.has(q.id)
      && (!q.sets || q.sets.includes(runSet))
      && runTribes.has(q.tribe),
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

/**
 * The turn-1 HERO QUEST offer: **two** options from this hero's own list (owner spec 2026-08-21).
 *
 * The one rule beyond "pick two": **at most one quest per `variantGroup`.** Opening Act (Fi) and Resonant Path
 * (Coran) are each three quests — a Shout, an Echo and a Rally variant — and offering two of a family would
 * hand the player a choice between two spellings of the same card, which is no choice at all. Picking the
 * FIRST option burns its whole family out of the pool before the second is drawn.
 *
 * Fewer than two survivors is fine and cannot soft-lock: the caller treats an empty result as "no quest
 * phase", and a single-option offer is still a legal (if unexciting) pick.
 */
function heroQuestOffer(heroId: string, taken: Set<string>, rng: ReturnType<typeof makeRng>): string[] {
  let pool = QUEST_DEFS.filter((q) => q.heroQuest === heroId && !taken.has(q.id));
  const offer: string[] = [];
  const SLOTS = 2;
  while (offer.length < SLOTS && pool.length > 0) {
    const pick = pool[rng.int(pool.length)]!;
    offer.push(pick.id);
    // Drop the pick AND — for a variant family — every sibling of it.
    pool = pool.filter((q) => q.id !== pick.id && (!pick.variantGroup || q.variantGroup !== pick.variantGroup));
  }
  return offer;
}
