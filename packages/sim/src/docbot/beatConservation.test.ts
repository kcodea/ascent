/**
 * DOC BOT LANE `beatConservation` — the recruit beat stream and the combat stamps are a faithful,
 * non-duplicating account of the state changes.
 *
 * Roughly half of this repo's fix history is presentation: beats, FX, doubled emissions. Doc Bot cannot see
 * pixels, but the machine-checkable half of a presentation bug is a CLAIM that disagrees with a STATE DIFF —
 * and that is checkable after every single action. The canonical shape is the Rope Wrangler bug (#1374,
 * Bug Board bb5195d5 / af51e5a3): a recruit scope opened INSIDE another (`castSpell` inside an End-of-Turn
 * `withRecruitTrigger`) diffed the same window twice, so every stolen card was previewed twice and Arnold's
 * Beefy read +16/+16 for +8/+8. A player found it. This lane exists so the next one is found by CI.
 *
 * THE LAW (helper: beatConservation.ts — the LAW 4 doctrine of conservationLaws.test.ts: exact equality, no
 * catch-all). For one action, fold the batch's consequences per uid and compare with the real diff:
 *   · OVER-CLAIM / MISATTRIBUTION — hard, every action type: Σ claimed stats per uid === the actual delta; a
 *     grant / summon / destroy claimed at most once per uid and only for a body that really arrived / left;
 *     no claim on a phantom uid; no consequence outside a trigger scope; a hero power's Gold claim exact.
 *   · UNDER-CLAIM (a missing beat) — hard for every action type whose resolution is scoped, and PINNED
 *     shrink-only (`KNOWN_UNATTRIBUTED`) for the dispatch sites that open no scope yet. Each pin carries a
 *     deterministic fixture that must still REPRODUCE, so a scoped site fails loudly until its pin is deleted
 *     (the temporalWindow doctrine: a defect stays visible, never excused into silence).
 *
 * DRIVERS: (a) the invariant-fuzz free-play policy (`nextFuzzAction`, shared with the corpus + nightly), (b) a
 * dense BUILDER policy — buys, plays, powers and End of Turn on a topped-up purse, no sells — because free
 * play sells its board down and reaches almost no End-of-Turn nesting (measured: 6 batches in 207 turn ends);
 * heroes cycle across seeds so hero-rail nesting (Djinn, Myra) is inside the vocabulary; (c) every checked-in
 * coverage-corpus fixture; (d) hand-built nested fixtures: a cast inside an End of Turn, a hero power that
 * replays End-of-Turn effects (a scope inside the whole-action diff), a shop death whose Echo summons INTO a
 * triple, a targeted Shout, a targeted Choose One branch, a Shout that Discovers then the pick.
 *
 * WHAT LANDING IT FOUND (2026-09-11), fixed in the same PR with their own fixtures below:
 *   · Djinn's `replayAllEndOfTurn`: the hero wrap's whole-action diff (`emitHeroPowerDiff`) re-emitted every
 *     consequence the nested End-of-Turn scopes had already claimed — Arnold +16/+16, Lasso steals twice. The
 *     Rope Wrangler class on the hero rail; the wrap now emits only the residual its children did not claim.
 *   · `applyBattlecryTarget` / `applyChooseOneTarget` opened NO scope: an aimed Shout (Toxin Tender, Emissary)
 *     and a targeted Choose One branch (Runic Beetle) resolved with an empty batch — nothing to schedule.
 *   · `emitHeroPowerDiff` had no departure half: Devourer's meal left the board with no `cardDestroyed`.
 *
 * SABOTAGE (recorded, §3.5):
 *   · Frame-stack revert (manual, 2026-09-11): with `parent?.flush()` + `parent?.rebase()` removed from
 *     `withRecruitTrigger` (the exact pre-#1374 code) this lane went red in the builder sweep AND on the
 *     nested fixtures — verbatim:
 *       seed 2 step 12 (flash, board 3) after faceOmen: dw_arnold (plant2): beats claim +16/+16 but the
 *         action changed it by +8/+8 — OVER-claimed (a doubled emission?)
 *       seed 7 step 7 (vale, board 2) after faceOmen: cardGranted claimed 2× for dw_orin (b14) — one
 *         arrival, 2 previews (the Rope Wrangler class)
 *       rope-wrangler+arnold after faceOmen: cardGranted claimed 2× for stray (b4) …
 *     (5 of 13 tests red; the free-play sweep stayed green — exactly why the builder policy exists.)
 *   · In-file: a doctored batch that re-emits a child's consequences at the parent (the bug's exact event
 *     shape), a dropped consequence, and a claim moved to the wrong body each alarm, naming the uid and numbers.
 *
 * Budget: seeded and bounded (~2–4 s locally); the deeper sweep is `DOCBOT_DEPTH=nightly` (×4 seeds).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type GamePresentationEvent } from '@game/core';
import { createRun, deserialize, reduceWithPresentation, type Action, type RunState } from '../index';
import { HEROES } from '../heroes';
import { CONFIG } from '../config';
import { parseQaScenario } from '../qaScenario';
import { nextFuzzAction, pinCurrentWave } from './trajectory';
import { beatConservationViolations, combatStampViolations } from './beatConservation';

// ── Fixtures ───────────────────────────────────────────────────────────────────────────────────────────────

function mk(uid: string, id: string) {
  const d = CARD_INDEX[id]!;
  return { uid, cardId: id, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
}
function withState(heroId: string, patch: Record<string, unknown>): RunState {
  return { ...createRun(11, heroId), phase: 'recruit', hand: [], ...patch } as unknown as RunState;
}
const straysShop = [{ uid: 's1', cardId: 'stray' }, { uid: 's2', cardId: 'stray' }, { uid: 's3', cardId: 'stray' }];

// ── Gate configuration ─────────────────────────────────────────────────────────────────────────────────────

/** Combat hand-off actions: the combat LOG is their record (conservationLaws LAW 2), and their post-combat
 *  scalers/rewards land outside the recruit beat stream by design. Over-claims are still checked. */
const COMBAT_ACTIONS = new Set<Action['type']>(['resolveCombat', 'settleCombat']);

interface UnattributedPin {
  action: Action['type'];
  /** Which dispatch site opens no scope, so the fixing session starts at the right line. */
  why: string;
  /** A deterministic reproduction of the gap — the pin is proven by CONSTRUCTION, not by seed luck. When
   *  the site is scoped this fixture stops under-claiming, the pin test fails, and the entry is deleted. */
  repro: () => { state: RunState; action: Action };
}

/**
 * Action types whose dispatch sites open NO trigger scope today, so a change they make has no beat. This
 * table may only SHRINK: scoping a site makes its fixture stop reproducing, and the pin test fails until the
 * entry is deleted. Everything not listed here is a HARD under-claim gate. (Over-claims are hard everywhere.)
 */
const KNOWN_UNATTRIBUTED: readonly UnattributedPin[] = [
  {
    action: 'buy',
    why: '`fire(onBuy)` dispatches bare (recruit.ts `fire`): Broker buffs the board on a buy with no scope; rune / quest buy-procs and hero passives (Harlan) too',
    repro: () => ({ state: withState('warden', { embers: 20, board: [mk('b1', 'broker'), mk('b2', 'pup')], shop: [{ uid: 's1', cardId: 'pup' }] }), action: { type: 'buy', uid: 's1' } }),
  },
  {
    action: 'play',
    why: '`fireBattlecryTriggered` + `fire(onSummon)` + Den Marker dispatch bare after the played Shout (Embermouth reacts to a Shout with no scope); rune spell-cast procs (Rune of Scales) and a Ruby from hand (reducer.ts `def.ruby`) buff with no scope',
    repro: () => ({ state: withState('warden', { board: [mk('b1', 'd2_embermouth')], hand: [mk('h1', 'dw_ironlung')] }), action: { type: 'play', uid: 'h1' } }),
  },
  {
    action: 'chooseOne',
    why: 'the pick REPLAYS the deferred `play` (reducer `chooseOnePick`), so it inherits every bare site of `play` — here a rune spell-cast proc (Rune of Scales, recruit.ts `castSpell`) buffing Dragons with no scope',
    repro: () => ({
      state: withState('warden', { runeScales: true, ownedRunes: ['rune_scales'], board: [mk('b1', 'd2_runefire')], hand: [mk('h1', 'crestclimb')], chooseOne: { uid: 'h1', cardId: 'crestclimb', spell: true, targetUid: 'b1' } }),
      action: { type: 'chooseOne', index: 1 },
    }),
  },
  {
    action: 'battlecryTarget',
    why: '`fireBattlecryTriggered` (Shout-watchers: Karwind, Embermouth) dispatches bare after the aimed Shout resolves — the aimed Shout itself is scoped since 2026-09-11',
    repro: () => {
      const dragon = Object.values(CARD_INDEX).find((c) => c && !c.token && !c.spell && c.tribe === 'dragon' && c.id !== 'emissary' && c.id !== 'd2_embermouth')!;
      let s = withState('warden', { board: [mk('b1', 'd2_embermouth'), mk('b2', dragon.id)], hand: [mk('h1', 'emissary')] });
      s = reduceWithPresentation(s, { type: 'play', uid: 'h1' }, true).state;
      return { state: s, action: { type: 'battlecryTarget', targetUid: 'b2' } };
    },
  },
  {
    action: 'discover',
    why: '`onGainCard` watchers (Gangplank) dispatch bare when the pick lands in hand',
    repro: () => ({ state: withState('warden', { board: [mk('b1', 'dw_gangplank')], discover: ['pup', 'pup', 'pup'] }), action: { type: 'discover', index: 0 } }),
  },
  {
    action: 'sell',
    why: 'on-sell effects (Beggy paying out Rubies, a card returning to hand) run bare in the `sell` case — no scope',
    repro: () => ({ state: withState('warden', { board: [mk('b1', 'k_beggy'), mk('b2', 'pup')] }), action: { type: 'sell', uid: 'b1' } }),
  },
  {
    action: 'buyRune',
    why: 'a reward that consumes a body (Rune of the Altar) leaves the board with no `cardDestroyed` — `withQuestRewardBeat` diffs stats / hand / Gold, not departures',
    repro: () => ({ state: withState('warden', { embers: 50, board: [mk('b1', 'pup'), mk('b2', 'dw_pimm')], runeforgeOffer: ['rune_altar'] }), action: { type: 'buyRune', index: 0 } }),
  },
  {
    action: 'upgrade',
    why: '`applyGoldSpent` (recruit.ts) fires `goldSpent` watchers bare — Coinfire: every 5 Gold spent (`card.goldTick`) → Dwarves +2 Attack; the tier-up is the spend here',
    repro: () => ({ state: withState('warden', { embers: 20, board: [{ ...mk('b1', 'dw_coinfire'), goldTick: 0 }, mk('b2', 'dw_pimm')], upgradeCost: 5 }), action: { type: 'upgrade' } }),
  },
  {
    action: 'roll',
    why: "`applyGoldSpent` fires `goldSpent` watchers bare on any spend — a paid refresh that crosses Coinfire's every-5 tick buffs Dwarves with no scope",
    repro: () => ({ state: withState('warden', { embers: 20, freeRolls: 0, board: [{ ...mk('b1', 'dw_coinfire'), goldTick: 4 }, mk('b2', 'dw_pimm')] }), action: { type: 'roll' } }),
  },
];

const NIGHTLY = process.env.DOCBOT_DEPTH === 'nightly';
const SEED_MULT = NIGHTLY ? 4 : 1;

// ── Drivers ────────────────────────────────────────────────────────────────────────────────────────────────

const heroRoster = (): string[] => HEROES.filter((h) => !h.wip).map((h) => h.id).sort();

/** The BUILDER policy: modals first (same order as the fuzz), then buy / play / roll / upgrade / power / end
 *  turn — no sells, so boards fill and End of Turn has something to fire. Weights are tuned constants. */
function denseAction(s: RunState, rng: { int(n: number): number }): Action {
  if (s.discover) return { type: 'discover', index: rng.int(Math.max(1, s.discover.length)) };
  if (s.chooseOne) return { type: 'chooseOne', index: rng.int(2) };
  if (s.pendingTarget) {
    const t = s.board[rng.int(Math.max(1, s.board.length))] ?? s.board[0];
    return t ? { type: 'battlecryTarget', targetUid: t.uid } : { type: 'faceOmen' };
  }
  if (s.questOffer) return { type: 'buyQuest', index: rng.int(Math.max(1, s.questOffer.length)) };
  if (s.powerOffer) return { type: 'pickPower', index: rng.int(Math.max(1, s.powerOffer.heroIds.length)) };
  if (s.runeforgeOffer) return { type: 'buyRune', index: rng.int(Math.max(1, s.runeforgeOffer.length)) };
  if (s.scoutedNextOpponent?.length) return { type: 'closeScout' };
  if (s.pendingDeath) return { type: 'resolveShopDeath' };
  if (s.phase === 'combat') return { type: 'resolveCombat' };
  if (s.lastCombat && !s.combatSettled && s.phase !== 'recruit') return { type: 'settleCombat' };
  const roll = rng.int(100);
  if (roll < 33 && (s.shop.length > 0 || s.spell)) {
    const pool = [...s.shop, ...(s.spell ? [s.spell] : [])];
    return { type: 'buy', uid: pool[rng.int(pool.length)]!.uid };
  }
  if (roll < 66 && s.hand.length > 0) {
    const c = s.hand[rng.int(s.hand.length)]!;
    const target = s.board[rng.int(Math.max(1, s.board.length))];
    return { type: 'play', uid: c.uid, ...(target ? { targetUid: target.uid } : {}) };
  }
  if (roll < 70 && s.board.length > 0) return { type: 'sell', uid: s.board[rng.int(s.board.length)]!.uid };
  if (roll < 77) return { type: 'roll' };
  if (roll < 82) return { type: 'upgrade' };
  if (roll < 90) {
    const t = s.board[rng.int(Math.max(1, s.board.length))];
    return { type: 'heroPower', ...(t ? { uid: t.uid } : {}) };
  }
  return { type: 'faceOmen' };
}

interface Finding { at: string; action: Action['type']; message: string }

/** Reconcile ONE dispatch. Returns the hard failures; pinned under-claims are returned separately so the
 *  pin test can prove each pin still reproduces. */
function reconcile(before: RunState, action: Action, at: string): { hard: Finding[]; pinned: Finding[]; after: RunState } {
  const { state: after, batch } = reduceWithPresentation(before, action, true);
  const events = batch?.events ?? [];
  const pinned = KNOWN_UNATTRIBUTED.some((p) => p.action === action.type);
  const combat = COMBAT_ACTIONS.has(action.type);
  const hard = beatConservationViolations(before, after, action, events, { underClaims: !pinned && !combat })
    .map((message) => ({ at, action: action.type, message }));
  const pinnedFindings: Finding[] = pinned
    ? beatConservationViolations(before, after, action, events, { underClaims: true })
      .filter((m) => !hard.some((h) => h.message === m))
      .map((message) => ({ at, action: action.type, message }))
    : [];
  return { hard, pinned: pinnedFindings, after };
}

/** Cards whose End of Turn CASTS a spell — the nested-scope class (a `castSpell` scope inside the End-of-Turn
 *  scope). Derived from content, never a hand list: a new such card joins the sweep the day it is authored. */
const nestedSeeds = (): string[] => Object.values(CARD_INDEX)
  .filter((c): c is NonNullable<typeof c> => !!c && !c.token && !c.spell && c.effects.some((e) => e.on === 'endOfTurn' && /cast/i.test(e.do)))
  .map((c) => c.id).sort();

/** One dense-sweep run: the builder hero cycle, plus ONE planted nested-class card in the opening hand so the
 *  sweep reaches End-of-Turn nesting instead of waiting for the shop to offer it (measured: it never did). */
function denseRun(seed: number): RunState {
  const heroes = heroRoster();
  // Every fourth run is Djinn: the hero whose power REPLAYS End-of-Turn effects — a nested scope inside the
  // whole-action hero diff, the class this lane found live on landing. The rest cycle the roster.
  const heroId = seed % 4 === 0 ? 'djinn' : heroes[(seed * 7) % heroes.length];
  const s = createRun(seed * 7919, heroId, 'ascent', CONFIG.defaultLine);
  const plants = nestedSeeds();
  const id = plants[seed % plants.length];
  if (id) s.hand.push({ ...mk(`plant${seed}`, id) });
  return s;
}

function sweep(policy: (s: RunState, rng: { int(n: number): number }) => Action, seeds: number, steps: number, salt: number, topUp: boolean): { hard: Finding[]; pinned: Finding[]; steps: number } {
  const heroes = heroRoster();
  const hard: Finding[] = [];
  const pinned: Finding[] = [];
  let executed = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const rng = makeRng(salt + seed);
    let s: RunState = topUp ? denseRun(seed) : createRun(seed * 7919, heroes[(seed * 7) % heroes.length], 'ascent', CONFIG.defaultLine);
    for (let step = 0; step < steps; step++) {
      pinCurrentWave(s);
      // The builder policy plays on a topped-up purse so the board fills — written BEFORE `before` is taken,
      // so the reconciliation still sees exactly what the reducer saw.
      if (topUp && s.phase === 'recruit') s.embers = Math.max(s.embers, 12);
      const a = policy(s, rng);
      const r = reconcile(s, a, `seed ${seed} step ${step} (${s.heroId}, board ${s.board.length})`);
      hard.push(...r.hard);
      pinned.push(...r.pinned);
      executed++;
      s = r.after;
      if (s.phase === 'gameover') break;
    }
  }
  return { hard, pinned, steps: executed };
}

const report = (f: Finding[]): string => f.slice(0, 20).map((x) => `  ${x.at} after ${x.action}: ${x.message}`).join('\n') + (f.length > 20 ? `\n  … ${f.length - 20} more` : '');

// ── The lane ───────────────────────────────────────────────────────────────────────────────────────────────

describe('Doc Bot — beat conservation (recruit)', () => {
  it('free-play fuzz (the invariant-fuzz policy): every batch reconciles exactly with the state diff', () => {
    const r = sweep(nextFuzzAction, 12 * SEED_MULT, 80, 0xbea7, false);
    expect(r.steps).toBeGreaterThan(400);
    expect(r.hard, `beat conservation violated:\n${report(r.hard)}`).toEqual([]);
  });

  it('builder policy (dense boards, heroes cycling): every batch reconciles exactly, nested scopes included', () => {
    const r = sweep(denseAction, 24 * SEED_MULT, 90, 0xb01d, true);
    expect(r.steps).toBeGreaterThan(1500);
    expect(r.hard, `beat conservation violated:\n${report(r.hard)}`).toEqual([]);
    // Coverage must be REAL: the sweep has to reach the nested class it exists for — End-of-Turn batches and
    // hero-power batches with child triggers. A sweep that never opens a nested scope proves nothing.
    let nestedEot = 0, nestedHero = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const rng = makeRng(0xb01d + seed);
      let s: RunState = denseRun(seed);
      for (let step = 0; step < 90; step++) {
        pinCurrentWave(s);
        if (s.phase === 'recruit') s.embers = Math.max(s.embers, 12);
        const a = denseAction(s, rng);
        const { state: next, batch } = reduceWithPresentation(s, a, true);
        const nested = (batch?.events ?? []).some((e) => e.type === 'sourceTrigger' && !!e.parentId);
        if (nested && a.type === 'faceOmen') nestedEot++;
        if (nested && a.type === 'heroPower') nestedHero++;
        s = next;
        if (s.phase === 'gameover') break;
      }
    }
    expect(nestedEot, 'the builder sweep reached no nested End-of-Turn scope — re-tune the policy').toBeGreaterThan(0);
    expect(nestedHero, 'the builder sweep reached no nested hero-power scope — re-tune the policy').toBeGreaterThan(0);
  });

  it('KNOWN_UNATTRIBUTED: every pin REPRODUCES from its own fixture (delete a pin whose site got scoped)', () => {
    for (const pin of KNOWN_UNATTRIBUTED) {
      const { state, action } = pin.repro();
      expect(action.type, 'a pin fixture must exercise its own action type').toBe(pin.action);
      const { state: after, batch } = reduceWithPresentation(state, action, true);
      expect(after !== state, `pin '${pin.action}': the fixture action was refused`).toBe(true);
      const under = beatConservationViolations(state, after, action, batch?.events ?? [], { underClaims: true });
      expect(under.length > 0, `pin for '${pin.action}' no longer reproduces (${pin.why}) — the site was scoped; DELETE the pin so the action is hard-gated`).toBe(true);
      // …and the pin excuses ONLY the under-claim half: the same fixture must be clean of over-claims.
      const over = beatConservationViolations(state, after, action, batch?.events ?? [], { underClaims: false });
      expect(over, `pin '${pin.action}': the fixture over-claims — that is never excused`).toEqual([]);
    }
  });

  it('coverage corpus: every checked-in fixture reconciles', () => {
    const dir = join(process.cwd(), 'packages', 'sim', 'src', 'docbot', 'corpus');
    const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'manifest.json');
    expect(files.length).toBeGreaterThan(0);
    const hard: Finding[] = [];
    for (const f of files) {
      const { scenario } = parseQaScenario(readFileSync(join(dir, f), 'utf8'));
      if (!scenario?.action) continue;
      const s = deserialize(scenario.state);
      pinCurrentWave(s);
      hard.push(...reconcile(s, scenario.action, f).hard);
    }
    expect(hard, `beat conservation violated in the corpus:\n${report(hard)}`).toEqual([]);
  });

  it('nested fixtures: a cast inside End of Turn (Rope Wrangler + Arnold) claims each steal and each +8/+8 once', () => {
    const s = withState('warden', { goldSpentThisTurn: 6, board: [mk('b1', 'ropewrangler'), mk('b2', 'dw_arnold')], shop: straysShop });
    const r = reconcile(s, { type: 'faceOmen' }, 'rope-wrangler+arnold');
    expect(r.hard, report(r.hard)).toEqual([]);
    expect(r.after.hand.length, 'the fixture steals').toBeGreaterThan(0);
    expect(r.after.board[1]!.attack - s.board[1]!.attack, 'Arnold cast Beefy').toBeGreaterThan(0);
  });

  it("nested fixtures: Djinn's replayAllEndOfTurn (a scope inside the whole-action hero diff) emits the residual only", () => {
    const s = withState('djinn', { embers: 10, goldSpentThisTurn: 6, board: [mk('b1', 'dw_arnold'), mk('b2', 'ropewrangler')], shop: straysShop });
    const r = reconcile(s, { type: 'heroPower' }, 'djinn-replay-all');
    expect(r.after !== s, 'the power fired').toBe(true);
    expect(r.hard, report(r.hard)).toEqual([]);
    const events = reduceWithPresentation(s, { type: 'heroPower' }, true).batch!.events;
    const arnold = events.filter((e) => e.type === 'statsChanged' && e.target.uid === 'b1');
    expect(arnold.length, 'ONE claim on Arnold — not one per nesting level').toBe(1);
    expect(events.filter((e) => e.type === 'sourceTrigger' && !!e.parentId).length, 'the EoT effects nest under the hero beat').toBeGreaterThan(0);
  });

  it('nested fixtures: a shop death whose Echo summons INTO a triple (arrivals that merge within the action)', () => {
    const s = withState('warden', { board: [mk('b1', 'pack'), mk('b2', 'pup')], pendingDeath: { uid: 'b1', kind: 'destroy' } });
    const r = reconcile(s, { type: 'resolveShopDeath' }, 'pack-death-triple');
    expect(r.hard, report(r.hard)).toEqual([]);
    expect(r.after.board.some((c) => c.uid === 'b1'), 'the body left').toBe(false);
  });

  it('nested fixtures: an aimed Shout and a targeted Choose One branch now open a scope (the found gap)', () => {
    const dragon = Object.values(CARD_INDEX).find((c) => c && !c.token && !c.spell && c.tribe === 'dragon' && c.id !== 'emissary')!;
    // Emissary: Shout → give a friendly Dragon stats. Aimed at play time.
    const s1 = withState('warden', { hand: [mk('h1', 'emissary')], board: [mk('b2', dragon.id)] });
    const p1 = reduceWithPresentation(s1, { type: 'play', uid: 'h1', targetUid: 'b2' }, true);
    const st = p1.state.pendingTarget ? reduceWithPresentation(p1.state, { type: 'battlecryTarget', targetUid: 'b2' }, true) : p1;
    const buffed = st.state.board.find((c) => c.uid === 'b2')!.attack - dragon.attack;
    expect(buffed, 'Emissary buffed the Dragon').toBeGreaterThan(0);
    const claims = (st.batch?.events ?? []).filter((e) => e.type === 'statsChanged' && e.target.uid === 'b2');
    expect(claims.length, 'the aimed Shout has a beat (before 2026-09-11 the batch was empty)').toBeGreaterThan(0);
    expect(claims.reduce((n, e) => n + (e as { attack: number }).attack, 0)).toBe(buffed);
    // Runic Beetle: Choose One, then aim, then resolve — the branch's effects must claim under a beat.
    let s2 = withState('warden', { hand: [mk('h1', 'beetle')], board: [mk('b2', 'pup'), mk('b3', 'pup')] });
    s2 = reduceWithPresentation(s2, { type: 'play', uid: 'h1' }, true).state;
    s2 = reduceWithPresentation(s2, { type: 'chooseOne', index: 0 }, true).state;
    expect(s2.pendingTarget, 'Beetle aims after the pick').toBeTruthy();
    const r = reconcile(s2, { type: 'battlecryTarget', targetUid: 'b2' }, 'beetle-target');
    expect(r.hard, report(r.hard)).toEqual([]);
    const events = reduceWithPresentation(s2, { type: 'battlecryTarget', targetUid: 'b2' }, true).batch?.events ?? [];
    expect(events.some((e) => e.type === 'sourceTrigger' && e.source.id === 'beetle'), 'the branch fires under a Beetle-sourced beat').toBe(true);
  });

  it('nested fixtures: a Shout that Discovers, then the pick (the modal is its own action)', () => {
    const s = withState('warden', { hand: [mk('h1', 'blackbelt')], board: [] });
    const r1 = reconcile(s, { type: 'play', uid: 'h1' }, 'blackbelt-play');
    expect(r1.hard, report(r1.hard)).toEqual([]);
    expect(r1.after.discover?.length, 'Black Belt opened a Discover').toBeGreaterThan(0);
    const r2 = reconcile(r1.after, { type: 'discover', index: 0 }, 'blackbelt-pick');
    expect(r2.hard, report(r2.hard)).toEqual([]);
    expect(r2.after.hand.length, 'the pick landed').toBe(1);
  });

  // ── Sabotage: the oracle must be able to ring ──────────────────────────────────────────────────────────

  it('SABOTAGE: the pre-#1374 shape — a parent re-emitting its child\'s consequences — alarms as an over-claim', () => {
    const s = withState('warden', { goldSpentThisTurn: 6, board: [mk('b1', 'ropewrangler'), mk('b2', 'dw_arnold')], shop: straysShop });
    const { state: after, batch } = reduceWithPresentation(s, { type: 'faceOmen' }, true);
    const events = batch!.events;
    expect(beatConservationViolations(s, after, { type: 'faceOmen' }, events)).toEqual([]);
    // Re-base each nested consequence onto its grandparent — exactly what the outer diff did before the fix.
    const parentOf = new Map(events.filter((e) => e.type === 'sourceTrigger').map((e) => [e.id, e.parentId] as const));
    const doubled: GamePresentationEvent[] = [...events];
    for (const e of events) {
      if (e.type === 'sourceTrigger' || !e.parentId) continue;
      const grand = parentOf.get(e.parentId);
      if (grand) doubled.push({ ...e, id: `${e.id}:dup`, parentId: grand });
    }
    const v = beatConservationViolations(s, after, { type: 'faceOmen' }, doubled);
    expect(v.some((m) => /OVER-claimed/.test(m) && /\+16\/\+16/.test(m) && /\+8\/\+8/.test(m)), v.join('\n')).toBe(true);
    expect(v.some((m) => /cardGranted claimed 2×/.test(m)), v.join('\n')).toBe(true);
  });

  it('SABOTAGE: a dropped consequence alarms as a missing beat; a claim on the wrong body alarms as misattribution', () => {
    const s = withState('warden', { board: [mk('b1', 'dw_arnold'), mk('b2', 'pup')] });
    const { state: after, batch } = reduceWithPresentation(s, { type: 'faceOmen' }, true);
    const events = batch!.events;
    const arnold = events.find((e) => e.type === 'statsChanged' && e.target.uid === 'b1');
    expect(arnold, 'the fixture claims Arnold').toBeTruthy();
    expect(beatConservationViolations(s, after, { type: 'faceOmen' }, events)).toEqual([]);
    const dropped = events.filter((e) => e !== arnold);
    expect(beatConservationViolations(s, after, { type: 'faceOmen' }, dropped).join('\n')).toMatch(/dw_arnold \(b1\): changed by \+8\/\+8 with NO beat claiming it/);
    const moved = events.map((e) => (e === arnold ? { ...e, target: { ...(e as { target: object }).target, uid: 'b2', cardId: 'pup' } } : e)) as GamePresentationEvent[];
    const v = beatConservationViolations(s, after, { type: 'faceOmen' }, moved);
    // Beefy also lands on the neighbour, so the moved claim stacks onto pup's own +8/+8 → +16/+16 claimed.
    expect(v.some((m) => /pup \(b2\): beats claim \+16\/\+16 but the action changed it by \+8\/\+8 — OVER-claimed/.test(m)), v.join('\n')).toBe(true);
    expect(v.some((m) => /dw_arnold \(b1\)/.test(m) && /NO beat/.test(m)), v.join('\n')).toBe(true);
    const phantom = [...events, { ...arnold!, id: 'ghost', target: { zone: 'board', uid: 'nobody', cardId: 'pup' } }] as GamePresentationEvent[];
    expect(beatConservationViolations(s, after, { type: 'faceOmen' }, phantom).join('\n')).toMatch(/phantom body/);
    const orphan = [...events, { ...arnold!, id: 'orphan', parentId: undefined, target: { zone: 'board', uid: 'b2', cardId: 'pup' } }] as GamePresentationEvent[];
    expect(beatConservationViolations(s, after, { type: 'faceOmen' }, orphan).join('\n')).toMatch(/orphan consequence/);
  });
});

describe('Doc Bot — beat conservation (combat stamps)', () => {
  const roster = Object.values(CARD_INDEX)
    .filter((c): c is NonNullable<typeof c> => !!c && !c.spell && !c.token && !c.ruby && c.attack > 0)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const randomBoard = (rng: { int(n: number): number }, prefix: string): BoardMinion[] =>
    Array.from({ length: 3 + rng.int(4) }, (_, i) => {
      const d = roster[rng.int(roster.length)]!;
      return { cardId: d.id, attack: d.attack, health: d.health, sourceUid: `${prefix}${i}`, keywords: [...d.keywords] } as unknown as BoardMinion;
    });
  const defOf = (id: string) => CARD_INDEX[id];

  it('every factory-stamped combat event names a card that carries that effect; key and srcCard travel together', () => {
    let stamped = 0;
    for (let seed = 1; seed <= 40 * SEED_MULT; seed++) {
      const rng = makeRng(0x57a3 + seed * 37);
      const tier = 1 + rng.int(6);
      const r = simulate(randomBoard(rng, 'p'), randomBoard(rng, 'e'), makeRng(seed * 101), CARD_INDEX, combatSide({ tier }), combatSide({ tier }));
      stamped += r.events.filter((e) => 'key' in e).length;
      const bad = combatStampViolations(r.events, defOf);
      expect(bad, `seed ${seed}:\n  ${bad.join('\n  ')}`).toEqual([]);
    }
    expect(stamped, 'the sweep saw no stamped events — coverage is not real').toBeGreaterThan(50);
  });

  it('SABOTAGE: a stamp moved to a card that lacks the effect, and a half-stamp, both alarm', () => {
    const honest = [{ type: 'buff', key: 'factory:deathrattleSummon:onDeath', srcCard: 'pack' }];
    expect(combatStampViolations(honest, defOf)).toEqual([]);
    expect(combatStampViolations([{ type: 'buff', key: 'factory:deathrattleSummon:onDeath', srcCard: 'pup' }], defOf).join('\n')).toMatch(/wrong body/);
    expect(combatStampViolations([{ type: 'buff', key: 'factory:deathrattleSummon:onDeath' }], defOf).join('\n')).toMatch(/half-stamped/);
    expect(combatStampViolations([{ type: 'buff', key: 'nonsense', srcCard: 'pack' }], defOf).join('\n')).toMatch(/malformed/);
  });
});
