/**
 * DOC BOT LANE `conservationLaws` — CONSERVATION LAWS: interaction bugs without enumerating interactions.
 *
 * The invariant fuzz (invariantFuzz.test.ts) checks properties of single states. This file checks properties
 * of TRANSITIONS — quantities that must be conserved or attributable across an action or a whole combat, so a
 * bug born from two effects composing badly (double-spend, phantom gold, an event log that disagrees with the
 * outcome, a stat that appeared from nowhere) trips a law even though no test ever named the pair.
 *
 * Three laws, each implemented at the STRONGEST grain the state actually proves — never weakened to vacuity,
 * and each with a sabotage check proving the law can alarm:
 *
 *   1. GOLD LEDGER. The reducer has exactly three writes to `embers` (audited 2026-08-26):
 *        - `spendGold` (reducer.ts) — the single spend chokepoint; it also bumps `s.goldSpent`;
 *        - `gainGold` (recruit.ts) — the single gain chokepoint (positive only);
 *        - the start-of-turn refill (`s.embers = maxEmbers + …`), which only runs on a turn advance.
 *      The state keeps a spend journal (`goldSpent`) but NO income journal, so exact per-action
 *      reconciliation (Δembers === income − spends) is not provable from outside. What IS provable:
 *        (a) `goldSpent` is monotone (a spend can never be un-booked);
 *        (b) within a recruit-phase action that does not advance the turn, every ember LOST is booked:
 *            Δembers + ΔgoldSpent ≥ 0. A direct `embers -=` that bypasses `spendGold` — the double-spend /
 *            unbooked-cost class — breaks this immediately;
 *        (c) embers stay non-negative finite integers.
 *      Exact-grain reconciliation lives in the targeted PROBES below: buy / sell / roll / upgrade move gold
 *      by exactly the printed cost helpers (`minionCostOf` / `sellValueWithBonus` / `refreshCostOf` /
 *      `upgradeCostOf`), and gold-inert actions (freeze / reposition) move nothing.
 *
 *   2. COMBAT EVENT-LOG RECONSTRUCTION. `simulate()`'s event log is the UI's ONLY input — if the log and the
 *      result disagree, the player watches one fight and is scored on another. A minimal reducer replays the
 *      log over `result.initial` and must reproduce: per-side survivor counts consistent with the outcome,
 *      no death of an unknown/already-dead body, and the loss-damage formula
 *      (`playerDamage === enemy tier + Σ tier(surviving enemy minions)`, simulate.ts ~3665).
 *
 *   3. STAT PROVENANCE (shop). Every `recruitBuffFx` record must describe a REAL stat change: its target is
 *      on the board, and per-target the recorded fx never exceeds the stat delta the action actually
 *      produced (a phantom/overstated fx record is the UI animating a buff that never happened). The
 *      CONVERSE (every stat change has an fx record) is deliberately NOT asserted — many legitimate channels
 *      are unrecorded by design: self-buffs (pulse channel, see `captureBuffFx`), direct reducer buffs
 *      (hero powers, rune procs, quest rewards), run-wide `cardBuffs` baking, and golden-triple merges.
 *      Inert actions (reposition / freeze) must change no stat and no gold at all.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type CombatResult, type Side } from '@game/core';
import { createRun, modalOpen, reduce, type Action, type BoardCard, type RunState } from '../index';
import { minionCostOf, refreshCostOf, upgradeCostOf } from '../reducer';
import { sellValueWithBonus } from '../recruit';

/** The invariant fuzz's action generator, kept in lockstep (see invariantFuzz.test.ts — duplicated rather
 *  than exported so the two lanes stay independently editable; the shape is the contract, not the code). */
function nextAction(s: RunState, rng: { int(n: number): number }): Action {
  if (s.discover) return { type: 'discover', index: rng.int(Math.max(1, s.discover.length)) };
  if (s.chooseOne) return { type: 'chooseOne', index: rng.int(2) };
  if (s.pendingTarget) {
    const t = s.board[rng.int(Math.max(1, s.board.length))] ?? s.board[0];
    return t ? { type: 'battlecryTarget', targetUid: t.uid } : { type: 'faceOmen' };
  }
  if (s.questOffer) return { type: 'buyQuest', index: rng.int(Math.max(1, s.questOffer.length)) };
  if (s.powerOffer) return { type: 'pickPower', index: rng.int(Math.max(1, s.powerOffer.heroIds.length)) };
  if (s.runeforgeOffer) return rng.int(3) === 0 ? { type: 'skipRuneforge' } : { type: 'buyRune', index: rng.int(Math.max(1, s.runeforgeOffer.length)) };
  if (s.scoutedNextOpponent?.length) return { type: 'closeScout' };
  if (s.phase === 'combat') return { type: 'resolveCombat' };
  if (s.lastCombat && !s.combatSettled && s.phase !== 'recruit') return { type: 'settleCombat' };
  const roll = rng.int(100);
  if (roll < 24 && s.shop.length > 0) return { type: 'buy', uid: s.shop[rng.int(s.shop.length)]!.uid };
  if (roll < 44 && s.hand.length > 0) {
    const c = s.hand[rng.int(s.hand.length)]!;
    const target = s.board[rng.int(Math.max(1, s.board.length))];
    return { type: 'play', uid: c.uid, ...(target ? { targetUid: target.uid } : {}) };
  }
  if (roll < 54 && s.board.length > 0) return { type: 'sell', uid: s.board[rng.int(s.board.length)]!.uid };
  if (roll < 64) return { type: 'roll' };
  if (roll < 70) return { type: 'upgrade' };
  if (roll < 76) {
    const t = s.board[rng.int(Math.max(1, s.board.length))];
    return { type: 'heroPower', ...(t ? { uid: t.uid } : {}) };
  }
  if (roll < 82 && s.board.length > 1) return { type: 'reposition', uid: s.board[rng.int(s.board.length)]!.uid, toIndex: rng.int(s.board.length) };
  if (roll < 86) return { type: 'freeze' };
  return { type: 'faceOmen' };
}

// ── LAW 1: the Gold ledger ────────────────────────────────────────────────────────────────────────────────

/** Null = the transition satisfies the ledger law; otherwise a description of the violation. */
function goldLedgerViolation(prev: RunState, next: RunState): string | null {
  if (!Number.isFinite(next.embers) || !Number.isInteger(next.embers)) return `embers=${next.embers} is not a finite integer`;
  if (next.embers < 0) return `embers=${next.embers} went negative`;
  const dSpent = (next.goldSpent ?? 0) - (prev.goldSpent ?? 0);
  if (dSpent < 0) return `goldSpent rolled back by ${-dSpent} — a spend was un-booked`;
  // The start-of-turn refill (`embers = maxEmbers + …`) may lower embers legitimately (an over-cap bank);
  // it only runs on a turn advance, so the loss-booking half applies within a stable recruit turn only.
  const turnAdvanced = next.wave !== prev.wave || prev.phase !== 'recruit' || next.phase !== 'recruit';
  const dEmbers = next.embers - prev.embers;
  if (!turnAdvanced && dEmbers + dSpent < 0) {
    return `embers fell by ${-dEmbers} but only ${dSpent} was booked through spendGold — an unbooked spend`;
  }
  return null;
}

// ── LAW 3: shop stat provenance ───────────────────────────────────────────────────────────────────────────

/** Null = every recruitBuffFx record after the action describes a real, correctly-sized stat change. */
function provenanceViolation(prev: RunState, next: RunState): string | null {
  const prevByUid = new Map(prev.board.map((c) => [c.uid, c]));
  const nextByUid = new Map(next.board.map((c) => [c.uid, c]));
  const perTarget = new Map<string, { attack: number; health: number }>();
  for (const fx of next.recruitBuffFx) {
    const t = perTarget.get(fx.targetUid) ?? { attack: 0, health: 0 };
    t.attack += Math.max(0, fx.attack);
    t.health += Math.max(0, fx.health);
    perTarget.set(fx.targetUid, t);
  }
  for (const [uid, fxSum] of perTarget) {
    const after = nextByUid.get(uid);
    // A target may legitimately vanish within the same action (a triple merge re-uids the golden copy, a
    // consume eats the body after it was buffed) — existence is only checkable when the uid survived.
    if (!after) {
      // …but if the uid never existed on EITHER side of the action, the record is a pure phantom.
      if (!prevByUid.has(uid)) return `recruitBuffFx targets uid ${uid} which was never on the board`;
      continue;
    }
    const before = prevByUid.get(uid);
    if (!before) continue; // buffed a card summoned within this same action — no before-state to bound against
    const dA = after.attack - before.attack;
    const dH = after.health - before.health;
    if (fxSum.attack > dA || fxSum.health > dH) {
      return `recruitBuffFx claims +${fxSum.attack}/+${fxSum.health} on ${uid} (${after.cardId}) but the action only changed it by ${dA}/${dH} — an overstated/phantom buff record`;
    }
  }
  return null;
}

const statFingerprint = (s: RunState): string => s.board.map((c) => `${c.uid}:${c.attack}/${c.health}`).join(',');

describe('Doc Bot — conservation laws (shop)', () => {
  it('gold ledger + stat provenance hold across 8 seeds × 60 random legal actions', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const rng = makeRng(0xc0a5 + seed);
      let s = createRun(seed * 6229);
      for (let step = 0; step < 60; step++) {
        const a = nextAction(s, rng);
        const next = reduce(s, a);
        const at = `seed ${seed} step ${step} after ${a.type}`;
        const ledger = goldLedgerViolation(s, next);
        expect(ledger, `${at}: ${ledger}`).toBeNull();
        const prov = provenanceViolation(s, next);
        expect(prov, `${at}: ${prov}`).toBeNull();
        // Inert actions: reposition and freeze have NO gold or stat channel at all.
        if ((a.type === 'reposition' || a.type === 'freeze') && next !== s) {
          expect(next.embers, `${at}: ${a.type} moved gold`).toBe(s.embers);
          expect(new Set(statFingerprint(next).split(',')), `${at}: ${a.type} changed a board stat`)
            .toEqual(new Set(statFingerprint(s).split(',')));
        }
        s = next;
      }
    }
  });

  it('probes: buy / sell / roll / upgrade move gold by EXACTLY the printed cost helpers', () => {
    const mk = (embers: number): RunState => ({ ...createRun(0x90b3, 'aster'), embers } as RunState);
    // BUY — the first non-spell shop offer costs `minionCostOf` on a plain fresh run.
    {
      const s0 = mk(20);
      const offer = s0.shop.find((c) => !CARD_INDEX[c.cardId]?.spell);
      expect(offer, 'fresh tier-1 shop offered no minion').toBeTruthy();
      const s1 = reduce(s0, { type: 'buy', uid: offer!.uid });
      expect(s1.shop.length, 'buy did not remove exactly one offer').toBe(s0.shop.length - 1);
      expect(s0.embers - s1.embers, `buy charged ${s0.embers - s1.embers}, printed cost is ${minionCostOf(s0)}`).toBe(minionCostOf(s0));
    }
    // SELL — pays exactly sellValueWithBonus.
    {
      const s0 = mk(0);
      const pup = CARD_INDEX['pup']!;
      const c: BoardCard = { uid: 'sell1', cardId: 'pup', tribe: pup.tribe, attack: pup.attack, health: pup.health, keywords: [...pup.keywords], golden: false };
      const withBoard = { ...s0, board: [c] } as RunState;
      const expected = sellValueWithBonus(c, withBoard);
      const s1 = reduce(withBoard, { type: 'sell', uid: 'sell1' });
      expect(s1.board.length, 'sell did not remove the minion').toBe(0);
      expect(s1.embers - withBoard.embers, `sell paid ${s1.embers - withBoard.embers}, printed value is ${expected}`).toBe(expected);
    }
    // ROLL — charges exactly refreshCostOf on a run with no free rolls.
    {
      const s0 = mk(10);
      const s1 = reduce(s0, { type: 'roll' });
      expect(s0.embers - s1.embers, 'roll charged a price other than refreshCostOf').toBe(refreshCostOf(s0));
    }
    // UPGRADE — charges exactly upgradeCostOf.
    {
      const s0 = mk(50);
      const s1 = reduce(s0, { type: 'upgrade' });
      expect(s1.tier).toBe(s0.tier + 1);
      expect(s0.embers - s1.embers, 'upgrade charged a price other than upgradeCostOf').toBe(upgradeCostOf(s0));
    }
  });

  it('SABOTAGE: a doctored transition that drops gold without booking it ALARMS', () => {
    const prev = createRun(1234);
    const unbooked = { ...prev, embers: prev.embers - 2 } as RunState; // gold vanished, goldSpent untouched
    expect(goldLedgerViolation(prev, unbooked)).toMatch(/unbooked spend/);
    const rollback = { ...prev, goldSpent: (prev.goldSpent ?? 0) - 1 } as RunState;
    expect(goldLedgerViolation(prev, rollback)).toMatch(/un-booked/);
    const nan = { ...prev, embers: Number.NaN } as RunState;
    expect(goldLedgerViolation(prev, nan)).toMatch(/finite/);
  });

  it('SABOTAGE: a phantom or overstated recruitBuffFx record ALARMS', () => {
    const prev = createRun(777);
    const pup = CARD_INDEX['pup']!;
    const body: BoardCard = { uid: 'b1', cardId: 'pup', tribe: pup.tribe, attack: pup.attack, health: pup.health, keywords: [...pup.keywords], golden: false };
    const withBoard = { ...prev, board: [body] } as RunState;
    // Phantom: an fx record naming a uid that never existed.
    const phantom = {
      ...withBoard,
      recruitBuffFx: [{ targetUid: 'ghost', attack: 2, health: 2, sourceCardId: 'pup', sourceTribe: 'beast', kind: 'minion' }],
    } as RunState;
    expect(provenanceViolation(withBoard, phantom)).toMatch(/never on the board/);
    // Overstated: the record claims +5/+5 but the board only moved +1/+1.
    const overstated = {
      ...withBoard,
      board: [{ ...body, attack: body.attack + 1, health: body.health + 1 }],
      recruitBuffFx: [{ targetUid: 'b1', attack: 5, health: 5, sourceCardId: 'pup', sourceTribe: 'beast', kind: 'minion' }],
    } as RunState;
    expect(provenanceViolation(withBoard, overstated)).toMatch(/overstated/);
  });
});

// ── LAW 2: combat event-log reconstruction ────────────────────────────────────────────────────────────────

/**
 * Replay the event log over `result.initial` with a minimal reducer, tracking the reconstructible
 * dimensions: which uids exist, which are alive, and each unit's current cardId (ascends re-point it).
 *
 * Event types deliberately NOT folded in, and why:
 *   - presentation-only metadata by contract (types.ts): `sc` (narration), `proccrit`, `reveal`,
 *     `tribeAura`, `rally`, `questTrigger`/`questComplete`, `hpGrant`, `spellProgress`, `spellcast`,
 *     `improve` (an accrual the replay folds into summonBonus, not a life/death fact), `wave`/`step`/
 *     `avenge`/`key`/`srcCard` stamps;
 *   - state deltas OUTSIDE the tracked dimensions: `buff`, `dmg` amounts, `shield`/`shieldUp`, `poison`,
 *     `venomLost`, `keyword`/`keywordLost`, `maxGold`, `toHand` — they change stats/keywords/economy, but
 *     survivor-set membership (this law's subject) is fully determined by summon/death/reborn/ascend.
 *     (`dmg` IS used for an existence check: damage to a uid the log never introduced is an alarm.)
 */
function reconstruct(result: CombatResult): { problems: string[]; survivors: Record<Side, { uid: string; cardId: string }[]> } {
  const problems: string[] = [];
  const units = new Map<string, { side: Side; alive: boolean; cardId: string }>();
  for (const side of ['player', 'enemy'] as const) {
    for (const m of result.initial[side]) units.set(m.uid, { side, alive: true, cardId: m.cardId });
  }
  for (const e of result.events as CombatEvent[]) {
    switch (e.type) {
      case 'summon': {
        units.set(e.minion.uid, { side: e.side, alive: true, cardId: e.minion.cardId });
        break;
      }
      case 'death': {
        const u = units.get(e.target);
        if (!u) { problems.push(`death of unknown uid ${e.target}`); break; }
        if (!u.alive) { problems.push(`double death of ${e.target} with no reborn in between`); break; }
        u.alive = false;
        break;
      }
      case 'reborn': {
        const u = units.get(e.target);
        if (!u) { problems.push(`reborn of unknown uid ${e.target}`); break; }
        u.alive = true;
        break;
      }
      case 'ascend': {
        const u = units.get(e.target);
        if (!u) { problems.push(`ascend of unknown uid ${e.target}`); break; }
        u.cardId = e.into;
        break;
      }
      case 'dmg': {
        if (!units.has(e.target)) problems.push(`damage to unknown uid ${e.target}`);
        break;
      }
      default:
        break; // documented above: presentation-only, or a delta outside the tracked dimensions
    }
  }
  const survivors: Record<Side, { uid: string; cardId: string }[]> = { player: [], enemy: [] };
  for (const [uid, u] of units) if (u.alive) survivors[u.side].push({ uid, cardId: u.cardId });
  return { problems, survivors };
}

/** Cross-check the reconstruction against the sim's own verdict. */
function reconstructionDisagreement(result: CombatResult, enemyTier: number): string | null {
  const { problems, survivors } = reconstruct(result);
  if (problems.length) return problems.join('; ');
  const p = survivors.player.length;
  const e = survivors.enemy.length;
  if (result.result === 'win' && !(p > 0 && e === 0)) return `outcome=win but log reconstructs ${p} player / ${e} enemy survivors`;
  if (result.result === 'lose' && !(p === 0 && e > 0)) return `outcome=lose but log reconstructs ${p} player / ${e} enemy survivors`;
  if (result.result === 'draw' && (p > 0) !== (e > 0)) return `outcome=draw but log reconstructs ${p} player / ${e} enemy survivors — one-sided`;
  // Final damage: the loss formula is enemy tier + Σ tier(surviving enemy minions) (simulate.ts ~3665).
  const expected = result.result === 'lose'
    ? enemyTier + survivors.enemy.reduce((sum, m) => sum + (CARD_INDEX[m.cardId]?.tier ?? 1), 0)
    : 0;
  if (result.playerDamage !== expected) return `playerDamage=${result.playerDamage} but the log's survivors reconstruct ${expected}`;
  return null;
}

describe('Doc Bot — conservation laws (combat event log)', () => {
  const roster = Object.values(CARD_INDEX)
    .filter((c): c is NonNullable<typeof c> => !!c && !c.spell && !c.token && !c.ruby && c.attack > 0)
    .sort((a, b) => (a.id < b.id ? -1 : 1)); // stable order — the fuzz must be seed-deterministic

  const randomBoard = (rng: { int(n: number): number }, prefix: string): BoardMinion[] => {
    const n = 3 + rng.int(4);
    return Array.from({ length: n }, (_, i) => {
      const d = roster[rng.int(roster.length)]!;
      return { cardId: d.id, attack: d.attack, health: d.health, sourceUid: `${prefix}${i}`, keywords: [...d.keywords] } as unknown as BoardMinion;
    });
  };

  it('30 seeded combats over random boards: the event log reconstructs to the sim result (survivors, outcome, loss damage)', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rng = makeRng(0x10ad + seed * 37);
      const tier = 1 + rng.int(6);
      const r = simulate(randomBoard(rng, 'p'), randomBoard(rng, 'e'), makeRng(seed * 101), CARD_INDEX,
        combatSide({ tier }), combatSide({ tier }));
      const bad = reconstructionDisagreement(r, tier);
      expect(bad, `seed ${seed}: ${bad}`).toBeNull();
    }
  });

  it('SABOTAGE: a doctored event log (a dropped death) ALARMS', () => {
    // A decisive fight: one big player body vs two small enemies — guaranteed enemy deaths.
    const big: BoardMinion = { cardId: 'pup', attack: 20, health: 60, sourceUid: 'P', keywords: [] } as unknown as BoardMinion;
    const small = (uid: string): BoardMinion => ({ cardId: 'pup', attack: 1, health: 1, sourceUid: uid, keywords: [] } as unknown as BoardMinion);
    const r = simulate([big], [small('E1'), small('E2')], makeRng(9), CARD_INDEX, combatSide({ tier: 2 }), combatSide({ tier: 2 }));
    expect(r.result).toBe('win');
    expect(reconstructionDisagreement(r, 2), 'the honest log must reconcile').toBeNull();
    const lastDeath = [...r.events].reverse().find((e) => e.type === 'death' && (e as { side?: string }).side === 'enemy');
    expect(lastDeath).toBeTruthy();
    const doctored: CombatResult = { ...r, events: r.events.filter((e) => e !== lastDeath) };
    expect(reconstructionDisagreement(doctored, 2), 'a dropped enemy death must desync survivors from the outcome').toMatch(/outcome=win/);
  });
});
