/**
 * VERSUS — the client run (blueprint 2 + 5; owner rulings 2026-10-13).
 *
 *  - `createVersusRun`: an ordinary run stamped `mode: 'versus'`. The mode keeps it out of every other mode's
 *    machinery: no course clock, no Resolve elimination (hearts live on the server match), no lobby, no rank, no
 *    uploads (the UI gates key on mode), and `poolOf` drops every attack-first card (R-VERSUS-POOL-01).
 *  - `versusHeroOffer`: the seat's hidden three, from its PRIVATE hero seed (server-pinned, owner-only), so the
 *    opponent cannot see or predict it (ruling 3; duplicates across seats allowed).
 *  - `versusAutoResolve`: the timeout policy (ruling 7). Every open decision gets a deterministic RANDOM LEGAL
 *    answer from the match/round/seat seed; nothing is cancelled unless no legal answer exists.
 *  - `buildVersusCandidate`: the lock candidate. Runs on a CLONE (never the live run, so End of Turn can never
 *    fire twice): auto-resolve, then `faceOmen { deferFight }`, and return the parked side.
 */
import { makeRng, type CombatResult, type Rng } from '@game/core';
import type { SetId } from '@game/content';
import { playableHeroes } from '../heroes';
import { heroRerollCandidates } from '../heroReroll';
import { reduce } from '../reducer';
import { modalOpen } from '../recruit';
import { createRun, mixSeed, runTribesForSeed, type Action, type PreparedCombatSide, type RunState } from '../state';
import { riftBonusArmor } from '../config';
import { VERSUS_HERO_OFFER_SIZE } from './constants';
import type { VersusGroupSeat } from './group';
import { normalizeVersusOptions, versusOptionsRift, type VersusRoomOptions } from './options';
import { snapshotBoard } from '../snapshot';
import type { VersusSeatScout } from '../lobby/runLobby';

/**
 * A fresh Versus run for one seat. `runSeed` is the seat's private run seed (server-pinned). `options` is the MATCH's
 * pinned room options (R-VERSUS-OPTIONS-01): a modifier pins its rift onto the run here, exactly as a Rift run pins
 * the live rift in `createRun`, so a saved, restored or replayed run keeps it. A Versus modifier adds NO Armor (owner
 * 2026-10-25, R-VERSUS-SUMMIT-01): Summit only unlocks Tier 7 here.
 * The opening shop is Tier 1 and reads no rift, so pinning after `createRun` draws the same shop a Rift run would.
 * No options (or the defaults) = today's run, byte for byte.
 */
export function createVersusRun(runSeed: number, heroId: string, setId: SetId, options?: VersusRoomOptions | null): RunState {
  const run = createRun(runSeed, heroId, 'versus', undefined, setId);
  const rift = versusOptionsRift(normalizeVersusOptions(options));
  if (rift) {
    const bonus = riftBonusArmor(rift, run.mode); // 0 in Versus
    run.rift = rift;
    run.armor += bonus;
    run.maxArmor += bonus;
  }
  return run;
}

/** The seat's three heroes: a seeded shuffle of the heroes this run's tribes allow. */
export function versusHeroOffer(heroSeed: number, runSeed: number, setId: SetId): string[] {
  const ids = playableHeroes(runTribesForSeed(runSeed, setId)).map((h) => h.id);
  const rng = makeRng(mixSeed(heroSeed, 0x4e50));
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  return ids.slice(0, VERSUS_HERO_OFFER_SIZE);
}

/** THE HERO RE-ROLL in Versus (owner 2026-10-15, R-HERO-REROLL-01): the heroes the seat's one re-roll may draw, i.e.
 *  the heroes this run's tribes allow minus the current three. The SERVER draws from this list with the match seed
 *  (`versus_reroll_hero`); the client never picks. */
export function versusHeroRerollCandidates(runSeed: number, setId: SetId, offer: readonly string[]): string[] {
  return heroRerollCandidates(offer, playableHeroes(runTribesForSeed(runSeed, setId)).map((h) => h.id));
}

/** The deterministic RNG for one seat's timeout answers in one round (p1..p4; p1/p2 unchanged since 1v1). */
export function versusTimeoutRng(matchSeed: number, round: number, seat: VersusGroupSeat): Rng {
  const n = seat === 'p1' ? 1 : seat === 'p2' ? 2 : seat === 'p3' ? 3 : 4;
  return makeRng(mixSeed(matchSeed, round, n, 0x71e0));
}

const legal = (s: RunState, a: Action): boolean => reduce(s, a) !== s;
const indices = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/** Every legal answer to the decision currently open on `s` (empty when nothing is open). */
export function legalModalAnswers(s: RunState): Action[] {
  const out: Action[] = [];
  const keep = (a: Action): void => { if (legal(s, a)) out.push(a); };
  if (s.discover) {
    for (const i of indices(s.discover.length)) keep({ type: 'discover', index: i });
  } else if (s.chooseOne) {
    for (const i of indices(4)) keep({ type: 'chooseOne', index: i });
  } else if (s.pendingTarget) {
    const self = s.pendingTarget.uid;
    for (const c of s.board) if (c.uid !== self) keep({ type: 'battlecryTarget', targetUid: c.uid });
    for (const o of s.shop) keep({ type: 'battlecryTarget', targetUid: o.uid });
    for (const c of s.hand) if (c.uid !== self) keep({ type: 'battlecryTarget', targetUid: c.uid });
  } else if (s.questOffer) {
    for (const i of indices(s.questOffer.length)) keep({ type: 'buyQuest', index: i });
  } else if (s.powerOffer) {
    for (const i of indices(s.powerOffer.heroIds.length)) keep({ type: 'pickPower', index: i });
  } else if (s.runeforgeOffer) {
    for (const i of indices(s.runeforgeOffer.length)) keep({ type: 'buyRune', index: i });
    if (out.length === 0) keep({ type: 'skipRuneforge' }); // nothing affordable: skipping is the only legal move
  } else if (s.scoutedNextOpponent?.length) {
    keep({ type: 'closeScout' });
  }
  return out;
}

/**
 * Close every open decision with a deterministic random legal pick (ruling 7). When a decision has NO legal answer
 * (an aim with nothing to aim at), the engine's own escape is used: `cancelChoice`. Bounded: a chain of Discovers
 * resolves one by one, and a modal that refuses every answer stops the loop rather than spinning.
 */
export function versusAutoResolve(run: RunState, rng: Rng): RunState {
  let s = run;
  for (let guard = 0; guard < 64 && modalOpen(s); guard++) {
    const answers = legalModalAnswers(s);
    const pick: Action = answers.length ? answers[Math.floor(rng.next() * answers.length)]! : { type: 'cancelChoice' };
    const next = reduce(s, pick);
    if (next === s) break;
    s = next;
  }
  return s;
}

/**
 * The seat's lock candidate: a CLONE of the live run, its open decisions answered (ruling 7), its turn ended with
 * `faceOmen { deferFight }`. Returns the parked side, or null when the engine refused to end the turn (the caller
 * keeps the previous candidate). Never touches `run`.
 */
export function buildVersusCandidate(run: RunState, rng: Rng): PreparedCombatSide | null {
  if (run.phase !== 'recruit') return null;
  const answered = versusAutoResolve(structuredClone(run), rng);
  const ended = reduce(answered, { type: 'faceOmen', deferFight: true });
  if (ended === answered || !ended.pendingCombatSide) return null;
  return ended.pendingCombatSide;
}

/**
 * RECONNECT CATCH-UP: bring a run (a fresh one, or a restored lock checkpoint) forward through rounds the server
 * already committed. For each committed round the run reached, its open decisions get the timeout answer, it ends
 * its turn (`faceOmen { deferFight }`), lands that round's authoritative fight for `seat` and returns to the shop.
 * Stops at the first round without a result (the live round). Deterministic; never touches the network.
 */
export function catchUpVersusRun(
  run: RunState,
  results: ReadonlyMap<number, CombatResult>,
  matchSeed: number,
  seat: VersusGroupSeat,
): RunState {
  let s = run;
  for (let guard = 0; guard < 200; guard++) {
    const fight = results.get(s.wave);
    if (!fight) break;
    if (s.phase === 'recruit') {
      s = versusAutoResolve(s, versusTimeoutRng(matchSeed, s.wave, seat));
      const ended = reduce(s, { type: 'faceOmen', deferFight: true });
      if (ended === s) break;
      s = ended;
    }
    if (s.phase !== 'combat') break;
    if (s.pendingCombatSide) s = reduce(s, { type: 'landCombat', fight: { result: fight, damageTaken: 0 } });
    const back = reduce(s, { type: 'resolveCombat' });
    if (back === s) break;
    s = back;
  }
  return s;
}

/**
 * The seat's PUBLIC state at its lock, for the opponent's scout card (owner 2026-10-14: "scout info must be accurate"):
 * the same fields a lobby seat's recorded snapshot shows. Sent with every candidate and the lock; the server records
 * it on the committed round (its tier re-read from the locked side), so it is only seen once the round is fought.
 */
export function versusScoutOf(run: RunState): VersusSeatScout {
  const snap = snapshotBoard(run);
  return {
    tier: snap.tier,
    triples: snap.triples,
    ...(snap.quests?.length ? { quests: [...snap.quests] } : {}),
    ...(snap.runes?.length ? { runes: [...snap.runes] } : {}),
  };
}
