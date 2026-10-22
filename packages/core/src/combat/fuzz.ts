import { combatSide } from './side';
import type { BoardMinion, CardDef, CombatSideState, Keyword, QuestCombatMods, Tribe } from '../types';
import type { Rng } from '../rng';

/**
 * RANDOM COMBAT FIXTURES, for the whole-content sweeps (test / audit only; nothing in a run calls these).
 *
 * One generator shared by the R-SYMMETRY-01 mirror test (`sideSymmetry.test.ts`) and the real-time stats audit
 * (`packages/ui/src/realtimeStatsAudit.test.ts`): a random board of a set's minions, and a random run context for a
 * side (spell power, tallies, auras, hand, Ruby strength) with a random handful of quest / rune / hero combat mods
 * drawn from the WHOLE `QuestCombatMods` catalogue. Core cannot import content, so the caller passes the set's pool.
 * A new combat mod belongs in BOOL_FLAGS / VALUE_MODS below, so both sweeps exercise it.
 */
export interface FuzzPool {
  /** The set's buyable minions. */
  buyable: readonly CardDef[];
  /** Every card in the set (tokens, spells, rewards). */
  all: readonly CardDef[];
  /** The set's spells. */
  spells: readonly CardDef[];
  /** The set's tribes. */
  tribes: readonly Tribe[];
}

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
  + 'runeTrophy oldPack runeWarCouncil runeGrowingInferno runeRuneboundBrood runeUnbrokenScales runeRunicTransposition '
  + 'runeSpellFedScales runeDeepBreaths runeDefiantWings runeFinalUtterance runeEmberInheritance' // Set 3 Dragon runes, Basic + Epic A
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
  () => ({ runeBorrowedFlame: 3 }), // Set 3 Dragon runes, Basic
  () => ({ runeSpellTempering: true, runeSpellTemperingTick: 3 }),
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
  () => ({ runeConduit: 1 }), // Rune of the Conduit: copy count (owner 2026-10-16, cross-phase)
  () => ({ runeHeldStrength: { attack: 2, health: 2, copies: 1 } }),
  () => ({ flagCopies: { runeAftershocks: 2, runeSavagery: 2, runeFury: 2 } }),
];

export function pickFuzzMods(r: Rng, ids: { A: string[]; pool: string[] }, n: number): QuestCombatMods {
  const mods: QuestCombatMods = {};
  for (let i = 0; i < n; i++) {
    if (r.next() < 0.5) Object.assign(mods, { [BOOL_FLAGS[r.int(BOOL_FLAGS.length)]!]: true });
    else Object.assign(mods, VALUE_MODS[r.int(VALUE_MODS.length)]!(r, ids));
  }
  return mods;
}

/** One random board of a set's buyable minions, with run uids `${tag}${i}` (the carry-back key). */
export function fuzzCombatBoard(r: Rng, set: FuzzPool, tag: string): BoardMinion[] {
  const pool = set.buyable;
  // Now and then a non-buyable body too (reward minions such as Echo Warden, tokens): they have engine rules of
  // their own and must be symmetric as well.
  const extra = set.all.filter((c) => !c.spell && !c.ruby && c.token);
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
export function fuzzCombatSide(r: Rng, set: FuzzPool, tag: string, board: BoardMinion[]): CombatSideState {
  const pool = set;
  const ids = pool.all.map((c) => c.id);
  const spells = pool.spells.map((c) => c.id);
  const tribes = [...set.tribes, 'neutral'] as Tribe[];
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
    questMods: pickFuzzMods(r, { A: board.map((m) => m.sourceUid!), pool: ids }, 2 + r.int(12)),
  });
}

