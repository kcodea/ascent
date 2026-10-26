/**
 * THE TEST BOT'S MATCH API, for every Versus mode (owner 2026-10-25: "id like the ability to test the various mechanics
 * with bots"). The bot driver speaks the 1v1 shape (`VersusBotApi`); a Versus Group or Duos match lives in the
 * `versus_group_*` tables. This adapter routes each match-scoped call to the 1v1 RPCs or the group / Duos ones by which
 * table the match id lives in (learned on its first read), and hands every group answer back PROJECTED from the bot's
 * own seat (`projectGroupMatch` / `projectGroupRounds`, exactly the projection a person's client plays through), so the
 * driver is the same code in every mode. The Duos pass calls ride along for the bot's teammate role.
 *
 * Pure plumbing over an injected remote (the browser passes the bot's own `makeVersusRemote`; the PGlite test passes
 * one backed by the real SQL). Nothing here holds a timer.
 */
import type { PreparedCombatSide, VersusGroupSeat, VersusSeatScout } from '@game/sim';
import { isDuosRaw, projectGroupMatch, projectGroupRounds } from './versusGroupView';
import { isRankedDuosRaw, rankedRoundsAsGroup } from './rankedDuosView';
import type { VersusBotApi, VersusBotDuosApi } from './versusBotDriver';
import type { VersusGroupMatchRaw, VersusMatch, VersusRemote, VersusRoundRow } from './versusRemote';

/** The slice of the remote the adapter uses. */
export type BotRemote = Pick<VersusRemote,
  | 'room' | 'pressGate' | 'heartbeat'
  | 'match' | 'myPrivate' | 'registerOffer' | 'pickHero' | 'submit' | 'combatReady' | 'introDone' | 'requestResume' | 'rounds' | 'reconcile' | 'finalize' | 'forfeit' | 'publishFrame'
  | 'rankedRounds' | 'finalizeRankedDuos'
  | 'groupMatch' | 'groupRounds' | 'groupMyPrivate' | 'groupRegisterOffer' | 'groupPickHero' | 'groupSubmit' | 'groupIntroDone' | 'groupCombatReady'
  | 'groupForfeit' | 'groupRequestResume' | 'groupReconcile' | 'groupPublishFrame' | 'finalizeGroup' | 'finalizeDuos'
  | 'duosPasses' | 'duosPass' | 'duosAnswerPass' | 'duosHandRoom'>;

export interface BotMatchApi extends VersusBotApi {
  forfeit(matchId: string): Promise<unknown>;
  publishFrame(matchId: string, seq: number, round: number, frame: unknown): Promise<unknown>;
  duos: VersusBotDuosApi;
  /** The latest raw group / Duos match row this bot saw (null for a 1v1 match). */
  raw(matchId: string): VersusGroupMatchRaw | null;
}

export function makeBotMatchApi(remote: BotRemote, userId: () => string | null): BotMatchApi {
  const groupIds = new Set<string>();
  const duelIds = new Set<string>();
  const raws = new Map<string, VersusGroupMatchRaw>();
  const G = (id: string): boolean => groupIds.has(id);
  const ingest = (raw: VersusGroupMatchRaw): VersusMatch => {
    groupIds.add(raw.id);
    const prev = raws.get(raw.id);
    if (!prev || raw.revision >= prev.revision) raws.set(raw.id, raw);
    return projectGroupMatch(raws.get(raw.id)!, userId());
  };
  const groupMatch = async (id: string): Promise<VersusMatch | null> => {
    const g = await remote.groupMatch(id);
    return g ? ingest(g) : null;
  };
  // A group RPC answers with the raw row: keep it (fresher than the last read), hand back nothing the driver needs.
  const keep = (p: Promise<unknown>): Promise<unknown> => p.then((r) => {
    const raw = r as VersusGroupMatchRaw | null;
    if (raw && typeof raw === 'object' && Array.isArray(raw.seats) && typeof raw.id === 'string') ingest(raw);
    return r;
  });
  return {
    room: (roomId) => remote.room(roomId),
    pressGate: (roomId) => remote.pressGate(roomId),
    async heartbeat(roomId) {
      const hb = await remote.heartbeat(roomId);
      if (hb.groupMatch) return { serverNow: hb.serverNow, match: ingest(hb.groupMatch) };
      if (hb.match) duelIds.add(hb.match.id);
      return { serverNow: hb.serverNow, ...(hb.match ? { match: hb.match } : {}) };
    },
    async match(id) {
      if (G(id)) return groupMatch(id);
      const m = await remote.match(id);
      if (m) { duelIds.add(id); return m; }
      if (duelIds.has(id)) return null;
      return groupMatch(id);
    },
    myPrivate: (id) => (G(id) ? remote.groupMyPrivate(id) : remote.myPrivate(id)),
    registerOffer: (id, offer) => (G(id) ? keep(remote.groupRegisterOffer(id, offer)) : remote.registerOffer(id, offer)),
    pickHero: (id, i) => (G(id) ? keep(remote.groupPickHero(id, i)) : remote.pickHero(id, i)),
    submit: (id: string, round: number, seq: number, side: PreparedCombatSide, final: boolean, checkpoint: string | null, scout?: VersusSeatScout | null) =>
      (G(id) ? keep(remote.groupSubmit(id, round, seq, side, final, checkpoint, scout)) : remote.submit(id, round, seq, side, final, checkpoint, scout)),
    combatReady: (id, round) => (G(id) ? keep(remote.groupCombatReady(id, round)) : remote.combatReady(id, round)),
    introDone: (id) => (G(id) ? keep(remote.groupIntroDone(id)) : remote.introDone(id)),
    requestResume: (id) => (G(id) ? keep(remote.groupRequestResume(id)) : remote.requestResume(id)),
    reconcile: (id) => (G(id) ? keep(remote.groupReconcile(id)) : remote.reconcile(id)),
    forfeit: (id) => (G(id) ? keep(remote.groupForfeit(id)) : remote.forfeit(id)),
    publishFrame: (id, seq, round, frame) => (G(id) ? remote.groupPublishFrame(id, seq, round, frame) : remote.publishFrame(id, seq, round, frame)),
    async rounds(id, from = 1): Promise<VersusRoundRow[]> {
      if (!G(id)) return remote.rounds(id, from);
      const raw = raws.get(id) ?? (await remote.groupMatch(id).then((g) => (g ? (ingest(g), raws.get(id)!) : null)));
      if (!raw) return [];
      // RANKED DUOS: the committed rounds in the Duos shape (the bot only needs its own fight).
      const rows = isRankedDuosRaw(raw) ? rankedRoundsAsGroup(await remote.rankedRounds(id, from)) : await remote.groupRounds(id, from);
      return Object.values(projectGroupRounds(raw, rows, userId())).sort((a, b) => a.round - b.round);
    },
    finalize(id, round, content) {
      if (!G(id)) return remote.finalize(id, round, content);
      if (isRankedDuosRaw(raws.get(id))) return remote.finalizeRankedDuos(id, round, content);
      return isDuosRaw(raws.get(id)) ? remote.finalizeDuos(id, round, content) : remote.finalizeGroup(id, round, content);
    },
    duos: {
      passes: (id, from) => remote.duosPasses(id, from),
      pass: (id, round, seq, card) => remote.duosPass(id, round, seq, card),
      answer: (id, from: VersusGroupSeat, seq, landed) => remote.duosAnswerPass(id, from, seq, landed),
      handRoom: (id, room) => remote.duosHandRoom(id, room),
    },
    raw: (id) => raws.get(id) ?? null,
  };
}
