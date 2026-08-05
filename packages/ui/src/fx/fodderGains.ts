/**
 * What a Fodder eat OWES each eater — the fodder analogue of `rubyLandHolds`.
 *
 * A consume emits one event per Fodder swallowed, each naming the Demon that ate it. One Demon can eat
 * several in a single action (Godfodder's pick, a Maw End-of-Turn), and the badge is one badge: withholding
 * per EVENT would put two holds on one uid, and same-rank holds accumulate, so the eater's number would step
 * twice for what the player saw as one gulp. Summing per eater first is what makes the withheld delta match
 * the change the reducer actually made.
 *
 * Pure and separate from `Recruit.tsx` because THREE call sites now place these holds — the mid-shop watcher,
 * the shop-minion consume watcher, and the End-of-Turn beat loop — and each one has to withhold exactly what
 * its own commit raised. One shared derivation makes that structural rather than three copies that agree
 * today.
 */

/** The subset of a `fodderEaten` / `shopEaten` event this arithmetic reads. */
export interface FodderEatEvent {
  eaterUid: string;
  /** Attack this single swallow gave the eater. */
  gainA: number;
  /** Health this single swallow gave the eater. */
  gainH: number;
}

/** One eater's whole withheld delta for a consume. */
export interface FodderGain {
  uid: string;
  attack: number;
  health: number;
}

/**
 * Sum a consume's gains per eater, in first-seen order.
 *
 * A zero-gain eater is dropped rather than returned: a Demon that ate a 0/0 Fodder has nothing to withhold,
 * and `holdStat` would discard the hold anyway — returning it would only invite a caller to believe a badge
 * is mid-delivery when nothing is.
 */
export function fodderGainHolds(events: readonly FodderEatEvent[]): FodderGain[] {
  const byUid = new Map<string, FodderGain>();
  const order: string[] = [];
  for (const ev of events) {
    const cur = byUid.get(ev.eaterUid);
    if (cur === undefined) {
      byUid.set(ev.eaterUid, { uid: ev.eaterUid, attack: ev.gainA, health: ev.gainH });
      order.push(ev.eaterUid);
    } else {
      cur.attack += ev.gainA;
      cur.health += ev.gainH;
    }
  }
  return order.map((uid) => byUid.get(uid)!).filter((g) => g.attack !== 0 || g.health !== 0);
}
