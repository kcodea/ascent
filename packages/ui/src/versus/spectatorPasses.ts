/**
 * THE STANDS SEE EVERY PASS (owner report 2026-11-02: "im spectating and antsy died and i didnt see the pass animation";
 * R-SPECTATE-DUOS-PASS-01). A seated Duos player's screen plays a pass's stream from its own transport: a send as the
 * outbox entry ships (`duosPasses.ts`, held for its `teamSend` beat when it is a fight's gift), an arrival as the row
 * lands in the hand. A spectator runs no transport (it sends nothing and lands nothing), so it plays the same streams
 * from what it receives: the watched player's run, frame by frame. Between two frames of the SAME watched run:
 *  - every new outbox entry is a send (a shop pass or an effect pass streams as the frame lands; a fight's gift waits
 *    for its `teamSend` beat on this screen's own replay, exactly as the player's did: `duosCombat.tsx`);
 *  - every newly received pass key that put a card in the hand is an arrival into that card's slot (none when the card
 *    completed a triple: the Gild plays instead, as on the player's screen).
 * Pure: no DOM, no store. Deterministic from the two runs alone.
 */
import type { RunState } from '@game/sim';

type DuosRun = Pick<RunState, 'runId' | 'hand' | 'duos' | 'triplesMade'>;
export type WatchedSend = NonNullable<RunState['duos']>['outbox'][number];

export interface WatchedPasses {
  /** New outbox entries to stream now (never a fight's gift: those wait for their beat). */
  sends: WatchedSend[];
  /** Hand uids a pass just landed as (stream out of the teammate portrait into them). */
  arrivals: string[];
}

const NONE: WatchedPasses = { sends: [], arrivals: [] };

/** What passed between `prev` and `next` (the same watched run, consecutive on screen). */
export function watchedPasses(prev: DuosRun | null | undefined, next: DuosRun | null | undefined): WatchedPasses {
  if (!prev || !next || prev.runId !== next.runId || !next.duos) return NONE;
  // A run that had no Duos state yet (its first frame) shows nothing: there is no "before" to compare with.
  if (!prev.duos) return NONE;
  const had = prev.duos.outbox.length;
  const sends = next.duos.outbox.length > had
    ? next.duos.outbox.slice(had).filter((e) => !e.refunded && e.combatIdx == null)
    : [];
  const before = new Set(prev.duos.received);
  const fresh = next.duos.received.filter((k) => !before.has(k));
  let arrivals: string[] = [];
  if (fresh.length && (next.triplesMade ?? 0) === (prev.triplesMade ?? 0)) {
    const inHand = new Set(prev.hand.map((c) => c.uid));
    const added = next.hand.filter((c) => !inHand.has(c.uid));
    const keys = new Set(fresh);
    arrivals = added.filter((c) => c.passKey && keys.has(c.passKey)).map((c) => c.uid);
    // A teammate's GIFT (a team effect that made a card here) lands with no pass key: the cards it added, one per key.
    const spare = fresh.length - arrivals.length;
    if (spare > 0) arrivals.push(...added.filter((c) => !c.passKey).slice(0, spare).map((c) => c.uid));
  }
  return sends.length || arrivals.length ? { sends, arrivals } : NONE;
}

/** A drag pass (the player's own drop, no effect behind it): its stream leaves the card itself. */
export const isDragPass = (e: WatchedSend): boolean => !e.team && !e.via;
