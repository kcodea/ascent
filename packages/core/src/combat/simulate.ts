import type {
  BoardMinion,
  CardDef,
  CombatContext,
  CombatEvent,
  CombatOutcome,
  CombatResult,
  EnemyScalers,
  EffectDef,
  Keyword,
  Minion,
  MinionSnapshot,
  QuestCombatMods,
  Side,
  Tribe,
} from '../types';
import type { Rng } from '../rng';
import { CombatBus } from '../events';
import { FACTORIES } from '../effects/factories';
import { instantiate, type CardIndex } from './minion';

const OTHER: Record<Side, Side> = { player: 'enemy', enemy: 'player' };
const ITERATION_GUARD = 300;
const REATTACK_GUARD = 50;
const IMMEDIATE_ATTACK_GUARD = 64; // bounds a chain of attack-on-summon Whelps (each kill can spawn another); one queue item per token — a deferred summon strikes inline in the same drain step

/**
 * Resolve a combat deterministically (handoff A.3) and return an event log the
 * UI can replay. Pure: depends only on its inputs and the seeded `rng`. Clones
 * every minion — shared CardDefs are never mutated.
 */
export function simulate(
  player: BoardMinion[],
  enemy: BoardMinion[],
  rng: Rng,
  cards: CardIndex,
  spellsThisTurn = 0,
  deathrattlesBase = 0,
  enemyTier = 1,
  undeadAttackBonus = 0,
  undeadHealthBonus = 0,
  spellsCast = 0,
  undeadBuyAtk = 0,
  fodderConsumedAtk = 0,
  fodderConsumedHp = 0,
  impAtkBonus = 0,
  impHpBonus = 0,
  spellPowerAtk = 0,
  spellPowerHp = 0,
  playerTier = 1,
  playerTribes: string[] = [],
  cardBuffs: Record<string, { attack: number; health: number }> = {},
  playerAttacksFirst = false,
  playerRallyDouble = false,
  beastsPlayedThisTurn = 0,
  beastBuyAtk = 0,
  magneticBuyAtk = 0,
  magneticBuyHp = 0,
  questMods: QuestCombatMods = {},
  /** The ENEMY board's run-level scalers, captured in its board snapshot — so an enemy Grim / Taragosa /
   *  Pack Leader / Runescale scales with the OPPONENT's values, not the current player's. All default 0
   *  (procedural threat / legacy boards), which is also correct for a synthetic foe with no run economy. */
  enemyScalers: EnemyScalers = {},
  /** The ENEMY board's quest/rune COMBAT modifiers, captured in its snapshot (the assembled `questCombatMods`
   *  output) — so a served board reproduces its owner's runes/quests at Start of Combat / on avenge / etc. Every
   *  per-side combat site reads `modsFor(side)`. Economy/hand/gold rune payoffs (Soul Taxes, Salvage, Blood Trail,
   *  Deep Hunger, Appraisal) stay player-only — a snapshot enemy has no hand/shop/run to receive them. Default {}
   *  (procedural threat / legacy boards). */
  enemyQuestMods: QuestCombatMods = {},
): CombatResult {
  // Per-side quest/rune combat modifiers: the player's live mods, or the served enemy's captured mods.
  const modsFor = (side: Side): QuestCombatMods => (side === 'player' ? questMods : enemyQuestMods);
  // Beast Attack aura, PER SIDE, mutable so The Old Hunt (oldHuntStep) can pump it live as Beasts attack —
  // later from-base Beast bodies (summons / Reborn) then inherit the grown value. Its Health sibling
  // (Pack Mentality) is fixed for the fight. Enemy values come from the served snapshot.
  const beastAtkAuraFor: Record<Side, number> = { player: beastBuyAtk, enemy: enemyScalers.beastBuyAtk ?? 0 };
  const beastHpAuraFor: Record<Side, number> = { player: questMods.beastAuraHp ?? 0, enemy: enemyQuestMods.beastAuraHp ?? 0 };
  let beastBuyAtkGain = 0; // The Old Hunt: run-wide Beast Attack aura gained this combat → carried back
  const events: CombatEvent[] = [];
  // Resolution-step tag (choreographer spec 2026-07-06): `stepN` identifies the atomic resolution moment
  // each event belongs to. `emit` stamps it; `nextStep()` is called wherever a NEW atomic resolution begins
  // (one attack swing's exchange, one victim's death resolution, its rattle's effects, one SC cast, …).
  // Pure metadata: zero logic/RNG/order impact — outcomes are locked by the determinism + golden suites.
  // Rule of thumb when extending the sim: finer is safer (the UI compiler can MERGE steps, never split them).
  let stepN = 0;
  const nextStep = (): void => { stepN++; };
  const emit = (e: CombatEvent): void => { events.push({ ...e, step: stepN }); };
  const bus = new CombatBus();
  let uidCounter = 0;
  const mkUid = (): string => `m${uidCounter++}`;
  const handGrants: string[] = []; // cards the player's deathrattles add to hand after combat
  const spellPowerGain = { attack: 0, health: 0 }; // run-wide spell-power gained this combat (Skullblade)
  let undeadBuyAtkGain = 0; // permanent Undead buy-time attack from this combat (Karthus)
  const undeadAuraGain = { attack: 0, health: 0 }; // permanent Undead aura (attack+health) from this combat (Watcher's Lantern)
  const impBuffGain = { attack: 0, health: 0 }; // permanent Imp buff from this combat (Imp King / Brood Avenge)
  const fodderBuffGain = { attack: 0, health: 0 }; // permanent run-wide Fodder enchant from this combat (Bane via Ryme)
  const cardBuffGains: { cardId: string; attack: number; health: number }[] = []; // run-wide card-type buffs (Grave Knit)
  let fodderGrants = 0; // Fodder queued into the next tavern (Burial Imp's Deathrattle)
  const fodderSchedule: number[] = []; // Fodder queued across the next several shops (Pit Supplier's Avenge)
  let maxGoldGain = 0; // permanent max-Gold gain (Soulsman's Avenge)
  let bonusGoldGain = 0; // one-time Gold granted into the next shop (Bounty Bot's Slaughter)
  const buffCounts = new Map<string, number>(); // # of stat-grants per minion this combat (Tara → Taragosa ascend)
  let freeRollGrants = 0; // free shop rerolls banked from combat (Gryphon's on-damaged)
  let attachmentShopGrants = 0; // Moe: shops that must contain a guaranteed Magnetic offer, banked from combat
  // Running spell tally per side for in-combat casts (Taragosa's Growth). The player side is seeded from
  // the run's spellsCast so Guel's grant scales correctly; `playerCombatSpells` is the delta carried back.
  const spellTotals: Record<Side, number> = { player: spellsCast, enemy: 0 };
  let playerCombatSpells = 0; // spells the player cast THIS combat → added to the run's spellsCast at settle
  // Economy battlecries Ryme re-fired in combat (Fodder / Gold / shop / gain-minion) — can't run in pure combat,
  // so they're recorded here and replayed through their real recruit factory at settle (full RunState access).
  const deferredBattlecries: { cardId: string; golden: boolean }[] = [];

  /**
   * AURAS — run-wide buffs that follow a player minion EVERYWHERE: the warband + shop (folded into the
   * recruit card view) and every combat body (start, summon, Reborn, resummon). Two storage styles feed them:
   *   • aggregate bonuses — the **Undead Aura** (Lantern of Souls' +A/+H, plus the buy-time Attack from
   *     Deathswarmer / Forsaken Weaver / Karthus) and the **Imp Aura** (Fodder Feeder / Ritualist / Bane);
   *   • per-card enchants in `cardBuffs` — the **Fodder Aura** (Ritualist / Bane / Staff of Guel) and the
   *     **Eternal Knight** card-type enchant.
   *
   * `fromBase` distinguishes a body built from BASE card stats (a summon or a Reborn — nothing baked in) from
   * one built off the run board (combat start, resummon — the buy-time Attack + prior per-card enchant are
   * already folded into its stats, so they must NOT be re-added). The stacks banked THIS fight (`cardBuffGains`)
   * apply to every fresh body regardless. To DECLARE a new aggregate aura, add an entry to `AURAS`; per-card
   * enchants flow automatically from `cardBuffs`.
   */
  const isUndeadMinion = (m: Minion): boolean =>
    m.tribe === 'undead' || m.tribe2 === 'undead' || !!m.universalTribe;

  // The Imp Aura is PER-SIDE (unlike the other aggregate auras, which are the player's run state). The player's
  // seeds from run state (impAtkBonus/impHpBonus); each side's in-combat imp-buffers (Imp King / Brood Matron via
  // `grantImpBuff`) then accrue onto their OWN side, so Imps summoned LATER inherit the gain — for both sides.
  // Fixes: enemy Imps spawning at 1/1 (enemy had no aura), and a later-summoned player Imp missing an earlier buff.
  const impAura: Record<Side, { attack: number; health: number }> = {
    player: { attack: impAtkBonus, health: impHpBonus },
    enemy: { attack: 0, health: 0 },
  };

  // Bleed (Bloodbinder): at Start of Combat the bleeder MARKS a fixed set of enemies (chosen once, in `armBleed`);
  // then every `everyN` attack swings made this fight (either side), it deals its current Attack (golden ×2) to
  // those SAME marked enemies that are still alive. `globalAttacks` counts every swing; `procBleed` fires the hit.
  const bleeders: { minion: Minion; everyN: number; marked: Minion[] }[] = [];
  let globalAttacks = 0;

  // The Undead Aura is side-scoped for the same reason: an enemy Karthus / Deathswarmer / Watcher grants its
  // Undead aura IN COMBAT (via grantUndeadBuyAtk / grantUndeadAura), and Undead the enemy summons/Reborns after
  // must inherit it — just like the player's. `buyAtk` is the Attack slice baked at buy time (player) or accrued
  // in-combat (enemy), re-added only to a from-base body; `attack`/`health` (Lantern) apply to all Undead.
  const undeadAura: Record<Side, { attack: number; health: number; buyAtk: number }> = {
    player: { attack: undeadAttackBonus, health: undeadHealthBonus, buyAtk: undeadBuyAtk },
    enemy: { attack: 0, health: 0, buyAtk: 0 },
  };

  // Each aura yields the +atk/+hp it grants a given minion (0/0 = doesn't apply). `bakedAtk` is the slice of
  // Attack already folded into run-board stats at buy time (re-added only to a from-base body). The Imp Aura is
  // handled separately (side-scoped, above) so it applies to both sides.
  const AURAS: { label: string; grant: (m: Minion) => { attack: number; health: number; bakedAtk?: number; bakedHp?: number } }[] = [
    {
      // Squirl Scout — run-wide Beast Attack aura, all baked at buy time (no combat-gained slice), so it's
      // re-added only to from-base bodies (summoned/Reborn Beasts); starting Beasts already carry it.
      label: 'Beast Aura',
      grant: (m) =>
        m.tribe === 'beast' || m.tribe2 === 'beast' || m.universalTribe
          ? { attack: 0, health: 0, bakedAtk: beastAtkAuraFor[m.side], bakedHp: beastHpAuraFor[m.side] }
          : { attack: 0, health: 0 },
    },
    {
      // Scrap Herald — run-wide Attachment/Magnetic aura (+atk AND +hp), all baked at buy, so it's re-added
      // only to from-base bodies (summoned/Reborn Magnetics); starting Magnetics already carry it.
      label: 'Attachment Aura',
      grant: (m) =>
        m.keywords.includes('M')
          ? { attack: 0, health: 0, bakedAtk: magneticBuyAtk, bakedHp: magneticBuyHp }
          : { attack: 0, health: 0 },
    },
  ];

  const applyAuras = (m: Minion, fromBase: boolean): void => {
    const isPlayer = m.side === 'player';
    // Imp Aura is SIDE-SCOPED, so it applies to both sides' Imps — an enemy Imp King's buff reaches enemy Imps
    // summoned later, exactly like the player's. (Applied regardless of `fromBase`: it's all live, none baked.)
    if (cards[m.cardId]?.imp) {
      const ia = impAura[m.side];
      if (ia.attack > 0) m.attack = Math.max(0, m.attack + ia.attack);
      if (ia.health > 0) { m.health += ia.health; m.maxHealth += ia.health; }
    }
    // Undead Aura is side-scoped too: apply each side's Undead aura to its Undead. The `buyAtk` slice is baked at
    // buy time, so it's re-added only to a from-base body (summoned/Reborn); the attack/health (Lantern) apply to all.
    if (isUndeadMinion(m)) {
      const ua = undeadAura[m.side];
      const a = ua.attack + (fromBase ? ua.buyAtk : 0);
      if (a > 0) m.attack = Math.max(0, m.attack + a);
      if (ua.health > 0) { m.health += ua.health; m.maxHealth += ua.health; }
    }
    // Beast / Attachment auras: baked into starting stats at buy time, so re-added only to a from-base body.
    // The BEAST aura is per-side — the base is baked, but an oldHunt / Packcraft pump grows it in combat, and a
    // served enemy carries its own captured aura — so enemy from-base Beasts get it too. The ATTACHMENT aura has
    // no enemy-captured value / combat grant path, so it stays player-only.
    for (const aura of AURAS) {
      if (aura.label === 'Attachment Aura' && !isPlayer) continue;
      const g = aura.grant(m);
      const a = g.attack + (fromBase ? g.bakedAtk ?? 0 : 0);
      const h = g.health + (fromBase ? g.bakedHp ?? 0 : 0);
      if (a > 0) m.attack = Math.max(0, m.attack + a);
      if (h > 0) { m.health += h; m.maxHealth += h; }
    }
    // Per-card run enchant (Fodder Aura + Eternal Knight). The player's prior-run total is authoritative in
    // `cardBuffs`; for BOTH sides the minion's own buff breakdown (keyed under the card's name) carries it
    // inline — so a captured ENEMY Eternal Knight re-gains its enchant when it Rises (built from base). The
    // stacks banked THIS fight (`cardBuffGains`) are the player's own tracking, so they only fold onto players.
    const def = cards[m.cardId];
    const prior = fromBase
      ? (isPlayer ? cardBuffs[m.cardId] : undefined) ?? (def ? m.buffs?.find((b) => b.source === def.name) : undefined)
      : undefined;
    const gain = isPlayer ? cardBuffGains.find((c) => c.cardId === m.cardId) : undefined;
    const a = (prior?.attack ?? 0) + (gain?.attack ?? 0);
    const h = (prior?.health ?? 0) + (gain?.health ?? 0);
    if (a > 0) m.attack = Math.max(0, m.attack + a);
    if (h > 0) { m.health += h; m.maxHealth += h; }
  };

  // A resummon (The Reclaimer) copies the minion's START-of-combat body, which ALREADY carries the live
  // auras + its prior per-card enchant (they were folded in before the copy was taken). So it only needs the
  // per-card stacks banked LATER this fight (e.g. its own destroy + other Eternal Knight deaths) re-applied.
  const applyCombatGains = (m: Minion): void => {
    if (m.side !== 'player') return;
    const gain = cardBuffGains.find((c) => c.cardId === m.cardId);
    if (!gain) return;
    if (gain.attack > 0) m.attack = Math.max(0, m.attack + gain.attack);
    if (gain.health > 0) { m.health += gain.health; m.maxHealth += gain.health; }
  };

  const boards: Record<Side, Minion[]> = {
    player: player.map((b) => instantiate(b, 'player', cards, mkUid)),
    enemy: enemy.map((b) => instantiate(b, 'enemy', cards, mkUid)),
  };
  for (const m of boards.player) applyAuras(m, false); // fold run-wide auras into starting minions (already baked → live part only)

  // Persistent tribe buffs (Grim's Deathrattle): registered when it fires, then applied to every matching
  // friend summoned for the *rest of combat*. Side-scoped; multiple Grims stack.
  const tribeAuras: { side: Side; tribe: Tribe | 'any'; attack: number; health: number; source: string }[] = [];

  // Player-side Deathrattle firings this combat — feeds Grim's "+1/+1 per Deathrattle this game" tally
  // (added to the run-wide base passed in), and is carried back to accumulate the run-wide count.
  let playerDeathrattles = 0;
  // Grave Contract / Last Rites: their "first Echo each combat fires extra" bonus is a one-shot per fight —
  // this flips true the first time a player Echo actually triggers so the bonus is spent exactly once.
  // These "first each combat" one-shots are now PER SIDE (a served enemy runs its own quest/rune doublers):
  // `firstEchoDone`/`firstRallyDone`/`firstSlaughterDone` gate the "first Echo/Rally/Slaughter each combat fires
  // extra" bonuses; `pitDone`/`emptyGravesDone` gate their once-per-fight summons.
  const firstEchoDone: Record<Side, boolean> = { player: false, enemy: false };
  // Player Rally (on-attack) triggers this combat — the `rally` quest objective.
  let playerRallies = 0;
  const firstRallyDone: Record<Side, boolean> = { player: false, enemy: false };
  // Imps the player summoned this combat — the `summonImp` objective.
  let playerImpsSummoned = 0;
  const pitDone: Record<Side, boolean> = { player: false, enemy: false };
  const emptyGravesDone: Record<Side, boolean> = { player: false, enemy: false };
  const firstSlaughterDone: Record<Side, boolean> = { player: false, enemy: false };

  // Enemy-side deaths this combat — Cassen's Collision banks these toward its 5-kill payoff (carried back).
  let enemyDeaths = 0;

  // ── Combat-phase quest tallies (carried back via playerQuestTally) ──────────────────────────────────────
  // Player attacks / mid-combat summons / enemy slaughters, each with a by-tribe breakdown (the acting or
  // summoned minion's tribe(s); universal-tribe minions count for every tribe). Beast quest objectives read
  // these post-combat. The Echo (Deathrattle) objective reuses `playerDeathrattles`.
  const questTally = {
    attack: 0, summonCombat: 0, slaughter: 0, slaughterKeyword: 0,
    attackByTribe: {} as Partial<Record<Tribe, number>>,
    summonCombatByTribe: {} as Partial<Record<Tribe, number>>,
    slaughterByTribe: {} as Partial<Record<Tribe, number>>,
  };
  const ALL_TRIBES: Tribe[] = ['beast', 'dragon', 'undead', 'mech', 'demon'];
  const tribesFor = (m: Minion): Tribe[] => {
    if (m.universalTribe) return ALL_TRIBES; // counts as every tribe (like the run-wide auras)
    return [m.tribe, m.tribe2].filter((t): t is Tribe => !!t && t !== 'neutral');
  };
  const byTribeMap = { attack: questTally.attackByTribe, summonCombat: questTally.summonCombatByTribe, slaughter: questTally.slaughterByTribe };
  // Per-tick timeline (step-tagged) so the UI can LIVE-TICK quest progress during the replay — one entry per
  // objective increment. `tribes` lets the panel narrow ("…with Beasts"); an entry with step ≤ the replay's
  // current step is "already counted". Deathrattle (Echo) entries carry no tribe (the Echo objective is
  // tribe-agnostic). Carried back via `CombatResult.playerQuestEvents`.
  const questEvents: { step: number; kind: 'attack' | 'summonCombat' | 'slaughter' | 'slaughterKeyword' | 'deathrattle' | 'friendlyDeath' | 'rally' | 'summonImp'; tribes: Tribe[] }[] = [];
  const bumpQuestTally = (kind: 'attack' | 'summonCombat' | 'slaughter', m: Minion): void => {
    const tribes = tribesFor(m);
    questTally[kind] += 1;
    const by = byTribeMap[kind];
    for (const t of tribes) by[t] = (by[t] ?? 0) + 1;
    questEvents.push({ step: stepN, kind, tribes });
  };
  // Player Deathrattle triggers (Echo objective + Grim tally) — increment + record for the live-tick timeline.
  const bumpDeathrattles = (n: number): void => {
    if (n <= 0) return;
    playerDeathrattles += n;
    for (let i = 0; i < n; i++) questEvents.push({ step: stepN, kind: 'deathrattle', tribes: [] });
  };
  // Player Rally (on-attack) triggers — the `rally` objective + live-tick timeline. Each fire (base + doubler
  // re-fires) counts one Rally trigger, matching the Shout/Echo convention.
  const bumpRally = (n: number): void => {
    if (n <= 0) return;
    playerRallies += n;
    for (let i = 0; i < n; i++) questEvents.push({ step: stepN, kind: 'rally', tribes: [] });
  };
  // The Red Trail: a Slaughter-KEYWORD trigger — a player minion with an on-kill effect felling an enemy. One per
  // kill (the primary trigger; doubler re-fires aren't counted). Tribe-agnostic.
  const bumpSlaughterKeyword = (): void => {
    questTally.slaughterKeyword += 1;
    questEvents.push({ step: stepN, kind: 'slaughterKeyword', tribes: [] });
  };
  const isBeast = (m: Minion): boolean => m.tribe === 'beast' || m.tribe2 === 'beast' || !!m.universalTribe;
  const isDemon = (m: Minion): boolean => m.tribe === 'demon' || m.tribe2 === 'demon' || !!m.universalTribe;

  // Blood Trail: the leftmost living player minion, captured at Start of Combat, "gains Slaughter: get a random
  // Beast" for this fight — each enemy it kills conjures a random Beast to hand (via ctx.grantRandomMinion).
  let bloodTrailMinion: Minion | undefined;
  // Deep Hunger: the leftmost living Demon, captured at Start of Combat, "gains Slaughter: add 3 Fodder to your
  // next shop" for this fight — each enemy it kills queues Fodder (fodderGrants carry-back).
  let deepHungerMinion: Minion | undefined;

  const snapshot = (m: Minion): MinionSnapshot => ({
    uid: m.uid,
    cardId: m.cardId,
    name: m.name,
    tribe: m.tribe,
    attack: m.attack,
    health: m.health,
    keywords: [...m.keywords],
    golden: m.golden,
    summonBonus: m.summonBonus,
    overflowBonus: m.overflowBonus,
    hpGrantBonus: m.hpGrantBonus,
    ascendProgress: m.ascendProgress,
    spellProgress: m.spellProgress, // Guel: the live combat text reads his on-board spell tally

    buffs: m.buffs, // recruit-phase buff breakdown → the combat inspect panel (absent on summoned tokens)
  });

  const living = (side: Side): Minion[] => boards[side].filter((m) => !m.dead && m.health > 0);
  // Non-allocating count of living minions on a side. The main loop guard checks this twice per iteration
  // (up to ~600×/sim); using this instead of `living(side).length` avoids building a throwaway array each time.
  const countLiving = (side: Side): number => {
    let n = 0;
    for (const m of boards[side]) if (!m.dead && m.health > 0) n++;
    return n;
  };

  // Live spell power: starts at the run's value, then mid-combat grants (Gnasher's kills, Bladesmith deaths)
  // bump it IN PLACE via grantSpellPower — so Taragosa's Growth and any spell cast later this fight read the
  // gain in real time, not just at settle. `spellPowerGain` is the separate carry-back delta.
  const spellPower = { attack: spellPowerAtk, health: spellPowerHp };
  // The enemy board's run-level scalers (from its snapshot) — static: enemies have no run economy and never
  // gain spell power mid-fight. Effects on the enemy side read these via the per-side accessors below, so an
  // enemy Taragosa/Grim/Pack Leader/Runescale scales with the OPPONENT's values, not the current player's.
  const enemySpellPower = { attack: enemyScalers.spellPowerAtk ?? 0, health: enemyScalers.spellPowerHp ?? 0 };
  const enemySpellsThisTurn = enemyScalers.spellsThisTurn ?? 0;
  const enemyBeastsPlayed = enemyScalers.beastsPlayed ?? 0;
  const enemyDeathrattles = enemyScalers.deathrattles ?? 0;

  const ctx: CombatContext = {
    rng,
    bus,
    boards,
    events,
    spellsThisTurn,
    beastsPlayedThisTurn,
    spellPower,
    enemySpellPower,
    spellPowerFor: (side) => (side === 'player' ? spellPower : enemySpellPower),
    spellsThisTurnFor: (side) => (side === 'player' ? spellsThisTurn : enemySpellsThisTurn),
    beastsPlayedFor: (side) => (side === 'player' ? beastsPlayedThisTurn : enemyBeastsPlayed),
    fodderConsumedAtk,
    fodderConsumedHp,
    deathrattleTally: (side) => (side === 'player' ? deathrattlesBase + playerDeathrattles : enemyDeathrattles),
    log: (event) => {
      emit(event);
    },
    living,
    getCard: (id) => {
      const card = cards[id];
      if (!card) throw new Error(`Unknown card: ${id}`);
      return card;
    },
    allCards: () => Object.values(cards),
    buff: (target, attack, health, source) => {
      // Golden Taurus doubles every combat stat-gain its engraved neighbors receive (`gainMult`).
      const gm = target.gainMult ?? 1;
      if (gm !== 1) { attack *= gm; health *= gm; }
      target.attack = Math.max(0, target.attack + attack); // Attack never drops below 0
      target.health += health;
      if (health > 0) target.maxHealth += health;
      emit({ type: 'buff', target: target.uid, attack, health, source });
      // Engraved: a minion that keeps its combat gains accrues every buff into permaGain, which carries
      // back to the run board after the fight (Flowing Monk records its gift directly for non-Engraved).
      if (target.keywords.includes('EG')) {
        target.permaGain = {
          attack: (target.permaGain?.attack ?? 0) + attack,
          health: (target.permaGain?.health ?? 0) + health,
        };
      }
      // Tara: tally each stat-grant on a minion that ascends after N grants (`cards[id].ascendAt`). Carried
      // back via playerAscendCount + transformed at settle, AND — once the running total (seeded prior progress
      // + this fight's grants) crosses the threshold — it ascends MID-combat to `ascendInto` (queued, swapped at
      // the next clean beat). No `sc` narration here: the live "N to ascend" tracker counts buff events in the
      // replay, and a per-buff `sc` would fire a phantom Start-of-Combat cast in the UI (the old Ember Whelp bug).
      const ascendDef = cards[target.cardId];
      if ((attack !== 0 || health !== 0) && ascendDef?.ascendAt) {
        const n = (buffCounts.get(target.uid) ?? 0) + 1;
        buffCounts.set(target.uid, n);
        if (ascendDef.ascendInto && (target.ascendProgress ?? 0) + n >= ascendDef.ascendAt) {
          queueAscension(target, ascendDef.ascendInto);
        }
      }
      // Hunter watches its own Attack rising: emit onGainAttack on a positive delta. The bus snapshots its
      // handlers, so this nested emit is safe; health-only buffs (the common case) skip it, and onGainAttack
      // handlers grant Health only (no further Attack gain) so it can't loop. Cheap when unsubscribed (a Map miss).
      if (attack > 0) bus.emit('onGainAttack', { minion: target, side: target.side });
    },
    addTribeAura: (side, tribe, attack, health, source) => {
      tribeAuras.push({ side, tribe, attack, health, source });
    },
    damage: (target, amount, poison = false, bypassShield = false) =>
      dealDamage(target, amount, poison, bypassShield),
    armBleed: (minion, everyN, targets) => {
      if (everyN <= 0 || targets <= 0) return;
      // MARK a fixed set of enemies now (Start of Combat) — up to `targets` distinct random living foes. These
      // stay marked for the whole fight; the proc later hits whichever of them are still alive (never re-rolled).
      const foe: Side = minion.side === 'player' ? 'enemy' : 'player';
      const pool = living(foe);
      const marked: Minion[] = [];
      for (let i = 0; i < targets && pool.length > 0; i++) {
        marked.push(pool.splice(rng.int(pool.length), 1)[0]!);
      }
      if (marked.length === 0) return;
      emit({ type: 'sc', source: minion.uid, text: `${minion.name} marks ${marked.length} ${marked.length === 1 ? 'enemy' : 'enemies'}`, cast: true });
      bleeders.push({ minion, everyN, marked });
    },
    summon: (side, card, nearUid, grantKeywords, golden, attackNow, copyStats) => summonMinion(side, card, nearUid, grantKeywords, golden, attackNow, copyStats),
    grantDeathrattle: (target, effects) => {
      // Graft copied Echoes onto `target` and register them so they fire on its death (Grave Body). Effects were
      // already registered at combat start for their source; these are fresh copies bound to `target`.
      for (const e of effects) {
        target.effects = [...target.effects, e];
        registerEffect(target, e);
      }
    },
    flushImmediateAttacks: () => flushImmediateAttacks(),
    attackNow: (minion, shieldFirst) => {
      // Solaris Fang's Avenge: an existing minion takes a bonus strike out of turn order via the same
      // attack-on-summon queue (drained by the next flushImmediateAttacks). `shieldFirst` grants a fresh Ward
      // right before the strike — so a golden Solaris, which queues two, goes in shielded on BOTH.
      if (!minion.dead && minion.health > 0) pendingAttackOnSummon.push({ minion, shieldFirst });
    },
    countDeathrattle: (side) => {
      // A Deathrattle triggered WITHOUT a death (Sporeling's Battlecry proc) still counts toward the tally
      // that feeds Grim + the run's deathrattlesTriggered (carried back via playerDeathrattles).
      if (side === 'player') bumpDeathrattles(1);
    },
    grantToHand: (cardId, side, sourceUid) => {
      // Combat can't touch the recruit hand directly; record player-side grants so the
      // run loop can add them after the replay (Arcane Weaver → a Spirit Fire copy), and log a
      // `toHand` event so the replay shows the card flying to your hand as it happens.
      if (side === 'player') {
        handGrants.push(cardId);
        emit({ type: 'toHand', cardId, side, source: sourceUid });
      }
    },
    grantSpellPower: (attack, health, side, sourceUid) => {
      // Player-only (enemies have no run state) — accumulate and carry back via playerSpellPower.
      if (side !== 'player') return;
      spellPowerGain.attack += attack;
      spellPowerGain.health += health;
      spellPower.attack += attack; // keep ctx.spellPower LIVE so Taragosa's Growth scales with the gain at once
      spellPower.health += health;
      // Telegraph it mid-combat (it otherwise applies silently at settle) so the player sees the gain.
      if (sourceUid && (attack !== 0 || health !== 0)) emit({ type: 'sc', source: sourceUid, text: `+${attack}/+${health} Spell Power` });
    },
    grantCardBuff: (cardId, attack, health, side) => {
      // Player-only — accumulate per cardId and carry back via playerCardBuffs.
      if (side !== 'player') return;
      const e = cardBuffGains.find((g) => g.cardId === cardId);
      if (e) { e.attack += attack; e.health += health; }
      else cardBuffGains.push({ cardId, attack, health });
    },
    grantTavernFodder: (count, side) => {
      if (side !== 'player') return; // enemies have no tavern
      fodderGrants += count;
    },
    scheduleFodder: (counts, side) => {
      if (side !== 'player') return; // enemies have no tavern
      counts.forEach((c, i) => { fodderSchedule[i] = (fodderSchedule[i] ?? 0) + c; }); // Pit Supplier: Fodder over the next N shops
    },
    deferBattlecry: (cardId, golden, side) => {
      if (side !== 'player') return; // enemies have no run state to carry economy battlecries back to
      deferredBattlecries.push({ cardId, golden });
    },
    grantMaxGold: (amount, side) => {
      if (side !== 'player') return; // enemies have no economy
      maxGoldGain += amount;
    },
    grantBonusGold: (amount, side) => {
      if (side !== 'player') return; // enemies have no economy
      bonusGoldGain += amount;
    },
    grantFreeRolls: (count, side) => {
      if (side !== 'player') return; // enemies have no shop
      freeRollGrants += count;
    },
    grantGuaranteedAttachments: (count, side) => {
      if (side !== 'player') return; // enemies have no shop
      attachmentShopGrants += count;
    },
    grantRandomSpell: (count, side, sourceUid) => {
      if (side !== 'player') return; // enemies have no hand
      // Pick the ACTUAL spell now (tavern tier passed in) and route it through grantToHand — so the replay
      // shows the real card flying to your hand (a `toHand` event), and settle just adds the carried cardId.
      const pool = Object.values(cards).filter((c) => c.spell && !c.token && c.tier <= playerTier); // exclude reward-exclusive spells (Feed the Alpha)
      for (let i = 0; i < count && pool.length > 0; i++) {
        const pick = pool[Math.floor(rng.next() * pool.length)]!;
        handGrants.push(pick.id);
        emit({ type: 'toHand', cardId: pick.id, side, source: sourceUid });
      }
    },
    grantRandomMinion: (count, tribe, side, exclude, sourceUid) => {
      if (side !== 'player') return; // enemies have no hand
      // Same as spells but for the buyable-minion pool (tribe-filtered, ≤ tavern tier, active tribes only).
      const pool = Object.values(cards).filter(
        (c) =>
          !c.token && !c.spell && c.tier <= playerTier && c.id !== exclude &&
          (c.tribe === 'neutral' || playerTribes.includes(c.tribe)) &&
          (!tribe || c.tribe === tribe || c.tribe2 === tribe || !!c.universalTribe),
      );
      for (let i = 0; i < count && pool.length > 0; i++) {
        const pick = pool[Math.floor(rng.next() * pool.length)]!;
        handGrants.push(pick.id);
        emit({ type: 'toHand', cardId: pick.id, side, source: sourceUid });
      }
    },
    grantImpBuff: (attack, health, side) => {
      // Advance the granting SIDE's live Imp Aura so Imps summoned later this fight inherit it (both sides).
      impAura[side].attack += attack;
      impAura[side].health += health;
      // Only the player carries the buff back into run state (the enemy is regenerated each wave).
      if (side === 'player') { impBuffGain.attack += attack; impBuffGain.health += health; }
    },
    impAura: (side) => ({ ...impAura[side] }), // Chef Raag reads the live Imp Aura to buff your minions by it
    grantFodderBuff: (attack, health, side) => {
      if (side !== 'player') return; // enemies have no run state
      fodderBuffGain.attack += attack;
      fodderBuffGain.health += health;
    },
    grantUndeadBuyAtk: (amount, side) => {
      // Advance the granting SIDE's live Undead buy-aura so Undead summoned / Reborn LATER this fight inherit it
      // (applyAuras re-adds it to every from-base body). Karthus / Forsaken Weaver route through here — on the
      // enemy side too, so a captured board's Undead-granter now buffs enemy Undead it summons afterward.
      undeadAura[side].buyAtk += amount;
      if (side === 'player') undeadBuyAtkGain += amount; // carry-back delta (enemy is regenerated each wave)
    },
    grantUndeadAura: (attack, health, side) => {
      // Watcher casting Lantern of Souls: bump the granting side's run-wide Undead aura (+Attack/+Health to its
      // Undead EVERYWHERE) — the SAME channel a shop-cast Lantern uses. Live (so Undead summoned/Reborn later this
      // fight inherit it via applyAuras); the player's carries back via CombatResult.playerUndeadAuraGain.
      undeadAura[side].attack += attack;
      undeadAura[side].health += health;
      if (side === 'player') { undeadAuraGain.attack += attack; undeadAuraGain.health += health; }
    },
    castSpell: (side) => {
      spellTotals[side] += 1; // count the cast first (the triggering spell is included, like recruit-phase Guel)
      if (side === 'player') playerCombatSpells += 1; // carried back → permanently bumps the run's spellsCast
      bus.emit('spellCast', { side, count: spellTotals[side] });
    },
  };

  /**
   * Apply the persistent tribe auras (Kennelmaster's Start-of-Combat Beast aura, Grim's Echo, Solaris's
   * Rally) to a minion that enters play — so a matching Beast summoned, Reborn (Rise), OR resummoned mid-fight
   * all inherit the "wherever they are" buff, not just fresh token summons.
   */
  function applyTribeAuras(minion: Minion): void {
    for (const aura of tribeAuras) {
      if (aura.side === minion.side && (aura.tribe === 'any' || minion.tribe === aura.tribe || minion.tribe2 === aura.tribe || (aura.tribe !== 'neutral' && !!minion.universalTribe))) {
        ctx.buff(minion, aura.attack, aura.health, aura.source);
      }
    }
  }

  /**
   * Summon one minion (the single summon chokepoint). Because this lives in the summon path, run-wide
   * auras, keyword grants, attack-on-summon and the onSummon event apply to *any* summon (token
   * Deathrattles, `deathrattleFillTribe`'s real minions, Brood Matron, future effects).
   */
  function summonMinion(side: Side, card: CardDef, nearUid: string | undefined, grantKeywords?: Keyword[], golden = false, attackNow = false, copyStats?: { attack: number; health: number; maxHealth: number; divineShield?: boolean; rebornAvailable?: boolean }, doubled = false): Minion {
    // A GILDED token (golden: true): doubled base stats + the golden flag, for summoners whose golden form
    // upgrades the token rather than the count (Manasaber's 0/4 cubs).
    const minion = instantiate(
      { cardId: card.id, attack: card.attack * (golden ? 2 : 1), health: card.health * (golden ? 2 : 1), golden },
      side, cards, mkUid,
    );
    // Mirrorhide Rhino — an EXACT copy: override to the SOURCE's current combat body (stats + shield/reborn),
    // set BEFORE the summon snapshot so the replay shows the copy at its real stats, not the base card.
    if (copyStats) {
      minion.attack = copyStats.attack;
      minion.health = copyStats.health;
      minion.maxHealth = copyStats.maxHealth;
      if (copyStats.divineShield) minion.divineShield = true;
      if (copyStats.rebornAvailable) minion.rebornAvailable = true;
    }
    // Attack-on-summon tokens (Whelp; Steadfast Champion's Spear Warden via `attackNow`) DEFER their whole
    // summon: rather than land + announce here, they queue onto the immediate-attack queue and are placed at
    // the next flushImmediateAttacks — i.e. AFTER the current clash's death cascade fully resolves. So the
    // token's `summon` event and its out-of-turn strike land together, as one discrete beat, never interleaved
    // with the other units' deaths/Deathrattles in the same clash (owner ruling 2026-07-10). Consequence: the
    // token is OFF the board for the rest of the cascade, so a same-clash Deathrattle can no longer buff it
    // before it exists — which also keeps the buff/summon event order consistent for the UI's computeFrame.
    if (card.attackOnSummon || attackNow) {
      pendingAttackOnSummon.push({ summon: { minion, side, card, nearUid, grantKeywords, golden, copyStats, doubled } });
      return minion;
    }
    return placeSummon(minion, side, card, nearUid, grantKeywords, golden, false, copyStats, doubled);
  }

  /**
   * Land an already-instantiated summon on the board: board-cap check, splice, auras, granted keywords,
   * effect registration, the `summon` event, quest tallies, onSummon + tribe auras, the attack-on-summon
   * strike-queue push, and Echo Warden doubling. Split out of summonMinion so attack-on-summon tokens can
   * DEFER to flushImmediateAttacks (which calls this at flush time) while plain summons run it inline.
   */
  function placeSummon(minion: Minion, side: Side, card: CardDef, nearUid: string | undefined, grantKeywords: Keyword[] | undefined, golden: boolean, attackNow: boolean, copyStats: { attack: number; health: number; maxHealth: number; divineShield?: boolean; rebornAvailable?: boolean } | undefined, doubled: boolean): Minion {
    // Board cap of 7 (handoff A.2): a full board can't receive summons — but Flowing Monk pays off
    // on the wasted body (the combat half of its recruit overflow buff).
    if (living(side).length >= 7) {
      bus.emit('summonOverflow', { side });
      return minion;
    }
    const arr = boards[side];
    let index = arr.length;
    if (nearUid) {
      const near = arr.findIndex((x) => x.uid === nearUid);
      if (near >= 0) index = near + 1;
    }
    arr.splice(index, 0, minion);
    if (!copyStats) applyAuras(minion, true); // a plain summon starts from base; an exact copy already carries its final stats
    // Grant keywords (e.g. Taunt from Broodmother) BEFORE snapshotting so the UI sees them from frame 1.
    if (grantKeywords) {
      for (const kw of grantKeywords) {
        if (!minion.keywords.includes(kw)) {
          minion.keywords.push(kw);
          if (kw === 'DS') minion.divineShield = true;
        }
      }
    }
    registerEffects(minion);
    emit({ type: 'summon', minion: snapshot(minion), side, index, source: nearUid });
    if (side === 'player') {
      bumpQuestTally('summonCombat', minion); // "Summon N minions in combat" quests
      if (cards[minion.cardId]?.imp) { playerImpsSummoned += 1; questEvents.push({ step: stepN, kind: 'summonImp', tribes: [] }); } // Imp Census / Implosion / Pit Without End
    }
    bus.emit('onSummon', { minion, side });
    applyTribeAuras(minion); // persistent tribe auras (Kennelmaster / Grim / Solaris) catch later summons
    // Attack-on-summon (Whelp) / `attackNow` (Spear Warden): the immediate strike is NOT queued here. We only
    // reach placeSummon for these tokens from flushImmediateAttacks (they defer in summonMinion), which strikes
    // the placed body inline right after this returns — so the token summons, then swings, before the next
    // deferred token lands (preserving the sequential board-cap "room after the first has attacked" logic).
    // Echo Warden: while it's on your board, "your summons trigger one more time" — each successful summon spawns
    // an extra copy (the copy carries `doubled=true`, so it never re-triggers). Golden Echo Warden adds two; each
    // Echo Warden stacks. Player-side only (it's a player reward). A full board short-circuits above (no room).
    if (!doubled && side === 'player') {
      let extra = 0;
      for (const m of boards[side]) if (m !== minion && !m.dead && m.health > 0 && m.cardId === 'echowarden') extra += m.golden ? 2 : 1;
      for (let k = 0; k < extra; k++) summonMinion(side, card, minion.uid, grantKeywords, golden, attackNow, copyStats, true);
    }
    return minion;
  }

  function registerEffect(minion: Minion, effect: EffectDef): void {
    const fn = FACTORIES[effect.do];
    if (!fn) return; // recruit-phase effects without a combat factory are inert here
    bus.on(effect.on, (payload) => {
      // A mid-combat ascension swaps a minion's effects; the CombatBus can't unregister, so a handler whose
      // effect is no longer in the minion's current set self-disables — the old form's abilities stop firing.
      if (!minion.effects.includes(effect)) return;
      // A dead minion fires nothing except its own Deathrattle.
      if (minion.dead && effect.on !== 'onDeath') return;
      fn(ctx, minion, effect.params ?? {}, payload);
      // Rune of Fury: your Avenges trigger twice — re-run the avenge effect once more. Per side (a served enemy's
      // Fury doubles its own minions' Avenges too).
      if (modsFor(minion.side).runeFury && effect.on === 'avenge') {
        fn(ctx, minion, effect.params ?? {}, payload);
      }
    });
  }
  function registerEffects(minion: Minion): void {
    for (const effect of minion.effects) registerEffect(minion, effect);
  }

  // --- Mid-combat ascension (Tara → Taragosa, Spirit Pup → Spirit Worgen): when a minion crosses its
  // threshold it transforms IN PLACE at the next clean beat — swapping to its ascend form's identity + effects
  // and gaining the new form's keywords, while KEEPING its current stats/buffs — and emits an `ascend` event
  // for the UI to animate. Queued (not applied mid-buff/mid-attack) so the swap lands between actions. ---
  const pendingAscensions: { minion: Minion; into: string }[] = [];
  function queueAscension(minion: Minion, into: string): void {
    if (minion.cardId === into || pendingAscensions.some((p) => p.minion === minion)) return;
    pendingAscensions.push({ minion, into });
  }
  function ascendMinion(minion: Minion, into: string): void {
    const def = cards[into];
    if (!def || minion.dead || minion.health <= 0 || minion.cardId === into) return;
    nextStep(); // a mid-combat transform is its own moment (bumped after the guard — no empty steps)
    minion.cardId = into;
    minion.name = def.name;
    minion.tribe = def.tribe;
    minion.tribe2 = def.tribe2;
    for (const k of def.keywords) {
      if (minion.keywords.includes(k)) continue;
      minion.keywords.push(k);
      // Sync the paired state flags — a printed DS/R on the ascended form must actually arm, not just
      // render (the same rule as granted keywords; today's forms grant neither, so this is future-proofing).
      if (k === 'DS') minion.divineShield = true;
      if (k === 'R') minion.rebornAvailable = true;
    }
    minion.effects = def.effects; // old handlers self-disable (the includes-guard above); register the new ones
    registerEffects(minion);
    emit({ type: 'ascend', target: minion.uid, into });
  }
  function flushAscensions(): void {
    while (pendingAscensions.length > 0) {
      const { minion, into } = pendingAscensions.shift()!;
      ascendMinion(minion, into);
    }
  }

  for (const side of ['player', 'enemy'] as const) {
    for (const minion of boards[side]) registerEffects(minion);
  }

  const initial = {
    player: boards.player.map(snapshot),
    enemy: boards.enemy.map(snapshot),
  };

  // Running death tally per side — drives Avenge (X) (A.4).
  const deaths: Record<Side, number> = { player: 0, enemy: 0 };
  // The immediate-attack queue, drained by flushImmediateAttacks after each attack's death cascade settles.
  // Two item kinds, processed in FIFO order so a token's summon and its strike stay adjacent:
  //   • `{ summon }` — a DEFERRED attack-on-summon token (Twilight Whelp's 3/3 Whelp, Spear Warden): its whole
  //     summon (placement + `summon` event) was held back from mid-cascade; placeSummon lands it at flush time,
  //     which then pushes its own `{ minion }` strike as the next item.
  //   • `{ minion, shieldFirst }` — an already-on-board minion taking an out-of-turn strike (a placed token's
  //     own swing, or Solaris Fang / Feeding Line / Bloodlust granting an existing body a bonus attack).
  const pendingAttackOnSummon: (
    | { summon: { minion: Minion; side: Side; card: CardDef; nearUid: string | undefined; grantKeywords: Keyword[] | undefined; golden: boolean; copyStats: { attack: number; health: number; maxHealth: number; divineShield?: boolean; rebornAvailable?: boolean } | undefined; doubled: boolean }; minion?: undefined }
    | { minion: Minion; shieldFirst?: boolean; summon?: undefined }
  )[] = [];

  // Fire a minion's OWN Deathrattle / on-death effects directly (no global onDeath broadcast / Avenge / death
  // event) — used by Reborn so a reborn death procs the unit's own Deathrattle without re-triggering other
  // minions' death-watchers. Sylus the Reaper re-procs it (a reborn death is still a death).
  // How many EXTRA times a minion's Echo fires beyond the base trigger — every echo doubler folded in
  // ADDITIVELY (owner ruling 2026-07-08): Sylus the Reaper (golden ×2, multiple stack) + Funeral Engine's
  // permanent `echoExtraAlways` + Grave Contract / Last Rites' `echoFirstEachCombat` on the FIRST player echo of
  // the fight. Enemy echoes only see Sylus (quest mods are player-only). Consumes the first-echo bonus (once per
  // combat), so call ONLY for a minion that actually has a Deathrattle.
  function playerEchoExtras(minion: Minion): number {
    let bonus = 0;
    for (const m of boards[minion.side]) if (!m.dead && m.health > 0 && m.cardId === 'sylus') bonus += m.golden ? 2 : 1;
    const mods = modsFor(minion.side); // per-side: a served enemy's Funeral Engine / Grave Contract doublers apply too
    bonus += mods.echoExtraAlways ?? 0;
    const first = mods.echoFirstEachCombat ?? 0;
    if (first > 0 && !firstEchoDone[minion.side]) { bonus += first; firstEchoDone[minion.side] = true; }
    return bonus;
  }

  // How many EXTRA times a player minion's Rally (on-attack effects) fires beyond the base trigger — every
  // Rally doubler folded in ADDITIVELY: Law of Teeth (Beast RL) + Rallying Offensive (`playerRallyDouble`) +
  // Infinite Assembly (`rallyExtraAlways`) + Spark Permit / Overclocked Core (`rallyFirstEachCombat`, the FIRST
  // player Rally of the fight only). Consumes the first-rally bonus once; call only for a player RL attacker.
  function playerRallyExtras(attacker: Minion): number {
    const mods = modsFor(attacker.side); // per-side: a served enemy's Law of Teeth / Infinite Assembly / Spark Permit apply too
    let extra = 0;
    if (mods.lawOfTeeth && isBeast(attacker)) extra += 1;
    if (attacker.side === 'player' && playerRallyDouble) extra += 1; // Rallying Offensive is a player-only one-fight override
    extra += mods.rallyExtraAlways ?? 0;
    const first = mods.rallyFirstEachCombat ?? 0;
    if (first > 0 && !firstRallyDone[attacker.side]) { extra += first; firstRallyDone[attacker.side] = true; }
    return extra;
  }

  function fireOwnDeathrattles(minion: Minion): void {
    const fireOnce = (): void => {
      for (const effect of minion.effects) {
        if (effect.on !== 'onDeath') continue;
        FACTORIES[effect.do]?.(ctx, minion, effect.params ?? {}, { minion, side: minion.side });
      }
    };
    fireOnce();
    if (!minion.effects.some((e) => e.on === 'onDeath')) return; // no Echo → no extra fires / tally to spend
    const extra = playerEchoExtras(minion);
    for (let r = 0; r < extra; r++) fireOnce();
    // Doubler re-triggers count as extra Echo triggers (Reborn / Echoing Coop / Bone Throne). The caller already
    // counted the base trigger; add the extras (player only — enemy Echoes don't feed quests).
    if (minion.side === 'player') bumpDeathrattles(extra);
  }

  function killOrReborn(minion: Minion, killer?: Minion): void {
    nextStep(); // this victim's death is its own resolution step (the exchange's damage came before)
    // Reborn (A.3 step 6): a minion's FIRST death fires its Deathrattle / on-death effects, then it returns
    // ONCE at its *base ATTACK* with **1 Health** (Hearthstone-style — regardless of its printed Health),
    // shedding combat buffs + granted keywords (Divine Shield, etc.), keeping printed keywords (minus the spent
    // Reborn). Golden → base attack ×2, but STILL 1 Health (owner ruling 2026-07-02) — auras apply on top after.
    // So a 7/8 buffed to a 13/10 body comes back a 7/1.
    // Undead carry-through + run-wide auras are still re-applied on top (Lantern/buy-time "everywhere" + the
    // Eternal-Knight enchant); general stat / Imp / Fodder buffs do NOT carry.
    if (minion.rebornAvailable) {
      minion.rebornAvailable = false;
      // It really died: proc the unit's own Deathrattle / on-death effects (each death procs them) BEFORE the
      // body returns — so the Whelp's spawn + the Eternal Knight's +3/+2 land per death, not just on the last.
      if (minion.side === 'player' && minion.effects.some((e) => e.on === 'onDeath')) bumpDeathrattles(1);
      // Rise = die → Deathrattle → return to the RIGHT of what it summoned (owner ruling 2026-07-06). The body
      // genuinely LEAVES its slot FIRST — flag it dead + emit a `death` (marked `rise`) so the replay shows the
      // removal before the rattle, then the rattle's summons fill the vacated slot, then the Rise re-inserts to
      // their right. The `rise` flag means the UI shows the death but does NOT count it as a kill: a Rise is
      // still NOT a friendly death for Avenge / the enemy-death tally / onDeath watchers (unchanged). `before`
      // snapshots the board so we can find the summoned block for the re-slot.
      const arr = boards[minion.side];
      const before = new Set(arr.map((m) => m.uid));
      const slot = arr.indexOf(minion);
      minion.dead = true;
      minion.health = 0;
      emit({ type: 'death', target: minion.uid, side: minion.side, rise: true });
      nextStep(); // the rattle's effects are a separate resolution from the death itself
      fireOwnDeathrattles(minion);
      // Board cap gates the Rise (owner ruling 2026-07-02): the Deathrattle resolved FIRST — its summons can
      // take the last slots, since the dying body holds none — and if the side is at 7 living the minion does
      // NOT return: it stays dead for real, and NOW counts as a true death (Avenge + enemy tally). It already
      // emitted its (rise-flagged) death above, so we don't push a second one, and there's NO `onDeath`
      // broadcast (watchers treat Rise deaths as non-deaths; the rattle already fired, incl. Sylus re-procs).
      if (living(minion.side).length >= 7) {
        if (minion.side === 'enemy') enemyDeaths++;
        deaths[minion.side] += 1;
        if (minion.side === 'player') questEvents.push({ step: stepN, kind: 'friendlyDeath', tribes: [] });
        bus.emit('avenge', { side: minion.side, count: deaths[minion.side] });
        return;
      }
      // Rise: revive the SAME body (keeps its uid → "reborn attacks again" + every per-instance carry-back
      // still work) at base ATTACK with 1 Health, shedding combat buffs + granted keywords.
      minion.dead = false;
      const def = cards[minion.cardId];
      const mul = minion.golden ? 2 : 1;
      if (def) {
        minion.attack = Math.max(0, def.attack * mul);
        minion.health = 1; // Rise returns at 1 Health — golden included — regardless of the card's base Health
        minion.maxHealth = minion.health;
        minion.keywords = def.keywords.filter((k) => k !== 'R');
        minion.divineShield = def.keywords.includes('DS');
      } else {
        minion.keywords = minion.keywords.filter((k) => k !== 'R');
        minion.health = 1;
        minion.maxHealth = 1;
      }
      // Granted blessings shed with the granted keywords: a golden-Taurus ×2 (`gainMult`) doesn't survive
      // the Rise — the EG it came with is already gone, and a lingering multiplier would double gains the
      // carry-back no longer records (display-vs-persist divergence).
      minion.gainMult = undefined;
      applyAuras(minion, true); // Reborn reset stats to base — re-apply every run-wide aura on top
      // Re-slot the risen body to just after the contiguous block its Deathrattle summoned into its old slot
      // (each freshly-summoned token isn't in `before`) → it returns to their RIGHT. No summons → it stays put.
      let at = arr.indexOf(minion);
      arr.splice(at, 1);
      while (at < arr.length && !before.has(arr[at]!.uid)) at++; // skip the tokens the rattle just summoned
      arr.splice(at, 0, minion);
      const after = at > slot ? arr[at - 1]!.uid : undefined; // anchor the UI re-slot to the token on its left
      nextStep(); // the body's return is its own moment, after the rattle's summons
      emit({ type: 'reborn', target: minion.uid, hp: minion.health, attack: minion.attack, keywords: [...minion.keywords], ...(after ? { after } : {}) });
      applyTribeAuras(minion); // a Reborn Beast inherits Kennelmaster's aura too ("summoned in any way")
      // A Rise IS a summon (owner ruling 2026-07-13): count it toward "Summon N in combat" quests (Forsaken Will,
      // Pack Mentality, …) — the body re-enters play, so it summons. Player-side only; mirrors placeSummon's tally.
      // NOT an onSummon broadcast: Rise deliberately doesn't re-fire onSummon effects — this is the quest count only.
      if (minion.side === 'player') {
        bumpQuestTally('summonCombat', minion);
        if (cards[minion.cardId]?.imp) { playerImpsSummoned += 1; questEvents.push({ step: stepN, kind: 'summonImp', tribes: [] }); }
      }
      return;
    }
    minion.dead = true;
    minion.health = 0;
    emit({ type: 'death', target: minion.uid, side: minion.side });
    // Count enemy deaths (Cassen's Collision banks them toward its 5-kill payoff).
    if (minion.side === 'enemy') enemyDeaths++;
    // Count your Deathrattles as they trigger (before firing, so Grim's own death counts toward its buff).
    const hasDeathrattle = minion.effects.some((e) => e.on === 'onDeath');
    if (minion.side === 'player' && hasDeathrattle) bumpDeathrattles(1);
    nextStep(); // Deathrattles + on-death watchers resolve as their own step
    bus.emit('onDeath', { minion, side: minion.side, killer });
    // Echo doublers re-proc the dying minion's own Deathrattle extra times — Sylus + Funeral Engine + the
    // first-echo-each-combat bonus, all folded additively in `playerEchoExtras` (see its note). Only for a
    // minion that actually has a Deathrattle (so the first-echo bonus isn't spent on a rattle-less body).
    const extra = hasDeathrattle ? playerEchoExtras(minion) : 0;
    for (let r = 0; r < extra; r++) {
      for (const effect of minion.effects) {
        if (effect.on !== 'onDeath') continue;
        FACTORIES[effect.do]?.(ctx, minion, effect.params ?? {}, { minion, side: minion.side });
      }
    }
    // Each RE-TRIGGER is another Echo "triggered" (owner ruling 2026-07-08: TRIGGER-based counts — the Echo
    // objective + Grim's tally — scale with doublers; a MINION dying is still one death). Added after the
    // re-fires so all firings read the same tally value (the value at death), only the count grows.
    if (minion.side === 'player' && hasDeathrattle) bumpDeathrattles(extra);
    // Avenge: count the death and notify that side's avengers.
    deaths[minion.side] += 1;
    if (minion.side === 'player') questEvents.push({ step: stepN, kind: 'friendlyDeath', tribes: [] });
    bus.emit('avenge', { side: minion.side, count: deaths[minion.side] });
    // The Bone Throne: every N friendly deaths, trigger your leftmost living Echo (like Echoing Coop, but
    // paced by the death counter). Fires the leftmost minion that HAS a Deathrattle — its own doublers apply.
    const side = minion.side; // per-side quest/rune death effects — a served enemy runs its own
    const throneStep = modsFor(side).boneThroneStep ?? 0;
    if (throneStep > 0 && deaths[side] % throneStep === 0) {
      const lead = boards[side].find((m) => !m.dead && m.health > 0 && m.effects.some((e) => e.on === 'onDeath'));
      if (lead) { nextStep(); if (side === 'player') bumpDeathrattles(1); fireOwnDeathrattles(lead); }
    }
    // Assembly Line: every N friendly deaths (Avenge N), add a Money Bot to your hand. Player-only —
    // `grantToHand` no-ops for a served enemy (no hand). Avenge-paced like The Bone Throne.
    const asmStep = modsFor(side).assemblyLineStep ?? 0;
    if (asmStep > 0 && deaths[side] % asmStep === 0) { nextStep(); ctx.grantToHand('moneybot', side, minion.uid); }
    // Pit Without End: the friendly death that empties your board summons N Imps (a last stand, once per fight).
    const pitImps = modsFor(side).pitWithoutEndImps ?? 0;
    if (pitImps > 0 && !pitDone[side] && countLiving(side) === 0) {
      pitDone[side] = true;
      const imp = cards['impscrap'];
      if (imp) { nextStep(); for (let i = 0; i < pitImps; i++) summonMinion(side, imp, undefined); }
    }
    // Empty Graves: the FIRST friendly death each combat summons a 1/1 Gravebody (which copies your leftmost Echo
    // on summon via its onSummon `copyLeftmostEcho`). Once per fight.
    if (modsFor(side).emptyGraves && !emptyGravesDone[side]) {
      emptyGravesDone[side] = true;
      const gb = cards['gravebody'];
      if (gb) { nextStep(); summonMinion(side, gb, undefined); }
    }
  }

  // The Reclaimer's pending resummons. A marked minion is destroyed at Start of Combat (its
  // Deathrattle fires + overflows the board); the exact body waits here and "reclaims" its slot the
  // next time the board has room — i.e. after a friend dies — never mid-summon-cascade. So its own
  // tokens win the immediate scramble and the original returns later. `anchor` is the dead body it
  // was killed from, so the copy comes back in (or next to) its original slot.
  const pendingResummons: { anchor: Minion; board: BoardMinion; side: Side }[] = [];
  function flushResummons(): void {
    // Reclaim each pending body the moment ITS side has room again (an enemy Soren board resummons on the
    // enemy side, exactly like the player's Reclaimer). FIFO within a side; player-only queues behave as before.
    for (let i = 0; i < pendingResummons.length; ) {
      const { anchor, board, side } = pendingResummons[i]!;
      if (living(side).length >= 7) { i++; continue; }
      pendingResummons.splice(i, 1);
      nextStep(); // each reclaimed body re-entering is its own moment
      const copy = instantiate(board, side, cards, mkUid);
      applyCombatGains(copy); // re-apply per-card stacks banked this fight (player-gated inside; enemy has no run)
      const at = boards[side].indexOf(anchor);
      boards[side].splice(at >= 0 ? at + 1 : boards[side].length, 0, copy);
      registerEffects(copy);
      emit({ type: 'summon', minion: snapshot(copy), side, index: boards[side].indexOf(copy), source: anchor.uid });
      bus.emit('onSummon', { minion: copy, side });
      applyTribeAuras(copy); // a resummoned Beast (The Reclaimer) inherits the aura too
    }
  }

  /**
   * Apply one damage instance WITHOUT resolving a resulting death — phase 1 of an attack's simultaneous
   * exchange (see performAttack). The HP change, dmg/shield/poison events, and on-damaged notifications all
   * land here; a victim left at ≤0 Health stays on the board (excluded from living()) until the caller
   * resolves it with killOrReborn.
   */
  function applyDamage(
    target: Minion,
    amount: number,
    poison: boolean,
    bypassShield: boolean,
    poisoner?: Minion,
  ): void {
    if (target.dead || target.health <= 0) return;
    // Immune: takes no damage at all (A.4) — even from Venomous or destroy effects.
    if (target.keywords.includes('IMM')) return;
    // A 0-damage hit is a non-event: it can't pop a Divine Shield, proc Venomous, or wake on-damaged
    // watchers — and it would bloat the replay with `dmg 0` beats. Load-bearing since 0-Attack
    // retaliators exist (Manasaber's 0/2 cubs): trading into one must not spend the attacker's shield.
    if (amount <= 0) return;
    // Divine Shield absorbs the first instance — and still blocks Venomous (A.3).
    if (!bypassShield && target.divineShield) {
      target.divineShield = false;
      target.keywords = target.keywords.filter((k) => k !== 'DS');
      emit({ type: 'shield', target: target.uid });
      bus.emit('onLoseDivineShield', { minion: target, side: target.side });
      return;
    }
    target.health -= amount;
    emit({ type: 'dmg', target: target.uid, amount, remainingHp: Math.max(0, target.health) });
    // The hit landed (Immune + Divine Shield already returned above) — notify on-damaged watchers (Gryphon).
    if (amount > 0) bus.emit('onDamaged', { minion: target, side: target.side });
    // Venomous: reaching here means the hit actually landed (Immune + Divine Shield already returned
    // above), so any damage from a Venomous source destroys the target — even if the raw hit was
    // already lethal. So attacking a Venomous minion is fatal *unless you were shielded from the
    // damage*, and the venom procs/drops off whichever side it lands on (main hit or retaliation).
    if (poison) {
      if (target.health > 0) target.health = 0;
      emit({ type: 'poison', target: target.uid });
      // Venomous proc: the poisoner spends its venom (drops off for the rest of combat).
      if (poisoner && poisoner.keywords.includes('V')) {
        poisoner.keywords = poisoner.keywords.filter((k) => k !== 'V');
        emit({ type: 'venomLost', target: poisoner.uid });
      }
    }
  }

  /** One-shot damage (effects, bolts, Deathrattle damage): apply + resolve any death immediately. Attack
   *  exchanges use the two-phase form instead (applyDamage × N, then killOrReborn per victim). */
  function dealDamage(
    target: Minion,
    amount: number,
    poison: boolean,
    bypassShield: boolean,
    poisoner?: Minion,
  ): void {
    applyDamage(target, amount, poison, bypassShield, poisoner);
    if (!target.dead && target.health <= 0) killOrReborn(target, poisoner);
  }

  // Targeting: random among living enemies, Taunts first if any (A.3 step 4).
  // Stealth minions can't be targeted (A.4); if every defender is Stealthed there's
  // no legal target and the swing is skipped.
  function chooseTarget(defenderSide: Side): Minion | undefined {
    const live = living(defenderSide).filter((m) => !m.keywords.includes('ST'));
    if (live.length === 0) return undefined;
    const taunts = live.filter((m) => m.keywords.includes('T'));
    return rng.pick(taunts.length > 0 ? taunts : live);
  }

  // Bleed proc (Bloodbinder): deal the bleeder's current Attack to its still-living MARKED enemies — the fixed set
  // chosen at Start of Combat (1, or 2 for golden), never re-rolled. Ends the moment the bleeder dies (guarded here),
  // skips while it's 0-Attack or once every mark is dead. Its own beat, so the replay shows a discrete hit.
  function procBleed(b: { minion: Minion; marked: Minion[] }): void {
    if (b.minion.dead || b.minion.health <= 0 || b.minion.attack <= 0) return;
    const targets = b.marked.filter((m) => !m.dead && m.health > 0);
    if (targets.length === 0) return;
    nextStep();
    emit({ type: 'sc', source: b.minion.uid, text: `${b.minion.name} bleeds`, cast: true });
    for (const t of targets) dealDamage(t, b.minion.attack, false, false, b.minion);
  }

  function performAttack(attacker: Minion, defenderSide: Side, depth: number): void {
    if (attacker.dead || attacker.health <= 0) return;
    nextStep(); // a new exchange begins (re-attacks and Whelp strikes each get their own step too)
    // Stealth is lost the moment a minion attacks (A.4) — it becomes targetable.
    if (attacker.keywords.includes('ST')) {
      attacker.keywords = attacker.keywords.filter((k) => k !== 'ST');
      emit({ type: 'reveal', target: attacker.uid });
    }
    const swings = attacker.keywords.includes('W') ? 2 : 1; // Windfury (A.3 step 5)
    for (let s = 0; s < swings; s++) {
      if (attacker.dead || attacker.health <= 0) break;
      const target = chooseTarget(defenderSide);
      if (!target) break;
      if (s > 0) nextStep(); // each Windfury swing is its own exchange
      // Critical Strike (Commander Impala): roll per swing — a hit doubles this swing's OUTGOING damage (main
      // hit + cleave splash), not the retaliation. Only consumes RNG for a minion that actually has critChance.
      const crit = !!attacker.critChance && attacker.critChance > 0 && rng.next() < attacker.critChance;
      const critMult = crit ? 2 : 1;
      emit({ type: 'attack', attacker: attacker.uid, defender: target.uid, swing: s, ...(crit ? { crit: true } : {}) });
      bus.emit('onAttack', { minion: attacker, side: attacker.side, target }); // Rally + on-attack effects (target = the enemy being hit this swing)
      // The Old Hunt: each Beast attack pumps that SIDE's run-wide Beast Attack aura by `oldHuntStep` — live
      // (every current Beast gains it; later summons inherit via the grown aura). A served enemy pumps its own
      // captured aura; the player also carries the gain back (the enemy has no run to persist to).
      const oldHuntStep = modsFor(attacker.side).oldHuntStep ?? 0;
      if (oldHuntStep > 0 && isBeast(attacker)) {
        beastAtkAuraFor[attacker.side] += oldHuntStep;
        if (attacker.side === 'player') beastBuyAtkGain += oldHuntStep;
        for (const m of boards[attacker.side]) if (!m.dead && m.health > 0 && isBeast(m)) ctx.buff(m, oldHuntStep, 0, 'The Old Hunt');
      }
      // A Rally (RL minion attacking) re-runs this attacker's OWN on-attack effects once per additive doubler
      // (Law of Teeth / Rallying Offensive / Infinite Assembly / Spark Permit — see playerRallyExtras), PER SIDE.
      // Direct calls, not via the bus, so other minions' on-attack watchers don't double-fire. The rally quest
      // TALLY (base + extras) is player-only.
      if (attacker.keywords.includes('RL') && !attacker.dead && attacker.health > 0) {
        if (attacker.side === 'player') bumpRally(1);
        const extras = playerRallyExtras(attacker);
        for (let r = 0; r < extras && !attacker.dead && attacker.health > 0; r++) {
          for (const effect of attacker.effects) {
            if (effect.on !== 'onAttack') continue;
            FACTORIES[effect.do]?.(ctx, attacker, effect.params ?? {}, { minion: attacker, side: attacker.side });
          }
        }
        if (attacker.side === 'player') bumpRally(extras);
      }
      if (attacker.side === 'player') bumpQuestTally('attack', attacker); // "Attack N times with Beasts" quest — player-only
      // Better Bot (Rally): each time this attacks — once per swing, so a Windfury body rallies TWICE if it
      // survives the first swing — give your OTHER Mechs +N Attack (N = accrued rallyMechAtk, stacks via
      // magnetize). Fires per hit alongside the onAttack rallies (rallyBuff / rallyProcDeathrattle) above.
      if (attacker.rallyMechAtk && attacker.rallyMechAtk > 0) {
        for (const m of boards[attacker.side]) { // iterate the board directly — no living() array per swing
          if (!m.dead && m.health > 0 && m !== attacker && (m.tribe === 'mech' || m.tribe2 === 'mech')) {
            ctx.buff(m, attacker.rallyMechAtk, 0, 'Better Bot');
          }
        }
      }
      // Bloodlust weld (the Bloodlust spell also grants its target a Rally): on each of its own swings, give a
      // random OTHER friendly living minion Attack equal to this minion's current Attack. Fires per swing, and
      // is one-fight like Bloodlust itself (stripped at settle).
      if (attacker.bloodlustRally && attacker.attack > 0) {
        const pool = boards[attacker.side].filter((m) => !m.dead && m.health > 0 && m !== attacker);
        if (pool.length > 0) ctx.buff(ctx.rng.pick(pool), attacker.attack, 0, 'Bloodlust');
      }
      // Perfect Core (welded Rally): each time this host attacks, add N random spells to your hand after combat
      // (N = accrued rallySpellWeld, stacks via magnetize; golden already baked at weld time). Mirrors the
      // standalone `rallyGrantSpell` factory — a standalone Perfect Core grants via its own effect instead, so no
      // double-count. Fires per swing (a Windfury host grants twice if it survives the first).
      if (attacker.rallySpellWeld && attacker.rallySpellWeld > 0) {
        const pool = ctx.allCards().filter((c) => c.spell && !c.token);
        if (pool.length > 0) {
          for (let i = 0; i < attacker.rallySpellWeld; i++) ctx.grantToHand(ctx.rng.pick(pool).id, attacker.side, attacker.uid);
        }
      }

      const targetWasAlive = !target.dead && target.health > 0;
      const targetCouldReborn = target.rebornAvailable; // a Reborn target that "dies" returns to life
      const poison = attacker.keywords.includes('V'); // Venomous

      // === The exchange is SIMULTANEOUS, in two phases (owner ruling 2026-07-02). ===
      // PHASE 1 — every hit of the clash APPLIES before any death resolves: cleave neighbours, the main hit,
      // and the retaliation. A unit that trades into a Deathrattle minion takes its damage WITH the kill —
      // not after the rattle's summons/effects (the old inline cascade ran the defender's whole death,
      // deathrattles and all, before the attacker's counter damage even landed).
      // `victims` collects each body hit this clash, in damage order, for phase 2. `couldReborn` is the
      // pre-clash Reborn state (nothing flips it until phase 2), so a spent Rise reads as a kill below.
      const victims: { m: Minion; killer: Minion; couldReborn: boolean }[] = [];

      // Cleave hits the target's neighbours in the same clash (A.3 step 5). Uses LIVING adjacency, not raw array
      // index: dead minions are kept in `boards[side]` (never spliced), so an index-based lookup would splash a
      // dead slot and skip the living neighbour beyond it — the exact bug where a Cleave over a fallen unit missed
      // the still-standing minion next to it (owner repro 2026-07-13). The visual board is the living order.
      if (attacker.keywords.includes('C')) {
        const live = boards[defenderSide].filter((m) => !m.dead && m.health > 0);
        const di = live.indexOf(target);
        const neighbours = [live[di - 1], live[di + 1]].filter((n): n is Minion => !!n);
        for (const n of neighbours) {
          victims.push({ m: n, killer: attacker, couldReborn: n.rebornAvailable });
          applyDamage(n, attacker.attack * critMult, poison, false, attacker);
        }
      }

      // Snapshot the defender's counter-attack BEFORE the hit. (With two-phase damage a Rise can no longer
      // reset stats mid-exchange — deaths wait for phase 2 — but the snapshot stays as belt-and-braces
      // documentation of the rule: retaliation uses the body that actually clashed.)
      const counterAttack = target.attack;
      const counterVenom = target.keywords.includes('V');
      victims.push({ m: target, killer: attacker, couldReborn: targetCouldReborn });
      applyDamage(target, attacker.attack * critMult, poison, false, attacker); // main hit (Critical Strike doubles it)
      // Bounty Bot: "immune while attacking" for its first N swings this combat — take no retaliation, and
      // spend one charge of immunity per swing (so it protects the first N attacks, not the first N combats).
      if ((attacker.attackImmuneLeft ?? 0) > 0) {
        attacker.attackImmuneLeft = attacker.attackImmuneLeft! - 1;
      } else {
        victims.push({ m: attacker, killer: target, couldReborn: attacker.rebornAvailable });
        applyDamage(attacker, counterAttack, counterVenom, false, target); // retaliation
      }

      // PHASE 2 — deaths resolve in damage order (cleave victims → target → attacker). Each fallen body's
      // Deathrattle / Rise runs only now, after every hit of the clash has landed — so death effects see the
      // full post-exchange board (e.g. a mutual kill counts both bodies down before either rattle fires).
      for (const { m, killer } of victims) {
        if (!m.dead && m.health <= 0) killOrReborn(m, killer);
      }

      // On-kill (owner ruling 2026-07-03): EVERY kill in the clash procs the killer's on-kill effects —
      // cleave splash and the defender felling its attacker included, matching the card text ("when this
      // kills"), not just the main-target kill. Dropping a Reborn body to 0 counts as a kill even though
      // it returns — it spent its Reborn. Emitted in damage order after phase 2, crediting each fallen
      // body's killer; a dead killer's handlers self-suppress in registerEffects (a mutual kill procs
      // nothing, unchanged from before).
      nextStep(); // on-kill rewards resolve as their own step, after every death in the clash
      for (const { m, killer, couldReborn } of victims) {
        // Slaughter (on-kill) fires ONLY when THIS minion ATTACKS and kills (owner ruling 2026-07-08, revising
        // the 2026-07-03 "defender fells attacker counts" rule): the attacker's own kills — the main target and
        // cleave splash — proc it, but a defender felling its attacker via retaliation does NOT (its `killer` is
        // the target, not this exchange's `attacker`). So gate on `killer === attacker`.
        if ((m.dead || m.health <= 0 || (couldReborn && !m.rebornAvailable)) && killer === attacker) {
          bus.emit('onKill', { attacker: killer, victim: m });
          // A player minion felling an enemy by attacking is a "Slaughter" — tally it for the Slaughter quests
          // (credited to the KILLER's tribe for "with Beasts").
          if (m.side !== killer.side) { // this attacker felled an OPPONENT minion — a Slaughter, for whichever side
            const kmods = modsFor(killer.side); // per-side quest/rune Slaughter effects
            const killerAlive = !killer.dead && killer.health > 0;
            if (killer.side === 'player') {
              bumpQuestTally('slaughter', killer);
              if (killer.effects.some((e) => e.on === 'onKill')) bumpSlaughterKeyword(); // The Red Trail: a Slaughter-keyword trigger
              // Blood Trail (Beast → hand) + Deep Hunger (Fodder → next shop) are ECONOMY/HAND — player-only (a
              // served enemy has no hand or shop). Their SoC marks are also only set on the player board.
              if (questMods.bloodTrail && killer === bloodTrailMinion && killerAlive) ctx.grantRandomMinion(1, 'beast', 'player', undefined, killer.uid);
              if (killer === deepHungerMinion && killerAlive) fodderGrants += 3;
            }
            // Law of Teeth: a Beast's Slaughter triggers one extra time — re-run only this killer's own on-kill
            // effects once more (direct call, not via the bus, so other minions' on-kills don't double-fire). Per side.
            if (kmods.lawOfTeeth && killerAlive && isBeast(killer)) {
              for (const effect of killer.effects) {
                if (effect.on !== 'onKill') continue;
                FACTORIES[effect.do]?.(ctx, killer, effect.params ?? {}, { attacker: killer, victim: m });
              }
            }
            // Author's Hand: the FIRST Slaughter each combat fires an extra time (any tribe; additive with Law of
            // Teeth). Re-runs only this killer's own on-kill effects, once per combat. Per side.
            const slfe = kmods.slaughterFirstEachCombat ?? 0;
            if (slfe > 0 && killerAlive && !firstSlaughterDone[killer.side]) {
              firstSlaughterDone[killer.side] = true;
              for (let r = 0; r < slfe; r++) {
                for (const effect of killer.effects) {
                  if (effect.on !== 'onKill') continue;
                  FACTORIES[effect.do]?.(ctx, killer, effect.params ?? {}, { attacker: killer, victim: m });
                }
              }
            }
            // Feeding Line (Beast capstone): a Beast's Slaughter gives your NEXT living Beast (in board order,
            // after the killer) an immediate out-of-turn attack — queued like a Twilight Whelp strike and drained
            // by flushImmediateAttacks below, so it can chain. Per side.
            if (kmods.feedingLine && killerAlive && isBeast(killer)) {
              const arr = boards[killer.side];
              for (let j = arr.indexOf(killer) + 1; j < arr.length; j++) {
                const nb = arr[j]!;
                if (!nb.dead && nb.health > 0 && nb.attack > 0 && isBeast(nb)) {
                  pendingAttackOnSummon.push({ minion: nb });
                  break;
                }
              }
            }
          }
        }
      }
      // On-kill re-attack (Gnasher) stays keyed to the MAIN target's kill only.
      const killed =
        targetWasAlive &&
        (target.dead || target.health <= 0 || (targetCouldReborn && !target.rebornAvailable));
      if (killed && attacker.reAttackOnKill && !attacker.dead && attacker.health > 0 && depth < REATTACK_GUARD) {
        performAttack(attacker, defenderSide, depth + 1);
      }
      // Bleed (Bloodbinder): this swing is one more combat attack — every `everyN`, the armed bleeder(s) fire.
      // Counted after the clash (and any reattack) resolves, so the AoE lands between exchanges, not mid-clash.
      if (bleeders.length > 0) {
        globalAttacks++;
        for (const b of bleeders) if (globalAttacks % b.everyN === 0) procBleed(b);
      }
    }
  }

  // Drain the immediate-attack queue AFTER the current clash's death cascade has fully settled: deferred
  // attack-on-summon tokens (Twilight Whelp's 3/3 Whelps) are placed + announced here and then strike, so the
  // whole summon lands as one discrete beat past the cascade. A placed token queues its own strike as the next
  // item; a Whelp's hit can spawn the enemy's Whelps (a chain), bounded by IMMEDIATE_ATTACK_GUARD. A Whelp with
  // no living foe is skipped (combat may be ending).
  function flushImmediateAttacks(): void {
    let guard = 0;
    while (pendingAttackOnSummon.length > 0 && guard++ < IMMEDIATE_ATTACK_GUARD) {
      const item = pendingAttackOnSummon.shift()!;
      // A deferred summon: land the token NOW (a fresh beat), then take its immediate strike as its own beat
      // right after — so it summons and swings as one discrete unit, past the cascade that queued it. Doing the
      // strike inline (not as a separate queue item) keeps a multi-token Deathrattle sequential: each token
      // summons + strikes before the next lands, so the board-cap "room after the first has attacked" logic
      // (golden Whelp on a near-full board) still holds.
      if (item.summon) {
        const s = item.summon;
        nextStep();
        const m = placeSummon(s.minion, s.side, s.card, s.nearUid, s.grantKeywords, s.golden, true, s.copyStats, s.doubled);
        // Only a body that actually landed strikes — an overflowed summon (full board) returns unplaced.
        if (boards[m.side].includes(m) && !m.dead && m.health > 0 && m.attack > 0 && countLiving(OTHER[m.side]) > 0) {
          nextStep();
          performAttack(m, OTHER[m.side], 0);
        }
        continue;
      }
      // Each out-of-turn strike opens a fresh moment: a Solaris shield grant lands here, then performAttack's
      // own entry bump gives the swing itself the next step (grant → strike, two beats, never merged into the
      // death resolution that queued them).
      nextStep();
      const { minion: m, shieldFirst } = item;
      // Grant a fresh Ward immediately before this strike (Solaris Fang's Avenge). Paired with the strike so a
      // golden Solaris — which queues two — goes in shielded on EACH. Idempotent (no double shield).
      if (shieldFirst && !m.dead && m.health > 0 && !m.divineShield) {
        m.divineShield = true;
        if (!m.keywords.includes('DS')) m.keywords.push('DS');
        emit({ type: 'shieldUp', target: m.uid });
      }
      if (m.dead || m.health <= 0 || m.attack <= 0) continue;
      if (countLiving(OTHER[m.side]) === 0) continue;
      performAttack(m, OTHER[m.side], 0);
    }
  }

  // --- The Reclaimer: a marked player minion is destroyed at the start of combat — its Deathrattle
  //     fires NOW (tokens summon and may overflow a full board) — and the exact body is queued to be
  //     resummoned in its slot the next time the board has room (a friend dies). It does NOT take
  //     priority over its own tokens: they win the immediate scramble, and it reclaims its spot later.
  //     If the board already has room after the Deathrattle, the flush right below brings it back at
  //     once (so on a non-full board it still rejoins before the normal Start of Combat effects). ---
  for (const minion of [...boards.player, ...boards.enemy]) {
    if (!minion.resummon || minion.dead || minion.health <= 0) continue;
    // Capture the full combat state for an exact copy (stats + granted keywords + golden + every
    // per-instance field). `sourceUid` rides along so the copy's carry-backs (Kennelmaster's Avenge,
    // Engraved permaGain, Sergeant's accrual, Tara's tally) still reach the originating run card —
    // duplicate-safe at settle: the set-style channels take the copy's (later) entry, and the add-style
    // ones are empty on the SC-destroyed original. `rallyMechAtk` stores only the WELDED part
    // (instantiate re-adds the card's own base). The copy's Deathrattle re-arms on the new body — a
    // re-proc is intended (owner ruling 2026-07-03), the same rule as every resummon.
    const def = cards[minion.cardId];
    const weldedRally = (minion.rallyMechAtk ?? 0) - (def?.rallyMechAtk ?? 0) * (minion.golden ? 2 : 1);
    const copyBoard: BoardMinion = {
      cardId: minion.cardId,
      attack: minion.attack,
      health: minion.health,
      keywords: [...minion.keywords],
      golden: minion.golden,
      summonBonus: minion.summonBonus,
      overflowBonus: minion.overflowBonus,
      hpGrantBonus: minion.hpGrantBonus,
      ascendProgress: minion.ascendProgress,
      sourceUid: minion.sourceUid,
      rallyMechAtk: weldedRally > 0 ? weldedRally : undefined,
      rallySpellWeld: minion.rallySpellWeld, // welded-only already (no card component); carry the copy exactly
      buffs: minion.buffs,
    };
    minion.rebornAvailable = false; // force a true death (skip Reborn) so the Deathrattle fires
    killOrReborn(minion); // tokens summon now and may overflow the board
    pendingResummons.push({ anchor: minion, board: copyBoard, side: minion.side });
  }
  flushResummons(); // non-full board → the original rejoins immediately; full board → it waits

  // --- Start of Combat: player minions left→right first (A.3 step 1), then the enemy's (owner ruling
  //     2026-07-03: a captured board's Start-of-Combat effects are live, not inert — an enemy Taurus
  //     engraves its line too). Effects reading the player's RUN state (Abhorrent Horror's consumed-Fodder
  //     tally) side-gate themselves, since an enemy snapshot carries no run state. ---
  // Blood Trail: mark the leftmost living player minion — its kills this fight conjure a random Beast (above).
  if (questMods.bloodTrail) bloodTrailMinion = boards.player.find((m) => !m.dead && m.health > 0);
  // Deep Hunger: mark the leftmost living Demon — its kills queue 3 Fodder into the next shop (below).
  if (questMods.deepHunger) deepHungerMinion = boards.player.find((m) => !m.dead && m.health > 0 && isDemon(m));
  // Run-level SoC quest/rune grants, PER SIDE (a served enemy runs its own): Rulebreaker's Crown, Umbral Energy,
  // Contract Rewrite. Enemy values come from the captured mods / scalers.
  for (const scSide of ['player', 'enemy'] as const) {
    const smods = modsFor(scSide);
    // Rulebreaker's Crown: the leftmost living minion gains +Attack equal to its Attack (doubles it).
    if (smods.doubleLeftmostAttack) {
      const lead = boards[scSide].find((m) => !m.dead && m.health > 0);
      if (lead && lead.attack > 0) { nextStep(); ctx.buff(lead, lead.attack, 0, lead.uid); }
    }
    // Umbral Energy: give every living Dragon +3/+3 for every spell cast this game (lifetime spellsCast, per side).
    const scSpells = scSide === 'player' ? spellsCast : (enemyScalers.spellsCast ?? 0);
    if (smods.umbralEnergy && scSpells > 0) {
      const amt = 3 * scSpells;
      let stepped = false;
      for (const m of boards[scSide]) {
        if (m.dead || m.health <= 0) continue;
        if (m.tribe !== 'dragon' && m.tribe2 !== 'dragon' && !m.universalTribe) continue;
        if (!stepped) { nextStep(); stepped = true; }
        ctx.buff(m, amt, amt, m.uid);
      }
    }
    // Contract Rewrite: the rightmost living Demon gains a Deathrattle — summon 2 Imps with Ward.
    if (smods.contractRewrite) {
      const demon = [...boards[scSide]].reverse().find((m) => !m.dead && m.health > 0 && isDemon(m));
      if (demon) {
        const eff: EffectDef = { on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: 'impscrap', count: 2, fixed: true, keyword: 'DS' } };
        demon.effects = [...demon.effects, eff];
        registerEffect(demon, eff); // register just the new Deathrattle (effects were registered at combat start)
      }
    }
  }
  // Taurus the Truth Bringer "triggers first": run any scEngraveAll BEFORE the normal SoC pass so every minion's
  // own Start-of-Combat gains are engraved too. Both sides (a captured enemy board's Taurus is live).
  for (const side of ['player', 'enemy'] as const) {
    for (const minion of [...boards[side]]) {
      if (minion.dead || minion.health <= 0) continue;
      for (const effect of minion.effects) {
        if (effect.on === 'startOfCombat' && effect.do === 'scEngraveAll') { nextStep(); FACTORIES[effect.do]?.(ctx, minion, effect.params ?? {}, {}); }
      }
    }
  }
  for (const side of ['player', 'enemy'] as const) {
    for (const minion of [...boards[side]]) {
      if (minion.dead || minion.health <= 0) continue;
      for (const effect of minion.effects) {
        if (effect.do === 'scEngraveAll') continue; // already ran in the priority pass above
        if (effect.on !== 'startOfCombat') continue;
        const fn = FACTORIES[effect.do];
        if (fn) { nextStep(); fn(ctx, minion, effect.params ?? {}, {}); }
      }
    }
  }
  // Start-of-Combat RUNE grants, PER SIDE (a served enemy runs its own runes): Warden, Twilight, Shared Circuit,
  // Warding, Echoing Coop, Rallying, Rising Graves. Enemy mods come from the captured snapshot.
  for (const rside of ['player', 'enemy'] as const) {
    const rmods = modsFor(rside);
    // Rune of the Warden: if the board has room (< 7), summon a Spear Warden.
    if (rmods.runeWarden && boards[rside].length < 7) {
      const knit = cards['knit'];
      if (knit) { nextStep(); summonMinion(rside, knit, undefined); }
    }
    // Rune of Twilight: Start-of-Combat effects trigger an ADDITIONAL time — a second SoC pass for this board.
    if (rmods.runeTwilight) {
      for (const minion of [...boards[rside]]) {
        if (minion.dead || minion.health <= 0) continue;
        for (const effect of minion.effects) {
          if (effect.on !== 'startOfCombat') continue;
          const fn = FACTORIES[effect.do];
          if (fn) { nextStep(); fn(ctx, minion, effect.params ?? {}, {}); }
        }
      }
    }
    // Shared Circuit: give up to N friendly Mechs (leftmost first, skipping already-shielded) a Ward.
    if ((rmods.sharedCircuitWard ?? 0) > 0) {
      const sideMods = rmods.sharedCircuitWard!;
      let left = sideMods;
      for (const m of boards[rside]) {
        if (left <= 0) break;
        if (m.dead || m.health <= 0 || m.divineShield) continue;
        if (m.tribe !== 'mech' && m.tribe2 !== 'mech') continue;
        nextStep();
        m.divineShield = true;
        if (!m.keywords.includes('DS')) m.keywords.push('DS');
        emit({ type: 'shieldUp', target: m.uid });
        left--;
      }
      // …and when a friendly Mech LOSES its Ward, pass a fresh Ward to another unshielded friendly Mech — up to
      // N transfers this combat (chains as those break too). `sc` is captured per side so the two boards don't share it.
      let transfers = sideMods;
      const tSide = rside;
      bus.on('onLoseDivineShield', (payload) => {
        const { minion, side } = payload as { minion: Minion; side: Side };
        if (side !== tSide || transfers <= 0) return;
        if (minion.tribe !== 'mech' && minion.tribe2 !== 'mech') return;
        const next = boards[tSide].find((m) => !m.dead && m.health > 0 && !m.divineShield && (m.tribe === 'mech' || m.tribe2 === 'mech'));
        if (!next) return;
        transfers--;
        nextStep();
        next.divineShield = true;
        if (!next.keywords.includes('DS')) next.keywords.push('DS');
        emit({ type: 'shieldUp', target: next.uid });
      });
    }
    // Rune of Warding: give the leftmost living minion a Ward.
    if (rmods.runeWarding) {
      const lead = boards[rside].find((m) => !m.dead && m.health > 0 && !m.divineShield);
      if (lead) {
        nextStep();
        lead.divineShield = true;
        if (!lead.keywords.includes('DS')) lead.keywords.push('DS');
        emit({ type: 'shieldUp', target: lead.uid });
      }
    }
    // Echoing Coop: trigger every minion's Echo once, without killing the body (Sylus doubles them). The
    // Deathrattle tally (Grim) is player-only.
    if (rmods.echoingCoop) {
      for (const minion of [...boards[rside]]) {
        if (minion.dead || minion.health <= 0 || !minion.effects.some((e) => e.on === 'onDeath')) continue;
        nextStep();
        emit({ type: 'sc', source: minion.uid, text: 'Echo' });
        if (rside === 'player') bumpDeathrattles(1);
        fireOwnDeathrattles(minion);
      }
    }
    // Rune of Rallying: trigger each minion's Rally (on-attack) effects once — a free rally without an attack.
    if (rmods.runeRallying) {
      for (const minion of [...boards[rside]]) {
        if (minion.dead || minion.health <= 0) continue;
        const cardRally = minion.keywords.includes('RL') && minion.effects.some((e) => e.on === 'onAttack');
        const mechRally = (minion.rallyMechAtk ?? 0) > 0;
        const spellRally = (minion.rallySpellWeld ?? 0) > 0;
        if (!cardRally && !mechRally && !spellRally) continue;
        nextStep();
        emit({ type: 'sc', source: minion.uid, text: 'Rally' });
        if (cardRally) {
          for (const effect of minion.effects) {
            if (effect.on !== 'onAttack') continue;
            FACTORIES[effect.do]?.(ctx, minion, effect.params ?? {}, { minion, side: minion.side });
          }
        }
        if (mechRally) {
          for (const m of boards[rside]) {
            if (!m.dead && m.health > 0 && m !== minion && (m.tribe === 'mech' || m.tribe2 === 'mech')) ctx.buff(m, minion.rallyMechAtk!, 0, 'Better Bot');
          }
        }
        if (spellRally) { // Perfect Core → spell to hand: player-only (grantToHand is a no-op for the enemy)
          const pool = ctx.allCards().filter((c) => c.spell && !c.token);
          if (pool.length > 0) for (let i = 0; i < minion.rallySpellWeld!; i++) ctx.grantToHand(ctx.rng.pick(pool).id, minion.side, minion.uid);
        }
      }
    }
    // Rune of Rising Graves: give the two left-most Undead Rise (Reborn) — a foldable `keyword` R grant.
    if (rmods.runeRisingGraves) {
      let given = 0;
      for (const m of boards[rside]) {
        if (given >= 2) break;
        if (m.dead || m.health <= 0 || m.rebornAvailable || !isUndeadMinion(m)) continue;
        nextStep();
        m.rebornAvailable = true;
        if (!m.keywords.includes('R')) m.keywords.push('R');
        emit({ type: 'keyword', target: m.uid, keyword: 'R', source: m.uid });
        given++;
      }
    }
  }
  // Rune-granted run-wide AVENGE effects (no minion source): a bus handler fires every N friendly deaths. Rune of
  // Fury doubles them, matching how a minion's Avenge doubles (see registerEffect). Registered before the attack
  // loop so they catch every death.
  const runeAvenge = (everyN: number, mask: (m: QuestCombatMods, side: Side) => boolean, fire: (side: Side) => void): void => {
    bus.on('avenge', (payload) => {
      const { side, count } = payload as { side: Side; count: number };
      if (count % everyN !== 0) return;
      const m = modsFor(side);
      if (!mask(m, side)) return;
      fire(side);
      if (m.runeFury) fire(side); // "your Avenge effects trigger twice" — per side
    });
  };
  // Combat avenge runes — PER SIDE (a served enemy runs its own): Broodpit + Spearline summon to their own side.
  runeAvenge(6, (m) => !!m.runeBroodpit, (side) => { // summon 2 Imps with Taunt
    const imp = cards['impscrap'];
    if (imp) { nextStep(); for (let i = 0; i < 2; i++) summonMinion(side, imp, undefined, ['T']); }
  });
  runeAvenge(4, (m) => !!m.runeSpearline, (side) => { // summon a Spear Warden that attacks immediately
    const knit = cards['knit'];
    if (knit) { nextStep(); summonMinion(side, knit, undefined, undefined, false, true); }
  });
  // Economy avenge runes — PLAYER-ONLY (grant to the run's spell power / max Gold; no enemy meaning).
  runeAvenge(4, (m, side) => side === 'player' && !!m.runeAppraisal, () => ctx.grantSpellPower(1, 1, 'player', undefined)); // spells +1/+1
  runeAvenge(4, (m, side) => side === 'player' && !!m.runeSoulTaxes, () => ctx.grantMaxGold(1, 'player')); // +1 max Gold

  // Rune of Packcraft: whenever you summon a minion in combat, your Beasts gain +1 Attack (aura — current Beasts
  // now + carried back so future bought Beasts inherit it, like The Old Hunt). Per side; carry-back player-only.
  if (questMods.runePackcraft || enemyQuestMods.runePackcraft) {
    bus.on('onSummon', (payload) => {
      const { side } = payload as { minion: Minion; side: Side };
      if (!modsFor(side).runePackcraft) return;
      beastAtkAuraFor[side] += 1;
      if (side === 'player') beastBuyAtkGain += 1;
      for (const m of boards[side]) if (!m.dead && m.health > 0 && isBeast(m)) ctx.buff(m, 1, 0, 'Rune of Packcraft');
    });
  }
  // Rune of Inheritance: when your LEFT-MOST living minion dies, your right-most living minion gains its stats. Per side.
  if (questMods.runeInheritance || enemyQuestMods.runeInheritance) {
    bus.on('onDeath', (payload) => {
      const { minion, side } = payload as { minion: Minion; side: Side };
      if (!modsFor(side).runeInheritance) return;
      const idx = boards[side].indexOf(minion);
      if (idx < 0 || boards[side].slice(0, idx).some((m) => !m.dead && m.health > 0)) return; // not the leftmost
      const right = [...boards[side]].reverse().find((m) => !m.dead && m.health > 0 && m !== minion);
      if (right) ctx.buff(right, minion.attack, minion.maxHealth, 'Rune of Inheritance');
    });
  }
  // Rune of Salvage: a friendly Mech losing its Ward drops a random Attachment into your hand next shop —
  // ECONOMY/HAND, so player-only (a served enemy has no hand; grantToHand no-ops for it anyway).
  if (questMods.runeSalvage) {
    const magnetics = Object.values(cards).filter((c) => (c.tribe === 'mech' || c.tribe2 === 'mech') && c.keywords.includes('M') && !c.token && !c.spell);
    if (magnetics.length > 0) {
      bus.on('onLoseDivineShield', (payload) => {
        const { minion, side } = payload as { minion: Minion; side: Side };
        if (side !== 'player' || !(minion.tribe === 'mech' || minion.tribe2 === 'mech')) return;
        ctx.grantToHand(magnetics[rng.int(magnetics.length)]!.id, 'player', minion.uid);
      });
    }
  }
  // Rune of First Claws: at Start of Combat, the left-most + right-most Beasts attack immediately. Per side.
  for (const fside of ['player', 'enemy'] as const) {
    if (!modsFor(fside).runeFirstClaws) continue;
    const beasts = boards[fside].filter((m) => !m.dead && m.health > 0 && m.attack > 0 && isBeast(m));
    const targets = beasts.length <= 2 ? beasts : [beasts[0]!, beasts[beasts.length - 1]!];
    if (targets.length > 0) {
      nextStep();
      for (const m of targets) ctx.attackNow?.(m, false);
      flushImmediateAttacks();
    }
  }

  // --- First attacker: more living minions goes first; tie → seeded (A.3 step 2).
  //     Pre-emptive Assault overrides the whole rule: the player strikes first, period (one fight —
  //     the run loop clears the flag at settle). No tie roll is consumed on the override. ---
  const playerCount = living('player').length;
  const enemyCount = living('enemy').length;
  let turn: Side = playerAttacksFirst
    ? 'player'
    : playerCount > enemyCount
      ? 'player'
      : enemyCount > playerCount
        ? 'enemy'
        : rng.next() < 0.5
          ? 'player'
          : 'enemy';

  // --- Attack loop: each side cycles its minions left→right; sides alternate ---
  // Track the next attacker by *identity*, not by an index into the living list: a dead
  // minion stays in the board array but drops out of living(), which re-indexes — indexing
  // into living() would skip the minion to the right of one that just died. Resuming from
  // the last attacker's position in the full board array keeps the order stable across
  // deaths and mid-combat summons.
  const lastAttacker: Record<Side, Minion | null> = { player: null, enemy: null };
  const nextAttacker = (side: Side): Minion | undefined => {
    const arr = boards[side];
    const last = lastAttacker[side];
    const start = last ? arr.indexOf(last) + 1 : 0;
    for (let k = 0; k < arr.length; k++) {
      const m = arr[(start + k) % arr.length];
      if (m && !m.dead && m.health > 0 && m.attack > 0) {
        lastAttacker[side] = m;
        return m;
      }
    }
    return undefined;
  };
  // A 0-Attack minion can't attack — it's skipped in the rotation (above). If neither side has a
  // minion that can attack, the fight is a stalemate (a draw) rather than spinning the iteration guard.
  const canAttack = (side: Side): boolean => boards[side].some((m) => !m.dead && m.health > 0 && m.attack > 0);
  // Bloodlust: each spell-marked minion takes an immediate out-of-turn attack now, immune to retaliation for
  // that swing ("cannot die from that attack"). Queued like a Whelp strike → drained by flushImmediateAttacks.
  // BOTH sides: a served opponent board captured with a pending Bloodlust must fire it too (fidelity), and
  // flushImmediateAttacks strikes `OTHER[m.side]` — so an enemy Bloodlust correctly swings at the player.
  // Player first (unchanged order → determinism preserved for the common player-only case).
  for (const side of ['player', 'enemy'] as Side[]) {
    for (const m of boards[side]) {
      if (!m.bloodlust || m.dead || m.health <= 0 || m.attack <= 0) continue;
      m.attackImmuneLeft = Math.max(m.attackImmuneLeft ?? 0, 1); // no retaliation on the Bloodlust swing
      pendingAttackOnSummon.push({ minion: m });
    }
  }
  flushImmediateAttacks(); // Whelps summoned during Start-of-Combat / Reclaimer strike before the rotation begins
  flushAscensions(); // a Start-of-Combat buff/cast can already push Tara/Spirit Pup over the line — transform before round 1
  let guard = 0;
  while (countLiving('player') > 0 && countLiving('enemy') > 0 && guard++ < ITERATION_GUARD) {
    const defenderSide = OTHER[turn];
    const attacker = nextAttacker(turn);
    if (!attacker) {
      if (!canAttack(defenderSide)) break; // neither side can attack → end the fight
      turn = defenderSide;
      continue;
    }
    const rebornBefore = attacker.rebornAvailable;
    performAttack(attacker, defenderSide, 0);
    // Reborn-on-attack: a minion that died to retaliation and Reborned keeps its place — it's next to
    // attack again for its side (rewind the pointer to just before it) rather than going to the back.
    if (rebornBefore && !attacker.rebornAvailable && !attacker.dead && attacker.health > 0) {
      const arr = boards[turn];
      lastAttacker[turn] = arr[arr.indexOf(attacker) - 1] ?? null;
    }
    // Whelps summoned by this attack's death cascade strike immediately, out of turn order.
    flushImmediateAttacks();
    // This attack's death cascade has fully settled — if it freed a player slot, a Reclaimer
    // resummon waiting in the wings reclaims it now (never interleaved mid-summon).
    flushResummons();
    flushAscensions(); // a Tara/Spirit Pup that crossed its threshold this attack transforms now (between actions)
    turn = defenderSide;
  }

  // --- Outcome (A.3 step 8) ---
  const survivorsP = living('player');
  const survivorsE = living('enemy');
  const result: CombatOutcome =
    survivorsP.length > 0 && survivorsE.length > 0
      ? 'draw' // iteration guard reached with both sides alive
      : survivorsE.length === 0 && survivorsP.length > 0
        ? 'win'
        : survivorsP.length === 0 && survivorsE.length === 0
          ? 'draw'
          : 'lose';

  // Player damage on loss (A.3 step 9) — Battlegrounds-style: the opponent's tavern tier + the SUM of the
  // tiers of their minions still standing (a tier-4 board surviving with a T4 + T3 → 4 + 4 + 3 = 11). The
  // run loop caps this per round. `enemyTier` is the served board's tavern tier (or the player's tier for
  // the procedural fallback); a token / unknown survivor counts as tier 1.
  const playerDamage =
    result === 'lose'
      ? enemyTier + survivorsE.reduce((sum, m) => sum + (cards[m.cardId]?.tier ?? 1), 0)
      : 0;

  // Per-instance state to carry back to the run board: a Kennelmaster whose Avenge
  // improved its summon buff this combat keeps the higher bonus for the run.
  const playerSummonBonus = boards.player
    .filter((m) => m.sourceUid !== undefined && m.summonBonus > 0)
    .map((m) => ({ sourceUid: m.sourceUid!, bonus: m.summonBonus }));
  // Sergeant: the Deathrattle HP-grant accrual (seeded from the run board + any improvements from Attack
  // gained this combat) carries back so the improvement is permanent — keyed to the originating board card.
  const playerHpGrantBonus = boards.player
    .filter((m) => m.sourceUid !== undefined && (m.hpGrantBonus ?? 0) > 0)
    .map((m) => ({ sourceUid: m.sourceUid!, bonus: m.hpGrantBonus! }));
  // Archmagus Guel: his on-board spell tally (seeded + this combat's casts) carries back so combat casts count
  // permanently toward his per-instance improvement — keyed to the originating board card.
  const playerSpellProgress = boards.player
    .filter((m) => m.sourceUid !== undefined && (m.spellProgress ?? 0) > 0)
    .map((m) => ({ sourceUid: m.sourceUid!, progress: m.spellProgress! }));
  // Tara's stat-grant tally this combat, per board card (for the ascend-at-settle accumulation).
  const playerAscendCount = boards.player
    .filter((m) => m.sourceUid !== undefined && (buffCounts.get(m.uid) ?? 0) > 0)
    .map((m) => ({ sourceUid: m.sourceUid!, count: buffCounts.get(m.uid)! }));

  // Permanent gains carry back to the run board (only real minions — summoned tokens have no sourceUid
  // and are gone after combat). Two flavors, both recorded as `permaGain`: an Engraved minion keeps the
  // stats it gained this fight (native EG, or EG granted at Start of Combat by Taurus), and Flowing Monk's
  // overflow gift sticks to a non-EG recipient. The `engraved` flag is read off the *combat Minion's* live
  // keywords (so a Taurus-granted EG counts), and only steers the run-board inspect label — never gates the
  // carry-back, which the reducer applies regardless.
  const playerPermaBuffs = boards.player
    .filter((m) => m.sourceUid !== undefined && m.permaGain && (m.permaGain.attack > 0 || m.permaGain.health > 0))
    .map((m) => ({
      sourceUid: m.sourceUid!,
      attack: m.permaGain!.attack,
      health: m.permaGain!.health,
      engraved: m.keywords.includes('EG'),
    }));

  return {
    events,
    result,
    playerDamage,
    playerDeathrattles,
    playerRallies: playerRallies > 0 ? playerRallies : undefined,
    playerImpsSummoned: playerImpsSummoned > 0 ? playerImpsSummoned : undefined,
    playerDeaths: deaths.player,
    playerSurvivorCardIds: (() => {
      const alive = boards.player.filter((m) => !m.dead && m.health > 0).map((m) => m.cardId);
      return alive.length > 0 ? alive : undefined;
    })(),
    enemyDeaths,
    playerQuestTally: (questTally.attack > 0 || questTally.summonCombat > 0 || questTally.slaughter > 0 || questTally.slaughterKeyword > 0) ? questTally : undefined,
    playerQuestEvents: questEvents.length > 0 ? questEvents : undefined,
    playerBeastBuyAtkGain: beastBuyAtkGain > 0 ? beastBuyAtkGain : undefined,
    initial,
    playerSummonBonus,
    playerHpGrantBonus: playerHpGrantBonus.length > 0 ? playerHpGrantBonus : undefined,
    playerSpellProgress: playerSpellProgress.length > 0 ? playerSpellProgress : undefined,
    playerAscendCount: playerAscendCount.length > 0 ? playerAscendCount : undefined,
    playerPermaBuffs: playerPermaBuffs.length > 0 ? playerPermaBuffs : undefined,
    playerHandGrants: handGrants.length > 0 ? handGrants : undefined,
    playerSpellPower: spellPowerGain.attack !== 0 || spellPowerGain.health !== 0 ? spellPowerGain : undefined,
    playerCardBuffs: cardBuffGains.length > 0 ? cardBuffGains : undefined,
    playerFodderGrants: fodderGrants > 0 ? fodderGrants : undefined,
    playerFodderSchedule: fodderSchedule.some((n) => n > 0) ? fodderSchedule : undefined,
    playerDeferredBattlecries: deferredBattlecries.length > 0 ? deferredBattlecries : undefined,
    playerMaxGoldGain: maxGoldGain > 0 ? maxGoldGain : undefined,
    playerBonusGold: bonusGoldGain > 0 ? bonusGoldGain : undefined,
    playerFreeRolls: freeRollGrants > 0 ? freeRollGrants : undefined,
    playerGuaranteedAttachments: attachmentShopGrants > 0 ? attachmentShopGrants : undefined,
    playerSpellsCast: playerCombatSpells > 0 ? playerCombatSpells : undefined,
    playerUndeadBuyAtkGain: undeadBuyAtkGain > 0 ? undeadBuyAtkGain : undefined,
    playerUndeadAuraGain: undeadAuraGain.attack > 0 || undeadAuraGain.health > 0 ? undeadAuraGain : undefined,
    playerImpBuffGain: impBuffGain.attack > 0 || impBuffGain.health > 0 ? impBuffGain : undefined,
    playerFodderBuffGain: fodderBuffGain.attack > 0 || fodderBuffGain.health > 0 ? fodderBuffGain : undefined,
    // Enemy run-level scalers so the UI can render an enemy Grim/Taragosa/Pack Leader/Runescale at the
    // OPPONENT's value. Present only when the enemy actually had a nonzero scaler (else the card's base text
    // is already accurate → the UI's player-side fallback is fine).
    enemyScalers: (enemySpellPower.attack || enemySpellPower.health || enemySpellsThisTurn || enemyBeastsPlayed || enemyDeathrattles)
      ? { spellPower: { ...enemySpellPower }, spellsThisTurn: enemySpellsThisTurn, beastsPlayed: enemyBeastsPlayed, deathrattles: enemyDeathrattles }
      : undefined,
  };
}
