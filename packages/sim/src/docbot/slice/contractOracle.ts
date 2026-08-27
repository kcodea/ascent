/**
 * DOC BOT 2.0 VERTICAL SLICE — contract oracle v0 (blueprint §9.1; docs/docbot2/work-package-plan.md
 * stage VS). PROTOTYPE, quarantined under docbot/slice/ — WP D's contractOracle.ts generalizes this.
 *
 * Executes every slice contract through the REAL engine — `simulate()` for combat triggers (the
 * temporalWindow harness pattern), `createRun`/`reduce` for shop triggers, `runQaScenario` for the
 * checked-in copy fixtures — and RECORDS observations addressed at contract fields by dotted path.
 * The generic comparator (`checkContract`) owns expected-vs-observed, so sabotaging a contract
 * (doctoring an amount or a copy policy) fails the comparison without re-running the engine (§4.5).
 *
 * One engine, ever (§4.1): nothing here re-implements card behaviour; every number below is counted off
 * the authoritative combat event log or the reducer's state transition.
 */
import { readFileSync } from 'node:fs';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun } from '../../state';
import { reduce } from '../../reducer';
import { parseQaScenario, runQaScenario, type QaScenarioResult } from '../../qaScenario';
import type { ContractObservation } from './contentContract';

const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf'];

const bm = (cardId: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, keywords: [], ...extra });

type Sim = ReturnType<typeof simulate>;

function fight(player: BoardMinion[], enemy: BoardMinion[], mods: Record<string, unknown> = {}, seed = 1): Sim {
  return simulate(player, enemy, makeRng(seed), CARD_INDEX,
    combatSide({ tier: 6, tribes: ALL_TRIBES, questMods: mods } as never),
    combatSide({ tier: 1 }));
}

const summonsOf = (r: Sim, cardId: string): number =>
  r.events.filter((e) => e.type === 'summon' && (e as { minion?: { cardId?: string } }).minion?.cardId === cardId).length;

/** Player-side death ordinal at each event (the temporalWindow withDeathOrdinal read). */
function withDeathOrdinal(events: readonly CombatEvent[]): Array<{ e: CombatEvent; deaths: number }> {
  let deaths = 0;
  return events.map((e) => {
    if (e.type === 'death' && (e as { side?: string }).side === 'player') deaths += 1;
    return { e, deaths };
  });
}

const avengeBuffsBy = (r: Sim, uid: string): Array<{ deaths: number }> =>
  withDeathOrdinal(r.events)
    .filter(({ e }) => e.type === 'buff' && (e as { avenge?: boolean }).avenge && (e as { source?: string }).source === uid)
    .map(({ deaths }) => ({ deaths }));

const improvesOn = (r: Sim, uid: string): number[] =>
  withDeathOrdinal(r.events)
    .filter(({ e }) => e.type === 'improve' && (e as { target?: string }).target === uid)
    .map(({ deaths }) => deaths);

const loadScenario = (id: string) => {
  const text = readFileSync(new URL(`../scenarios/${id}.json`, import.meta.url), 'utf8');
  const { scenario, errors } = parseQaScenario(text);
  if (!scenario) throw new Error(`fixture ${id} invalid: ${errors.join(' · ')}`);
  return scenario;
};

/** Everything the slice lane needs beyond path-addressed observations: the raw measurements the four
 *  findings are built from, plus the honest not-probed list (§4.3 — no silent uncertainty). */
export interface SliceProbeReport {
  observations: ContractObservation[];
  /** Contract fields the slice deliberately does NOT probe, each with why — reported, never passed. */
  unprobed: Array<{ contractId: string; path: string; why: string }>;
  avwin10: {
    /** avenge-stamped buff fires by the dying drake in the minimized batch fixture (ruled: 0). */
    fires: number;
    firesSecondRun: number;
    /** Combat-log index of the first avenge-stamped buff — the first semantic divergence. */
    firstDivergenceStep: number;
    scenarioResult: QaScenarioResult;
    scenarioDeterministic: boolean;
  };
  anubis: {
    deathsOfAnubis: number;
    rebornHappened: boolean;
    /** How many times the Echo's Lantern cast fired across the two deaths (once per death = 2). */
    lanternCasts: number;
    rebornAttack: number | null;
    rebornHp: number | null;
  };
  xerox: { copyGolden: boolean; copySummonBonus: number | null };
  copyFixtures: { plain: QaScenarioResult; exact: QaScenarioResult };
}

export function probeSlice(semanticRevision?: string): SliceProbeReport {
  const observations: ContractObservation[] = [];
  const obs = (contractId: string, path: string, observed: ContractObservation['observed'], evidence: string): void => {
    observations.push({ contractId, path, observed, evidence });
  };

  // ── wolvesden: Echo summon counts, plain and gilded, in combat ──────────────────────────────────────────
  {
    const plain = fight([bm('wolvesden', 3, 3, { keywords: ['T'] })], [bm('sandbag', 5, 4000)]);
    const deathIdx = plain.events.findIndex((e) => e.type === 'death');
    const wolfIdx = plain.events.findIndex((e) => e.type === 'summon');
    obs('wolvesden', 'triggers.0.phase', 'combat', 'wolves appear in the combat event log, after the Echo death');
    obs('wolvesden', 'effects.0.summons.count.plain', summonsOf(plain, 'cryptwolf'),
      `combat log: wolvesden died at event ${deathIdx}, first wolf at ${wolfIdx}; total cryptwolf summons counted`);
    const golden = fight([bm('wolvesden', 6, 6, { keywords: ['T'], golden: true })], [bm('sandbag', 7, 4000)]);
    obs('wolvesden', 'effects.0.summons.count.gilded', summonsOf(golden, 'cryptwolf'), 'same fixture, gilded body');
  }

  // ── sylus / zyff: one extra Echo resolution (3 wolves → 6) ─────────────────────────────────────────────
  for (const mult of ['sylus', 'zyff'] as const) {
    const body = mult === 'sylus' ? bm('sylus', 1, 7) : bm('zyff', 6, 6);
    const r = fight([bm('wolvesden', 3, 3, { keywords: ['T'] }), body], [bm('sandbag', 5, 4000)]);
    const wolves = summonsOf(r, 'cryptwolf');
    obs(mult, 'multiplier.extra', wolves / 3 - 1, `with ${mult} on board the Echo summoned ${wolves} wolves (base 3)`);
  }

  // ── deathsayer: forced Echo, no death, one leftmost target per Rally ───────────────────────────────────
  {
    const r = fight([bm('wolvesden', 0, 30), bm('deathsayer', 3, 5, { keywords: ['RL'] })], [bm('sandbag', 0, 50)]);
    const firstDeath = r.events.findIndex((e) => e.type === 'death');
    const attacks = r.events.map((e, i) => (e.type === 'attack' ? i : -1)).filter((i) => i >= 0);
    const windowEnd = attacks[1] ?? r.events.length;
    const firstRallyWolves = r.events
      .slice(0, windowEnd)
      .filter((e) => e.type === 'summon' && (e as { minion?: { cardId?: string } }).minion?.cardId === 'cryptwolf').length;
    obs('deathsayer', 'triggers.0.phase', 'combat', 'the forced Echo resolves inside the combat log');
    obs('deathsayer', 'effects.0.targets.count', firstRallyWolves / 3,
      `first Rally summoned ${firstRallyWolves} wolves (one Echo resolution = 3) BEFORE any death (first death at event ${firstDeath < 0 ? 'none' : firstDeath})`);
  }

  // ── stuntdrake: threshold 3, 2 targets per resolution, gilded ×2 — surviving-source fixture ────────────
  {
    const board = [bm('stuntdrake', 3, 400), bm('stuntdrake', 3, 400, { golden: true }),
      bm('b2_packstrider', 1, 1), bm('b2_packstrider', 1, 1), bm('b2_packstrider', 1, 1), bm('sandbag', 0, 500)];
    const r = fight(board, [bm('sandbag', 2, 4000)]);
    const plainUid = r.initial.player[0]!.uid;
    const goldenUid = r.initial.player[1]!.uid;
    const plainFires = avengeBuffsBy(r, plainUid);
    const goldenAt3 = avengeBuffsBy(r, goldenUid).filter((f) => f.deaths === 3).length;
    const plainAt3 = plainFires.filter((f) => f.deaths === 3).length;
    obs('stuntdrake', 'triggers.0.threshold', plainFires[0]?.deaths ?? null, 'side-death ordinal of the first avenge-stamped grant');
    obs('stuntdrake', 'effects.0.targets.count', plainAt3, `plain drake resolved ${plainAt3} grants at death 3 (one resolution)`);
    obs('stuntdrake', 'gildedDelta.factor', goldenAt3 / plainAt3, `gilded drake resolved ${goldenAt3} grants at the same threshold`);

    // rune_fury on the SAME fixture: doubled resolution, untouched progress (R-AVWIN-07).
    const fury = fight(board, [bm('sandbag', 2, 4000)], { runeFury: true });
    const furyAt3 = avengeBuffsBy(fury, plainUid).filter((f) => f.deaths === 3).length;
    const furyBefore3 = avengeBuffsBy(fury, plainUid).filter((f) => f.deaths < 3).length;
    obs('rune_fury', 'multiplier.extra', furyAt3 / plainAt3 - 1, `with Rune of Fury armed the plain drake resolved ${furyAt3} grants at death 3 (plain run: ${plainAt3})`);
    obs('rune_fury', 'multiplier.resolutionOnly', furyBefore3 === 0, `no early fire under the rune (fires before death 3: ${furyBefore3}) — progress is not doubled`);
  }

  // ── kennel: Avenge (4) improve counter ─────────────────────────────────────────────────────────────────
  {
    const r = fight(
      [bm('kennel', 1, 600), bm('wolvesden', 2, 1), bm('wolvesden', 2, 1), bm('b2_packstrider', 1, 1), bm('b2_packstrider', 1, 1), bm('sandbag', 0, 60)],
      [bm('sandbag', 2, 4000)]);
    const kennelUid = r.initial.player[0]!.uid;
    obs('kennel', 'triggers.0.threshold', improvesOn(r, kennelUid)[0] ?? null, `kennel improves at side-deaths [${improvesOn(r, kennelUid).join(', ')}]`);
  }

  // ── copy semantics: the two checked-in fixtures (plain = Bellringer, exact = Xerox) ────────────────────
  const plainFixture = runQaScenario(loadScenario('avenge-window-plain-copy'), { semanticRevision });
  const exactFixture = runQaScenario(loadScenario('avenge-window-exact-copy'), { semanticRevision });
  obs('n2_bellringer', 'copyPolicy.mode', plainFixture.ok ? 'plain' : 'NOT-plain',
    'fixture avenge-window-plain-copy: the copied Kennelmaster reached hand with NO summonBonus while the source kept 3');
  obs('hero:xerox', 'copyPolicy.mode', exactFixture.ok ? 'exact' : 'NOT-exact',
    'fixture avenge-window-exact-copy: the summoned copy carries the source\'s accrued summonBonus 3');

  // ── hero:xerox: the gilding/counter carry probe (the text-defect runtime evidence) ─────────────────────
  const xerox = (() => {
    const s = createRun(13, 'xerox', 'ascent', 9, 'set1');
    s.embers = 10;
    s.board = [{ uid: 'k1', cardId: 'kennel', tribe: 'beast', attack: 2, health: 6, keywords: ['SC'], golden: true, summonBonus: 2 }];
    const after = reduce(s, { type: 'heroPower', uid: 'k1' });
    const copy = after.board.find((c) => c.uid !== 'k1');
    return { copyGolden: copy?.golden === true, copySummonBonus: copy?.summonBonus ?? null };
  })();

  // ── dm_butcher: Shout amounts, plain and gilded, on the run-wide channel ───────────────────────────────
  for (const golden of [false, true]) {
    const s = createRun(11, 'aster', 'ascent', 9, 'set1');
    s.embers = 10;
    s.hand = [{ uid: 'h1', cardId: 'dm_butcher', tribe: 'demon', attack: golden ? 8 : 4, health: golden ? 6 : 3, keywords: [], golden }];
    const after = reduce(s, { type: 'play', uid: 'h1' });
    obs('dm_butcher', golden ? 'effects.0.amount.gilded' : 'effects.0.amount.plain',
      [after.tavernBuyBonus.atk, after.tavernBuyBonus.hp],
      `playing ${golden ? 'gilded ' : ''}dm_butcher moved tavernBuyBonus by [${after.tavernBuyBonus.atk}, ${after.tavernBuyBonus.hp}]`);
  }

  // ── dm_agent: targeted Shop Consume counts, plain and gilded ───────────────────────────────────────────
  for (const golden of [false, true]) {
    const s = createRun(12, 'aster', 'ascent', 9, 'set1');
    s.embers = 10;
    s.board = [{ uid: 'd1', cardId: 'dm_butcher', tribe: 'demon', attack: 4, health: 3, keywords: [], golden: false }];
    s.hand = [{ uid: 'h1', cardId: 'dm_agent', tribe: 'demon', attack: golden ? 6 : 3, health: golden ? 4 : 2, keywords: [], golden }];
    const shopBefore = s.shop.length;
    const played = reduce(s, { type: 'play', uid: 'h1' });
    const after = reduce(played, { type: 'battlecryTarget', targetUid: 'd1' });
    const eaten = shopBefore - after.shop.length;
    const t = after.board.find((c) => c.uid === 'd1')!;
    obs('dm_agent', golden ? 'effects.0.amount.gilded' : 'effects.0.amount.plain', eaten,
      `${golden ? 'gilded ' : ''}dm_agent: shop ${shopBefore} → ${after.shop.length}; the targeted Demon grew to ${t.attack}/${t.health}`);
  }

  // ── d2_recaller: copies of the last Shop spell cast this turn ──────────────────────────────────────────
  for (const golden of [false, true]) {
    const s = createRun(14, 'aster', 'ascent', 9, 'set1');
    s.embers = 10;
    (s as { lastSpellThisTurnId?: string }).lastSpellThisTurnId = 'growth';
    s.hand = [{ uid: 'h1', cardId: 'd2_recaller', tribe: 'dragon', attack: golden ? 6 : 3, health: golden ? 8 : 4, keywords: [], golden }];
    const after = reduce(s, { type: 'play', uid: 'h1' });
    const copies = after.hand.filter((c) => c.cardId === 'growth').length;
    obs('d2_recaller', golden ? 'effects.0.amount.gilded' : 'effects.0.amount.plain', copies,
      `${golden ? 'gilded ' : ''}d2_recaller with lastSpellThisTurnId='growth' put ${copies} Growth in hand`);
  }

  // ── anubis: Rise keyword + the Echo-fires-per-death measurement (the questionable interaction) ─────────
  const anubis = (() => {
    const r = fight([bm('anubis', 8, 5, { keywords: ['R'] }), bm('b2_packstrider', 1, 30)], [bm('sandbag', 9, 4000)]);
    const anubisUid = r.initial.player[0]!.uid;
    const deaths = r.events.filter((e) => e.type === 'death' && (e as { target?: string }).target === anubisUid).length;
    const reborn = r.events.find((e) => e.type === 'reborn' && (e as { target?: string }).target === anubisUid) as
      { attack?: number; hp?: number } | undefined;
    const lanternCasts = r.events.filter((e) => e.type === 'spellcast'
      && (e as { key?: string }).key === 'factory:deathrattleCastTribeAttack:onDeath'
      && (e as { srcCard?: string }).srcCard === 'anubis').length;
    obs('anubis', 'keywords.0', reborn ? 'R' : 'no-rise-observed', 'Anubis died and a reborn event followed — Rise is live');
    return {
      deathsOfAnubis: deaths,
      rebornHappened: !!reborn,
      lanternCasts,
      rebornAttack: reborn?.attack ?? null,
      rebornHp: reborn?.hp ?? null,
    };
  })();

  // ── the R-AVWIN-10 minimized batch fixture — the verified-mechanical-bug substrate ─────────────────────
  const gradScenario = loadScenario('avenge-dying-source-batch-pin');
  const run1 = runQaScenario(gradScenario, { semanticRevision });
  const run2 = runQaScenario(gradScenario, { semanticRevision });
  const log = run1.combatLog ?? [];
  const firstDivergenceStep = log.findIndex((e) => e.type === 'buff' && (e as { avenge?: boolean }).avenge);
  const fires = log.filter((e) => e.type === 'buff' && (e as { avenge?: boolean }).avenge).length;
  const fires2 = (run2.combatLog ?? []).filter((e) => e.type === 'buff' && (e as { avenge?: boolean }).avenge).length;

  return {
    observations,
    unprobed: [
      { contractId: 'sylus', path: 'multiplier.stacks', why: 'a two-Sylus wolf count hits the 7-slot board cap before it can disambiguate summed vs best-of; needs a smaller-summon fixture (WP D)' },
      { contractId: 'rune_fury', path: 'multiplier.stacks', why: 'duplicate-rune flagCopies is pinned by the runeSwallowScan lane (R-RUNEDUP-05); not re-proven here' },
      { contractId: 'n2_bellringer', path: 'triggers.0.note', why: 'the every-2-turns cadence needs a multi-turn trajectory; the slice probes copy semantics only' },
      { contractId: 'deathsayer', path: 'gildedDelta.factor', why: 'a gilded Deathsayer fixture floods the board cap mid-measurement; deferred to WP D isolated cases' },
      { contractId: 'anubis', path: 'effects.1.note', why: 'the Lantern magnitude rides spell-power folding, covered by spellPowerFolding.test.ts' },
    ],
    avwin10: {
      fires,
      firesSecondRun: fires2,
      firstDivergenceStep,
      scenarioResult: run1,
      scenarioDeterministic: run1.after === run2.after && JSON.stringify(run1.combatLog) === JSON.stringify(run2.combatLog),
    },
    anubis,
    xerox,
    copyFixtures: { plain: plainFixture, exact: exactFixture },
  };
}
