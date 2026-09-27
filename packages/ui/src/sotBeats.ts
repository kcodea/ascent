/**
 * START OF TURN BEATS (R-SOT-BEAT-01). Owner 2026-09-26: "this also does not have a start of turn beat, please wire one
 * in and make sure we bake time for the screen wipe transition." Owner 2026-09-27 (every source): "yes they all need
 * their own beat, and the timer/turn shouldnt start until after they complete. also, they need to wait until the
 * transition back from combat finishes."
 *
 * Every Start-of-Turn effect resolves inside `resolveCombat`, which the Shop dispatches while the return-to-shop curtain
 * fully covers the scene (`coveredOut`). Anything played at that moment plays UNDER the blue. So the sim records each
 * Start-of-Turn SOURCE as its own beat (`RunState.sotBeatFx`, gated by `sotBeatFxSeq`; the recorder is
 * `packages/sim/src/sotBeat.ts`) and this module plans how the Shop presents the batch, DOM-free so the timing rules are
 * testable:
 *
 *   · nothing plays until the wipe is fully at rest on a revealed Shop (`sotBeatsMayPlay`), plus a short pad so the
 *     first beat does not land on the reveal's last frame;
 *   · each source gets its OWN beat, in the order the sim applied them: the source pulses first (the hero-power
 *     button, the minion's medallion, the rune / quest badge, the Equipment slot + its body), then every recipient's
 *     gain lands one after another, then every new card arrives (hand, board, shop), then a tail before the next beat;
 *   · everything a beat produced is HELD until its cue: the recipients' shown stats stay at their pre-grant values
 *     (`holdSotGains`, a DELTA off the real stats, so a Shop action taken mid-beat still reads right) and the new cards
 *     stay out of their rows (`holdSotBeats`), each released by the cue that lands it;
 *   · the TURN TIMER does not tick until the whole batch has played (`turnClockMayTick`'s `startOfTurnPlaying`), and
 *     the Shop's offers (a Discover a Start-of-Turn rune raised) open after it too.
 *
 * Presentation only — the run state committed at `resolveCombat`; skipping or missing a beat changes nothing.
 */
import type { SotBeatFx } from '@game/sim';
import type { WipeState } from './wipeMachine';

/** Breath between the return wipe coming fully to rest and the first Start-of-Turn beat. */
export const SOT_POST_WIPE_PAD_MS = 300;
/** From a beat's source pulse to its first gain landing (the pulse reads first, then the payoff). */
export const SOT_PULSE_LEAD_MS = 260;
/** Between two recipients' gains inside one beat. */
export const SOT_GAIN_STAGGER_MS = 70;
/** After a beat's last gain, before the next beat's pulse. */
export const SOT_BEAT_TAIL_MS = 420;

/** A Start-of-Turn beat may play only on a REVEALED Shop: the recruit phase with the wipe fully idle. */
export function sotBeatsMayPlay(phase: string, wipe: WipeState): boolean {
  return phase === 'recruit' && wipe === 'idle';
}

/** Between two new cards' arrivals inside one beat. */
export const SOT_ARRIVE_STAGGER_MS = 120;
/** A beat with NO consequence on screen (a re-equip, a Discover queued, a charge armed) is its pulse alone, so it gets
 *  a shorter tail: the next source's pulse follows once this one has read. */
export const SOT_QUIET_TAIL_MS = 380;

export type SotArrivalZone = 'hand' | 'board' | 'shop';

type Source = SotBeatFx['source'];
export type SotCue =
  | { at: number; kind: 'pulse'; beat: number; source: Source; procs?: SotBeatFx['procs']; equipFx?: SotBeatFx['equipFx'] }
  | { at: number; kind: 'gain'; beat: number; source: Source; uid: string; attack: number; health: number }
  | { at: number; kind: 'arrive'; beat: number; source: Source; zone: SotArrivalZone; uid: string };

/** A beat's new cards, in the order they land: board first (next to the gains), then the hand, then the shop. */
export function sotArrivals(b: SotBeatFx): { zone: SotArrivalZone; uid: string }[] {
  return [
    ...(b.summons ?? []).map((uid) => ({ zone: 'board' as const, uid })),
    ...(b.handGrants ?? []).map((uid) => ({ zone: 'hand' as const, uid })),
    ...(b.shopAdds ?? []).map((uid) => ({ zone: 'shop' as const, uid })),
  ];
}

/** The cue list for a batch of Start-of-Turn beats, in ms from the moment the wipe came to rest. Every cue sits at or
 *  after `SOT_POST_WIPE_PAD_MS`; beats never overlap (each waits for the previous one's tail), and they play in the
 *  batch's order, which is the order the sim applied them. `durationMs` is when the last beat's tail ends: the moment
 *  the turn (and its timer) may start. An empty batch is 0 — no added delay. */
export function planSotBeats(beats: readonly SotBeatFx[]): { cues: SotCue[]; durationMs: number } {
  const cues: SotCue[] = [];
  let t = SOT_POST_WIPE_PAD_MS;
  beats.forEach((b, i) => {
    cues.push({ at: t, kind: 'pulse', beat: i, source: b.source, ...(b.procs ? { procs: b.procs } : {}), ...(b.equipFx?.length ? { equipFx: b.equipFx } : {}) });
    const first = t + SOT_PULSE_LEAD_MS;
    let last = -1;
    b.gains.forEach((g, j) => {
      last = first + j * SOT_GAIN_STAGGER_MS;
      cues.push({ at: last, kind: 'gain', beat: i, source: b.source, uid: g.uid, attack: g.attack, health: g.health });
    });
    const arriveFrom = last < 0 ? first : last + SOT_GAIN_STAGGER_MS;
    sotArrivals(b).forEach((a, k) => {
      last = arriveFrom + k * SOT_ARRIVE_STAGGER_MS;
      cues.push({ at: last, kind: 'arrive', beat: i, source: b.source, zone: a.zone, uid: a.uid });
    });
    t = last < 0 ? t + SOT_QUIET_TAIL_MS : last + SOT_BEAT_TAIL_MS;
  });
  return { cues, durationMs: beats.length ? t : 0 };
}

export type SotHeld = Readonly<Record<string, { attack: number; health: number }>>;

/** Add a batch's gains to the held deltas (what the Shop subtracts from the real stats until each gain's cue). */
export function holdSotGains(prev: SotHeld | null, beats: readonly SotBeatFx[]): SotHeld | null {
  const out: Record<string, { attack: number; health: number }> = { ...(prev ?? {}) };
  for (const b of beats) {
    for (const g of b.gains) {
      const cur = out[g.uid] ?? { attack: 0, health: 0 };
      out[g.uid] = { attack: cur.attack + g.attack, health: cur.health + g.health };
    }
  }
  return Object.keys(out).length ? out : null;
}

/** Release one landed gain from the hold (null once nothing is held). */
export function releaseSotGain(prev: SotHeld | null, uid: string, attack: number, health: number): SotHeld | null {
  const cur = prev?.[uid];
  if (!prev || !cur) return prev;
  const out: Record<string, { attack: number; health: number }> = { ...prev };
  const left = { attack: cur.attack - attack, health: cur.health - health };
  if (left.attack <= 0 && left.health <= 0) delete out[uid];
  else out[uid] = left;
  return Object.keys(out).length ? out : null;
}

/** The stats to SHOW for a board card while a Start-of-Turn gain is held off it (undefined = show the real stats). */
export function sotShownStats(held: SotHeld | null, uid: string, attack: number, health: number): { attack: number; health: number } | undefined {
  const d = held?.[uid];
  return d ? { attack: attack - d.attack, health: health - d.health } : undefined;
}

/** Everything a Start-of-Turn batch holds back until its cue: the stat deltas and the new cards per row. */
export interface SotHolds {
  stats: SotHeld | null;
  hand: ReadonlySet<string> | null;
  board: ReadonlySet<string> | null;
  shop: ReadonlySet<string> | null;
}
export const NO_SOT_HOLDS: SotHolds = { stats: null, hand: null, board: null, shop: null };

const addAll = (prev: ReadonlySet<string> | null, uids: readonly string[]): ReadonlySet<string> | null =>
  uids.length === 0 ? prev : new Set([...(prev ?? []), ...uids]);

/** Hold a whole batch: its gains off the shown stats, its new cards out of their rows. */
export function holdSotBeats(prev: SotHolds, beats: readonly SotBeatFx[]): SotHolds {
  const arrivals = beats.flatMap(sotArrivals);
  return {
    stats: holdSotGains(prev.stats, beats),
    hand: addAll(prev.hand, arrivals.filter((a) => a.zone === 'hand').map((a) => a.uid)),
    board: addAll(prev.board, arrivals.filter((a) => a.zone === 'board').map((a) => a.uid)),
    shop: addAll(prev.shop, arrivals.filter((a) => a.zone === 'shop').map((a) => a.uid)),
  };
}

/** Release one landed cue from the holds (the same object back when it held nothing, so a render can bail out). */
export function releaseSotCue(prev: SotHolds, cue: SotCue): SotHolds {
  if (cue.kind === 'gain') {
    const stats = releaseSotGain(prev.stats, cue.uid, cue.attack, cue.health);
    return stats === prev.stats ? prev : { ...prev, stats };
  }
  if (cue.kind !== 'arrive') return prev;
  const row = prev[cue.zone];
  if (!row?.has(cue.uid)) return prev;
  const next = new Set(row);
  next.delete(cue.uid);
  return { ...prev, [cue.zone]: next.size ? next : null };
}

/** Whether anything is still held (the batch has not fully landed). */
export function sotHolding(h: SotHolds): boolean {
  return !!(h.stats || h.hand?.size || h.board?.size || h.shop?.size);
}
