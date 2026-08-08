import type { CombatEvent } from '@game/core';

/**
 * WATCHER-PULSE channel. Which units — OTHER than the beat's attacker — fired an effect inside this attack
 * beat, i.e. the "watchers" that answered an ally's swing (Crypt Drake, Mineral Master, Traveling Skald,
 * Raptor). They earn the distinct light-blue pulse (medallion + card frame) rather than the generic white
 * medallion pulse a Battlecry gets.
 *
 * The signal mirrors `useCombatReplay`'s trigger-medallion scan exactly — a unit is "acting" when it is the
 * `source` of an sc/buff/keyword/summon/toHand event, or the `target` of an improve/maxGold/hpGrant/reborn
 * event — MINUS the death branch (a Deathrattle is not an on-attack reaction) and MINUS the attacker itself
 * (its own rally/effect keeps the attacker's own pulse paths). First-seen order, deduped, so a cascade reads
 * left-to-right. Pure: the whole testable surface of this channel.
 */
export function watcherPulseUids(
  beat: { start: number; end: number },
  events: CombatEvent[],
  attackerUid: string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const take = (uid: string | undefined): void => {
    if (!uid || uid === attackerUid || seen.has(uid)) return;
    seen.add(uid);
    out.push(uid);
  };
  for (let i = beat.start; i < beat.end; i++) {
    const e = events[i];
    if (!e) continue;
    if ((e.type === 'sc' || e.type === 'buff' || e.type === 'keyword') && (e as { source?: string }).source) take((e as { source?: string }).source);
    else if ((e.type === 'summon' || e.type === 'toHand') && (e as { source?: string }).source) take((e as { source?: string }).source);
    else if (e.type === 'improve' || e.type === 'maxGold' || e.type === 'hpGrant' || e.type === 'reborn') take((e as { target?: string }).target);
  }
  return out;
}
