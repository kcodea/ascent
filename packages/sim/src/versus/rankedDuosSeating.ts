/**
 * RANKED DUOS: who sits at the table (owner 2026-10-26; docs/design/2026-10-26-ranked-duos.md section 5).
 *
 * The live pair is team `a`; this picks teams `b`, `c` and `d` ONCE, on the server, after both live heroes lock. The
 * answer is written to `versus_ranked_duos_served` with the WHOLE recordings copied in (pinned), so nothing ever
 * re-derives it: a reconnect, a restore and a replay read that copy.
 *
 * Owner: "duo's snapshots are the priority to be served, but until we have enough duo's snapshots, just put random single
 * player snapshots together and serve them as teammate boards", two DIFFERENT players, "strength based on the ranked
 * matchmaking rules in place". So, walking the ranked lobby's band steps (the team's own medal band, widened +10 a side,
 * the overall cap never relaxed, R-LOBBY-09 / R-LOBBY-15):
 *
 *   1. recorded DUO runs inside the step, in a seeded shuffle;
 *   2. then SOLO runs inside the step, in a seeded shuffle, paired in walk order: a run joins the open team when its
 *      player differs from its partner's;
 *   and only when both are exhausted does the band widen. Then generated seats fill what is left (a half pair gets a
 *   generated partner), never a smaller table. Any generated member = unrated (it has no server-side recording yet).
 *
 * Every step: all eight heroes unique (the live pair's included), one run never seated twice, at most
 * `RANKED_DUOS_MAX_SEATS_PER_PLAYER` of the six served seats per player (the solo 4-of-7 cap scaled; your own runs are
 * seatable like anyone's). Pure and deterministic (one seeded stream per shuffle); bundle-safe.
 */
import { makeRng } from '@game/core';
import { bandSteps, runInStrengthBand, type StrengthBand } from '../lobby/strengthBands';
import { handleFor, handleKeyOf } from '../lobby/handles';
import { RANKED_DUOS_SERVED_TEAMS, type RankedDuosTeam } from './rankedDuos';

/** At most this many of the six served seats per player (reading R2 in the design). */
export const RANKED_DUOS_MAX_SEATS_PER_PLAYER = 2;

export interface DuoMemberCandidate {
  runKey: string;
  /** The account that played it (always known for a duo run). */
  ownerId: string | null;
  name: string;
  heroId: string;
}

/** A recorded duo run (`duo_runs`), as the server samples it. */
export interface DuoRunCandidate {
  id: string;
  members: readonly [DuoMemberCandidate, DuoMemberCandidate];
  strength?: number | null;
  early?: number | null;
  late?: number | null;
}

/** A solo pool run (`pool_runs_sample`), already eligible by the pool's whole-run rules (R-LOBBY-07 / R-LOBBY-08). */
export interface SoloRunCandidate {
  key: string;
  ownerId: string | null;
  author: string;
  heroId: string;
  strength?: number | null;
  early?: number | null;
  late?: number | null;
}

export interface RankedDuosServedMember {
  kind: 'duo' | 'solo' | 'generated';
  /** The run key (`author|hero|seed`), or `bot:hybrid:<hero>` for a generated seat. */
  key: string;
  ownerId: string | null;
  name: string;
  heroId: string;
  /** A generated seat's recording seed. */
  seed?: number;
}

export interface RankedDuosServedTeam {
  team: RankedDuosTeam;
  kind: 'duo' | 'pair' | 'generated';
  /** The `duo_runs.id` a duo team serves. */
  duoRunId?: string;
  members: [RankedDuosServedMember, RankedDuosServedMember];
  /** Who fights first: a duo run keeps its RECORDED order; anything else is the seeded 50/50 (owner Q9). */
  order: 'recorded' | 'random';
}

export interface RankedDuosSeatingInput {
  seed: number;
  /** The live pair's heroes. */
  liveHeroes: readonly string[];
  duoRuns: readonly DuoRunCandidate[];
  soloRuns: readonly SoloRunCandidate[];
  /** The live TEAM's medal band (`strengthBandForDivision(team division)`), null = no band (Platinum up). */
  band: StrengthBand | null;
  /** Heroes a generated seat may play, in a fixed order (`playableHeroes()` ids). */
  generatedHeroes: readonly string[];
}

export interface RankedDuosSeating {
  teams: RankedDuosServedTeam[];
  /** The band step the last real run came from (0 = the team's own band). */
  usedStep: number;
  /** Any served member generated (it fields no board until server-side recordings exist): the game is unrated. */
  unrated: boolean;
}

/** One player = their account, else their display name (the lobby's `runOwnerOf` rule). Null = unknown. */
export function servedOwnerOf(ownerId: string | null | undefined, author: string | null | undefined): string | null {
  if (ownerId) return `id:${ownerId}`;
  return author && author !== 'anon' ? `name:${author.toLowerCase()}` : null;
}

function shuffled<T>(xs: readonly T[], seed: number): T[] {
  const out = [...xs];
  const rng = makeRng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const DUO_TAG = 0x6d2b79f5;
const SOLO_TAG = 0x1b873593;
const BOT_TAG = 0x27d4eb2f;

export function selectRankedDuosTable(input: RankedDuosSeatingInput): RankedDuosSeating {
  const heroesTaken = new Set<string>(input.liveHeroes);
  const runsTaken = new Set<string>();
  const seatsByOwner = new Map<string, number>();
  const teams: RankedDuosServedTeam[] = [];
  const full = (): boolean => teams.length >= RANKED_DUOS_SERVED_TEAMS.length;
  const nextTeam = (): RankedDuosTeam => RANKED_DUOS_SERVED_TEAMS[teams.length]!;
  const underCap = (owner: string | null, extra = 0): boolean =>
    owner == null || (seatsByOwner.get(owner) ?? 0) + extra < RANKED_DUOS_MAX_SEATS_PER_PLAYER;
  const take = (owner: string | null, key: string, hero: string): void => {
    runsTaken.add(key);
    heroesTaken.add(hero);
    if (owner) seatsByOwner.set(owner, (seatsByOwner.get(owner) ?? 0) + 1);
  };

  // Sort first so the shuffle is a pure function of the seed, whatever order the server returned the rows in.
  const duos = shuffled([...input.duoRuns].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), (input.seed ^ DUO_TAG) >>> 0);
  const solos = shuffled([...input.soloRuns].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)), (input.seed ^ SOLO_TAG) >>> 0);
  const duoSeen = new Set<string>();
  const soloSeen = new Set<string>();
  let pending: { member: RankedDuosServedMember; owner: string | null } | null = null;

  const steps = bandSteps(input.band);
  let usedStep = 0;
  for (let step = 0; step < steps.length && !full(); step++) {
    const band = steps[step]!;
    // 1. Recorded duo runs first.
    for (const run of duos) {
      if (full()) break;
      if (duoSeen.has(run.id) || !runInStrengthBand(run, band)) continue;
      duoSeen.add(run.id);
      const [m0, m1] = run.members;
      if (m0.heroId === m1.heroId || heroesTaken.has(m0.heroId) || heroesTaken.has(m1.heroId)) continue;
      if (runsTaken.has(m0.runKey) || runsTaken.has(m1.runKey)) continue;
      // A pending half pair holds a hero / a seat of its player too.
      if (pending && (pending.member.heroId === m0.heroId || pending.member.heroId === m1.heroId)) continue;
      const o0 = servedOwnerOf(m0.ownerId, m0.name);
      const o1 = servedOwnerOf(m1.ownerId, m1.name);
      const pend = (o: string | null): number => (pending && o && pending.owner === o ? 1 : 0);
      if (!underCap(o0, pend(o0) + (o0 && o0 === o1 ? 1 : 0)) || !underCap(o1, pend(o1) + (o1 && o0 === o1 ? 1 : 0))) continue;
      take(o0, m0.runKey, m0.heroId);
      take(o1, m1.runKey, m1.heroId);
      teams.push({
        team: nextTeam(), kind: 'duo', duoRunId: run.id, order: 'recorded',
        members: [
          { kind: 'duo', key: m0.runKey, ownerId: m0.ownerId, name: m0.name, heroId: m0.heroId },
          { kind: 'duo', key: m1.runKey, ownerId: m1.ownerId, name: m1.name, heroId: m1.heroId },
        ],
      });
      usedStep = step;
    }
    // 2. Then solo runs, paired in walk order.
    for (const run of solos) {
      if (full()) break;
      if (soloSeen.has(run.key) || !runInStrengthBand(run, band)) continue;
      soloSeen.add(run.key);
      if (runsTaken.has(run.key) || heroesTaken.has(run.heroId)) continue;
      const owner = servedOwnerOf(run.ownerId, run.author);
      if (pending) {
        if (pending.member.heroId === run.heroId) continue;
        // Two DIFFERENT players (owner 2026-10-26). An unknown player never matches another (nothing to compare).
        if (owner != null && owner === pending.owner) continue;
      }
      if (!underCap(owner)) continue;
      const member: RankedDuosServedMember = {
        kind: 'solo', key: run.key, ownerId: run.ownerId,
        name: run.author && run.author !== 'anon' ? run.author : handleFor(handleKeyOf(run.key)), heroId: run.heroId,
      };
      if (!pending) {
        pending = { member, owner };
        take(owner, run.key, run.heroId);
        continue;
      }
      take(owner, run.key, run.heroId);
      teams.push({ team: nextTeam(), kind: 'pair', order: 'random', members: [pending.member, member] });
      pending = null;
      usedStep = step;
    }
  }

  // 3. Generated seats fill the rest (a half pair gets a generated partner).
  const bots = shuffled([...input.generatedHeroes].sort(), (input.seed ^ BOT_TAG) >>> 0);
  let botIx = 0;
  const generated = (): RankedDuosServedMember | null => {
    while (botIx < bots.length) {
      const hero = bots[botIx++]!;
      if (heroesTaken.has(hero)) continue;
      heroesTaken.add(hero);
      const seed = (Math.imul(input.seed ^ BOT_TAG, 31) + botIx * 7919) >>> 0;
      return { kind: 'generated', key: `bot:hybrid:${hero}`, ownerId: null, name: handleFor(handleKeyOf(`${input.seed}|${hero}`)), heroId: hero, seed };
    }
    return null;
  };
  if (pending && !full()) {
    const mate = generated();
    if (mate) teams.push({ team: nextTeam(), kind: 'pair', order: 'random', members: [pending.member, mate] });
  }
  while (!full()) {
    const a = generated();
    const b = generated();
    if (!a || !b) break; // not enough heroes in the roster: the caller refuses the table
    teams.push({ team: nextTeam(), kind: 'generated', order: 'random', members: [a, b] });
  }
  // UNRATED when ANY member is generated: a generated member has no server-side recording yet, so it fields no board
  // (a free win would move the rating). All three generated is also the lobby's own "offline = unrated" (R-LOBBY-06).
  const unrated = teams.some((t) => t.members.some((m) => m.kind === 'generated'));
  return { teams, usedStep, unrated };
}
