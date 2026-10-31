import type { CardDef, QuestReward, Tribe } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, QUEST_DEFS, RUNES, forkedCardId, type SetId } from '@game/content';

/**
 * The Compendium's REWARD buckets, per SET (owner report 2026-10-26: "searching mech returns this minion, which
 * isnt even possible in set 2 - but the other mechs from rune rewards don't show up. like clockwork assistant and
 * wanderer").
 *
 * The old lists walked EVERY rune / quest in the registry, so a Set-1-only rune's minion (Reconfigurator, from
 * Rune of Reconfiguration, `sets: ['set1']`) was listed in a Set-2 book. The truth is the same set test the game
 * itself applies when it offers or hands out a rune or quest: `sets` absent means every set, otherwise it must
 * name the set (`runeforgePool` / `grantRune` / the quest draw). A rune whose tribe gate the set never rolls is
 * still reachable through `grantRune` (Spare Forge / Runic Passage draw by set only), and the Runes tab lists by
 * the same set test, so Rune Rewards mirrors exactly the runes that tab shows. Ids go through `forkedCardId`, the
 * id a grant actually delivers in that set.
 */

/** The fixed card ids a reward hands over (named `cards` / `grantGolden` grants and recurring grants, nested
 *  `multi` rewards included). Random-tier / random-tribe / random-filter grants have no fixed card to show. */
function walkRewardIds(r: QuestReward, out: (id: string) => void): void {
  if (r.kind === 'grant') {
    for (const id of r.cards ?? []) out(id);
    for (const id of r.grantGolden ?? []) out(id);
  } else if (r.kind === 'recurringGrant') {
    for (const id of r.cards) out(id);
  } else if (r.kind === 'multi') {
    for (const sub of r.rewards) walkRewardIds(sub, out);
  }
}

const inSet = (setId: SetId) => (d: { sets?: readonly string[] }): boolean => !d.sets || d.sets.includes(setId);

const runeRewardsBySet = new Map<string, readonly CardDef[]>();
/** Every card a rune offered in `setId` (Basic or Epic forge) can hand you by name. Memoized; sets are immutable.
 *  The Duos-only runes (`duos: true`, Megamimed's Megamimic) count only with `duos` on: the Compendium's Duos toggle
 *  (owner ask 2026-10-30). Off, the book lists what a regular run's forge offers. */
export function runeRewardCardsFor(setId: SetId, duos = false): readonly CardDef[] {
  const key = `${setId}:${duos ? 'duos' : 'reg'}`;
  const hit = runeRewardsBySet.get(key);
  if (hit) return hit;
  const ids = new Set<string>();
  for (const rune of [...RUNES, ...EPIC_RUNES].filter(inSet(setId)).filter((r) => duos || !r.duos)) walkRewardIds(rune.reward, (id) => ids.add(forkedCardId(setId, id)));
  const out = [...ids].map((id) => CARD_INDEX[id]).filter((c): c is CardDef => !!c);
  runeRewardsBySet.set(key, out);
  return out;
}

const questRewardsBySet = new Map<SetId, readonly { card: CardDef; tribe: Tribe }[]>();
/** Every card a quest offered in `setId` can grant, tagged with the granting quest's tribe for run-scoping
 *  (neutral wins when quests of several tribes grant it, since neutral quests are always offered). */
export function questRewardCardsFor(setId: SetId): readonly { card: CardDef; tribe: Tribe }[] {
  const hit = questRewardsBySet.get(setId);
  if (hit) return hit;
  const byId = new Map<string, Tribe>();
  for (const q of QUEST_DEFS.filter(inSet(setId))) {
    walkRewardIds(q.reward, (raw) => {
      const id = forkedCardId(setId, raw);
      if (byId.get(id) !== 'neutral') byId.set(id, q.tribe);
    });
  }
  const out = [...byId]
    .map(([id, tribe]) => ({ card: CARD_INDEX[id], tribe }))
    .filter((x): x is { card: CardDef; tribe: Tribe } => !!x.card);
  questRewardsBySet.set(setId, out);
  return out;
}
