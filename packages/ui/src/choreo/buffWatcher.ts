import { bindingDefIds, bindingFor, sourceBuffDefFor } from './bindings';
import { playDef } from '../fx/playDef';
import { SOURCE_CASCADE_MS } from './sourceCascade';
import type { RecruitMoment } from './recruitMoments';

/**
 * Each BUFFER's turn in a Shop buff wave (R-FX-BUFF-WATCHER-01): two Beardsleys buffing one summoned Beast play one
 * after the other, `SOURCE_CASCADE_MS` apart, not on top of each other (the same gap combat's left-most-first cascade
 * uses). Ranks go by first appearance, counting only buffers with their own buff effect; a buffer's rank is the same
 * for its bite on each minion and its On Watcher effect, so they stay together.
 */
export function buffSourceRanks(events: readonly { sourceCardId: string; sourceUid?: string }[]): Map<string, number> {
  const ranks = new Map<string, number>();
  for (const e of events) {
    if (!e.sourceUid || ranks.has(e.sourceUid) || !bindingFor(e.sourceCardId, 'minionBuffed')) continue;
    ranks.set(e.sourceUid, ranks.size);
  }
  return ranks;
}

/** The delay for a buffer of rank `rank` (0 = now). */
export const buffSourceDelayMs = (rank: number | undefined): number => (rank ?? 0) * SOURCE_CASCADE_MS;

/**
 * Does `cardId` play its own effect on each minion it buffs? A `minionBuffed` def (the Shop) or a `buffWave`
 * `buffed` def (combat). Only such a buffer plays its On Watcher effect on ITSELF as it buffs (R-FX-BUFF-WATCHER-01).
 */
export function hasOwnBuffFx(cardId: string | null): boolean {
  return !!cardId && (!!bindingFor(cardId, 'minionBuffed') || sourceBuffDefFor(cardId) !== null);
}

/**
 * The buffer's own On Watcher effect, played FROM the buffer TO one minion it buffs, while its per-target def lands on
 * that minion (Kennelmaster: `beast-buff-bite-watcher` from Kennelmaster to each Beast, `beast-buff-bite` on the Beast).
 * Callers play it once per minion buffed, so a travel layer (a beam, a particle stream) crosses to each one; with
 * Follow source on, each end rides its own card as it moves. With no `to` it plays on the buffer alone. `muteSound`
 * plays the visuals only, for every play after the first in one trigger, so a fan-out rings once.
 */
export function playBuffSourceWatcher(
  cardId: string | null,
  uid: string | null,
  at: { x: number; y: number },
  to?: { uid: string | null; at: { x: number; y: number } },
  muteSound = false,
): void {
  if (!hasOwnBuffFx(cardId)) return;
  const b = bindingFor(cardId, 'watcher');
  if (!b) return;
  const target = to?.at ?? at;
  for (const id of bindingDefIds(b)) {
    playDef(id, { source: at, target, cursor: target }, { uids: { source: uid, target: to ? to.uid : uid }, gain: b.gain, muteSound });
  }
}

/**
 * ONE BITE PER MINION per Shop action (owner 2026-11-09; combat does the same in useCombatReplay): when several buffers with the same buff effect hit one minion
 * (two Beardsleys on a summoned Beast), only the first buffer's effect lands on it; each buffer still plays its own
 * On Watcher effect. Only buffers WITH a watcher (the Beast bite): Karwind's rings still play per buffer. A later buffer's moment keeps only the minions no earlier one already bit, and is dropped when
 * none are left. Other moments pass through untouched.
 */
export function oneBitePerTarget(moments: readonly RecruitMoment[]): RecruitMoment[] {
  const bitten = new Set<string>();
  const out: RecruitMoment[] = [];
  for (const m of moments) {
    const def = m.kind === 'minionBuffed' && m.sourceCardId && bindingFor(m.sourceCardId, 'watcher') ? bindingFor(m.sourceCardId, 'minionBuffed')?.def : undefined;
    if (!def) { out.push(m); continue; }
    const recipients = m.recipients.filter((r) => !bitten.has(`${def}|${r.uid}`));
    for (const r of recipients) bitten.add(`${def}|${r.uid}`);
    if (recipients.length === 0) continue;
    out.push(recipients.length === m.recipients.length ? m : { ...m, recipients });
  }
  return out;
}
