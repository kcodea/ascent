/**
 * VERSUS ON THE DOCKED RAIL (owner 2026-10-31: "I think we should move all modes to this rail type. 1v1, even 3 and 4
 * player group games"): what each player is doing, shown on their slice. The 1v1 opponent block (`VersusFoe`) used to
 * carry this for the one opponent; on the Docked rail every Versus mode (1v1, Group, Duos, Ranked Duos) shows it on the
 * slice of the player it is about, by one rule:
 *   Disconnected  the match is paused on them
 *   Away          the server plays their last locked board for them
 *   Locked in     they ended their turn (the shop)
 *   Ready         they are back from the fight (the fight)
 * Shopping and fighting are the default and show nothing. A Ranked Duos recorded member (`served`) is never waited on,
 * so it never shows a state. Pure; keyed by the RAIL's seat ids (s0 = the viewer, `duosLobbySeatId`).
 */
import type { VersusGroupSeat } from '@game/sim';
import type { VersusMatch } from './versusRemote';
import { duosLobbySeatId } from './versusGroupView';

export type RailStatusTone = 'ready' | 'away';
export interface RailStatus { label: string; tone: RailStatusTone }

const status = (paused: boolean, auto: boolean, locked: boolean, ready: boolean, phase: string): RailStatus | null => {
  if (paused) return { label: 'Disconnected', tone: 'away' };
  if (auto) return { label: 'Away', tone: 'away' };
  if (phase === 'shop' && locked) return { label: 'Locked in', tone: 'ready' };
  if (phase === 'combat' && ready) return { label: 'Ready', tone: 'ready' };
  return null;
};

/**
 * Every player's state by rail seat id, from `viewer`'s side (`viewer`: the viewer's own seat, or the seat a spectator
 * watches). The viewer's own seat is included (the caller decides whether to draw it). Empty when nothing is known.
 */
export function versusRailStatuses(match: VersusMatch | null, viewer: VersusGroupSeat | null): Record<string, RailStatus> {
  const out: Record<string, RailStatus> = {};
  if (!match || !viewer || match.phase === 'complete') return out;
  const raw = match.group?.raw;
  if (raw) {
    if (raw.phase === 'complete') return out;
    for (const s of raw.seats) {
      if (s.served || s.eliminatedRound != null) continue;
      const st = status(!!raw.paused_at && raw.paused_seat === s.seat, s.auto, s.locked, s.ready, raw.phase);
      const id = st ? duosLobbySeatId(raw, viewer, s.seat) : null;
      if (st && id) out[id] = st;
    }
    return out;
  }
  // A 1v1: the viewer's seat is s0, the other player s1.
  const other = viewer === 'p1' ? 'p2' : 'p1';
  for (const [seat, id] of [[viewer, 's0'], [other, 's1']] as const) {
    if (seat !== 'p1' && seat !== 'p2') continue;
    const st = status(match.paused_seat === seat, !!match[`${seat}_auto`], !!match[`${seat}_locked`], !!match[`${seat}_ready`], match.phase);
    if (st) out[id] = st;
  }
  return out;
}

/** The statuses as one stable string (a store selector's value): `id:tone:label` joined, sorted. */
export function railStatusKey(map: Record<string, RailStatus>): string {
  return Object.keys(map).sort().map((id) => `${id}|${map[id]!.tone}|${map[id]!.label}`).join(';');
}

/** The key back into the map. */
export function parseRailStatusKey(key: string): Record<string, RailStatus> {
  const out: Record<string, RailStatus> = {};
  if (!key) return out;
  for (const part of key.split(';')) {
    const [id, tone, label] = part.split('|') as [string, RailStatusTone, string];
    out[id] = { tone, label };
  }
  return out;
}
