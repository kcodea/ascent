/**
 * BALANCE BOT B5 — a deterministic SYNTHETIC lobby generator.
 *
 * The aggregate / report / compare (packages/tools/src/balance) consume `LobbyRecord[]` and nothing else, so they
 * can be built and tested before the authoritative runner (B1) lands. This generator produces plausible records
 * from a seed: eight seats, real hero / card / rune ids from `@game/content` for the manifest's set, a shop →
 * buy → play → sell action stream with matching effect events, real-shaped round snapshots (pairing, byes, damage,
 * armor, elimination) and a placement. It is a FIXTURE, not a simulation — nothing here touches the reducer or
 * `simulate()`, and every record is stamped `manifest.mode` so a report can never mistake it for measured play.
 *
 * Knobs the tests lean on:
 *  - `heroBias`: a per-hero latent-strength shift — the POSITIVE CONTROL for `compareJobs` (nerf one hero, the
 *    compare must register it with a CI excluding zero).
 *  - `failRate`: fraction of lobbies flagged `failure` (censored) so the coverage ledger has something to count.
 *  - `rounds`: the lobby's round cap (elimination usually ends it earlier).
 */
import { makeRng, type Rng } from '@game/core';
import { CARD_INDEX, RUNES, SETS, poolFor, type SetId } from '@game/content';
import { HEROES, playableHeroes } from '../../heroes';
import { runTribesForSeed } from '../../state';
import { createRecorder } from '../recorder';
import type { EffectEvent, ExperimentIdentity, ExperimentManifest, LobbyRecord, RoundRecord, RunRecord } from '../types';
import type { Action } from '../../state';

export interface SyntheticOptions {
  /** Latent WEAKNESS per hero id: +1 ≈ one place WORSE on average (a nerf), −1 ≈ one place better (a buff). */
  heroBias?: Readonly<Record<string, number>>;
  /** Fraction of lobbies marked failed/censored (deterministic per seed). Default 0. */
  failRate?: number;
  /** Rounds cap. Default `manifest.maxRounds ?? 20`. */
  rounds?: number;
  /** Extra noise on fight outcomes. Default 1. */
  noise?: number;
}

/** A synthetic identity. `tag` models a DATA patch: it moves `contentDigest` only (engine / pool / effects stay the
 *  synthetic baseline), so a compare between two tags declares `['contentDigest', 'manifestDigest']` — the shape a
 *  real card-parameter candidate has. */
export function syntheticIdentity(manifest: ExperimentManifest, tag = 'synthetic'): ExperimentIdentity {
  const d = (s: string): string => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  };
  return {
    schemaVersion: 1,
    engineRevision: 'synthetic-engine',
    dirtyDigest: '',
    contentDigest: d(`content:${manifest.setId}:${tag}`),
    poolDigest: d(`pool:${manifest.setId}:synthetic`),
    effectDigest: d('effects:synthetic'),
    manifestDigest: d(JSON.stringify(manifest)),
  };
}

export function syntheticManifest(setId: SetId, seeds: { start: number; count: number }, extra: Partial<ExperimentManifest> = {}): ExperimentManifest {
  return {
    schemaVersion: 1,
    name: `synthetic ${setId}`,
    mode: 'selfPlayLobby',
    setId,
    policy: { id: 'synthetic', budget: { depth: 1, beam: 1, maxNodes: 1, positionCandidates: 1 } },
    seeds,
    maxRounds: 20,
    notes: 'SYNTHETIC FIXTURE — generated records, not measured play',
    ...extra,
  };
}

// Approximate normal from the uniform RNG (Irwin–Hall, 4 draws — plenty for a fixture).
const gauss = (rng: Rng): number => (rng.next() + rng.next() + rng.next() + rng.next() - 2) * Math.SQRT2;

interface Seat {
  id: string;
  heroId: string;
  strength: number;
  health: number;
  armor: number;
  tier: number;
  gold: number;
  hand: { uid: string; cardId: string; route: EffectEvent['route'] }[];
  board: { uid: string; cardId: string; golden?: boolean }[];
  runes: string[];
  alive: boolean;
  eliminatedRound?: number;
  heroPowerUses: number;
  uidSeq: number;
  frozenOffers?: string[];
  goldSpent: number;
}

export function synthesizeLobby(seed: number, manifest: ExperimentManifest, identity: ExperimentIdentity, opts: SyntheticOptions = {}): LobbyRecord {
  const rng = makeRng(seed ^ 0x5eed);
  const setId = manifest.setId;
  const pool = poolFor(setId);
  const tribes = runTribesForSeed(seed, setId);
  const setDef = SETS[setId];
  const lobbyId = `${manifest.name.replace(/\s+/g, '-')}-${seed}`;
  const rec = createRecorder(lobbyId, seed, manifest, identity);
  const rounds = opts.rounds ?? manifest.maxRounds ?? 20;
  const noise = opts.noise ?? 1;

  // Heroes: the manifest's roster or the production eligibility for this set's run tribes.
  const roster = manifest.heroes?.length ? manifest.heroes.filter((id) => HEROES.some((h) => h.id === id)) : playableHeroes(tribes).map((h) => h.id);
  const order = [...roster];
  for (let i = order.length - 1; i > 0; i--) { const j = rng.int(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const seatHeroes = Array.from({ length: 8 }, (_, i) => order[i % order.length]);

  // Cards by tier for offers; runes eligible for this set.
  const minionsByTier = new Map<number, string[]>();
  for (const c of pool.buyable) { const t = Number(c.tier); if (!minionsByTier.has(t)) minionsByTier.set(t, []); minionsByTier.get(t)!.push(c.id); }
  const spells = pool.spells.map((c) => c.id);
  const runes = RUNES.filter((r) => !r.sets || r.sets.includes(setId)).filter((r) => !r.tribes || r.tribes.some((t) => tribes.includes(t))).map((r) => r.id);

  const seats: Seat[] = seatHeroes.map((heroId, i) => {
    const hero = HEROES.find((h) => h.id === heroId)!;
    return {
      id: `s${i}`, heroId, strength: gauss(rng) * 0.6 - (opts.heroBias?.[heroId] ?? 0),
      health: hero.resolve, armor: hero.armor ?? 0, tier: 1, gold: 3, hand: [], board: [], runes: [], alive: true,
      heroPowerUses: 0, uidSeq: 0, goldSpent: 0,
    };
  });

  const offerFor = (s: Seat): string[] => {
    const n = Math.min(3 + Math.floor(s.tier / 2), 6);
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const t = 1 + rng.int(s.tier);
      const list = minionsByTier.get(t) ?? minionsByTier.get(1) ?? [];
      if (list.length) out.push(rng.pick(list));
    }
    if (spells.length) out.push(rng.pick(spells));
    return out;
  };

  let placementNext = 8;
  const placements = new Map<string, number>();

  for (let round = 1; round <= rounds; round++) {
    const alive = seats.filter((s) => s.alive);
    if (alive.length <= 1) break;

    // ── recruit turn per living seat ────────────────────────────────────────────────────────────────────────
    for (const s of alive) {
      s.gold = Math.min(10, 2 + round);
      const goldStart = s.gold;
      let index = 0;
      const emit = (action: Action, offers: readonly string[], goldBefore: number, effects: Omit<EffectEvent, 'lobbyId' | 'seatId' | 'round'>[]): void => {
        rec.onAction({ lobbyId, seatId: s.id, round, index: index++, action, goldBefore, goldAfter: s.gold, offers, preHash: `${seed}:${s.id}:${round}:${index - 1}`, postHash: `${seed}:${s.id}:${round}:${index}` });
        for (const e of effects) rec.onEffect({ lobbyId, seatId: s.id, round, ...e });
      };
      const uid = (): string => `${s.id}u${s.uidSeq++}`;
      let offers = s.frozenOffers ?? offerFor(s);
      s.frozenOffers = undefined;

      // Tier up when affordable-ish.
      const upgradeCost = 4 + s.tier;
      if (s.tier < 6 && s.gold >= upgradeCost && rng.next() < 0.35 + 0.05 * round) {
        const g = s.gold; s.gold -= upgradeCost; s.tier++;
        emit({ type: 'upgrade' }, offers, g, []);
      }
      // Hero power (~55% of turns once it is affordable).
      if (s.gold >= 2 && rng.next() < 0.55) {
        const g = s.gold; s.gold -= 2; s.heroPowerUses++;
        emit({ type: 'heroPower' }, offers, g, [{ kind: 'heroPower', sourceId: s.heroId, gold: 2, route: 'hero' }]);
      }
      // Runeforge at round 6: offer three, buy one or skip.
      if (round === 6 && runes.length >= 3) {
        const offer = [rng.pick(runes), rng.pick(runes), rng.pick(runes)];
        const pick = rng.int(4); // 3 = skip
        if (pick < 3 && s.gold >= 3) {
          const g = s.gold; s.gold -= 3; s.runes.push(offer[pick]);
          emit({ type: 'buyRune', index: pick }, offer, g, [{ kind: 'runePicked', sourceId: offer[pick], gold: 3, route: 'rune' }]);
        } else {
          emit({ type: 'skipRuneforge' }, offer, s.gold, []);
        }
      }
      // Buy loop: buy what is affordable, favouring higher tiers; reroll once when nothing pleases.
      let rerolled = false;
      for (let guard = 0; guard < 8; guard++) {
        const affordable = offers.filter((id) => (CARD_INDEX[id]?.spell ? (CARD_INDEX[id]?.cost ?? 3) : 3) <= s.gold && s.hand.length < 10);
        if (!affordable.length) {
          if (!rerolled && s.gold >= 1 && rng.next() < 0.5) { rerolled = true; const g = s.gold; s.gold -= 1; offers = offerFor(s); emit({ type: 'roll' }, offers, g, []); continue; }
          break;
        }
        // Prefer a card already on the board (a triple chase), else the highest tier.
        const owned = new Set(s.board.map((b) => b.cardId));
        const ranked = [...affordable].sort((a, b) => (owned.has(b) ? 1 : 0) - (owned.has(a) ? 1 : 0) || Number(CARD_INDEX[b]?.tier ?? 1) - Number(CARD_INDEX[a]?.tier ?? 1));
        const id = rng.next() < 0.7 ? ranked[0] : rng.pick(affordable);
        const price = CARD_INDEX[id]?.spell ? (CARD_INDEX[id]?.cost ?? 3) : 3;
        const g = s.gold; s.gold -= price;
        const u = uid();
        s.hand.push({ uid: u, cardId: id, route: 'shop' });
        const offersAtDecision = offers;
        const idx = offers.indexOf(id);
        offers = offers.filter((_, i) => i !== idx);
        emit({ type: 'buy', uid: u }, offersAtDecision, g, [{ kind: 'cardGained', sourceUid: u, sourceId: id, gold: price, route: 'shop' }]);
        // Occasionally a bought minion GENERATES a spell (a Set 3 Clue-style mint) so the generated route is exercised.
        if (!CARD_INDEX[id]?.spell && rng.next() < 0.12 && spells.length) {
          const gen = rng.pick(spells); const gu = uid();
          s.hand.push({ uid: gu, cardId: gen, route: 'generated' });
          rec.onEffect({ lobbyId, seatId: s.id, round, kind: 'cardGained', sourceUid: gu, sourceId: gen, route: 'generated' });
        }
        if (rng.next() < 0.15) break;
      }
      // Play everything in hand: minions to the board (selling the weakest when full), spells on a body.
      for (const h of [...s.hand]) {
        const def = CARD_INDEX[h.cardId];
        const g = s.gold;
        if (def?.spell) {
          if (!s.board.length) { if (rng.next() < 0.3) continue; }
          const target = s.board.length ? rng.pick(s.board) : undefined;
          s.hand = s.hand.filter((x) => x.uid !== h.uid);
          const fx: Omit<EffectEvent, 'lobbyId' | 'seatId' | 'round'>[] = [{ kind: 'spellCast', sourceId: h.cardId, sourceUid: h.uid, targetUid: target?.uid, targetId: target?.cardId, route: h.route }];
          if (target) fx.push({ kind: 'buff', sourceId: h.cardId, targetUid: target.uid, targetId: target.cardId, attack: 1 + rng.int(2), health: 1 + rng.int(2), detail: 'spell' });
          if (rng.next() < 0.1) fx.push({ kind: 'spellCast', sourceId: h.cardId, route: h.route, detail: 'repeat' });
          emit({ type: 'play', uid: h.uid, targetUid: target?.uid }, offers, g, fx);
          continue;
        }
        if (s.board.length >= 7) {
          const victim = s.board[rng.int(s.board.length)];
          s.board = s.board.filter((b) => b.uid !== victim.uid);
          s.gold += 1;
          emit({ type: 'sell', uid: victim.uid }, offers, g, [{ kind: 'cardSold', sourceUid: victim.uid, sourceId: victim.cardId, gold: 1, route: 'shop' }]);
        }
        s.hand = s.hand.filter((x) => x.uid !== h.uid);
        s.board.push({ uid: h.uid, cardId: h.cardId });
        const fx: Omit<EffectEvent, 'lobbyId' | 'seatId' | 'round'>[] = [{ kind: 'cardPlayed', sourceUid: h.uid, sourceId: h.cardId, route: h.route }];
        if (def?.effects?.length && s.board.length > 1 && rng.next() < 0.4) {
          const t = rng.pick(s.board.filter((b) => b.uid !== h.uid));
          fx.push({ kind: 'buff', sourceUid: h.uid, sourceId: h.cardId, targetUid: t.uid, targetId: t.cardId, attack: 1, health: 1, detail: 'minion' });
        }
        if (def?.celestial && rng.next() < 0.3) fx.push({ kind: 'starform', sourceUid: 'starform', sourceId: 'starform', targetUid: h.uid, targetId: h.cardId, detail: 'consumed' });
        // Triple: three copies on the board fold into one golden.
        const copies = s.board.filter((b) => b.cardId === h.cardId && !b.golden);
        if (copies.length >= 3) {
          s.board = s.board.filter((b) => !copies.includes(b));
          const gu = uid();
          s.board.push({ uid: gu, cardId: h.cardId, golden: true });
          fx.push({ kind: 'cardGained', sourceUid: gu, sourceId: h.cardId, route: 'triple', detail: 'triple' });
        }
        emit({ type: 'play', uid: h.uid }, offers, s.gold, fx);
      }
      if (rng.next() < 0.15) { s.frozenOffers = offers; emit({ type: 'freeze' }, offers, s.gold, []); }
      s.goldSpent = goldStart - s.gold;
    }

    // ── pairing + fights ────────────────────────────────────────────────────────────────────────────────────
    const shuffled = [...alive];
    for (let i = shuffled.length - 1; i > 0; i--) { const j = rng.int(i + 1); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    const results = new Map<string, { opp: string | null; result: RoundRecord['result']; dealt: number; taken: number }>();
    const power = (s: Seat): number => s.strength + s.tier * 0.5 + s.board.length * 0.25 + s.board.filter((b) => b.golden).length * 0.5 + s.runes.length * 0.3;
    for (let i = 0; i + 1 < shuffled.length; i += 2) {
      const a = shuffled[i], b = shuffled[i + 1];
      const margin = power(a) - power(b) + gauss(rng) * noise;
      // Damage ≈ the winner's tier + its surviving bodies (the game's rule of thumb), scaled by how lopsided the fight was.
      const winner = margin > 0 ? a : b;
      const survivors = Math.min(winner.board.length, Math.ceil(Math.abs(margin) * 3));
      const dmg = Math.max(1, winner.tier * 2 + survivors * 2 + Math.floor(round / 2));
      if (Math.abs(margin) < 0.15) { results.set(a.id, { opp: b.id, result: 'tie', dealt: 0, taken: 0 }); results.set(b.id, { opp: a.id, result: 'tie', dealt: 0, taken: 0 }); continue; }
      const [w, l] = margin > 0 ? [a, b] : [b, a];
      results.set(w.id, { opp: l.id, result: 'win', dealt: dmg, taken: 0 });
      results.set(l.id, { opp: w.id, result: 'loss', dealt: 0, taken: dmg });
    }
    if (shuffled.length % 2 === 1) results.set(shuffled[shuffled.length - 1].id, { opp: null, result: 'bye', dealt: 0, taken: 0 });

    // ── settle + round records ──────────────────────────────────────────────────────────────────────────────
    const eliminatedThisRound: Seat[] = [];
    for (const s of alive) {
      const r = results.get(s.id)!;
      let taken = r.taken;
      const absorbed = Math.min(s.armor, taken); s.armor -= absorbed; taken -= absorbed;
      s.health -= taken;
      const eliminated = s.health <= 0;
      rec.onRound({
        lobbyId, seatId: s.id, round, heroId: s.heroId, tier: s.tier,
        goldSpent: s.goldSpent, goldUnspent: s.gold,
        board: s.board.map((b) => b.cardId), hand: s.hand.map((h) => h.cardId),
        health: Math.max(0, s.health), armor: s.armor, opponentSeatId: r.opp, result: r.result,
        damageDealt: r.dealt, damageTaken: r.taken, eliminated,
      });
      if (eliminated) eliminatedThisRound.push(s);
    }
    // Simultaneous eliminations share the WORSE placement order by health (more negative = lower).
    eliminatedThisRound.sort((a, b) => a.health - b.health);
    for (const s of eliminatedThisRound) { s.alive = false; s.eliminatedRound = round; placements.set(s.id, placementNext--); }
    rec.setRoundsPlayed(round);
  }
  // Survivors: ranked by health (then armor) — the cap case; a lone survivor is the winner.
  const survivors = seats.filter((s) => s.alive).sort((a, b) => b.health + b.armor - (a.health + a.armor));
  for (const s of survivors) placements.set(s.id, placementNext--);

  const failed = (opts.failRate ?? 0) > 0 && makeRng(seed * 7 + 3).next() < (opts.failRate ?? 0);
  for (const s of seats) {
    const run: RunRecord = {
      lobbyId, seatId: s.id, heroId: s.heroId, setId, tribes: setDef ? tribes : [], policyId: manifest.policy.id,
      placement: failed ? undefined : placements.get(s.id), eliminatedRound: s.eliminatedRound,
      termination: failed ? 'failed' : s.alive && s.eliminatedRound === undefined && survivors.length > 1 ? 'capped' : 'placed',
      runesOwned: [...s.runes], finalBoard: s.board.map((b) => b.cardId),
    };
    if (failed) run.failure = 'synthetic: injected lobby failure';
    rec.onRun(run);
  }
  if (failed) rec.fail('synthetic: injected lobby failure');
  return rec.finalize();
}

/** Every lobby in the manifest's seed schedule. */
export function synthesizeJob(manifest: ExperimentManifest, identity: ExperimentIdentity = syntheticIdentity(manifest), opts: SyntheticOptions = {}): LobbyRecord[] {
  const out: LobbyRecord[] = [];
  for (let i = 0; i < manifest.seeds.count; i++) out.push(synthesizeLobby(manifest.seeds.start + i, manifest, identity, opts));
  return out;
}
