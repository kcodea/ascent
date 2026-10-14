import { describe, it, expect } from 'vitest';
import {
  combatSide, makeRng, simulate,
  type BoardMinion, type CombatResult, type CombatSideState, type Keyword, type QuestCombatMods, type Rng, type Tribe,
} from '../index';
import { CARD_INDEX, SETS, poolFor, type SetId } from '@game/content';

/**
 * R-SYMMETRY-01 — THE MIRROR TEST (owner ruling 2026-10-13: "it's imperative that both sides are equal in what's
 * captured, represented, buffed etc. they should be 1:1 exact").
 *
 * For many seeds and many generated board pairs across sets 1-3, each side carrying a random run context (spell
 * power, tallies, auras, hand, Ruby strength…) and a random handful of quest / rune / hero combat mods drawn from
 * the WHOLE `QuestCombatMods` catalogue:
 *
 *   r1 = simulate(A, B, seed)                              A fights as `player`
 *   r2 = simulate(B, A, seed, { firstSide: 'enemy' })      A fights as `enemy`
 *
 * must be the SAME fight up to the side swap: the outcome mirrors, both damages swap, every event is identical
 * once `player` <-> `enemy` is swapped (stats, deaths, summons, buffs, grants, triggers, step tags), the starting
 * snapshots swap, and each board's carry-backs are identical whichever side it fought on.
 *
 * WHY `firstSide`: a few things happen to both sides "at once" (the Start-of-Combat passes, a board-wide spray,
 * which board mints its combat uids first, which side's random hand grants draw from the fight's main RNG stream,
 * and which side "heads" names on the seeded first-attacker coin). Some order must be picked, and picking it by
 * LABEL would make the RNG draw order differ between the two fights, so exact mirroring would be impossible.
 * `firstSide` names the side that goes first by ROLE; the default (`player`) is the order every recorded fight was
 * resolved in. With the role pinned, the two fights draw the same random numbers in the same order and must agree
 * exactly. That tie-break is the only permitted difference between the sides.
 *
 * NOT compared: `enemyScalers` (a presentation channel that describes the ENEMY board's run scalers to the UI's
 * card-text chain; the player board's text reads the live run instead, so by construction it is one-sided).
 */

const SET_IDS: SetId[] = ['set1', 'set2', 'set3'];
const EXTRA_KEYWORDS: Keyword[] = ['T', 'DS', 'W', 'R', 'RB', 'EG', 'CR', 'C', 'V', 'RW', 'IMM'];

/** Every boolean combat flag in `QuestCombatMods` (the rune / quest / hero switchboard). */
const BOOL_FLAGS = (
  'ancientTrackWardBreaks ancientCountRises ancientCountSummons bloodTrail echoingCoop lawOfTeeth deepHunger contractRewrite '
  + 'doubleLeftmostAttack possession feedingLine umbralEnergy crateringMissive passingSpears emptyGraves runeWarding runeFury '
  + 'avengeFirstDouble runeVanguard runeLastCall runeProcession runeLivingTreasure runeHuntingBell runeWarChorus runeFoodChain '
  + 'runeMatriarch runeMammoth runeVaultkeeper runeWarpath runeCounterpoint runeDeepeningVein runeFinalGate runeDreamedGraves '
  + 'runeOpenHand runeWakingReserve runeEchoingKobolds runeRubywire runeCombatativeRubies runeBodyCounting runeAggressiveGolems '
  + 'runeRupturedRubies runeWake runeSecondWind runeSoulToll runeSoulFurnace runeRestless runeHeraldingStar runeStellarEchoes '
  + 'runeStarsong runeGuidingStar runeMeteorStorm runeCallAndAnswer runeAnvil runeSatchel runeGemCrypt runePallbearer runeStarTap '
  + 'runeGrimToast runeGemStar runeKeepsakeGem runeHeavyHand runeUnity runeSunpony candlelightToll gemheartCharge runeRallying '
  + 'runeForthcoming runeSpellstone runeFullMeasure runeRisingGraves runeBroodpit runeSpearline runeAppraisal runeSoulTaxes '
  + 'runeFirstClaws runePackcraft runeInheritance runeSalvage runeTwilight runeWarden runeRebirth runeAftershocks runeEngraving '
  + 'runeUnderdog runeGemGolem runeChef runeFiveBanners containFirstEnemySummon stolenInitiative rallyDouble markFoeRightmostTaunt '
  + 'runeCenterline runeSecondLitter runeEmberline runeBackbeat runeSpareChair runeAncestralRoar runeRubyShrapnel '
  + 'runeSharedScripture runeBroodmaster runeMoonhowl runeFloodedVault runeBattleRefraction runeWrangler runeLivingGeode '
  + 'runeDawnclaw runeSylus runeGroveweaver runeTemperedTime runeSavagery runeJungle runeBurrow runeBeastialSwarm runeZoo '
  + 'runeRuins runeGolems runeEngravingGems runeHerdingHorn runeDeathtouchedApple runeStokedMenagerie runeHerald runeMirrorMarch '
  + 'runeTrophy oldPack'
).split(' ');

/** Every non-boolean combat mod, with a value of its real shape (labels are display-only). */
const VALUE_MODS: ((r: Rng, ids: { A: string[]; pool: string[] }) => Partial<QuestCombatMods>)[] = [
  () => ({ ancientWar: { attack: 2, health: 1, label: 'War' } }),
  () => ({ ancientTimeGild: { label: 'Time' } }),
  () => ({ ancientBonds: { attack: 3, label: 'Bonds' } }),
  () => ({ ancientWardCopy: { every: 2, window: [] } }),
  () => ({ ancientEdgeShouts: { label: 'Edges' } }),
  () => ({ ancientShoutAdjacent: { attack: 2, health: 2, label: 'Adj' } }),
  (_r, { A }) => ({ ancientUndying: { uids: A.slice(0, 2), regainRise: true, war: true, label: 'Undying' } }),
  () => ({ ancientSummonExtra: 1, ancientSummonExtraLimit: 3 }),
  () => ({ ancientSummonsAttack: { count: 2, label: 'Charge' } }),
  () => ({ ancientSummonBuffOthers: { count: 2, attack: 2, health: 2, label: 'Others' } }),
  (_r, { pool }) => ({ ancientSproutAvenge: { every: 2, tick: 0, cardId: pool[0]!, size: 1, flag: 'sprout', label: 'Sprout' } }),
  () => ({ ancientAvengePulse: { every: 3, tick: 1, flag: 'pulse', label: 'Pulse' } }),
  () => ({ ancientSocRandomBuffs: { reps: 3, attack: 1, health: 1, label: 'Repeat' } }),
  (_r, { pool }) => ({ ancientShoutBuffsCard: { cardId: pool[1]!, attack: 2, health: 2, label: 'Drakko' } }),
  () => ({ flashPick: 'first', ancientFlash: { second: true, pummel: { every: 10, dealt: 5 }, soc: true, exact: true, label: 'Flash' } }),
  () => ({ ancientRiseEcho: { label: 'RiseEcho' } }),
  (_r, { pool }) => ({ ancientPummel: { every: 12, count: 1, cardId: pool[2]!, dealt: 3, label: 'Pummel' } }),
  () => ({ ancientAvengeSpells: { every: 2, attack: 1, health: 1, label: 'Hunch' } }),
  () => ({ ancientSpellCastExtra: 1 }),
  () => ({ ancientSpellEdges: { attack: 2, health: 3, label: 'Edges' } }),
  () => ({ ancientClearanceStacks: { every: 3, flag: 'clear', label: 'Clear' } }),
  () => ({ ancientXeroxAvenge: { every: 3, tick: 0, label: 'Xerox' } }),
  () => ({ ancientXeroxSoc: { label: 'XeroxSoc' } }),
  (_r, { A }) => ({ ancientXeroxBond: { a: A[0]!, b: A[1] ?? A[0]!, label: 'Bond' } }),
  () => ({ ancientRefreshAvenge: { every: 3, tick: 0, flag: 'refresh', label: 'Refresh' } }),
  () => ({ ancientRallyGold: { gold: 1 } }),
  () => ({ ancientSummonGain: { attack: 3, health: 2, label: 'Spoils' } }),
  () => ({ ancientLastDeathCopy: { label: 'RePete' } }),
  (_r, { pool }) => ({ ancientGorrAvenge: { every: 3, tick: 0, ids: pool.slice(0, 3), label: 'Gorr' } }),
  () => ({ ancientPummelCopy: { every: 15, dealt: 0, label: 'Copy' } }),
  () => ({ ancientBramDeaths: { every: 4, tick: 0, label: 'Bram' } }),
  () => ({ ancientSocBuffAll: { attack: 2, health: 2, label: 'Braum' } }),
  () => ({ ancientPummelCharge: { every: 20, dealt: 0, flag: 'swap', label: 'Swap' } }),
  () => ({ ancientMaxGoldAvenge: { every: 3, tick: 0, gold: 1, flag: 'gold', label: 'Gold' } }),
  () => ({ ancientSocRally: { attack: 2, label: 'Rally' } }),
  () => ({ ancientBrackusAvenge: { every: 3, tick: 0, attack: 2, health: 2, flag: 'brackus', label: 'Brackus' } }),
  () => ({ ancientSummitCopy: { label: 'Summit' } }),
  () => ({ beastAuraHp: 2 }),
  () => ({ beastSummonScale: { per: 2, stepAttack: 1, stepHealth: 1, progress: 1, attack: 1, health: 1 } }),
  (_r, { pool }) => ({ shoutMeters: [{ sourceId: 'meter', per: 2, tick: 1, grantSpell: 1, grantOneOf: pool.slice(0, 2), grantCards: pool.slice(2, 3), buff: { tribe: 'dragon' as Tribe, attack: 1, health: 1, label: 'Shouts' } }] }),
  () => ({ bladeMastery: { attacks: 5 } }),
  () => ({ hoard: { attack: 2, health: 2 } }),
  (_r, { A }) => ({ soulbind: { a: A[0]!, b: A[1] ?? A[0]! } }),
  () => ({ flashPick: 'last', flashCopies: 2 }),
  () => ({ tribeRallySlaughterExtra: 'beast' as Tribe }),
  () => ({ oldHuntStep: 1 }),
  () => ({ echoExtraAlways: 1 }),
  () => ({ echoFirstEachCombat: 1 }),
  () => ({ boneThroneStep: 2 }),
  () => ({ assemblyLineStep: 2 }),
  () => ({ rallyExtraAlways: 1 }),
  () => ({ rallyFirstEachCombat: 1 }),
  () => ({ sharedCircuitWard: 2 }),
  () => ({ pitWithoutEndImps: 2 }),
  () => ({ slaughterFirstEachCombat: 1 }),
  () => ({ runeFinality: 2 }),
  () => ({ runeHatchery: { attack: 2, health: 2 } }),
  () => ({ runeCinderLedger: 2 }),
  () => ({ runeGemstorm: 2 }),
  () => ({ runeBloodAndCoin: 2 }),
  () => ({ runeWildHunt: 1 }),
  () => ({ runeRemains: 1 }),
  () => ({ runeReinvestment: { attack: 1, health: 1 } }),
  () => ({ runeBrood: 1 }),
  () => ({ runeLivingEchoes: 1 }),
  () => ({ runeAttackingGems: 1 }),
  () => ({ baneDemonWiden: { attack: 1, health: 1 } }),
  () => ({ runeOverflow: 1 }),
  () => ({ runeReturningPack: 2 }),
  () => ({ runeGraveRefreshment: 2 }),
  () => ({ runeShiftingFacets: 'attack' as const }),
  () => ({ runeCombatativeRubies: true, runeCombatativeTick: 1 }),
  () => ({ runeBodyCounting: true, runeBodyCountTick: 2 }),
  () => ({ runeGemStar: true, gemStarLeft: 2 }),
  () => ({ starCrashBonus: { attack: 1, health: 1 } }),
  () => ({ warDrumExtra: 1 }),
  () => ({ shoutDoubleCharges: 2 }),
  () => ({ encoreExtra: 1 }),
  () => ({ shoutExtraAlways: 1 }),
  () => ({ warmEmbersFirst: 1 }),
  () => ({ shoutEdgeBuff: { attack: 1, health: 1 } }),
  () => ({ shoutEdgeTribeBuff: { tribe: 'dragon' as Tribe, attack: 1, health: 1 } }),
  () => ({ burningLegionUses: 1 }),
  () => ({ decoySigils: 1 }),
  () => ({ weakenTargets: 1 }),
  () => ({ runePackcraft: true, packcraftLevel: { attack: 3, health: 2 } }),
  () => ({ runeCarrionCoin: 1 }),
  () => ({ solidGroundLeft: 2, solidGroundStat: 3 }),
  () => ({ fleetingVigor: { attack: 1, health: 1 } }),
  () => ({ bankedKeywords: [{ index: 0, keyword: 'DS' as Keyword }] }),
  () => ({ bankedImps: 1 }),
  () => ({ unitedFront: 2 }),
  () => ({ runeAshenPayroll: 1 }),
  () => ({ runeEnchantment: 1 }),
  () => ({ runeDragonscale: 2 }),
  () => ({ runeBeastialSwarm: true, beastialSwarmLevel: 3 }),
  () => ({ summonTaunts: 2 }),
  () => ({ runeCrucible: 2 }),
  () => ({ runeUndertow: 2 }),
  () => ({ runeMastery: 1 }),
  () => ({ runeHeldStrength: { attack: 2, health: 2, copies: 1 } }),
  () => ({ flagCopies: { runeAftershocks: 2, runeSavagery: 2, runeFury: 2 } }),
];

function pickMods(r: Rng, ids: { A: string[]; pool: string[] }, n: number): QuestCombatMods {
  const mods: QuestCombatMods = {};
  for (let i = 0; i < n; i++) {
    if (r.next() < 0.5) Object.assign(mods, { [BOOL_FLAGS[r.int(BOOL_FLAGS.length)]!]: true });
    else Object.assign(mods, VALUE_MODS[r.int(VALUE_MODS.length)]!(r, ids));
  }
  return mods;
}

/** One random board of a set's buyable minions, with run uids `${tag}${i}` (the carry-back key). */
function randomBoard(r: Rng, set: SetId, tag: string): BoardMinion[] {
  const pool = poolFor(set).buyable;
  // Now and then a non-buyable body too (reward minions such as Echo Warden, tokens): they have engine rules of
  // their own and must be symmetric as well.
  const extra = poolFor(set).all.filter((c) => !c.spell && !c.ruby && c.token);
  const n = 1 + r.int(7);
  const out: BoardMinion[] = [];
  for (let i = 0; i < n; i++) {
    const def = (extra.length && r.next() < 0.12 ? extra[r.int(extra.length)] : pool[r.int(pool.length)])!;
    const golden = r.next() < 0.2;
    const keywords: Keyword[] = [...def.keywords];
    if (r.next() < 0.3) { const k = EXTRA_KEYWORDS[r.int(EXTRA_KEYWORDS.length)]!; if (!keywords.includes(k)) keywords.push(k); }
    if (keywords.includes('RW') && !keywords.includes('DS')) keywords.push('DS');
    out.push({
      cardId: def.id,
      attack: def.attack * (golden ? 2 : 1) + r.int(6),
      health: Math.max(1, def.health * (golden ? 2 : 1) + r.int(8)),
      keywords,
      golden,
      sourceUid: `${tag}${i}`,
      ...(r.next() < 0.1 ? { bloodlust: true } : {}),
      ...(r.next() < 0.08 ? { partingCry: true } : {}),
      ...(r.next() < 0.05 ? { closedCasket: true } : {}),
      ...(r.next() < 0.05 ? { resummon: true } : {}),
    });
  }
  return out;
}

/** One random run context for a side: tallies, auras, spell power, hand, Ruby strength, and a handful of mods. */
function randomSide(r: Rng, set: SetId, tag: string, board: BoardMinion[]): CombatSideState {
  const pool = poolFor(set);
  const ids = pool.all.map((c) => c.id);
  const spells = pool.spells.map((c) => c.id);
  const tribes = [...SETS[set].tribes, 'neutral'] as Tribe[];
  const hand = Array.from({ length: r.int(4) }, (_, i) => {
    const def = pool.buyable[r.int(pool.buyable.length)]!;
    return { uid: `${tag}h${i}`, cardId: def.id, attack: def.attack + r.int(4), health: def.health + r.int(4), keywords: [...def.keywords], golden: r.next() < 0.2 };
  });
  return combatSide({
    poolIds: ids,
    tier: 1 + r.int(6),
    tribes,
    spellsThisTurn: r.int(4),
    spellsCast: r.int(20),
    deathrattles: r.int(15),
    spellPowerAtk: r.int(4),
    spellPowerHp: r.int(4),
    undeadAtk: r.int(4),
    undeadHp: r.int(3),
    undeadBuyAtk: r.int(3),
    impAtk: r.int(3),
    impHp: r.int(3),
    conductorBuff: r.int(3),
    fodderConsumedAtk: r.int(3),
    fodderConsumedHp: r.int(3),
    beastBuyAtk: r.int(3),
    tribesPlayed: { [tribes[r.int(tribes.length)]!]: r.int(4) },
    cardsBoughtThisTurn: r.int(4),
    magneticAtk: r.int(3),
    magneticHp: r.int(3),
    rubyBonus: { attack: r.int(4), health: r.int(4) },
    rubyCasts: r.int(6),
    revelerX: r.int(4),
    handSpellIds: spells.length ? Array.from({ length: r.int(3) }, () => spells[r.int(spells.length)]!) : [],
    handMinions: hand,
    alesLastTurn: r.int(3),
    spellEscalation: { attack: r.int(3), health: r.int(3) },
    lastSpellCastId: spells.length ? spells[r.int(spells.length)] : undefined,
    firstSpellThisTurnId: spells.length ? spells[r.int(spells.length)] : undefined,
    lastSpellThisTurnId: spells.length ? spells[r.int(spells.length)] : undefined,
    rememberedSpellIds: spells.length ? [spells[r.int(spells.length)]!] : [],
    growthBonus: r.int(3),
    goldSpentThisTurn: r.int(10),
    squirlScoutBuff: r.int(3),
    beastHuntExtra: r.int(2),
    beastRitualExtra: r.int(2),
    wildHuntGrown: r.int(4),
    cardBuffs: board.length ? { [board[0]!.cardId]: { attack: r.int(3), health: r.int(3) } } : {},
    spellhide: board.length && spells.length ? [{ spellId: spells[r.int(spells.length)]!, uid: board[0]!.sourceUid! }] : [],
    pendingQuests: r.next() < 0.3 ? [{ questId: `${tag}quest`, event: 'attack', count: 2, progress: 0, mods: { rallyDouble: true } }] : [],
    questMods: pickMods(r, { A: board.map((m) => m.sourceUid!), pool: ids }, 2 + r.int(12)),
  });
}

/** Swap every `player` <-> `enemy` string, deeply. Card ids, texts and uids never equal either word. */
function swapSides<T>(x: T): T {
  if (x === 'player') return 'enemy' as T;
  if (x === 'enemy') return 'player' as T;
  if (Array.isArray(x)) return x.map(swapSides) as T;
  if (x && typeof x === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) out[k] = swapSides(v);
    return out as T;
  }
  return x;
}

/** The viewer-seat narration ("your" / "their") is the one wording that legitimately reads per seat. */
const neutralText = (s: string): string => s.replace(/Fleeting Vigor — your minions surge/g, 'Fleeting Vigor: SIDE minions surge')
  .replace(/Fleeting Vigor: their minions surge/g, 'Fleeting Vigor: SIDE minions surge');
const normEvents = (r: CombatResult): string => neutralText(JSON.stringify(r.events));

/** The player's legacy `player*` fields, re-keyed to the side-agnostic `CombatCarryBacks` shape. */
function playerCarry(r: CombatResult): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const rr = r as unknown as Record<string, unknown>;
  for (const k of Object.keys(r.enemyCarry!)) {
    const field = k === 'foeDeaths' ? 'enemyDeaths' : `player${k[0]!.toUpperCase()}${k.slice(1)}`;
    out[k] = k === 'deaths' ? (rr.playerDeaths ?? 0) : rr[field];
  }
  return out;
}
const norm = (c: object): Record<string, unknown> =>
  JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)))) as Record<string, unknown>;

/** First index where the two event logs differ, for a readable failure. */
function firstDiff(a: unknown[], b: unknown[]): string {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = neutralText(JSON.stringify(a[i]));
    const y = neutralText(JSON.stringify(b[i]));
    if (x !== y) return `event #${i}:\n  as player: ${x}\n  as enemy (swapped): ${y}`;
  }
  return 'none';
}

function assertMirror(label: string, A: BoardMinion[], B: BoardMinion[], sA: CombatSideState, sB: CombatSideState, seed: number): CombatResult {
  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  const r1 = simulate(clone(A), clone(B), makeRng(seed), CARD_INDEX, clone(sA), clone(sB));
  const r2 = simulate(clone(B), clone(A), makeRng(seed), CARD_INDEX, clone(sB), clone(sA), { firstSide: 'enemy' });
  const mirrored = swapSides(r2);
  const ctx = `${label} (seed ${seed})`;
  // Outcome + damage.
  const flip = { win: 'lose', lose: 'win', draw: 'draw' } as const;
  expect(flip[r2.result], `${ctx}: outcome`).toBe(r1.result);
  // r1.enemyDamage = what A (player) dealt B; in r2 A is the enemy, so that is r2.playerDamage — and vice versa.
  expect(r2.playerDamage, `${ctx}: A's damage to B`).toBe(r1.enemyDamage);
  expect(r2.enemyDamage, `${ctx}: B's damage to A`).toBe(r1.playerDamage);
  expect(JSON.stringify(r2.damageBreakdown), `${ctx}: A's damage breakdown`).toBe(JSON.stringify(r1.enemyDamageBreakdown));
  expect(JSON.stringify(r2.enemyDamageBreakdown), `${ctx}: B's damage breakdown`).toBe(JSON.stringify(r1.damageBreakdown));
  // Starting boards (A's bodies mint the same uids in both fights: the first side mints first).
  expect(JSON.stringify(r2.initial.enemy), `${ctx}: A's starting snapshot`).toBe(JSON.stringify(r1.initial.player));
  expect(JSON.stringify(r2.initial.player), `${ctx}: B's starting snapshot`).toBe(JSON.stringify(r1.initial.enemy));
  // Every event, up to the side swap.
  if (normEvents(r1) !== neutralText(JSON.stringify(mirrored.events))) {
    expect.fail(`${ctx}: event logs differ — ${firstDiff(r1.events, mirrored.events)}`);
  }
  // Carry-backs: each board's ledger is the same whichever side it fought on.
  expect(norm(r2.enemyCarry!), `${ctx}: A's carry-backs`).toEqual(norm(playerCarry(r1)));
  expect(norm(playerCarry(r2)), `${ctx}: B's carry-backs`).toEqual(norm(r1.enemyCarry!));
  return r1;
}

describe('R-SYMMETRY-01 — combat is 1:1 symmetric between the two sides', () => {
  for (const set of SET_IDS) {
    it(`${set}: 300 random board pairs, random run contexts + combat mods, mirror exactly`, () => {
      let events = 0;
      for (let seed = 1; seed <= 300; seed++) {
        const r = makeRng(seed * 7919 + set.length * 31 + set.charCodeAt(3));
        const A = randomBoard(r, set, 'A');
        const B = randomBoard(r, set, 'B');
        const sA = randomSide(r, set, 'A', A);
        const sB = randomSide(r, set, 'B', B);
        events += assertMirror(set, A, B, sA, sB, seed).events.length;
      }
      expect(events, 'the fights did something').toBeGreaterThan(1000);
    });
  }

  it('an empty context mirrors too (the harness / procedural shape)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const r = makeRng(seed);
      const set = SET_IDS[seed % 3]!;
      assertMirror('bare', randomBoard(r, set, 'A'), randomBoard(r, set, 'B'), combatSide(), combatSide(), seed);
    }
  });

  it('Pre-emptive Assault is a per-side option: the enemy can strike first exactly like the player', () => {
    const A: BoardMinion[] = [{ cardId: 'sandbag', attack: 3, health: 10, sourceUid: 'A0' }];
    const B: BoardMinion[] = [
      { cardId: 'sandbag', attack: 3, health: 10, sourceUid: 'B0' },
      { cardId: 'sandbag', attack: 3, health: 10, sourceUid: 'B1' },
    ];
    // B has more minions, so B would normally swing first; Pre-emptive Assault puts A first — on either side.
    const asPlayer = simulate(A, B, makeRng(4), CARD_INDEX, combatSide(), combatSide(), { playerAttacksFirst: true });
    const asEnemy = simulate(B, A, makeRng(4), CARD_INDEX, combatSide(), combatSide(), { enemyAttacksFirst: true, firstSide: 'enemy' });
    const firstAttack = (r: CombatResult): string | undefined => (r.events.find((e) => e.type === 'attack') as { attacker?: string } | undefined)?.attacker;
    expect(firstAttack(asPlayer)).toBe(asPlayer.initial.player[0]!.uid);
    expect(firstAttack(asEnemy)).toBe(asEnemy.initial.enemy[0]!.uid);
    expect(normEvents(asPlayer)).toBe(neutralText(JSON.stringify(swapSides(asEnemy).events)));
    // Both sides holding it cancel out: the normal rule (more minions first) decides.
    const both = simulate(A, B, makeRng(4), CARD_INDEX, combatSide(), combatSide(), { playerAttacksFirst: true, enemyAttacksFirst: true });
    expect(firstAttack(both)).toBe(both.initial.enemy[0]!.uid);
  });

  it('the default tie-break is the historical one: omitting firstSide = firstSide player (byte-identical)', () => {
    const r = makeRng(77);
    const A = randomBoard(r, 'set1', 'A');
    const B = randomBoard(r, 'set1', 'B');
    const sA = randomSide(r, 'set1', 'A', A);
    const sB = randomSide(r, 'set1', 'B', B);
    const a = simulate(A, B, makeRng(9), CARD_INDEX, sA, sB);
    const b = simulate(A, B, makeRng(9), CARD_INDEX, sA, sB, { firstSide: 'player' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
