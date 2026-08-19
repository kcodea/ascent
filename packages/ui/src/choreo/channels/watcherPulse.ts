import type { CombatEvent } from '@game/core';

/**
 * WATCHER-PULSE channel. Which units — a non-attacker unit (any side, mirroring the trigger scan) — fired an
 * effect inside this attack beat, i.e. the "watchers" that answered the attacker's swing (Crypt Drake, Mineral
 * Master, Traveling Skald, Raptor). They earn the distinct light-blue pulse (medallion + card frame) rather
 * than the generic white medallion pulse a Battlecry gets.
 *
 * The signal mirrors `useCombatReplay`'s trigger-medallion scan exactly — a unit is "acting" when it is the
 * `source` of an sc/buff/keyword/summon/toHand/rally event, or the `target` of an improve/maxGold/hpGrant/reborn
 * event — MINUS the death branch (a Deathrattle is not an on-attack reaction) and MINUS the attacker itself
 * (its own rally/effect keeps the attacker's own pulse paths). First-seen order, deduped, so a cascade reads
 * left-to-right. Pure: the whole testable surface of this channel.
 *
 * `rally` earns a pulse (owner call 2026-08-19) because a card that PROCS someone else's Echo off an ally's
 * swing — Hawkus — is a watcher in exactly the sense above, and its `rally` cue was the only trace it left.
 * Without this it read as nothing: the Echo it fired animated, but the card that caused it never lit up.
 * The attacker guard is what keeps this from double-counting the OTHER shape of the same event — Echohorn
 * procs off its own swing, so it IS the attacker and keeps its existing attacker pulse rather than gaining a
 * second, differently-coloured one.
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
    if ((e.type === 'sc' || e.type === 'buff' || e.type === 'keyword' || e.type === 'rally') && e.source) take(e.source);
    else if ((e.type === 'summon' || e.type === 'toHand') && e.source) take(e.source);
    else if (e.type === 'improve' || e.type === 'maxGold' || e.type === 'hpGrant' || e.type === 'reborn') take(e.target);
  }
  return out;
}
