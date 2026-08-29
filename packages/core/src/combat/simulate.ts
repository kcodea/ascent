import type {
  BoardMinion,
  CardDef,
  CombatConfig,
  CombatContext,
  CombatEvent,
  CombatOutcome,
  CombatResult,
  CombatSideState,
  EffectDef,
  Keyword,
  Minion,
  MinionSnapshot,
  QuestCombatMods,
  PendingCombatQuest,
  Side,
  Tribe,
} from '../types';
import { ALE_IDS, alignAllows, extraTriggerFires, foldEchoExtraFires, socTwilightExtraFires } from '../types';
import type { Rng } from '../rng';
import { CombatBus } from '../events';
import { FACTORIES, playRubyOn, castInCombat, combatCastable, resolveCombatSpellCast, replayCombatBattlecry, drakkoRepeats, SILENT_ONPLAY } from '../effects/factories';
import { instantiate, type CardIndex } from './minion';
import { EMPTY_SIDE } from './side';

const OTHER: Record<Side, Side> = { player: 'enemy', enemy: 'player' };
// On-attack WATCHERS (on a minion other than the attacker) that are gated on the attacker's Rally and so must
// scale with Rally doublers. Paragon (`onRallyBuffOnePerTribe`) is the one such today. Generic ally-attack
// watchers (Crypt Drake) are intentionally NOT here — they count every swing, not every Rally.
const RALLY_WATCHER_EFFECTS = new Set<string>(['onRallyBuffOnePerTribe']);
const ITERATION_GUARD = 300;
const REATTACK_GUARD = 50;
/** Rune of Ruins: the flat per-stat grant each landed friendly-Demon hit gives that side's board. */
const RUNE_RUINS_BUFF = 2;
const IMMEDIATE_ATTACK_GUARD = 64; // bounds a chain of attack-on-summon Whelps (each kill can spawn another); one queue item per token — a deferred summon strikes inline in the same drain step

/**
 * Resolve a combat deterministically (handoff A.3) and return an event log the
 * UI can replay. Pure: depends only on its inputs and the seeded `rng`. Clones
 * every minion — shared CardDefs are never mutated.
 */
/** Set 2 — does this combat minion count as `tribe`? Reads its snapshot tribes plus the CardDef's
 *  `universalTribe` (Lab Experiment counts as every tribe), matching the tribe checks in the effect factories. */
function isTribeOf(m: Minion, tribe: string, cards: Record<string, CardDef>): boolean {
  return m.tribe === tribe || m.tribe2 === tribe || !!cards[m.cardId]?.universalTribe;
}

export function simulate(
  player: BoardMinion[],
  enemy: BoardMinion[],
  rng: Rng,
  cards: CardIndex,
  /** The PLAYER side's run-level combat context (auras, spell power, tribe tallies, tier, tribes, quest mods).
   *  Built from live `RunState`. Defaults to the neutral all-zero side, so a bare `simulate(player, enemy, rng,
   *  cards)` behaves exactly as it always did. */
  playerState: CombatSideState = EMPTY_SIDE,
  /** The ENEMY side's run-level context — the SAME struct — reconstituted from its board snapshot, so an enemy
   *  Grim / Taragosa / Pack Leader / Runescale / Watcher scales with the OPPONENT's values, not the current
   *  player's. Defaults to the neutral side (procedural threat / synthetic foe with no run economy). */
  enemyState: CombatSideState = EMPTY_SIDE,
  /** Player-only one-fight combat overrides (runes): attack-first + Rally-double. */
  config: CombatConfig = {},
): CombatResult {
  const { playerAttacksFirst = false, playerRallyDouble = false, forceEnemyFirstTargetCard } = config;
  // TUTORIAL ONLY: consumed once, on the enemy's opening swing (see the target pick below).
  let forcedEnemyTargetPending = !!forceEnemyFirstTargetCard;
  // Per-side quest/rune combat modifiers: each side reads its OWN captured mods.
  const modsFor = (side: Side): QuestCombatMods => (side === 'player' ? playerState.questMods : enemyState.questMods);
  // RUNE DUPLICATE STACKING (owner approve 2026-08-27, q-runedup-boolean-flags): how many copies of a boolean
  // combat flag this side holds — repeatable flag dispatchers fire once per copy. `flagCopies` is the same
  // channel the rune Avenge dispatchers have consumed since 2026-08-06; `?? 1` keeps every single-copy run
  // (and every pre-counter snapshot) byte-identical.
  const flagCopiesOf = (side: Side, flag: string): number => Math.max(1, modsFor(side).flagCopies?.[flag] ?? 1);
  // Beast Attack aura, PER SIDE, mutable so The Old Hunt (oldHuntStep) can pump it live as Beasts attack —
  // later from-base Beast bodies (summons / Reborn) then inherit the grown value. Its Health sibling
  // (Pack Mentality) is fixed for the fight. Enemy values come from the served snapshot.
  const beastAtkAuraFor: Record<Side, number> = { player: playerState.beastBuyAtk, enemy: enemyState.beastBuyAtk };
  const beastHpAuraFor: Record<Side, number> = { player: playerState.questMods.beastAuraHp ?? 0, enemy: enemyState.questMods.beastAuraHp ?? 0 };
  let beastBuyAtkGain = 0; // The Old Hunt: run-wide Beast Attack aura gained this combat → carried back
  // GORUN (Blade Mastery): attacks made THIS fight, per side. The run-lifetime total rides in on
  // `mods.bladeMastery.attacks`; adding this to it is what lets the grant step up mid-combat as the running
  // total crosses each multiple of 8. Its own counter rather than `questTally.attack`, which is player-only —
  // a served rival running Gorun has to snowball on its own side too.
  const bladeAttacks: Record<Side, number> = { player: 0, enemy: 0 };
  // CINDARA (Hoard): the improvement her Whelps have banked ABOVE the token's 1/1 base, per side. Seeded from
  // the run's saved level and grown +2/+2 per Avenge (4) fire; the player's growth carries back at settle.
  const hoardLevel: Record<Side, { attack: number; health: number }> = {
    player: { ...(playerState.questMods.hoard ?? { attack: 0, health: 0 }) },
    enemy: { ...(enemyState.questMods.hoard ?? { attack: 0, health: 0 }) },
  };
  const hoardStart = { attack: hoardLevel.player.attack, health: hoardLevel.player.health };
  // Pack Mentality: player-side LIVE growth of the Beast aura (every `per` Beasts summoned this fight grow it by
  // step, applied at once to living Beasts). `beastScaleProgress` counts toward the next step; the Health gain is
  // its own carry-back (The Old Hunt is Attack-only, so `beastBuyHpGain` is new).
  const beastScale = playerState.questMods.beastSummonScale;
  let beastBuyHpGain = 0;
  let beastScaleProgress = beastScale?.progress ?? 0;
  const events: CombatEvent[] = [];
  // Resolution-step tag (choreographer spec 2026-07-06): `stepN` identifies the atomic resolution moment
  // each event belongs to. `emit` stamps it; `nextStep()` is called wherever a NEW atomic resolution begins
  // (one attack swing's exchange, one victim's death resolution, its rattle's effects, one SC cast, …).
  // Pure metadata: zero logic/RNG/order impact — outcomes are locked by the determinism + golden suites.
  // Rule of thumb when extending the sim: finer is safer (the UI compiler can MERGE steps, never split them).
  let stepN = 0;
  const nextStep = (): void => { stepN++; };
  // `inAvenge` is true only while an Avenge handler bus-emission is running (see `emitAvenge`). Every event a
  // handler emits during that window is stamped `avenge:true` — pure presentation metadata (like `step`) that
  // lets the replay hold Avenge payoff beats until after the death's summons deploy. Zero effect on outcomes.
  let inAvenge = false;
  // CHOREOGRAPHER PR 23 — the ACTIVE EFFECT context, mirroring `inAvenge`: while a minion's combat effect
  // runs, every event it emits is stamped with the effect's registry key + the card that ran it. Identity
  // travels ON the events gameplay already emits — no new event types, no count/order changes, so replay
  // grouping is untouched. Presentation metadata only; resolution never reads it.
  let effectCtx: { key: string; srcCard: string } | null = null;
  const withEffect = (self: Minion, effect: EffectDef, run: () => void): void => {
    const prev = effectCtx;
    effectCtx = { key: `factory:${effect.do}:${effect.on}`, srcCard: self.cardId };
    try { run(); } finally { effectCtx = prev; }
  };
  // Presentation WAVE tag (multi-pass echo pacing — Fel Spikes). Unlike `stepN`, which a death bumps mid-pass,
  // `waveN` stays constant for a whole pass, so all of a pass's damage + its synchronous reactor buffs + the
  // deaths it resolves share one id; the replay groups a same-`wave` run into one volley moment and pauses
  // between waves. `waveSeq` only ever increments (monotonic ids), so re-fires (Sylus) get fresh waves too.
  // Opt-in via `ctx.wave(fn)`; `waveN` is undefined everywhere else, so untagged combat is byte-identical.
  let waveN: number | undefined;
  let waveSeq = 0;
  const withWave = <T,>(fn: () => T): T => {
    const prev = waveN;
    waveN = ++waveSeq;
    try { return fn(); } finally { waveN = prev; }
  };
  // ── Multi-volley Echo: deferred-death scope ─────────────────────────────────────────────────────────
  // A Fel-Spikes-style Deathrattle (`deathrattleDamageAllExceptTribe`) that sprays the whole board can fire
  // MANY times over one death: gilded sprays twice, and any Echo doubler (Sylus, Funeral Engine, a golden
  // Echohorn's re-trigger) re-fires the whole rattle. Every fire must hit the SAME victims and their deaths
  // must resolve ONCE, AFTER the last fire — otherwise a body that summons tokens on death (Void Panther →
  // two Void Cubs) dies to volley 1 and its fresh tokens are mown down by volley 2, and a low-HP victim
  // vanishes before later volleys' reactors (Axeman / Leech) can proc (owner ruling 2026-08-20). While a
  // scope is open, `resolveEchoDeath` QUEUES a ≤0 victim instead of killing it; the OUTERMOST scope flushes
  // the queue in capture order once firing is done. The scope wraps EVERY death's own rattle firing, but only
  // Fel-Spikes-style effects ever call `resolveEchoDeath`, so it is a no-op — byte-identical events — for
  // every other death (proven by the determinism harness).
  let echoDeferDepth = 0;
  const echoDeferredDeaths: { victim: Minion; killer?: Minion }[] = [];
  const flushEchoDeaths = (): void => {
    const pending = echoDeferredDeaths.splice(0);
    for (const { victim, killer } of pending) if (!victim.dead && victim.health <= 0) killOrReborn(victim, killer);
  };
  const withEchoDefer = <T,>(fire: () => T): T => {
    echoDeferDepth++;
    try { return fire(); }
    finally { echoDeferDepth--; if (echoDeferDepth === 0 && echoDeferredDeaths.length > 0) flushEchoDeaths(); }
  };
  const emit = (e: CombatEvent): void => { events.push({ ...e, step: stepN, ...(inAvenge ? { avenge: true as const } : {}), ...(effectCtx ? { key: effectCtx.key, srcCard: effectCtx.srcCard } : {}), ...(waveN !== undefined ? { wave: waveN } : {}) }); };
  // A completed quest / owned rune's COMBAT effect just fired — emit a marker the UI folds into a badge pulse
  // (the `flag` maps to the quest/rune id via content). Purely cosmetic; zero effect on resolution.
  const fireTrigger = (flag: string, side: Side): void => emit({ type: 'questTrigger', flag, side });
  const bus = new CombatBus();
  // Fire the Avenge bus with `inAvenge` set, so every event the handlers emit (buff / improve / maxGold /
  // shieldUp / summon / …) is stamped `avenge:true`. try/finally guarantees the flag clears even if a handler
  // throws. The two call sites are the two friendly-death tallies (a true death, and a board-full Rise that
  // stays dead). Presentation-only tag; resolution is unchanged.
  const emitAvenge = (side: Side, count: number, victim?: Minion): void => {
    inAvenge = true;
    // `victim` is ADDITIVE: every existing Avenge consumer reads only side/count, so passing the dead body is
    // free, and a watcher that cares WHAT died (Endless Overseer: only Imps) can now ask.
    try { bus.emit('avenge', { side, count, victim }); } finally { inAvenge = false; }
  };
  let uidCounter = 0;
  const mkUid = (): string => `m${uidCounter++}`;
  const handGrants: string[] = []; // cards the player's deathrattles add to hand after combat
  /** Rune of Grave Refreshment's per-side Echo counter. Combat-local: the rune reads "in combat", so the
   *  remainder is deliberately NOT banked across fights. */
  const echoRefreshTick: Record<Side, number> = { player: 0, enemy: 0 };
  /** Rune of the Returning Pack's per-side Beast-summon counter. Combat-local for the same reason. */
  const packSummonTick: Record<Side, number> = { player: 0, enemy: 0 };
  let slaughterCopyId: string | undefined; // Rune of the Trophy: the first friendly slaughterer's card id
  const spellPowerGain = { attack: 0, health: 0 }; // run-wide spell-power gained this combat (Skullblade)
  const rubyGrants = { n: 0 }; // Set 2 — Rubies to mint into hand after combat (Rikk / Gemline), carried back
  // Per SIDE, and read LIVE (owner rule 2026-08-02): a mid-combat Ruby buff (Crownvein Vanguard's Rally)
  // must reach the Rubies played LATER in the same fight (Gemstorm Instigator's Avenge, Mineral Master's
  // Rally, Rune of Attacking Gems) — it used to be a settle-time carry-back only, so every in-combat Ruby
  // minted at the pre-combat snapshot. `rubyBonusFor` folds this in on every read; the player half still
  // carries back via `playerRubyBonusGain` (enemies have no run to persist to).
  let rubyMintCount = 0; // "get N Rubies" refired in combat — settle mints via the run's real mintRubies
  const handSummonedUids = new Set<string>(); // hand minions taken by Rope Wrangler's Echo (per-fight, both sides)
  const handSummoned: string[] = []; // the player half, carried back so settle removes them from the hand
  const rubyBonusGain: Record<Side, { attack: number; health: number }> = {
    player: { attack: 0, health: 0 },
    enemy: { attack: 0, health: 0 },
  };
  const boardBuffGain = { attack: 0, health: 0 }; // Rune of Overflow — permanent, carried back to the warband
  const tavernBuyGain = { attack: 0, health: 0 }; // Demon Horse — carried back to `tavernBuyBonus` // Set 2 — rubyBonus gained this combat (Veinbreaker), carried back
  const nextTurnSpellCopies = { n: 0 }; // Set 2 — Scalefeather Echoes: next-turn first-spell copies, carried back
  let undeadBuyAtkGain = 0; // permanent Undead buy-time attack from this combat (Karthus)
  const beastExtraGain: Record<Side, { hunt: number; ritual: number }> = { // Elderhorn refired in combat —
    player: { hunt: 0, ritual: 0 }, // both sides read live for the rest of the fight; player half carries back
    enemy: { hunt: 0, ritual: 0 },
  };
  const undeadAuraGain = { attack: 0, health: 0 }; // permanent Undead aura (attack+health) from this combat (Watcher's Lantern)
  const impBuffGain = { attack: 0, health: 0 }; // permanent Imp buff from this combat (Imp King / Brood Avenge)
  const rightmostSlotGain = { attack: 0, health: 0 }; // permanent right-most Shop-slot buff (Right Hand Hank's Echo)
  const magneticBuffGain = { attack: 0, health: 0 }; // permanent Attachment enchant from this combat (Chorus Engine)
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
  const spellTotals: Record<Side, number> = { player: playerState.spellsCast, enemy: 0 };
  let playerCombatSpells = 0; // spells the player cast THIS combat → added to the run's spellsCast at settle
  /** Escalating-spell improvement earned this fight (Quil casting Front to Back). Live for the REST of the
   *  fight — a second cast grants the improved value — and the player's half carries back at settle. */
  const spellEscalationGain: Record<Side, { attack: number; health: number }> =
    { player: { attack: 0, health: 0 }, enemy: { attack: 0, health: 0 } };
  /** Discover spells cast mid-fight (Quil / Sporebat / a taught Pup) — the modal can't open here, so the
   *  cast carries back and settle queues the real pick. Player-only, like every hand channel. */
  const discoverCasts: string[] = [];
  /** Shop-buff spells cast mid-fight → a one-time NEXT-shop buff (the run's `nextShopBuff` channel). */
  const nextShopBuffGain = { attack: 0, health: 0 };
  /** Extra combat casts each side has been granted (Runebloom Matriarch). 0 = a Shop Spell resolves once.
   *  Locked in at Start of Combat, so losing the granter mid-fight does not retract it — the same contract
   *  every other Start-of-Combat mode installs. Read by `castInCombat` via `spellCastRepsFor`. */
  const spellCastExtra: Record<Side, number> = { player: 0, enemy: 0 };
  /** Rune of the Crucible: the bodies sacrificed at Start of Combat, per side, kept at the stats they had.
   *  Resummoned when that side's LAST minion dies — see the wipe check in `killOrReborn`. Emptied on use, so
   *  a side can only be brought back once per fight. */
  const crucibleBank: Record<Side, { cardId: string; attack: number; health: number; keywords: Keyword[]; golden: boolean }[]> =
    { player: [], enemy: [] };
  /** Rune of the Second Litter: has the once-per-combat copy already fired, per side? */
  const secondLitterUsed: Record<Side, boolean> = { player: false, enemy: false };
  /** Wolvie (Echo): one-shot buffs queued for the next tribe minion each side summons (FIFO). */
  const nextSummonBuffs: Record<Side, { tribe: Tribe; attack: number; health: number }[]> = { player: [], enemy: [] };
  /** Wolvie's Echoes STACK onto the NEXT matching summon (owner 2026-08-12): four queued Echoes all land on the
   *  next Beast summoned, then the queue is spent — they are still for the next summon ONLY, just summed. Called
   *  from BOTH the normal summon chokepoint AND the Rise re-slot — a Rise re-enters play as a summon (owner
   *  ruling 2026-07-13), so it is "the next Beast you summon" too. */
  function applyNextSummonBuff(minion: Minion, side: Side): void {
    if (minion.dead || nextSummonBuffs[side].length === 0) return;
    const matches = (b: { tribe: Tribe }): boolean =>
      minion.tribe === b.tribe || minion.tribe2 === b.tribe || !!cards[minion.cardId]?.universalTribe;
    let a = 0, h = 0;
    for (const b of nextSummonBuffs[side]) if (matches(b)) { a += b.attack; h += b.health; }
    if (a === 0 && h === 0) return;
    nextSummonBuffs[side] = nextSummonBuffs[side].filter((b) => !matches(b)); // spent on this one body
    ctx.buff(minion, a, h, 'Wolvie');
  }
  /** Rune of Beastial Swarm: the current per-Beast-death buff amount, per side (grows via Avenge(2); the player
   *  side's final value carries back into the run). Seeded from the run-persisted level (default 2). */
  const beastialLevel: Record<Side, number> = {
    player: playerState.questMods?.beastialSwarmLevel ?? 2,
    enemy: enemyState.questMods?.beastialSwarmLevel ?? 2,
  };
  const beastialStart = { player: beastialLevel.player, enemy: beastialLevel.enemy };
  /** Rune of Dragonscale: Ward grants still owed this combat, per side. */
  const runeDragonscaleLeft: Record<Side, number> = {
    player: playerState.questMods.runeDragonscale ?? 0,
    enemy: enemyState.questMods.runeDragonscale ?? 0,
  };
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
    player: { attack: playerState.impAtk, health: playerState.impHp },
    enemy: { attack: enemyState.impAtk, health: enemyState.impHp },
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
    player: { attack: playerState.undeadAtk, health: playerState.undeadHp, buyAtk: playerState.undeadBuyAtk },
    enemy: { attack: enemyState.undeadAtk, health: enemyState.undeadHp, buyAtk: enemyState.undeadBuyAtk },
  };

  // Attachment/Magnetic aura (Scrap Herald / Banksly welds), PER SIDE — a served enemy carries its own captured
  // value, so enemy from-base Magnetics (summoned/Reborn) get it too, just like Beasts.
  const magneticAuraFor: Record<Side, { attack: number; health: number }> = {
    player: { attack: playerState.magneticAtk, health: playerState.magneticHp },
    enemy: { attack: enemyState.magneticAtk, health: enemyState.magneticHp },
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
      // only to from-base bodies (summoned/Reborn Magnetics); starting Magnetics already carry it. Per-side.
      label: 'Attachment Aura',
      grant: (m) =>
        m.keywords.includes('M')
          ? { attack: 0, health: 0, bakedAtk: magneticAuraFor[m.side].attack, bakedHp: magneticAuraFor[m.side].health }
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
    // Both are per-side — a served enemy carries its own captured aura value (`beastAtkAuraFor` / `magneticAuraFor`),
    // so enemy from-base Beasts / Magnetics (summons / Reborn) inherit it, just like the player's.
    for (const aura of AURAS) {
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
      ? (isPlayer ? playerState.cardBuffs[m.cardId] : undefined) ?? (def ? m.buffs?.find((b) => b.source === def.name) : undefined)
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

  const startCount: Record<Side, number> = { player: player.length, enemy: enemy.length };
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
  // extra" bonuses; `pitDone` gates Pit Without End's once-per-fight summon.
  const firstEchoDone: Record<Side, boolean> = { player: false, enemy: false };
  // Player Rally (on-attack) triggers this combat — the `rally` quest objective.
  let playerRallies = 0;
  const firstRallyDone: Record<Side, boolean> = { player: false, enemy: false };
  // Imps the player summoned this combat — the `summonImp` objective.
  let playerImpsSummoned = 0;
  const pitDone: Record<Side, boolean> = { player: false, enemy: false };
  /** Rune of Finality's own once-per-fight latch — separate from `pitDone` so holding both runes pays both. */
  const finalityDone: Record<Side, boolean> = { player: false, enemy: false };
  /** Rune of the Wild Hunt's escalating per-attack Health grant, per side. */
  // Seeded from each side's run context — the Wild Hunt's growth is PERMANENT across combats (owner fix
  // 2026-08-01), so the fight opens where the last one left off.
  const wildHuntGrown: Record<Side, number> = { player: playerState.wildHuntGrown ?? 0, enemy: enemyState.wildHuntGrown ?? 0 };
  /** Friendly minions summoned this combat — the Remains' threshold and Reinvestment's settle-time multiplier. */
  let playerSummonCount = 0;
  /** Per-side count of combat summons so far (this one included), read by Rune of the Zoo to scale Beardsley. */
  const summonOrdinal: Record<Side, number> = { player: 0, enemy: 0 };
  const firstSlaughterDone: Record<Side, boolean> = { player: false, enemy: false };

  // Enemy-side deaths this combat — Cassen's Collision banks these toward its 5-kill payoff (carried back).
  let enemyDeaths = 0;
  // Flash: the IDENTITY of the first and last enemy body you put down, not just how many. Recorded at both
  // enemy-death sites so a Rise's real death counts exactly like an ordinary one.
  let firstKill: string | undefined;
  let lastKill: string | undefined;
  // Rune of the Deathtouched Apple: 2 re-arms per COMBAT per side. A budget rather than a flag because
  // re-granting Rise on a Rise is otherwise unbounded — each return would arm the next forever.
  // 2 uses per copy held (boolean-flag family, owner 2026-08-27).
  const appleBudget: Record<Side, { left: number } | null> = {
    player: modsFor('player').runeDeathtouchedApple ? { left: 2 * flagCopiesOf('player', 'runeDeathtouchedApple') } : null,
    enemy: modsFor('enemy').runeDeathtouchedApple ? { left: 2 * flagCopiesOf('enemy', 'runeDeathtouchedApple') } : null,
  };
  const appleUsesFor = (side: Side): { left: number } | null => appleBudget[side];
  const flashPick = playerState.questMods?.flashPick;
  // Rune of the Wishbone on Flash: the claim grants TWO copies (owner ruling 2026-08-19 — "2 copies of the
  // minion for either choice"). The mark itself is unchanged; what doubles is the payout, which is the only
  // thing about this power that CAN double — arming a mark twice is the same mark.
  const flashCopies = Math.max(1, playerState.questMods?.flashCopies ?? 1);
  let flashDone = false;
  const noteKill = (cardId: string, uid: string): void => {
    firstKill ??= cardId;
    lastKill = cardId;
    // FIRST is knowable the instant it happens, so it flies to hand right then. LAST cannot be known until the
    // fight ends — it is granted at the final step below, still inside the replay so it animates the same way.
    if (flashPick === 'first' && !flashDone) {
      flashDone = true;
      const def = cards[cardId];
      if (def && !def.spell && !def.ruby) for (let i = 0; i < flashCopies; i++) ctx.grantToHand(cardId, 'player', uid);
    }
  };

  // ── Combat-phase quest tallies (carried back via playerQuestTally) ──────────────────────────────────────
  // Player attacks / mid-combat summons / enemy slaughters, each with a by-tribe breakdown (the acting or
  // summoned minion's tribe(s); universal-tribe minions count for every tribe). Beast quest objectives read
  // these post-combat. The Echo (Deathrattle) objective reuses `playerDeathrattles`.
  const questTally = {
    attack: 0, summonCombat: 0, slaughter: 0, slaughterKeyword: 0,
    attackByTribe: {} as Partial<Record<Tribe, number>>,
    summonCombatByTribe: {} as Partial<Record<Tribe, number>>,
    slaughterByTribe: {} as Partial<Record<Tribe, number>>,
    statGainByTribe: {} as Partial<Record<Tribe, number>>,
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
  // ── Mid-combat quest completion (player) ───────────────────────────────────────────────────────────────
  // Active combat-objective quests threaded in via `pendingQuests`. As their tally climbs, the moment one crosses
  // its threshold we (a) fold its reward's ONGOING combat mods into `playerState.questMods` — so effects like
  // Feeding Line trigger for the REST of this fight (Start-of-Combat mods, already applied, stay no-ops) — and
  // (b) emit a `questComplete` event so the UI lights the node on that beat. The actual completion + reward grant
  // still settles in the reducer; this only makes the in-fight activation live. `checkPendingQuests()` is called
  // after every objective tally bump; firing is one-shot per quest.
  const pending = (playerState.pendingQuests ?? []).map((p) => ({ def: p, fired: false }));
  const pendingCount = (p: PendingCombatQuest): number => {
    switch (p.event) {
      case 'attack': return p.tribe ? (questTally.attackByTribe[p.tribe] ?? 0) : questTally.attack;
      case 'summonCombat': case 'summon': return p.tribe ? (questTally.summonCombatByTribe[p.tribe] ?? 0) : questTally.summonCombat;
      case 'slaughter': return p.tribe ? (questTally.slaughterByTribe[p.tribe] ?? 0) : questTally.slaughter;
      case 'slaughterKeyword': return questTally.slaughterKeyword;
      case 'deathrattle': return playerDeathrattles;
      case 'rally': return playerRallies;
      case 'summonImp': return playerImpsSummoned;
      default: return 0; // friendlyDeath / tribeStats / compound / recruit objectives: settle-time only (no mid-combat proc)
    }
  };
  const checkPendingQuests = pending.length === 0 ? (): void => {} : (): void => {
    for (const p of pending) {
      if (p.fired || p.def.progress + pendingCount(p.def) < p.def.count) continue;
      p.fired = true;
      if (p.def.mods) Object.assign(playerState.questMods, p.def.mods); // activate ongoing combat effects from here on
      emit({ type: 'questComplete', questId: p.def.questId, side: 'player' });
      // Fly the reward card to hand as a live VISUAL only — a bare `toHand` event, NOT `ctx.grantToHand` (which
      // would also record it in `playerHandGrants`). The reducer grants the reward for real at settle
      // (`applyQuestReward`), so emitting here would otherwise double it.
      if (p.def.rewardCardId) emit({ type: 'toHand', cardId: p.def.rewardCardId, side: 'player' });
    }
  };
  const bumpQuestTally = (kind: 'attack' | 'summonCombat' | 'slaughter', m: Minion): void => {
    const tribes = tribesFor(m);
    questTally[kind] += 1;
    const by = byTribeMap[kind];
    for (const t of tribes) by[t] = (by[t] ?? 0) + 1;
    questEvents.push({ step: stepN, kind, tribes });
    // Pack Mentality (player): a Beast summoned in combat ticks the aura toward its next step; on each step,
    // grow the live Beast aura + buff EVERY living Beast immediately (matching "wherever they are"), then carry
    // the gain + leftover progress back to the run at settle. The just-summoned Beast is already on the board,
    // so it's included in the buff.
    if (kind === 'summonCombat' && beastScale && tribes.includes('beast')) {
      beastScaleProgress += 1;
      while (beastScaleProgress >= beastScale.per) {
        beastScaleProgress -= beastScale.per;
        beastAtkAuraFor.player += beastScale.stepAttack;
        beastHpAuraFor.player += beastScale.stepHealth;
        beastBuyAtkGain += beastScale.stepAttack;
        beastBuyHpGain += beastScale.stepHealth;
        for (const b of boards.player) if (!b.dead && b.health > 0 && isBeast(b)) ctx.buff(b, beastScale.stepAttack, beastScale.stepHealth, 'Pack Mentality');
      }
    }
    checkPendingQuests();
  };
  // Player Deathrattle triggers (Echo objective + Grim tally) — increment + record for the live-tick timeline.
  const bumpDeathrattles = (n: number): void => {
    if (n <= 0) return;
    playerDeathrattles += n;
    for (let i = 0; i < n; i++) questEvents.push({ step: stepN, kind: 'deathrattle', tribes: [] });
    checkPendingQuests();
  };
  // Player Rally (on-attack) triggers — the `rally` objective + live-tick timeline. Each fire (base + doubler
  // re-fires) counts one Rally trigger, matching the Shout/Echo convention.
  const bumpRally = (n: number): void => {
    if (n <= 0) return;
    playerRallies += n;
    for (let i = 0; i < n; i++) questEvents.push({ step: stepN, kind: 'rally', tribes: [] });
    // RUNE OF THE HERDING HORN: every Rally banks a free Shop refresh, carried back at settle. Hooked HERE
    // rather than at each Rally site so it counts exactly what the `rally` quest objective counts — every
    // fire, doubler re-fires included — instead of drifting from the game's own definition of "a Rally".
    if (modsFor('player').runeHerdingHorn) { fireTrigger('runeHerdingHorn', 'player'); ctx.grantFreeRolls(n, 'player'); }
    checkPendingQuests();
  };
  // The Red Trail: a Slaughter-KEYWORD trigger — a player minion with an on-kill effect felling an enemy. One per
  // kill (the primary trigger; doubler re-fires aren't counted). Tribe-agnostic.
  const bumpSlaughterKeyword = (): void => {
    questTally.slaughterKeyword += 1;
    questEvents.push({ step: stepN, kind: 'slaughterKeyword', tribes: [] });
    checkPendingQuests();
  };
  const isBeast = (m: Minion): boolean => m.tribe === 'beast' || m.tribe2 === 'beast' || !!m.universalTribe;
  const isDemon = (m: Minion): boolean => m.tribe === 'demon' || m.tribe2 === 'demon' || !!m.universalTribe;

  // Blood Trail: the leftmost living player minion, captured at Start of Combat, "gains Slaughter: get a random
  // Beast" for this fight — each enemy it kills conjures a random Beast to hand (via ctx.grantRandomMinion).
  let bloodTrailMinion: Minion | undefined;

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
    eotBonus: m.eotBonus,
    chosenOption: m.chosenOption, // Choose One: display-only, so the combat card prints the branch it became
    rallySpreadAtk: m.rallySpreadAtk, // Sunmane: the live escalating rally value, for the card text
    taughtSpellId: m.taughtSpellId, // Mage-Pup: display-only, so the combat card names the spell it cast
    sellBonus: m.sellBonus,
    eotTick: m.eotTick,
    overflowBonus: m.overflowBonus,
    hpGrantBonus: m.hpGrantBonus,
    ascendProgress: m.ascendProgress,
    spellProgress: m.spellProgress, // Guel: the live combat text reads his on-board spell tally

    buffs: m.buffs, // recruit-phase buff breakdown → the combat inspect panel (absent on summoned tokens)
  });

  const living = (side: Side): Minion[] => boards[side].filter((m) => !m.dead && m.health > 0);
  // Like `living`, but RETAINS a body already at ≤0 HP whose death is being DEFERRED across a multi-volley
  // Echo (Fel Spikes): it stays on the board until the spray's flush, so a later volley / re-fire re-hits the
  // SAME accumulating set instead of skipping a body volley 1 already dropped. Only differs from `living` while
  // an echo-defer scope is open — elsewhere no body sits at ≤0-not-dead, so it returns exactly `living`.
  const onBoard = (side: Side): Minion[] => boards[side].filter((m) => !m.dead);
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
  const spellPower = { attack: playerState.spellPowerAtk, health: playerState.spellPowerHp };
  // The enemy board's run-level scalers (from its snapshot) — static: enemies have no run economy and never
  // gain spell power mid-fight. Effects on the enemy side read these via the per-side accessors below, so an
  // enemy Taragosa/Grim/Pack Leader/Runescale scales with the OPPONENT's values, not the current player's.
  const enemySpellPower = { attack: enemyState.spellPowerAtk, health: enemyState.spellPowerHp };
  const enemySpellsThisTurn = enemyState.spellsThisTurn;
  const enemyBeastsPlayed = enemyState.beastsPlayed;
  const enemyDeathrattles = enemyState.deathrattles;

  // Sable's Soulbind re-entrancy guard — declared beside `ctx` because `ctx.buff` mirrors onto its partner by
  // calling itself. See the mirror block inside `buff`.
  let soulbindMirroring = false;

  /**
   * "A card was added to your hand" — broadcast to the side's reactors (owner report 2026-08-29). Called from
   * `ctx.grantToHand` and `ctx.grantRubies`, the only two ways a card reaches a hand mid-fight.
   *
   * DEPTH-GUARDED even though nothing today needs it: no current `onGainCard` reactor grants a card, so the
   * chain cannot recurse — but this is a broadcast whose handlers run arbitrary effects, and the one that
   * eventually grants a card would otherwise loop forever with no symptom until it hung a fight. One level
   * is all the game means: a card arriving pays out, and whatever that payout grants does not pay out again.
   */
  let gainCardDepth = 0;
  function emitGainCard(cardId: string, side: Side): void {
    if (gainCardDepth > 0) return;
    gainCardDepth++;
    try { bus.emit('onGainCard', { cardId, side }); } finally { gainCardDepth--; }
  }
  const ctx: CombatContext = {
    rng,
    bus,
    boards,
    events,
    spellsThisTurn: playerState.spellsThisTurn,
    beastsPlayedThisTurn: playerState.beastsPlayed,
    spellPower,
    enemySpellPower,
    spellPowerFor: (side) => (side === 'player' ? spellPower : enemySpellPower),
    rubyBonusFor: (side) => {
      // Base (the run's Ruby strength at combat start) + everything gained SO FAR this fight — so a Rally
      // that buffs Rubies raises the very next in-combat Ruby play (owner rule 2026-08-02).
      const base = (side === 'player' ? playerState.rubyBonus : enemyState.rubyBonus) ?? { attack: 0, health: 0 };
      const live = rubyBonusGain[side];
      return { attack: base.attack + live.attack, health: base.health + live.health };
    },
    leftmostHandSpellFor: (side) => (side === 'player' ? playerState.handSpellIds : enemyState.handSpellIds)?.[0],
    handSpellsFor: (side) => (side === 'player' ? playerState.handSpellIds : enemyState.handSpellIds) ?? [],
    spellEscalationFor: (side) => {
      const base = (side === 'player' ? playerState : enemyState).spellEscalation ?? { attack: 0, health: 0 };
      const live = spellEscalationGain[side];
      return { attack: base.attack + live.attack, health: base.health + live.health };
    },
    grantSpellEscalation: (attack, health, side) => {
      spellEscalationGain[side].attack += attack;
      spellEscalationGain[side].health += health;
    },
    tierFor: (side) => (side === 'player' ? playerState : enemyState).tier,
    rubiesPermanentFor: (side) => !!modsFor(side).runeEngravingGems, // Rune of Engraving Gems

    spellsThisTurnFor: (side) => (side === 'player' ? playerState.spellsThisTurn : enemySpellsThisTurn),
    // Rune of Mastery: +1 extra Improve step per copy held (owner 2026-08-27) — the mods field carries the
    // copy count; a legacy snapshot's bare `true` reads as 1 (the classic double).
    improveRepsFor: (side) => {
      const m = modsFor(side).runeMastery;
      return m ? 1 + (typeof m === 'number' ? Math.max(1, m) : 1) : 1;
    },
    // SHOP→COMBAT CARRY-OVER (owner ruling 2026-08-26): consumed once per combat-triggered Shout by
    // `replayCombatBattlecry`. The first Shout gets the whole unspent War Drum multiplier (its own latch),
    // and each of the next N Shouts one extra fire while the carried Warm Embers charges last — the two
    // STACK on the first Shout, mirroring the recruit counter (`playedShoutRepeats`).
    shoutCarryExtras: (side) => {
      let extra = 0;
      const wd = modsFor(side).warDrumExtra;
      if (wd && !warDrumCarrySpent[side]) { warDrumCarrySpent[side] = true; extra += wd; }
      if (shoutDoubleCarryLeft[side] > 0) { shoutDoubleCarryLeft[side] -= 1; extra += 1; }
      // Demand an Encore (R-TURN-01, owner ruling 2026-08-27): a turn-long BUFF, not a charge — every
      // combat-triggered Shout gets the extras, nothing is latched or decremented (mirrors the shop
      // counter's `n += state.shoutExtraTurn` on every played Shout).
      extra += modsFor(side).encoreExtra ?? 0;
      return extra;
    },
    beastsPlayedFor: (side) => (side === 'player' ? playerState.beastsPlayed : enemyBeastsPlayed),
    cardsBoughtThisTurnFor: (side) => (side === 'player' ? playerState.cardsBoughtThisTurn : enemyState.cardsBoughtThisTurn),
    fodderConsumedFor: (side) => (side === 'player'
      ? { attack: playerState.fodderConsumedAtk, health: playerState.fodderConsumedHp }
      : { attack: enemyState.fodderConsumedAtk, health: enemyState.fodderConsumedHp }),
    deathrattleTally: (side) => (side === 'player' ? playerState.deathrattles + playerDeathrattles : enemyDeathrattles),
    log: (event) => {
      emit(event);
    },
    living,
    onBoard,
    withEchoDefer,
    getCard: (id) => {
      const card = cards[id];
      if (!card) throw new Error(`Unknown card: ${id}`);
      return card;
    },
    allCards: () => Object.values(cards),
    // SET-SCOPED draw pool. `poolIds` empty/absent = unrestricted, so the harness and procedural threats are
    // unchanged; a real run pins its set and every random pick below narrows to it.
    poolCards: (side) => {
      const ids = (side === 'player' ? playerState : enemyState).poolIds;
      if (!ids || ids.length === 0) return Object.values(cards);
      const allow = new Set(ids);
      return Object.values(cards).filter((c) => allow.has(c.id));
    },
    buff: (target, attack, health, source, ruby) => {
      // TRANSCENDANT: Engraved as a LIVE ADJACENCY AURA rather than a one-shot grant (owner respec
      // 2026-08-17). Resolved HERE, at the moment stats are gained, which is what makes "while alive and
      // adjacent" literally true: gains made beside a living Transcendant carry back, and gains made after it
      // dies do not. Granting the EG keyword instead would be wrong — the keyword persists, so a single
      // adjacent buff would silently engrave the rest of the fight.
      const transcendant = ((): Minion | undefined => {
        const side = boards[target.side];
        const i = side.indexOf(target);
        if (i < 0) return undefined;
        // `isTribeOf`, not a bare tribe compare — an all-tribes body (Paragon, Lab Experiment) IS a Dragon
        // for every other Dragon check in the engine, so it must be one here too (owner 2026-08-17).
        if (!isTribeOf(target, 'dragon', cards)) return undefined;
        for (const nb of [side[i - 1], side[i + 1]]) {
          if (nb && !nb.dead && nb.health > 0 && nb.cardId === 'd2_transcendence') return nb;
        }
        return undefined;
      })();
      // Golden Taurus doubles every combat stat-gain its engraved neighbours receive (`gainMult`), and a GOLDEN
      // Transcendant does the same for its adjacent Dragons — live rather than stamped, so the doubling stops
      // the moment it dies. The LARGER of the two wins rather than the product: two separate "2x stats" sources
      // should not compound into 4x.
      const gm = Math.max(target.gainMult ?? 1, transcendant?.golden ? 2 : 1);
      if (gm !== 1) { attack *= gm; health *= gm; }
      target.attack = Math.max(0, target.attack + attack); // Attack never drops below 0
      target.health += health;
      if (health > 0) target.maxHealth += health;
      // Spread the flag in only when set, so a non-Ruby buff event keeps its EXACT previous shape — an explicit
      // `ruby: undefined` key would show up in the golden logs and in any deep-equality assertion over events.
      emit({ type: 'buff', target: target.uid, attack, health, source, ...(ruby ? { ruby } : {}) });
      // "Give <tribe> N total stats" (Skybound Pact / Taragosa's Inheritance): every positive combat stat gain on
      // a PLAYER minion counts toward its tribe(s), so combat buffs advance the `tribeStats` quest like recruit
      // ones (owner: Skybound Pact stats in combat should count). Uses the post-gainMult value actually applied.
      if (target.side === 'player') {
        const g = Math.max(0, attack) + Math.max(0, health);
        if (g > 0) for (const t of tribesFor(target)) questTally.statGainByTribe[t] = (questTally.statGainByTribe[t] ?? 0) + g;
      }
      if (transcendant) target.auraEngraved = true; // so the carry-back entry attributes it correctly
      // Engraved: a minion that keeps its combat gains accrues every buff into permaGain, which carries
      // back to the run board after the fight (Flowing Monk records its gift directly for non-Engraved).
      if (target.keywords.includes('EG') || transcendant) {
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
      // Sable's Soulbind: a stat gain on one bound body is gained by the other, in full and ONCE. The mirrored
      // grant re-enters this very function, so `soulbindMirroring` is the load-bearing guard — without it the
      // pair buff each other forever. Player-side only: the bond is forged in the player's shop.
      const bond = modsFor('player').soulbind;
      if (bond && !soulbindMirroring && target.side === 'player' && (attack !== 0 || health !== 0)) {
        // Match on `sourceUid` — the RUN-BOARD uid the bond was forged against. A combat minion is a fresh
        // clone with its own uid (`m0`, `m1`, …), so comparing `m.uid` never matched and the bond did nothing
        // once the fight began: verified byte-identical buff logs with and without a bond (owner 2026-08-21,
        // "it should carry through combat"). `uid` stays in the comparison for synthetic boards (tests, the
        // harness) that set no `sourceUid`.
        const idOf = (m: Minion): string => m.sourceUid ?? m.uid;
        const tid = idOf(target);
        const otherUid = tid === bond.a ? bond.b : tid === bond.b ? bond.a : undefined;
        const partner = otherUid ? boards.player.find((m) => idOf(m) === otherUid && !m.dead) : undefined;
        if (partner) {
          soulbindMirroring = true;
          try { ctx.buff(partner, attack, health, source ?? 'Soulbind', ruby); } finally { soulbindMirroring = false; }
        }
      }
    },
    addTribeAura: (side, tribe, attack, health, source) => {
      tribeAuras.push({ side, tribe, attack, health, source });
      // Telegraph the wash — the run-wide aura is a board-wide event, so it gets the same bloom the recruit
      // phase shows off `auraFxSeq` (owner ask 2026-07-21: Ryme + Deathswarmer, Anubis's Lantern, …). Only a
      // real gain is worth a wave; a 0/0 aura (shouldn't happen) draws nothing.
      // Carry the amounts + the Buffs-panel row this feeds ('undead' Lantern, 'beast' Old Hunt, 'attachment'
      // Scrap Herald) so the UI both washes the board AND ticks that row live. `neutral`/`any` still washes.
      const auraKey = tribe === 'undead' ? 'undead' : tribe === 'beast' ? 'beast' : tribe === 'mech' ? 'attachment' : undefined;
      if (attack !== 0 || health !== 0) emit({ type: 'tribeAura', side, tribe, attack, health, aura: auraKey });
    },
    damage: (target, amount, poison = false, bypassShield = false, source) =>
      dealDamage(target, amount, poison, bypassShield, source),
    // Multi-volley Echo: apply WITHOUT resolving death (overkill), so a captured target keeps reading each
    // volley and its death is held for `resolveEchoDeath` at the end — see the CombatContext doc.
    damageDeferred: (target, amount, source) => applyDamage(target, amount, false, false, source, true),
    resolveEchoDeath: (target, source) => {
      if (target.dead || target.health > 0) return;
      // Inside a multi-fire echo scope, HOLD the death — the outermost `withEchoDefer` flushes the whole set
      // at once after every volley + re-fire, so tokens (Void Cubs) land after all the damage and a low-HP
      // victim reads every volley instead of dying to the first. Outside any scope, resolve immediately.
      if (echoDeferDepth > 0) {
        if (!echoDeferredDeaths.some((d) => d.victim === target)) echoDeferredDeaths.push({ victim: target, killer: source });
      } else killOrReborn(target, source);
    },
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
    wave: withWave,
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
    // The one Echo-multiplier read, shared with the Rally-proc factories (see the CombatContext doc).
    echoExtras: (minion) => playerEchoExtras(minion),
    grantToHand: (cardId, side, sourceUid) => {
      // Combat can't touch the recruit hand directly; record player-side grants so the
      // run loop can add them after the replay (Arcane Weaver → a Spirit Fire copy), and log a
      // `toHand` event so the replay shows the card flying to your hand as it happens.
      if (side === 'player') {
        handGrants.push(cardId);
        emit({ type: 'toHand', cardId, side, source: sourceUid });
        // "A card was added to your hand" — the reactors (Gangplank, Kegheart Dwarf) fire NOW, during the
        // fight, not only at settle (owner report 2026-08-29). This is the one combat chokepoint every
        // grant-to-hand passes through, which is exactly why the trigger belongs here rather than at the
        // dozen call sites that grant.
        //
        // PLAYER-SIDE ONLY, and that is a property of the engine rather than a choice made here: a served
        // enemy board has no hand at all, so `grantToHand` already drops enemy grants two lines up. An enemy
        // Gangplank therefore never reacts — the card never reaches a hand for it to react to.
        emitGainCard(cardId, side);
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
    grantRubies: (count, side, sourceUid) => {
      // Set 2 (Rikk / Gemline) — player-only: mint `count` Rubies into hand after combat (carried back via
      // `playerRubyGrants`, minted with the run's live rubyBonus). Emit a `toHand` per Ruby for the replay.
      if (side !== 'player' || count <= 0) return;
      rubyGrants.n += count;
      // A Ruby IS a card reaching hand — the shop half has fired `onGainCard` per mint since 2026-08-26, so
      // combat matches it: one reactor firing per Ruby, alongside each `toHand`.
      for (let i = 0; i < count; i++) {
        emit({ type: 'toHand', cardId: 'ruby', side, source: sourceUid });
        emitGainCard('ruby', side);
      }
    },
    queueNextTurnSpellCopy: (count, side) => {
      // Player-only (enemies have no run state to arm) — accumulated and carried back via
      // `playerNextTurnSpellCopies`, applied to the run at settle.
      if (side !== 'player' || count <= 0) return;
      nextTurnSpellCopies.n += count;
    },
    gainTavernBuy: (attack, health, side, sourceUid) => {
      if (side !== 'player') return; // enemies have no shop
      tavernBuyGain.attack += attack;
      tavernBuyGain.health += health;
      // Same telegraph as the Imp buff above — it otherwise applies to the NEXT shop with nothing shown here.
      if (sourceUid && (attack !== 0 || health !== 0)) emit({ type: 'sc', source: sourceUid, text: `+${attack}/+${health} Shop` });
    },
    takeRandomHandMinion: (side) => {
      const pool = (side === 'player' ? playerState.handMinions : enemyState.handMinions) ?? [];
      const left = pool.filter((h) => !handSummonedUids.has(h.uid));
      if (left.length === 0) return undefined;
      const pick = left[Math.floor(rng.next() * left.length)]!;
      handSummonedUids.add(pick.uid);
      if (side === 'player') handSummoned.push(pick.uid); // settle removes it from the run hand
      return pick;
    },
    mintRubies: (count, side, sourceUid) => {
      if (side !== 'player' || count <= 0) return; // enemies have no hand
      rubyMintCount += count;
      // The replay sees each Ruby fly to hand on the trigger beat; the actual mint happens at settle through
      // the run's real `mintRubies` (rubyBonus baked in, Candle Conduit fired, hand cap respected).
      for (let i = 0; i < count; i++) emit({ type: 'toHand', cardId: 'ruby', side, source: sourceUid });
    },
    gainRubyBonus: (attack, health, side, sourceUid) => {
      // Set 2 (Veinbreaker / Crownvein) — BOTH sides accumulate, because the value is read live mid-fight
      // (see `rubyBonusFor`): an enemy Crownvein's Rally must grow the enemy's own later Ruby plays too.
      // Only the player half carries back to the run at settle (enemies have no run).
      rubyBonusGain[side].attack += attack;
      rubyBonusGain[side].health += health;
      // Telegraph it mid-combat (it otherwise applies silently at settle) so the player sees the gain, and so the
      // UI has something to hang the Ruby Power FX on at the moment the Echo/Avenge fires rather than at settle.
      // Same channel + text shape as `grantSpellPower` above, so the replay parses both the same way.
      // `side` rides the event: BOTH sides can gain Ruby Power (unlike Spell Power, which is player-only),
      // and the Buffs drawer's live delta must not count an enemy Crownvein's gain into YOUR row.
      if (sourceUid && (attack !== 0 || health !== 0)) emit({ type: 'sc', source: sourceUid, side, text: `+${attack}/+${health} Ruby Power` });
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
    // The echo-trigger chokepoint, exposed so the FORCED-trigger factories (Echohorn / Hawkus / Spots)
    // pay the same "an Echo fired" runes a real death does. Lazily referenced — `asEcho` is declared below
    // this literal and is only ever invoked long after.
    asEcho: (side, fn, source) => { asEcho(side, fn, source); },
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
      // Set-scoped (owner report 2026-07-27: a Set-1 Badgington handed out a Set-2 spell). Reward-exclusive
      // spells (Feed the Alpha) stay excluded via `!token`.
      const pool = ctx.poolCards('player').filter((c) => c.spell && !c.token && c.tier <= playerState.tier);
      for (let i = 0; i < count && pool.length > 0; i++) {
        const pick = pool[Math.floor(rng.next() * pool.length)]!;
        handGrants.push(pick.id);
        emit({ type: 'toHand', cardId: pick.id, side, source: sourceUid });
      }
    },
    grantRandomMinion: (count, tribe, side, exclude, sourceUid, fixedTier, shoutOnly) => {
      if (side !== 'player') return; // enemies have no hand
      // Wayfinder's `tribe: 'uncontrolled'` is a SENTINEL, not a real tribe — "a minion from a tribe you don't
      // control". Resolve it here to the active tribes absent from your board, mirroring `uncontrolledTribes`
      // in the recruit factory. Without this, a combat re-fire (Ryme / Drakko) filtered for a literal tribe
      // `'uncontrolled'`, matched no card, and granted nothing — Wayfinder's Shout silently failed to proc off
      // Ryme (owner report 2026-07-22). Controlling every active tribe (or a single-tribe run) → fall back to any.
      let uncontrolled: Set<string> | null = null;
      if (tribe === 'uncontrolled') {
        // "Controlled" tribes = every tribe on your board, counting DEAD minions too. Ryme is itself dead when
        // its Deathrattle fires this, so skipping the dead would wrongly re-open Ryme's own Undead as
        // "uncontrolled". The recruit `uncontrolledTribes` reads the whole persistent board; match that.
        const onBoard = new Set<string>();
        for (const m of boards.player) {
          const def = cards[m.cardId];
          if (!def) continue;
          for (const t of [def.tribe, def.tribe2]) if (t && t !== 'neutral') onBoard.add(t);
        }
        const missing = playerState.tribes.filter((t) => t !== 'neutral' && !onBoard.has(t));
        uncontrolled = missing.length > 0 ? new Set(missing) : null;
      }
      const inTribe = (c: (typeof cards)[string]): boolean =>
        uncontrolled
          ? uncontrolled.has(c.tribe) || (!!c.tribe2 && uncontrolled.has(c.tribe2)) || !!c.universalTribe
          : !tribe || tribe === 'uncontrolled' || c.tribe === tribe || c.tribe2 === tribe || !!c.universalTribe;
      // Same as spells but for the buyable-minion pool (tribe-filtered, ≤ tavern tier, active tribes only).
      const pool = ctx.poolCards('player').filter(
        (c) =>
          !c.token && !c.spell && (fixedTier ? c.tier === fixedTier : c.tier <= playerState.tier) && c.id !== exclude &&
          (c.tribe === 'neutral' || playerState.tribes.includes(c.tribe)) &&
          inTribe(c) &&
          // Roarcollector: restrict to SHOUT minions — a real (non-silent) `onPlay`.
          (!shoutOnly || c.effects.some((e) => e.on === 'onPlay' && !SILENT_ONPLAY.has(e.do))),
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
      if (side === 'player') {
        impBuffGain.attack += attack; impBuffGain.health += health;
        // Imps are Demons — a demon board-wash + a live 'imp' row tick (owner report 2026-07-21: neither played
        // in combat because this granted the buff silently).
        if (attack !== 0 || health !== 0) emit({ type: 'tribeAura', side, tribe: 'demon', attack, health, aura: 'imp' });
      }
      // NO `sc` telegraph here on purpose: the `tribeAura` emit above ALREADY drives the board aura-wash in the
      // replay, so adding one would double-cue the same gain. The Imp path was never silent — only the Shop one.
    },
    grantRightmostSlotBuff: (attack, health, side) => {
      // Player-side only — the enemy shop is regenerated each wave, so its slot buff would never be read.
      if (side === 'player') { rightmostSlotGain.attack += attack; rightmostSlotGain.health += health; }
    },
    queueNextSummonBuff: (side, tribe, attack, health) => {
      if (attack > 0 || health > 0) nextSummonBuffs[side].push({ tribe, attack, health });
    },
    zooReps: (side) => (modsFor(side).runeZoo ? Math.max(1, summonOrdinal[side]) : 1),
    grantMagneticBuff: (attack, health, side) => {
      if (side !== 'player') return; // enemies have no run state to carry an Attachment aura back into
      magneticBuffGain.attack += attack;
      magneticBuffGain.health += health;
      // Attachments are Mechs — the same board-wash the Mech aura channel plays in the shop, so the grant is
      // visible in combat instead of landing silently (the Imp-aura lesson, owner report 2026-07-21).
      if (attack !== 0 || health !== 0) emit({ type: 'tribeAura', side, tribe: 'mech', attack, health, aura: 'magnetic' });
    },
    impAura: (side) => ({ ...impAura[side] }), // Chef Raag reads the live Imp Aura to buff your minions by it
    // CONDUCTOR: the run's snowball, per side — read-only in combat (a re-fire is a trigger, not a play).
    conductorTally: (side) => (side === 'player' ? playerState.conductorBuff : enemyState.conductorBuff) ?? 0,
    grantFodderBuff: (attack, health, side) => {
      if (side !== 'player') return; // enemies have no run state
      fodderBuffGain.attack += attack;
      fodderBuffGain.health += health;
      if (attack !== 0 || health !== 0) emit({ type: 'tribeAura', side, tribe: 'demon', attack, health, aura: 'fodder' });
    },
    gainBeastExtra: (hunt, ritual, side, sourceUid) => {
      beastExtraGain[side].hunt += hunt;
      beastExtraGain[side].ritual += ritual;
      if (sourceUid && (hunt !== 0 || ritual !== 0)) {
        const what = hunt !== 0 ? 'Rallies' : 'Echoes';
        emit({ type: 'sc', source: sourceUid, text: `your Beast ${what} trigger +${hunt || ritual} more` });
      }
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
      emit({ type: 'spellcast', side, count: spellTotals[side] }); // the replay's live-counter beat
      // Rune of Enchantment: a COMBAT cast gives your minions +4/+6 (the shop half gives the printed +2/+3 —
      // see the recruit tail). Temporary like any combat buff; the shop grant is the permanent half.
      // AFTER the counter beat, so the replay's tick and the buff land in the order they read. (owner 2026-08-11)
      const ench = modsFor(side).runeEnchantment;
      if (ench) {
        fireTrigger('runeEnchantment', side); // burst on the combat cast too, like every other combat rune
        // +4/+6 per copy held (the mods field carries the copy count; a legacy `true` reads as 1).
        const en = typeof ench === 'number' ? Math.max(1, ench) : 1;
        for (const m of boards[side]) if (!m.dead && m.health > 0) ctx.buff(m, 4 * en, 6 * en, 'Rune of Enchantment');
      }
      bus.emit('spellCast', { side, count: spellTotals[side] });
    },
    spellstoneFor: (side) => !!modsFor(side).runeSpellstone,
    groveweaverSelfFor: (side) => !!modsFor(side).runeGroveweaver,
    broodmasterSelfFor: (side) => !!modsFor(side).runeBroodmaster,
    floodedVaultFor: (side) => !!modsFor(side).runeFloodedVault,
    battleRefractionRepsFor: (side) => {
      // Rune of Battle Refraction: each living Prismcaster repeats a combat Ruby once (golden twice) — the
      // shop-side `rubyExtraCast` convention, read live so a Prismcaster that died stops paying.
      if (!modsFor(side).runeBattleRefraction) return 0;
      return living(side).reduce((n, m) => n + (m.cardId === 'k_prismcaster' ? (m.golden ? 2 : 1) : 0), 0);
    },
    growthBonusFor: (side) => (side === 'player' ? playerState : enemyState).growthBonus ?? 0,
    alesLastTurnFor: (side) => (side === 'player' ? playerState : enemyState).alesLastTurn ?? 0,
    crit: (sourceUid, mult) => emit({ type: 'proccrit', source: sourceUid, mult }),
    spellCastRepsFor: (side) => 1 + spellCastExtra[side],
    grantSpellCastExtra: (side, n) => { spellCastExtra[side] += n; },
    lastSpellCastFor: (side) => (side === 'player' ? playerState : enemyState).lastSpellCastId,
    onCombatSpellCast: (side) => {
      // RUNE OF SHARED SCRIPTURE: the warband's FIRST Shop-spell cast in a fight fires the left-most Shout and
      // the left-most Rally. Reported from `resolveCombatSpellCast`, so it counts a cast that actually
      // RESOLVED — a fizzled aim (no legal target) is not a cast, and must not spend the rune.
      if (!modsFor(side).runeSharedScripture || scriptureSpent[side]) return;
      const shout = living(side).find((m) => m.effects.some((e) => e.on === 'onPlay'));
      const rally = living(side).find((m) => canRally(m));
      if (!shout && !rally) return;
      scriptureSpent[side] = true;
      nextStep(); fireTrigger('runeSharedScripture', side);
      if (shout) {
        // q-interact-combat-shout-multipliers (owner APPROVE 2026-08-27): the rune's forced Shout folds the
        // Battlecry multipliers (Drakko) like every other combat Shout re-fire (Ryme / Sovereign / Dawnclaw).
        const reps = drakkoRepeats(ctx, side);
        for (let r = 0; r < reps; r++) {
          emit({ type: 'sc', source: shout.uid, text: 'Shout' });
          for (const effect of shout.effects) {
            if (effect.on !== 'onPlay') continue;
            withEffect(shout, effect, () => FACTORIES[effect.do]?.(ctx, shout, effect.params ?? {}, { minion: shout, side }));
          }
        }
      }
      if (rally) fireFreeRally(rally, side);
    },
    rememberedSpellsFor: (side) => (side === 'player' ? playerState : enemyState).rememberedSpellIds ?? [],
    resummonDeadBeasts: (side, count, excludeUid) => {
      // Earliest-first, skipping the caller's own corpse ("other Beasts") and anything already brought back,
      // so a second Colossus Echo doesn't re-raise the same three. `summonMinion` is the shared placement
      // chokepoint, so each returning body fires onSummon, collects tribe auras and respects the 7-slot cap.
      let brought = 0;
      // SNAPSHOT the graveyard before summoning. A resummoned body can die again inside this very loop (it
      // lands in front of a lethal attacker), which pushes a fresh corpse onto `deadBeasts[side]` — iterating
      // the live array therefore feeds itself and never terminates. Caught by the two-Colossi test, which
      // raised 66 bodies instead of 2.
      for (const rec of [...deadBeasts[side]]) {
        if (brought >= count) break;
        if (rec.uid === excludeUid || resummonedUids.has(rec.uid)) continue;
        if (living(side).length >= 7) break;
        const def = cards[rec.cardId];
        if (!def) continue;
        resummonedUids.add(rec.uid);
        // Rune of the Old Pack: bring the FIRST resummoned Beast back at its full (pre-death) stats, not base.
        // One full-stat return per copy held (boolean-flag family, owner 2026-08-27).
        const copyStats = modsFor(side).oldPack && oldPackUsed[side] < flagCopiesOf(side, 'oldPack') && rec.attack !== undefined && rec.maxHealth !== undefined
          ? { attack: rec.attack, health: rec.maxHealth, maxHealth: rec.maxHealth } : undefined;
        if (copyStats) { oldPackUsed[side] += 1; fireTrigger('oldPack', side); }
        raisedBodies.add(summonMinion(side, def, undefined, undefined, rec.golden, false, copyStats).uid);
        brought += 1;
      }
      return brought;
    },
    triggerRally: (m) => fireFreeRally(m, m.side),
    queueDiscoverCast: (spellId, side) => { if (side === 'player') discoverCasts.push(spellId); },
    gainNextShopBuff: (attack, health, side) => {
      if (side !== 'player') return;
      nextShopBuffGain.attack += attack;
      nextShopBuffGain.health += health;
    },
    matriarchRepsFor: (side) => (modsFor(side).runeMatriarch ? 2 : 1),
    baneDemonWidenFor: (side) => modsFor(side).baneDemonWiden,
    activeTribesFor: (side) => (side === 'player' ? playerState : enemyState).tribes,
    mammothHealthFor: (side) => !!modsFor(side).runeMammoth,
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
   * Dispatch `onSummon` to every LIVING watcher in CURRENT board order, left→right, summoning side first
   * (owner ruling 2026-08-12: after the auras land, the augmenting triggers — Beardsley / King Oona /
   * Groveweaver — fire in board order). Replaces the bus broadcast for this event, whose order was
   * REGISTRATION order and drifted from the visible board as bodies re-slotted and summoned mid-fight.
   *
   * Mirrors the `registerEffect` wrapper's guards for this event: a dead watcher fires nothing, an
   * alignment-gated half stays inert off its side of the sky (alignment is locked at setup, so the
   * per-fire check equals the registration-time one), and iterating each watcher's CURRENT `effects`
   * self-disables handlers an ascension swapped out. Boards are snapshotted so a watcher that summons
   * mid-dispatch can't reshuffle the iteration.
   */
  function emitOnSummonOrdered(minion: Minion, side: Side): void {
    const payload = { minion, side };
    for (const s of [side, side === 'player' ? 'enemy' : 'player'] as Side[]) {
      for (const w of [...boards[s]]) {
        if (w.dead || w.health <= 0) continue;
        for (const effect of [...w.effects]) {
          if (effect.on !== 'onSummon') continue;
          const fn = FACTORIES[effect.do];
          if (!fn) continue;
          if (!alignAllows(effect, w.align)) continue;
          withEffect(w, effect, () => fn(ctx, w, effect.params ?? {}, payload));
        }
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
    // Echo summons (a Deathrattle is resolving right now): Rune of the Undertow routes the body onto the
    // immediate-attack queue so it lands + strikes as one beat (the Whelp path). Rune of Aftershocks no
    // longer touches the summon — as of 2026-07-21 it buffs your whole board when an Echo TRIGGERS (see asEcho).
    // (Rune of the Undertow's old echo-summons-attack-immediately behaviour lived here; the 2026-07-31
    // rework grants combat summons WARD instead — see the grant beside the Living Treasure graft below.)
    // Rune of the Hatchery: bodies summoned IN COMBAT come in +3/+3 with Taunt. Applied at the summon site so
    // it lands before the summon snapshot — the replay shows the real body, not the base card.
    //
    // Owner rework 2026-08-03: this used to be gated on `echoDepth > 0` (Echo summons only), which made it
    // dead weight for every summon line that isn't a Deathrattle — Start-of-Combat fills, Rally summons,
    // token generators. Now it covers every combat summon, matching Rune of the Undertow just below (which
    // grants Ward on the same "summoned in combat" scope).
    const hatch = modsFor(side).runeHatchery;
    if (hatch) {
      fireTrigger('runeHatchery', side); // owner call 2026-08-19: a continuous modifier bursts on each body it buffs
      minion.attack += hatch.attack;
      minion.health += hatch.health;
      minion.maxHealth = Math.max(minion.maxHealth ?? minion.health, minion.health);
      if (!minion.keywords.includes('T')) minion.keywords.push('T');
    }
    // Rune of Packcraft (owner rework 2026-08-04): bodies summoned IN COMBAT come in +6/+6. Applied here, next
    // to the Hatchery grant, for the same two reasons: it lands before the summon snapshot (so the replay shows
    // the real body rather than the base card), and it is in place before the token can attack — a Whelp or a
    // Gemheart Golem that strikes the instant it lands would otherwise swing at its base Attack.
    //
    // It USED to be an `onSummon` bus listener that buffed your whole Beast line whenever a Beast was summoned.
    // That shape can't express "the minion you summoned gets +6/+6": by the time `onSummon` fires the body is
    // already on the board and already snapshotted, and the old version was tribe-gated besides.
    if (modsFor(side).runePackcraft) {
      fireTrigger('runePackcraft', side); // as Hatchery — owning both pops both badges on the same summon, which is true
      // +6/+6 per copy held (boolean-flag family, owner 2026-08-27).
      const pk = 6 * flagCopiesOf(side, 'runePackcraft');
      minion.attack += pk;
      minion.health += pk;
      minion.maxHealth = Math.max(minion.maxHealth ?? minion.health, minion.health);
    }
    // Heart of the Mountain: Gemheart Golems attack the instant they land, riding the same `attackNow` queue
    // the Whelp and Rune of the Undertow use — so the summon and its strike land as one beat.
    if (modsFor(side).gemheartCharge && card.id === 'gemheart-shard') attackNow = true;
    // RUNE OF THE SPARE CHAIR: a board that started FULL-but-one (exactly 6) has kept a seat open, and the
    // first body to take it arrives Warded and swinging. `startCount` is the start-of-combat size, so a board
    // that reaches 6 by losing a minion mid-fight doesn't qualify — "begin combat with exactly 6".
    // One qualifying summon per copy held (boolean-flag family, owner 2026-08-27).
    if (modsFor(side).runeSpareChair && spareChairUsed[side] < flagCopiesOf(side, 'runeSpareChair') && startCount[side] === 6) {
      spareChairUsed[side] += 1;
      attackNow = true;
      grantKeywords = [...(grantKeywords ?? []), 'DS'];
      fireTrigger('runeSpareChair', side);
    }
    // Rune of Living Treasure: your Gemheart Golems enter with Rise — the keyword IS "summon an exact copy of
    // this without Echo", so this reuses Rise rather than stamping a bespoke Deathrattle onto the token.
    // Rune of the Food Chain: the FIRST body summoned this combat inherits the captured Demon stats.
    const fc = foodChainStats[side];
    if (fc) {
      foodChainStats[side] = undefined; // spent — first summon only
      minion.attack += fc.attack;
      minion.health += fc.health;
      minion.maxHealth = Math.max(minion.maxHealth ?? minion.health, minion.health);
    }
    // Rune of the Undertow (owner sheet 2026-07-31): minions summoned in combat arrive with Ward. Granted
    // BEFORE the summon event is emitted, so the snapshot carries the shield from the first frame.
    // RUNE OF THE UNDERTOW — capped at 4 Wards a combat (owner ruling 2026-08-08; it was unbounded, so a
    // token engine warded its whole cascade). Per side and per fight, counting only the bodies that actually
    // TAKE a Ward: a summon that already had one costs nothing from the allowance.
    const undertow = modsFor(side).runeUndertow;
    if (undertow && !minion.divineShield && undertowUsed[side] < (typeof undertow === 'number' ? undertow : 4)) {
      fireTrigger('runeUndertow', side);
      undertowUsed[side] += 1;
      minion.divineShield = true;
      if (!minion.keywords.includes('DS')) minion.keywords.push('DS');
    }
    if (modsFor(side).runeLivingTreasure && card.id === 'gemheart-shard') {
      fireTrigger('runeLivingTreasure', side);
      // Rune of Living Treasure grafts the EXACT-COPY Echo (Exgalloper's), not Rise. It shipped as Rise on the
      // theory that "Rise IS summon an exact copy" — but Rise resummons the PRINTED body, so a 7/3 shard came
      // back a 1/1 (owner report 2026-07-31); the Echo copies current stats. Being a real `onDeath` effect
      // also means every Echo-amplifier (Sylus, Echohorn Stag) now applies. The chain terminates the same way
      // Exgalloper's does: the factory strips ALL onDeath effects from the copy it summons — including this
      // graft, which lands first (this line runs during the copy's summon) — and a stripped effect
      // self-disables via the `minion.effects.includes` guard in `registerEffect`.
      // Push ONLY — no explicit registerEffect: `registerEffects(minion)` below registers everything in
      // `minion.effects`, and registering here too subscribed the Echo TWICE (it summoned two copies per death,
      // caught by the chain-termination test).
      const eff: EffectDef = { on: 'onDeath', do: 'echoSummonCopyNoEcho', params: {} };
      minion.effects = [...minion.effects, eff];
    }
    // Aug-11 minion-grant runes — Ward/Taunt on a specific summoner's token. `nearUid` is the summoner's uid
    // (combatArena.summonToken passes self.uid), so these scope to "summoned by your Imp Wranglers / Geode
    // Guardians" rather than every Imp / Golem. Granted before the summon snapshot so the keyword shows frame 1.
    if ((modsFor(side).runeWrangler && card.id === 'impscrap') || (modsFor(side).runeLivingGeode && card.id === 'gemheart-shard')) {
      const summoner = nearUid ? boards[side].find((m) => m.uid === nearUid) : undefined;
      const wardOnly = card.id === 'gemheart-shard' && summoner?.cardId === 'k_geode';
      const wardTaunt = card.id === 'impscrap' && summoner?.cardId === 'dm_wrangler';
      if (wardOnly || wardTaunt) {
        // Two runes share this guard; attribute by which one actually granted, so the right badge bursts.
        fireTrigger(wardTaunt ? 'runeWrangler' : 'runeLivingGeode', side);
        minion.divineShield = true;
        if (!minion.keywords.includes('DS')) minion.keywords.push('DS');
        if (wardTaunt && !minion.keywords.includes('T')) minion.keywords.push('T');
      }
    }
    // Attack-on-summon tokens (Whelp; Steadfast Champion's Spear Warden via `attackNow`) DEFER their whole
    // summon: rather than land + announce here, they queue onto the immediate-attack queue and are placed at
    // the next flushImmediateAttacks — i.e. AFTER the current clash's death cascade fully resolves. So the
    // token's `summon` event and its out-of-turn strike land together, as one discrete beat, never interleaved
    // with the other units' deaths/Deathrattles in the same clash (owner ruling 2026-07-10). Consequence: the
    // token is OFF the board for the rest of the cascade, so a same-clash Deathrattle can no longer buff it
    // before it exists — which also keeps the buff/summon event order consistent for the UI's computeFrame.
    if (card.attackOnSummon || attackNow) {
      // Board-cap enforced at QUEUE time, not flush time (owner bug 2026-08-11): a Rally/Echo that summons an
      // attack-on-summon token while the board is FULL must fail NOW. Previously the summon sat on the queue and
      // was placed at the next flushImmediateAttacks — which runs AFTER the current clash's death cascade, so the
      // attacker's own death freed the slot and a summon that should have been rejected instead landed (reported:
      // Echohorn on a full board triggers Chicken Brawl's Echo, dies, and the Charging Soldier appears anyway).
      // When there's no room, run placeSummon inline: it emits summonOverflow (+ the Rune of Overflow payoff) and
      // no-ops, exactly like a plain over-cap summon — the token is simply lost, board stays full.
      if (living(side).length >= 7) {
        return placeSummon(minion, side, card, nearUid, grantKeywords, golden, attackNow, copyStats, doubled);
      }
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
      // Rune of Overflow: a summon that does not fit buffs your whole board PERMANENTLY. Buffed live here so it
      // matters this fight, and banked for the carry-back so it survives the settle — the word "permanently" is
      // the whole card, and a combat-only buff would silently drop it.
      const ov = modsFor(side).runeOverflow ?? 0;
      if (ov > 0) {
        nextStep(); fireTrigger('runeOverflow', side);
        for (const m of boards[side]) if (!m.dead && m.health > 0) ctx.buff(m, ov, ov, 'Rune of Overflow');
        if (side === 'player') { boardBuffGain.attack += ov; boardBuffGain.health += ov; }
      }
      return minion;
    }
    const arr = boards[side];
    let index = arr.length;
    if (nearUid) {
      const near = arr.findIndex((x) => x.uid === nearUid);
      if (near >= 0) index = near + 1;
    }
    arr.splice(index, 0, minion);
    // AVENGE COUNTS FROM ARRIVAL (owner report 2026-08-24): a minion SUMMONED mid-combat must not inherit the
    // side's running death tally, or an Avenge body summoned onto a board that has already lost N minions fires
    // the instant it lands — Bullseye/Mammoth rolling a 7/7 Solaris that immediately Wards + strikes, or a
    // summoned Dunkey instantly summoning an Armadiyo. It is the SAME rule a Rise already uses (see
    // `avengeBaseline` at the killOrReborn site): everything before this body existed is not its progress.
    // The initial board never reaches placeSummon, so start-of-fight minions keep baseline 0 and count from the
    // opening — exactly as before.
    minion.avengeBaseline = deaths[side];
    if (!copyStats) applyAuras(minion, true); // a plain summon starts from base; an exact copy already carries its final stats
    // SOLID GROUND (spell): the first N minions YOU summon this fight land bigger. Counted down per body, so a
    // wave of tokens spends it in arrival order and the 4th arrives plain.
    // Side-general: it is the SUMMONING side's own banked charges that pay.
    const sg = modsFor(side);
    if ((sg.solidGroundLeft ?? 0) > 0) {
      const amt = sg.solidGroundStat ?? 4;
      sg.solidGroundLeft = (sg.solidGroundLeft ?? 0) - 1;
      ctx.buff(minion, amt, amt, 'Solid Ground');
    }
    // CONTAINMENT RUNE (spell): the FIRST body the OPPOSING side summons is pinned to 1/1 — the flag lives on
    // the CASTER's mods and fires on their opponent's summon. One-shot: spent on that summon whatever it was,
    // which is the gamble (a throwaway token can eat it).
    const foeMods = modsFor(OTHER[side]);
    if (foeMods.containFirstEnemySummon) {
      foeMods.containFirstEnemySummon = false;
      minion.attack = 1;
      minion.health = 1;
      minion.maxHealth = 1;
      emit({ type: 'sc', source: minion.uid, text: 'Contained (1/1)' });
    }
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
    summonEntryEffects(minion, side);
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

  /**
   * Everything that fires when a minion ENTERS PLAY — the single summon-entry suite, called from BOTH the
   * normal placement chokepoint (`placeSummon`) and the Rise return (`killOrReborn`). A minion that Rises IS
   * a summon (owner ruling 2026-08-12, closing the earlier "quest count only" carve-out): it fires onSummon
   * watchers (Beardsley / King Oona / Groveweaver / Broodwright), advances the Zoo ordinal and the Remains
   * counter, collects Emberline's bank, can be Second Litter's first Beast, and takes Savagery / Jungle /
   * Wolvie — exactly like any other body entering play.
   */
  /** Summoning Bulwark: the first N bodies each side summons this combat gain Taunt. Decremented on the GRANT
   *  (a body that already has Taunt does not burn one), so the spell delivers N Taunts, not N attempts. */
  const summonTauntsLeft: Record<Side, number> = {
    player: playerState.questMods?.summonTaunts ?? 0,
    enemy: enemyState.questMods?.summonTaunts ?? 0,
  };
  function summonEntryEffects(minion: Minion, side: Side): void {
    if (summonTauntsLeft[side] > 0 && !minion.dead && !minion.keywords.includes('T')) {
      summonTauntsLeft[side] -= 1;
      minion.keywords.push('T');
      emit({ type: 'keyword', target: minion.uid, keyword: 'T' });
    }
    summonOrdinal[side] += 1; // before onSummon fires, so Rune of the Zoo reads THIS summon's ordinal
    if (side === 'player') {
      bumpQuestTally('summonCombat', minion); // "Summon N minions in combat" quests
      // Rune of the Remains / Rune of Reinvestment both key off friendly summons. Counted here, at the single
      // entry chokepoint, so a token, a Rise and a resummon all count exactly once each.
      if (minion.side === 'player') {
        playerSummonCount += 1;
        const remains = modsFor('player').runeRemains ?? 0;
        if (remains > 0 && playerSummonCount % 5 === 0) {
          fireTrigger('runeRemains', 'player');
          ctx.gainTavernBuy(remains, remains, 'player');
        }
      }
      if (cards[minion.cardId]?.imp) { playerImpsSummoned += 1; questEvents.push({ step: stepN, kind: 'summonImp', tribes: [] }); } // Imp Census / Implosion / Pit Without End
    }
    // RUNE OF THE RETURNING PACK: every Nth BEAST you summon this combat hands over a random Beast next shop.
    // Counted at this single summon chokepoint, so a token, a Rise and a resummon each count exactly once —
    // the same contract the Remains / Reinvestment counters above rely on. Player-only: `grantRandomMinion`
    // rides `playerHandGrants`, and a served enemy has no hand.
    const packN = side === 'player' ? (modsFor('player').runeReturningPack ?? 0) : 0;
    if (packN > 0 && minion.side === 'player'
        && (minion.tribe === 'beast' || minion.tribe2 === 'beast' || !!cards[minion.cardId]?.universalTribe)) {
      packSummonTick.player += 1;
      if (packSummonTick.player % packN === 0) {
        fireTrigger('runeReturningPack', 'player');
        // Same 6-summon meter, one Beast per copy held (owner revise 2026-08-27: "2 rune of the returning
        // pack, every 6 beast summons you'd get 2 random beasts").
        ctx.grantRandomMinion(flagCopiesOf('player', 'runeReturningPack'), 'beast', 'player', undefined, minion.uid);
      }
    }
    // RUNE OF EMBERLINE, the paying half: the next Imp to arrive inherits the banked stats, once per combat.
    if (modsFor(side).runeEmberline && !emberlinePaid[side] && emberlineBank[side] && cards[minion.cardId]?.imp
        && !minion.dead) {
      const bank = emberlineBank[side]!;
      emberlinePaid[side] = true;
      fireTrigger('runeEmberline', side);
      // The banked stats land once per copy held (boolean-flag family, owner 2026-08-27).
      const el = flagCopiesOf(side, 'runeEmberline');
      ctx.buff(minion, bank.attack * el, bank.health * el, 'Rune of Emberline');
    }
    // ── ORDER (owner ruling 2026-08-12) ──────────────────────────────────────────────────────────────────
    // AURAS FIRST: the "wherever they are" buffs (Grim / Kennelmaster / Solaris) are always-present state, so
    // they land on the arriving body before ANY augmenting trigger reads it. A 0/2 Void Cub arriving after
    // Grim died becomes 8/10 FIRST — and only then do Oona / Savagery / Jungle double the grown stats. (Oona
    // used to fire off the pre-aura body because the onSummon bus ran before the aura pass.)
    applyTribeAuras(minion);
    // …THEN the augmenting onSummon watchers, in CURRENT board order left→right (bus order was registration
    // order, which drifts from the visible board as bodies re-slot and summon).
    emitOnSummonOrdered(minion, side);
    // RUNE OF THE SECOND LITTER: the FIRST Beast summoned each combat summons another copy. `doubled: true`
    // on the copy is the standard no-recursion guard (Echo Warden's) — the copy must not itself be "the first
    // Beast" and spawn a third. Fired after the triggers so the copy is made from the body as it landed.
    if (modsFor(side).runeSecondLitter && !secondLitterUsed[side] && !minion.dead
        && (minion.tribe === 'beast' || minion.tribe2 === 'beast' || !!cards[minion.cardId]?.universalTribe)) {
      const def = cards[minion.cardId];
      if (def) {
        secondLitterUsed[side] = true;
        fireTrigger('runeSecondLitter', side);
        // One extra copy per rune copy held (boolean-flag family, owner 2026-08-27). `doubled: true` still
        // keeps every copy from counting as "the first Beast".
        for (let k = 0; k < flagCopiesOf(side, 'runeSecondLitter'); k++) {
          summonMinion(side, def, minion.uid, [...minion.keywords], !!minion.golden, false,
            { attack: minion.attack, health: minion.maxHealth ?? minion.health, maxHealth: minion.maxHealth ?? minion.health }, true);
        }
      }
    }
    // RUNE OF SAVAGERY: a Beast summoned in combat doubles its Attack — applied LAST, after the summon
    // watchers and the tribe auras have paid out (owner ruling 2026-08-07).
    //
    // It used to run FIRST, which is why the rune read as doing nothing: the body was doubled at its bare
    // arrival stats, then Groveweaver's +3/+3 and every aura landed on top un-doubled. A Beast arriving 1/1
    // beside a Groveweaver went 1 → 2 → 5 Attack, when the rune's whole point is that it should go
    // 1 → 4 → 8. Doubling last is what makes it compose with the summon payoffs it is meant to reward.
    if (modsFor(side).runeSavagery && minion.attack > 0 && !minion.dead
        && (minion.tribe === 'beast' || minion.tribe2 === 'beast' || !!cards[minion.cardId]?.universalTribe)) {
      fireTrigger('runeSavagery', side);
      // One doubling per copy held (boolean-flag family, owner 2026-08-27) — each reads the grown Attack.
      for (let k = 0; k < flagCopiesOf(side, 'runeSavagery'); k++) ctx.buff(minion, minion.attack, 0, 'Rune of Savagery');
    }
    // RUNE OF THE JUNGLE: a Beast summoned in combat doubles its Health. Sibling of Savagery (Attack), applied
    // here so it composes with the summon payoffs; `minion.health` (current) is added again to double it.
    if (modsFor(side).runeJungle && minion.health > 0 && !minion.dead
        && (minion.tribe === 'beast' || minion.tribe2 === 'beast' || !!cards[minion.cardId]?.universalTribe)) {
      fireTrigger('runeJungle', side);
      // One doubling per copy held (boolean-flag family, owner 2026-08-27) — each reads the grown Health.
      for (let k = 0; k < flagCopiesOf(side, 'runeJungle'); k++) ctx.buff(minion, 0, minion.health, 'Rune of the Jungle');
    }
    // WOLVIE (Echo): a queued next-summon buff pays this body if its tribe matches. Applied after auras/Savagery
    // so it stacks on the final body.
    applyNextSummonBuff(minion, side);
  }

  // Runs `run()` as an ECHO (Deathrattle) trigger. The `echoDepth` counter that used to live here — marking
  // "a Deathrattle is resolving right now" so summons inside it could be treated as Echo summons — is gone as
  // of 2026-08-03: Aftershocks stopped reading it in the 2026-07-21 rework (it buffs on TRIGGER now, not on
  // summon), Undertow moved to all combat summons, and the Hatchery rework removed its last reader. Rather
  // than leave a counter nothing consults, it is deleted; the wrapper still exists for the Aftershocks grant.
  const asEcho = (side: Side, run: () => void, source?: Minion): void => {
    {
      run();
      // RUNE OF THE BURROW (owner rework 2026-08-19): triggering a BEAST's Echo banks a free Shop refresh.
      // It rides the echo chokepoint rather than the death site, so an Echo forced by Echohorn / Hawkus /
      // Spots / Rune of the Herald — no death involved — pays exactly like one that came from dying. (Those
      // forced paths reached this chokepoint only from 2026-08-20; before that they fired the `onDeath`
      // factories directly. The Reliquary is NOT among them — its trigger is an End-of-Turn recruit effect,
      // and this rune, like Aftershocks, is combat-scoped.) `fireTrigger` bursts the rune's badge (#1102) —
      // it now fires on forced Echoes too, which is the point: the badge should burst whenever it pays.
      // One free refresh per copy held (boolean-flag family, owner 2026-08-27).
      if (source && modsFor(side).runeBurrow && isBeast(source)) { fireTrigger('runeBurrow', side); ctx.grantFreeRolls(flagCopiesOf(side, 'runeBurrow'), side); }
      // RUNE OF GRAVE REFRESHMENT: every Nth friendly Echo TRIGGER banks a free Shop refresh for next turn.
      // The same chokepoint as the Burrow above (not the death site), so a forced Echo — Echohorn, Hawkus,
      // Spots, the Herald — counts exactly like one that came from dying. The meter is combat-local: it
      // measures "in combat", so it starts fresh each fight rather than banking a remainder across the course.
      const graveN = modsFor(side).runeGraveRefreshment ?? 0;
      if (graveN > 0) {
        echoRefreshTick[side] += 1;
        // Same meter, one refresh per copy held (threshold family, owner revise 2026-08-27: doubled OUTPUT).
        if (echoRefreshTick[side] % graveN === 0) { fireTrigger('runeGraveRefreshment', side); ctx.grantFreeRolls(flagCopiesOf(side, 'runeGraveRefreshment'), side); }
      }
      // WRAP ONE ECHO **TRIGGER** — never one EFFECT and never one WATCHER. Aftershocks grants +4/+4 to the
      // whole board here, so every extra wrap is a whole extra board buff. Both ways of getting that wrong
      // shipped and produced the owner's "continuously triggers after attacks" (2026-08-09):
      //   · a body with TWO onDeath effects paid twice per trigger (the loops below now wrap once, outside);
      //   · every board minion holding any onDeath effect paid on EVERY death, because the bus broadcasts to
      //     all watchers and each factory self-filters AFTER being called — so N rattle-bodies meant N grants
      //     per death, of which N-1 did nothing at all.
      // Rune of Aftershocks (reworked 2026-07-21): TRIGGERING an Echo gives your minions +4/+4 (it used to
      // bake +4/+4 into Echo-summoned bodies instead). Fires after the Echo resolves, so a body it summoned is
      // already on the board and shares the grant. Per side; a nested Echo is its own trigger.
      if (modsFor(side).runeAftershocks) {
        fireTrigger('runeAftershocks', side); // pulse the rune's badge when its Echo grant fires
        // +4/+4 per copy held (boolean-flag family, owner 2026-08-27).
        const as4 = 4 * flagCopiesOf(side, 'runeAftershocks');
        for (const m of boards[side]) if (!m.dead && m.health > 0) ctx.buff(m, as4, as4, 'Rune of Aftershocks');
      }
    }
  };

  /** The Burning Legion's per-side use counter. */
  const burningLegionSpent: Record<string, number> = {};
  /** Can this body take a FREE rally — a card Rally, a welded Mech rally, or a welded spell rally? */
  const canRally = (m: Minion): boolean => {
    if (m.dead || m.health <= 0) return false;
    return (m.keywords.includes('RL') && m.effects.some((e) => e.on === 'onAttack'))
      || (m.rallyMechAtk ?? 0) > 0 || (m.rallySpellWeld ?? 0) > 0;
  };

  /**
   * Fire one minion's Rally WITHOUT an attack. Extracted from Rune of Rallying (2026-07-30) so the Hunting
   * Bell's Avenge-paced rally is the same thing rather than a near-copy — the tally bump below was already
   * missed once in the original (audit 2026-07-21), and a second hand-rolled copy would drift the same way.
   * Callers own the `nextStep()` and the badge pulse; this owns what a rally IS.
   */
  const fireFreeRally = (minion: Minion, side: Side): void => {
    emit({ type: 'sc', source: minion.uid, text: 'Rally' });
    // A free rally is still a Rally TRIGGER — it counts toward the Rally quests and the Author's Hand rally
    // half exactly like an attack-path rally. Player-only, like every tally.
    if (side === 'player') bumpRally(1);
    if (minion.keywords.includes('RL') && minion.effects.some((e) => e.on === 'onAttack')) {
      for (const effect of minion.effects) {
        if (effect.on !== 'onAttack') continue;
        withEffect(minion, effect, () => FACTORIES[effect.do]?.(ctx, minion, effect.params ?? {}, { minion, side: minion.side }));
      }
    }
    if ((minion.rallyMechAtk ?? 0) > 0) {
      for (const m of boards[side]) {
        if (!m.dead && m.health > 0 && m !== minion && (m.tribe === 'mech' || m.tribe2 === 'mech' || !!m.universalTribe)) ctx.buff(m, minion.rallyMechAtk!, 0, 'Better Bot');
      }
    }
    if ((minion.rallySpellWeld ?? 0) > 0) { // player-only: grantToHand is a no-op for a served enemy
      const pool = ctx.poolCards('player').filter((c) => c.spell && !c.token);
      if (pool.length > 0) for (let i = 0; i < minion.rallySpellWeld!; i++) ctx.grantToHand(ctx.rng.pick(pool).id, minion.side, minion.uid);
    }
  };

  /** Per-side use counts for the two "while you have room" runes — both are bounded per combat. */
  const broodSpent: Record<Side, number> = { player: 0, enemy: 0 };
  const echoesSpent: Record<Side, number> = { player: 0, enemy: 0 };
  /** Rune of the War Chorus' once-per-combat latch, per side. */
  const warChorusSpent: Record<Side, boolean> = { player: false, enemy: false };
  /** Rune of the Warpath re-entrancy latch: the chained attack must not chain again (the right-most could
   *  BE the left-most on a one-minion board, and a chain-of-chains is an infinite loop). */
  const warpathChaining: Record<Side, boolean> = { player: false, enemy: false };
  /** Rune of the Food Chain: the left-most Demon's stats, captured at Start of Combat and spent on the first
   *  summon. Captured rather than read live, so a Demon that dies before the summon still pays out — the rune
   *  reads as a Start-of-Combat promise, not a lookup at an arbitrary later moment. */
  const foodChainStats: Record<Side, { attack: number; health: number } | undefined> = { player: undefined, enemy: undefined };
  /**
   * Rune of the Brood / Rune of Living Echoes: while a side has an empty board slot, fill it.
   *
   * Called after each attack's death cascade settles (beside `flushResummons`) — the moment a slot actually
   * frees up. BOUNDED per combat: an unbounded version refills every slot the instant it empties, so a board
   * can never shrink and the fight stops resolving.
   */
  function fillFreeSlots(): void {
    for (const side of ['player', 'enemy'] as Side[]) {
      // Decoy Sigil: each banked cast fills ONE freed slot with a Training Dummy (1/1 Taunt + Ward), far
      // right (the default append position). Same bounded once-per-cast shape as the Brood below.
      const decoys = modsFor(side).decoySigils ?? 0;
      const dummy = cards['trainingdummy'];
      while (decoys > 0 && decoysSpent[side] < decoys && countLiving(side) < 7 && dummy) {
        decoysSpent[side] += 1;
        nextStep();
        emit({ type: 'sc', source: boards[side].find((m) => !m.dead)?.uid ?? '', text: 'Decoy Sigil deploys a Training Dummy', cast: true });
        summonMinion(side, dummy, undefined, ['T', 'DS']);
      }
      const brood = modsFor(side).runeBrood ?? 0;
      const imp = cards['impscrap'];
      while (brood > 0 && broodSpent[side] < brood && countLiving(side) < 7 && imp) {
        broodSpent[side] += 1;
        nextStep(); fireTrigger('runeBrood', side);
        summonMinion(side, imp, undefined, ['DS', 'T']);
      }
      const echoes = modsFor(side).runeLivingEchoes ?? 0;
      const herald = cards['b2_sunmane'];
      while (echoes > 0 && echoesSpent[side] < echoes && countLiving(side) < 7 && herald) {
        echoesSpent[side] += 1;
        nextStep(); fireTrigger('runeLivingEchoes', side);
        summonMinion(side, herald, undefined, undefined, false, true); // attacks immediately
      }
    }
  }

  const decoysSpent: Record<Side, number> = { player: 0, enemy: 0 };
  /** The Sealed Vault's once-per-combat latch, per side. */
  const avengeDoubleSpent: Record<string, boolean> = {};
  function registerEffect(minion: Minion, effect: EffectDef): void {
    const fn = FACTORIES[effect.do];
    if (!fn) return; // recruit-phase effects without a combat factory are inert here
    // CELESTIAL: an alignment-gated half is inert for a body on the wrong side of the sky. Checked ONCE at
    // registration rather than per fire, because alignment locked at combat setup and cannot change mid-fight
    // (owner ruling 2026-08-03) — so a gate that fails here can never start passing later.
    if (!alignAllows(effect, minion.align)) return;
    // `onSummon` no longer travels the bus AT ALL: `emitOnSummonOrdered` dispatches it in current board order
    // (owner ruling 2026-08-12 — auras first, then the augmenting watchers left→right). Registering here too
    // would double-fire every watcher if a bus emit ever came back, so the event is excluded at the source.
    if (effect.on === 'onSummon') return;
    bus.on(effect.on, (payload) => {
      // A mid-combat ascension swaps a minion's effects; the CombatBus can't unregister, so a handler whose
      // effect is no longer in the minion's current set self-disables — the old form's abilities stop firing.
      if (!minion.effects.includes(effect)) return;
      // A dead minion fires nothing except its own Deathrattle — AND its own Slaughter (on-kill): a minion
      // that kills an enemy but dies in the SAME clash (a mutual kill) still procs its Slaughter (owner
      // ruling 2026-07-17, revising the old "a mutual kill procs nothing" behavior). The on-kill factories
      // are all attacker-guarded (`payload.attacker === self`), so on this broadcast only the minion that
      // actually landed the kill acts; every other dead minion's on-kill handler no-ops. A dead minion can
      // only BE the attacker of a kill in this same-clash mutual case (it can't swing again once dead), so
      // this stays precisely scoped to "killed and died together".
      if (minion.dead && effect.on !== 'onDeath' && effect.on !== 'onKill') return;
      // A RISE broadcast (`ownAlreadyFired`) reaches every WATCHER but must not re-run the dying body's own
      // Deathrattle — `fireOwnDeathrattles` already ran it, with its own Echo-extras handling. Without this
      // guard the emit doubled it: a Spear Warden came back 9/5 instead of 6/3, its Eternal-Knight enchant
      // applied twice (owner report chased 2026-07-27).
      if (effect.on === 'onDeath'
        && (payload as { ownAlreadyFired?: boolean; minion?: Minion }).ownAlreadyFired
        && (payload as { minion?: Minion }).minion === minion) return;
      // Cratering Missive: drop the tribe filter on the Cratering Hulk's overflow buff so it hits ALL your minions.
      const params =
        effect.do === 'onSummonOverflowBuffTribe' && modsFor(minion.side).crateringMissive
          ? { ...(effect.params ?? {}), tribe: '' }
          : effect.params ?? {};
      // An Echo counts as TRIGGERED only for the body whose Echo it is. The bus broadcasts `onDeath` to every
      // watcher, and a watcher reacting to someone else's death (Brood Matron, Endless Overseer) is not its
      // own Echo firing — wrapping those made Aftershocks pay once per rattle-body per death.
      const ownEcho = effect.on === 'onDeath' && (payload as { minion?: Minion } | undefined)?.minion === minion;
      if (ownEcho) asEcho(minion.side, () => withEffect(minion, effect, () => fn(ctx, minion, params, payload)), minion);
      else withEffect(minion, effect, () => fn(ctx, minion, params, payload));
      // Rune of Fury: your Avenges trigger twice — re-run the avenge effect once more. Per side (a served enemy's
      // Fury doubles its own minions' Avenges too).
      if (modsFor(minion.side).runeFury && effect.on === 'avenge') {
        // Fury modifies OTHER runes' Avenges, so its badge pops beside theirs — it genuinely caused the
        // second trigger, and without this the extra fire has no attribution at all. One extra fire per
        // Fury copy held (boolean-flag family, owner 2026-08-27).
        fireTrigger('runeFury', minion.side);
        for (let k = 0; k < flagCopiesOf(minion.side, 'runeFury'); k++) fn(ctx, minion, effect.params ?? {}, payload);
      }
      // The Sealed Vault: the FIRST Avenge each combat triggers twice — tracked per side, so a served enemy
      // holding the same quest gets its own re-fire rather than sharing the player's.
      //
      // The `avenge` bus event fires on EVERY friendly death, and each avenge factory decides for itself
      // whether this death meets its threshold (`count % params.count !== 0 → return`). So the latch has to be
      // spent on a death that actually PAYS OUT, not on the first death that merely broadcasts: latching on the
      // broadcast burned the doubler on a no-op and the reward did nothing at any board size. Every avenge
      // effect in content declares `params.count`, so the threshold is readable here.
      else if (modsFor(minion.side).avengeFirstDouble && effect.on === 'avenge' && !avengeDoubleSpent[minion.side]) {
        const threshold = Math.max(1, Number((effect.params as { count?: number } | undefined)?.count ?? 0) || 1);
        const deaths = Number((payload as { count?: number }).count ?? 0);
        if (deaths > 0 && deaths % threshold === 0) {
          avengeDoubleSpent[minion.side] = true;
          fn(ctx, minion, effect.params ?? {}, payload);
        }
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
    // Sylus (stacking) + Uron (best-copy) — resolved from card DATA rather than a hardcoded id, so a new
    // multiplier is a card field and not another branch in this function.
    // `!m.dead` (NOT `health > 0`): a doubler that took lethal damage from the very Echo it is doubling — a
    // gilded Fel Spikes sprays its own non-Demon Sylus to ≤0 on the base fire — is mid-DEFERRED-death, still on
    // the board, and was alive when the Deathrattle triggered, so it must still double (owner report
    // 2026-08-21: gilded + Sylus should fire "4 twice, twice"). Outside a defer scope nothing sits at
    // ≤0-not-dead, so this is identical to the old filter for every non-spraying Deathrattle.
    const reaperExtras = extraTriggerFires('deathrattle', boards[minion.side].filter((m) => !m.dead), (id) => cards[id]);
    // Elderhorn (Ritual): BEAST Echoes fire an extra time (tribe-scoped, so it never touches other tribes).
    const beastRitualExtra = isTribeOf(minion, 'beast', cards)
      ? (minion.side === 'player' ? playerState.beastRitualExtra ?? 0 : enemyState.beastRitualExtra ?? 0)
        + beastExtraGain[minion.side].ritual // a mid-fight Elderhorn re-fire counts from now on
      : 0;
    const mods = modsFor(minion.side); // per-side: a served enemy's Funeral Engine / Grave Contract doublers apply too
    const first = mods.echoFirstEachCombat ?? 0;
    let firstEchoBonus = 0;
    if (first > 0 && !firstEchoDone[minion.side]) { fireTrigger('runeCatacomb', minion.side); firstEchoBonus = first; firstEchoDone[minion.side] = true; }
    // The SAME fold the recruit-side Echo path uses (`fireRecruitDeathrattles`) — one definition of the
    // Echo-multiplier set across both phases (owner principle 2026-08-20).
    return foldEchoExtraFires({ reaperExtras, beastRitualExtra, echoExtraAlways: mods.echoExtraAlways ?? 0, firstEchoBonus });
  }

  // How many EXTRA times a player minion's Rally (on-attack effects) fires beyond the base trigger — every
  // Rally doubler folded in ADDITIVELY: Law of Teeth (Beast RL) + Rallying Offensive (`playerRallyDouble`) +
  // Infinite Assembly (`rallyExtraAlways`) + Spark Permit / Overclocked Core (`rallyFirstEachCombat`, the FIRST
  // player Rally of the fight only). Consumes the first-rally bonus once; call only for a player RL attacker.
  function playerRallyExtras(attacker: Minion): number {
    const mods = modsFor(attacker.side); // per-side: a served enemy's Law of Teeth / Infinite Assembly / Spark Permit apply too
    let extra = 0;
    if (mods.lawOfTeeth && isBeast(attacker)) extra += 1;
    // The tribe-parameterised twin (War Council and friends). Kept beside `lawOfTeeth` rather than replacing it:
    // the Beast flag is load-bearing for existing runs and saved boards.
    if (mods.tribeRallySlaughterExtra && isTribeOf(attacker, mods.tribeRallySlaughterExtra, cards)) extra += 1;
    if (attacker.side === 'player' && playerRallyDouble) extra += 1; // Rallying Offensive is a player-only one-fight override
    extra += mods.rallyExtraAlways ?? 0;
    if (mods.rallyExtraAlways) fireTrigger('runeAdventuring', attacker.side);
    const first = mods.rallyFirstEachCombat ?? 0;
    if (first > 0 && !firstRallyDone[attacker.side]) { fireTrigger('runeStampede', attacker.side); extra += first; firstRallyDone[attacker.side] = true; }
    return extra;
  }

  // A Rally WATCHER on ANOTHER minion (Paragon's `onRallyBuffOnePerTribe`) scales with the number of Rally
  // triggers — it fires once on the base swing (via the `onAttack` bus) but the doubler loops re-run only the
  // attacker's OWN effects, so the watcher was silently stuck at ×1 (owner report 2026-08-14). Re-fire it per
  // extra. Deliberately NARROW: generic ally-attack watchers (Crypt Drake) count every swing and must NOT
  // double — only rally-gated watchers named here re-fire.
  const refireRallyWatchers = (attacker: Minion): void => {
    for (const m of boards[attacker.side]) {
      if (m === attacker || m.dead || m.health <= 0) continue;
      for (const effect of m.effects) {
        if (effect.on === 'onAttack' && RALLY_WATCHER_EFFECTS.has(effect.do)) {
          withEffect(m, effect, () => FACTORIES[effect.do]?.(ctx, m, effect.params ?? {}, { minion: attacker, side: attacker.side }));
        }
      }
    }
  };

  /** Fire a body's OWN Echo. `killer` is the minion that landed the lethal blow, when there was one —
   *  Jensen & Fi's "destroy the minion that killed this" needs it, and a RISE death used to drop it on the
   *  floor (owner report 2026-08-08): the Rise branch calls this directly and then emits `onDeath` with
   *  `ownAlreadyFired`, so the bus carrying the killer never reaches the dying body's own handler. A forced
   *  Echo (Echoing Coop, Bone Throne) legitimately has no killer and passes none. */
  function fireOwnDeathrattles(minion: Minion, killer?: Minion): void {
    const fireOnce = (): void => {
      for (const effect of minion.effects) {
        if (effect.on !== 'onDeath') continue;
        asEcho(minion.side, () => withEffect(minion, effect, () => FACTORIES[effect.do]?.(ctx, minion, effect.params ?? {}, { minion, side: minion.side, killer })), minion);
      }
    };
    // Defer any Fel-Spikes-style board deaths across the base fire + all re-fires (see the withEchoDefer note).
    withEchoDefer(() => {
      fireOnce();
      if (!minion.effects.some((e) => e.on === 'onDeath')) return; // no Echo → no extra fires / tally to spend
      const extra = playerEchoExtras(minion);
      for (let r = 0; r < extra; r++) fireOnce();
      // Doubler re-triggers count as extra Echo triggers (Reborn / Echoing Coop / Bone Throne). The caller
      // already counted the base trigger; add the extras (player only — enemy Echoes don't feed quests).
      if (minion.side === 'player') bumpDeathrattles(extra);
    });
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
      fireOwnDeathrattles(minion, killer); // a Rise death still has a killer — Jensen & Fi must reach it
      // A Rise death is a REAL death (owner ruling 2026-07-27, reversing 2026-07-02/07-06): it counts for
      // Avenge, the enemy-death tally, friendly-death quests and on-death watchers. The body genuinely leaves
      // play before returning — "minions that die and then rise should still count as a death".
      //
      // Tallied AFTER the rattle, matching the regular death path.
      //
      // …and every on-death WATCHER sees it too (owner 2026-07-27: "the minion effectively dies and should
      // trigger all on death effects"). `ownAlreadyFired` stops the broadcast re-running the dying body's own
      // rattle, which `fireOwnDeathrattles` handled a line above — see the guard in `registerEffect`.
      bus.emit('onDeath', { minion, side: minion.side, killer, ownAlreadyFired: true });
      if (minion.side === 'enemy') { enemyDeaths++; noteKill(minion.cardId, minion.uid); }
      deaths[minion.side] += 1;
      if (minion.side === 'player') questEvents.push({ step: stepN, kind: 'friendlyDeath', tribes: [] });
      emitAvenge(minion.side, deaths[minion.side], minion);
      // Board cap gates the Rise (owner ruling 2026-07-02): the Deathrattle resolved FIRST — its summons can
      // take the last slots, since the dying body holds none — and if the side is at 7 living the minion does
      // NOT return: it stays dead for real, and NOW counts as a true death (Avenge + enemy tally). It already
      // emitted its (rise-flagged) death above, so we don't push a second one, and there's NO `onDeath`
      // broadcast (watchers treat Rise deaths as non-deaths; the rattle already fired, incl. Sylus re-procs).
      if (living(minion.side).length >= 7) {
        // The death was already tallied above (every Rise counts now), so this branch only has to stop the
        // body returning — double-counting here would make a capped Rise worth two Avenge ticks.
        return;
      }
      // Rise: revive the SAME body (keeps its uid → "reborn attacks again" + every per-instance carry-back
      // still work) at base ATTACK with 1 Health, shedding combat buffs + granted keywords.
      minion.dead = false;
      const def = cards[minion.cardId];
      const mul = minion.golden ? 2 : 1;
      // (Rune of Rebirth no longer alters this path — as of 2026-07-21 it GRANTS Rise to 2 random allies at
      // Start of Combat instead of changing the Health a Rise returns at.)
      if (def) {
        minion.attack = Math.max(0, def.attack * mul);
        minion.health = 1; // Rise always returns at 1 Health
        minion.maxHealth = minion.health;
        minion.keywords = def.keywords.filter((k) => k !== 'R');
        minion.divineShield = def.keywords.includes('DS');
      } else {
        minion.keywords = minion.keywords.filter((k) => k !== 'R');
        minion.health = 1;
        minion.maxHealth = 1;
      }
      // RUNE OF THE DEATHTOUCHED APPLE: a minion that Rises gets Rise BACK, so it can go again. Budgeted per
      // combat (2 uses) — without a budget this is an infinite loop, since each Rise would re-arm the next.
      // Re-armed AFTER the strip above, which is what clears `R` in both branches.
      const apple = appleUsesFor(minion.side);
      if (apple && apple.left > 0) {
        apple.left -= 1;
        if (!minion.keywords.includes('R')) minion.keywords.push('R');
        minion.rebornAvailable = true;
        emit({ type: 'keyword', target: minion.uid, keyword: 'R' });
        fireTrigger('runeDeathtouchedApple', minion.side);
      }
      // Granted blessings shed with the granted keywords: a golden-Taurus ×2 (`gainMult`) doesn't survive
      // the Rise — the EG it came with is already gone, and a lingering multiplier would double gains the
      // carry-back no longer records (display-vs-persist divergence).
      minion.gainMult = undefined;
      // A RISEN BODY IS THE PRINTED BODY (owner ruling 2026-08-08): everything GRANTED to this instance
      // during the fight resets with its stats. The Sunmane/Better-Bot/Spell-Weld/Empty-Graves rallies were
      // riding through the Rise — a body came back "fresh" yet still carried another minion's gift.
      minion.rallySpreadAtk = undefined;
      minion.rallyMechAtk = undefined;
      minion.rallySpellWeld = undefined;
      minion.emptyGravesRally = undefined;
      minion.bloodlustRally = undefined;
      // …and its AVENGE progress restarts (owner: "1/3 should reset to 0/3"). Avenge counts are a side-level
      // deaths tally, so the reset is a per-instance BASELINE: everything before this moment no longer counts
      // for this body. Stamped AFTER its own rise-death was tallied, so that death isn't "progress" either.
      minion.avengeBaseline = deaths[minion.side];
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
      // A Rise IS a summon, in FULL (owner ruling 2026-08-12, superseding the 2026-07-13 "quest count only"
      // carve-out): the returned body runs the same summon-entry suite as any placed summon — onSummon
      // watchers (Beardsley / King Oona / Groveweaver), tribe auras, the Zoo ordinal, Remains, Emberline,
      // Second Litter, Savagery / Jungle, Wolvie, and the quest tallies (all inside the shared helper).
      summonEntryEffects(minion, minion.side);
      return;
    }
    minion.dead = true;
    minion.health = 0;
    emit({ type: 'death', target: minion.uid, side: minion.side });
    // MOSSMEMORY COLOSSUS's graveyard: every Beast that dies is recorded in DEATH ORDER, so its Echo can bring
    // back the three that fell earliest. The PRINTED body is what's recorded (cardId + golden), matching the
    // Rise precedent — "Rise resummons the PRINTED body" — rather than whatever the corpse had grown into.
    // Recorded here at the real death site so a Rise death (handled above, and a real death by the 2026-07-27
    // ruling) still counts. Both sides record: a served Colossus resummons its OWN dead.
    // A body that ALREADY came back this way is not recorded again. Without this the Colossus is its own
    // fuel: it is itself a Beast, so two of them resurrect each other, each new copy dies, enters the
    // graveyard under a fresh uid and is raised again — 134 bodies in the two-Colossi test before this guard.
    // "The first 3 other Beasts that died this combat" means three corpses, not three per resurrection.
    // RUNE OF EMBERLINE: the FIRST Imp to die each combat banks its stats for the next Imp summoned. The
    // Ashen Heir's rule, narrowed to one payout a fight — `maxHealth` for the same reason (what the Imp WAS,
    // not what the killing blow left). Per side, so a served board runs its own.
    // RUNE OF MOONHOWL: a dying Mage-Pup casts the Shop spell it was taught — the taught spell rides the
    // instance (`taughtSpellId`), and `battlecryCastTaughtSpell` is the exact combat cast the Shout re-fires
    // use (targeted spells pick a seeded-random living friendly), so the Echo is the Shout, on death.
    if (modsFor(minion.side).runeMoonhowl && minion.cardId === 'b2_magepup' && minion.taughtSpellId) {
      // Not routed through `battlecryCastTaughtSpell`: that factory refuses a DEAD caster (correct for the
      // Shout re-fires it serves), and an Echo's caster is by definition dead. Same cast, inlined — targeted
      // spells pick a seeded-random living friendly, and the whole thing rides `castInCombat` so it is a
      // genuine cast (a Runebloom Matriarch multiplies it).
      const taught = cards[minion.taughtSpellId];
      if (taught?.spell && combatCastable(taught)) {
        nextStep(); fireTrigger('runeMoonhowl', minion.side);
        castInCombat(ctx, minion, () => {
          const friends = living(minion.side);
          if (taught.target && friends.length === 0) return;
          const targets = taught.target ? [rng.pick(friends)] : undefined;
          if (resolveCombatSpellCast(ctx, minion, taught, targets)) {
            emit({ type: 'sc', source: minion.uid, text: `${minion.name} casts ${taught.name}` });
          }
        });
      }
    }
    // RUNE OF ANCESTRAL ROAR: a dying Dragon with a Shout fires that Shout as an Echo. Same firing block the
    // War Chorus uses, aimed at the dying body rather than the left-most one — this is the minion's OWN Shout,
    // granted to it as an Echo, so there is no left-most pick to make and no once-per-combat latch: the rune
    // grants an ability to every qualifying Dragon rather than firing once itself.
    if (modsFor(minion.side).runeAncestralRoar
        && (minion.tribe === 'dragon' || minion.tribe2 === 'dragon')
        && minion.effects.some((e) => e.on === 'onPlay')) {
      nextStep(); fireTrigger('runeAncestralRoar', minion.side);
      // q-interact-combat-shout-multipliers (owner APPROVE 2026-08-27): the granted Echo's Shout folds the
      // Battlecry multipliers (Drakko) like every other combat Shout re-fire (Ryme / Sovereign / Dawnclaw).
      const roarReps = drakkoRepeats(ctx, minion.side);
      for (let r = 0; r < roarReps; r++) {
        emit({ type: 'sc', source: minion.uid, text: 'Shout' });
        for (const effect of minion.effects) {
          if (effect.on !== 'onPlay') continue;
          withEffect(minion, effect, () => FACTORIES[effect.do]?.(ctx, minion, effect.params ?? {}, { minion, side: minion.side }));
        }
      }
    }
    // RUNE OF RUBY SHRAPNEL: a dying Ruby-buffed body scatters its Ruby stats across the survivors. The tally
    // is the same read the Gemheart line and Rune of the Gem Golem use — the carried shop 'Ruby' buff plus
    // this fight's `rubyGain` — so a Ruby counts the same whether it was played in the shop or mid-fight.
    // Split evenly and FLOORED: 5 Attack across 2 survivors is 2 each, not 2.5, and a share that rounds to
    // nothing simply doesn't land rather than being topped up to 1 (which would make wide boards free value).
    if (modsFor(minion.side).runeRubyShrapnel) {
      const carried = minion.buffs?.find((b) => b.source === 'Ruby');
      // The split lands once per copy held (boolean-flag family, owner 2026-08-27): the survivors share the
      // Ruby stats × copies, dealt through the same round-robin dispersal.
      const rs = flagCopiesOf(minion.side, 'runeRubyShrapnel');
      const tally = {
        attack: ((carried?.attack ?? 0) + (minion.rubyGain?.attack ?? 0)) * rs,
        health: ((carried?.health ?? 0) + (minion.rubyGain?.health ?? 0)) * rs,
      };
      const survivors = living(minion.side).filter((m) => m !== minion);
      if (survivors.length > 0 && (tally.attack > 0 || tally.health > 0)) {
        // DISPERSE the literal stats rather than dividing them (owner ruling 2026-08-07). An even split floors,
        // and a floor loses points: 2 Attack across 3 survivors used to pay nothing at all. Handing them out
        // one at a time, round-robin from the left, spends every point — 2 across 3 gives the first two
        // survivors +1 each and the third nothing. Attack and Health are dealt independently, both starting at
        // the left, so a 2/2 body's Attack and Health land on the same two minions rather than scattering.
        const share = survivors.map(() => ({ attack: 0, health: 0 }));
        for (let i = 0; i < tally.attack; i++) share[i % survivors.length]!.attack += 1;
        for (let i = 0; i < tally.health; i++) share[i % survivors.length]!.health += 1;
        nextStep(); fireTrigger('runeRubyShrapnel', minion.side);
        for (let i = 0; i < survivors.length; i++) {
          const sh = share[i]!;
          if (sh.attack > 0 || sh.health > 0) ctx.buff(survivors[i]!, sh.attack, sh.health, 'Rune of Ruby Shrapnel');
        }
      }
    }
    if (modsFor(minion.side).runeEmberline && !emberlineBank[minion.side] && cards[minion.cardId]?.imp) {
      emberlineBank[minion.side] = { attack: Math.max(0, minion.attack), health: Math.max(0, minion.maxHealth) };
    }
    // RUNE OF BACKBEAT: the first Echo triggered each combat also fires your LEFT-MOST Rally. Hooked at the
    // real death site — a Deathrattle is dispatched through the `onDeath` bus, so `fireOwnDeathrattles` (the
    // FORCED-Echo path used by Echoing Coop and Bone Throne) is not where an ordinary Echo passes. Gated on
    // the dying body actually HAVING an Echo, so a plain death can't spend the rune, and on a living Rally
    // body, since a free Rally on a corpse pays nothing.
    if (modsFor(minion.side).runeBackbeat && !backbeatUsed[minion.side]
        && minion.effects.some((e) => e.on === 'onDeath')) {
      const lead = living(minion.side).find((m) => m.keywords.includes('RL') && m.effects.some((e) => e.on === 'onAttack'));
      if (lead) {
        backbeatUsed[minion.side] = true;
        fireTrigger('runeBackbeat', minion.side);
        // One Rally fire per copy held (boolean-flag family, owner 2026-08-27).
        for (let k = 0; k < flagCopiesOf(minion.side, 'runeBackbeat'); k++) fireFreeRally(lead, minion.side);
      }
    }
    if ((minion.tribe === 'beast' || minion.tribe2 === 'beast' || cards[minion.cardId]?.universalTribe)
        && !raisedBodies.has(minion.uid)) {
      deadBeasts[minion.side].push({ uid: minion.uid, cardId: minion.cardId, golden: minion.golden, attack: minion.attack, maxHealth: minion.maxHealth ?? minion.health });
    }
    const dyingIsBeast = minion.tribe === 'beast' || minion.tribe2 === 'beast' || !!cards[minion.cardId]?.universalTribe;
    // RUNE OF BEASTIAL SWARM: a friendly Beast dying pumps your living Beasts by the current per-death amount
    // (starts 2, raised by the Avenge(2) improvement below). A combat stat-gain; only the LEVEL persists.
    if (dyingIsBeast && modsFor(minion.side).runeBeastialSwarm) {
      const n = beastialLevel[minion.side];
      const beasts = living(minion.side).filter((m) => m.tribe === 'beast' || m.tribe2 === 'beast' || !!cards[m.cardId]?.universalTribe);
      if (n > 0 && beasts.length > 0) {
        nextStep(); fireTrigger('runeBeastialSwarm', minion.side);
        // The per-death buff lands once per copy held (boolean-flag family, owner 2026-08-27).
        const bs = n * flagCopiesOf(minion.side, 'runeBeastialSwarm');
        for (const m of beasts) ctx.buff(m, bs, bs, 'Rune of Beastial Swarm');
      }
    }
    // Candlelight Toll: your Kobolds have "Echo: get a Ruby". Implemented as a run-wide rule rather than by
    // stamping an effect onto each body, so Kobolds summoned mid-combat carry it too. Grants through the same
    // carry-back channel every hand grant uses.
    //
    // BUG FIX 2026-08-14 (owner report): this used `grantToHand('ruby', …)`, which carries back a RAW POOL COPY
    // of the Ruby card — a flat 1/1 — so a Kobold deck that had built its Rubies up to +3/+3 got 1/1 Rubies out
    // of the quest while every other source paid full strength. Rubies are MINTED, never conjured: `grantRubies`
    // rides `playerRubyGrants`, which runs the run's real `mintRubies` at settle with the live `rubyBonus` baked
    // in (and fires the Motherlode / Candle Conduit "when you GET a Ruby" watchers, which the hand-grant channel
    // also skipped). Same replay `toHand` event either way.
    if (modsFor(minion.side).candlelightToll && (minion.tribe === 'kobold' || minion.tribe2 === 'kobold')) {
      ctx.grantRubies(1, minion.side, minion.uid);
    }
    // Rune of the Gem Golem: a dying Kobold leaves a token with stats equal to the RUBIES it was carrying.
    // `rubyTallyOf` is the same read the Gemheart line uses (the carried 'Ruby' snapshot + this fight's gains),
    // so a body with no Rubies leaves nothing rather than a 0/0.
    if (modsFor(minion.side).runeGemGolem && (minion.tribe === 'kobold' || minion.tribe2 === 'kobold')) {
      // The same read the arena's `rubyTallyOf` does: the carried shop 'Ruby' buff plus this fight's gains.
      const carried = minion.buffs?.find((b) => b.source === 'Ruby');
      const tally = {
        attack: (carried?.attack ?? 0) + (minion.rubyGain?.attack ?? 0),
        health: (carried?.health ?? 0) + (minion.rubyGain?.health ?? 0),
      };
      const golemDef = cards['gemheart-shard'];
      if (golemDef && (tally.attack > 0 || tally.health > 0)) {
        fireTrigger('runeGemGolem', minion.side);
        // One token per copy held (boolean-flag family, owner 2026-08-27) — board room permitting.
        for (let k = 0; k < flagCopiesOf(minion.side, 'runeGemGolem'); k++) {
          summonMinion(minion.side, golemDef, minion.uid, undefined, false, false,
            { attack: tally.attack, health: tally.health, maxHealth: tally.health });
        }
      }
    }
    // Count enemy deaths (Cassen's Collision banks them toward its 5-kill payoff) and remember WHICH bodies
    // they were, first and last, for Flash.
    if (minion.side === 'enemy') { enemyDeaths++; noteKill(minion.cardId, minion.uid); }
    // Count your Deathrattles as they trigger (before firing, so Grim's own death counts toward its buff).
    const hasDeathrattle = minion.effects.some((e) => e.on === 'onDeath');
    if (minion.side === 'player' && hasDeathrattle) bumpDeathrattles(1);
    nextStep(); // Deathrattles + on-death watchers resolve as their own step
    // PARTING CRY (spell): this body's SHOUT fires as it dies, before its Echo. One-shot — spent here, so a
    // Rise/resummon of the same body never pays twice.
    if (minion.partingCry) {
      minion.partingCry = false;
      if (minion.effects.some((e) => e.on === 'onPlay')) {
        // `cast: true` is what makes the UI PLAY something: an `sc` without it is classified as narration
        // (log line + a small trigger pulse) and draws no animation at all — see the `sc` case in
        // useCombatReplay. The cry is a real, visible proc, so it flashes on the dying body (owner report
        // 2026-08-17: "why isn't parting cry showing the shout animations").
        // Route through the SAME machinery every other Shout-trigger uses (Dawnclaw, Ryme, Thunderous
        // Sovereign): `replayCombatBattlecry` for the effect itself, then the `battlecryTriggered` bus emit.
        // Calling the `onPlay` FACTORIES directly — as this used to — fired the effect but skipped the emit,
        // so every "after you trigger a Shout" watcher silently missed it (owner report 2026-08-16:
        // Embermouth Whelp gained nothing, and Deepvein Tender's +1 Health never showed its buff text).
        // q-interact-combat-shout-multipliers (owner APPROVE 2026-08-27): the cry folds the Battlecry
        // multipliers (Drakko) like every other combat Shout re-fire — one sc + emit per fire, Ryme-style.
        const reps = drakkoRepeats(ctx, minion.side);
        for (let r = 0; r < reps; r++) {
          emit({ type: 'sc', source: minion.uid, text: `${minion.name}'s parting cry`, cast: true });
          replayCombatBattlecry(ctx, minion);
          bus.emit('battlecryTriggered', { side: minion.side, minion });
        }
      }
    }
    // Defer any Fel-Spikes-style board deaths across the base Echo (fired via the bus) + every re-fire below,
    // so all volleys land before a deferred victim resolves (see the withEchoDefer note). A no-op — byte-
    // identical events — for every death whose rattle never calls `resolveEchoDeath`.
    withEchoDefer(() => {
      bus.emit('onDeath', { minion, side: minion.side, killer });
      // Rune of the Crucible: the sacrificed bodies return when the side's LAST minion dies. Checked AFTER the
      // Echoes fire, so an Echo that summons keeps the side alive and defers the return — the wipe has to be
      // real. Emptied on use: one resurrection per fight, and the returning bodies can't re-trigger it.
      if (crucibleBank[minion.side].length > 0 && boards[minion.side].every((m) => m.dead || m.health <= 0)) {
        const bank = crucibleBank[minion.side];
        crucibleBank[minion.side] = [];
        fireTrigger('runeCrucible', minion.side);
        for (const b of bank) {
          const def = cards[b.cardId];
          if (!def) continue;
          summonMinion(minion.side, def, undefined, [...b.keywords], b.golden, false,
            { attack: b.attack, health: b.health, maxHealth: b.health });
        }
      }
      // Echo doublers re-proc the dying minion's own Deathrattle extra times — Sylus + Funeral Engine + the
      // first-echo-each-combat bonus, all folded additively in `playerEchoExtras` (see its note). Only for a
      // minion that actually has a Deathrattle (so the first-echo bonus isn't spent on a rattle-less body).
      const extra = hasDeathrattle ? playerEchoExtras(minion) : 0;
      for (let r = 0; r < extra; r++) {
        // One wrap around the whole re-trigger: a body with two Echo effects is still ONE Echo triggering.
        asEcho(minion.side, () => {
          for (const effect of minion.effects) {
            if (effect.on !== 'onDeath') continue;
            withEffect(minion, effect, () => FACTORIES[effect.do]?.(ctx, minion, effect.params ?? {}, { minion, side: minion.side }));
          }
        }, minion);
      }
      // Each RE-TRIGGER is another Echo "triggered" (owner ruling 2026-07-08: TRIGGER-based counts — the Echo
      // objective + Grim's tally — scale with doublers; a MINION dying is still one death). Added after the
      // re-fires so all firings read the same tally value (the value at death), only the count grows.
      if (minion.side === 'player' && hasDeathrattle) bumpDeathrattles(extra);
    });
    // Avenge: count the death and notify that side's avengers.
    deaths[minion.side] += 1;
    if (minion.side === 'player') questEvents.push({ step: stepN, kind: 'friendlyDeath', tribes: [] });
    // RUNE OF BEASTIAL SWARM — Avenge (2): every 2 friendly deaths, raise the per-death amount by +2. Permanent:
    // the player side's grown level carries back into the run (`playerBeastialSwarmLevel`).
    if (modsFor(minion.side).runeBeastialSwarm && deaths[minion.side] % 2 === 0) {
      beastialLevel[minion.side] += 2;
      fireTrigger('runeBeastialSwarm', minion.side);
    }
    emitAvenge(minion.side, deaths[minion.side], minion);
    // The Bone Throne: every N friendly deaths, trigger your leftmost living Echo (like Echoing Coop, but
    // paced by the death counter). Fires the leftmost minion that HAS a Deathrattle — its own doublers apply.
    const side = minion.side; // per-side quest/rune death effects — a served enemy runs its own
    const throneStep = modsFor(side).boneThroneStep ?? 0;
    if (throneStep > 0 && deaths[side] % throneStep === 0) {
      const lead = boards[side].find((m) => !m.dead && m.health > 0 && m.effects.some((e) => e.on === 'onDeath'));
      if (lead) { nextStep(); fireTrigger('boneThroneStep', side); if (side === 'player') bumpDeathrattles(1); fireOwnDeathrattles(lead); }
    }
    // Assembly Line: every N friendly deaths (Avenge N), add a Money Bot to your hand. Player-only —
    // `grantToHand` no-ops for a served enemy (no hand). Avenge-paced like The Bone Throne.
    const asmStep = modsFor(side).assemblyLineStep ?? 0;
    if (asmStep > 0 && deaths[side] % asmStep === 0) { nextStep(); fireTrigger('assemblyLine', side); ctx.grantToHand('moneybot', side, minion.uid); }
    // Pit Without End: the friendly death that empties your board summons N Imps (a last stand, once per fight).
    const pitImps = modsFor(side).pitWithoutEndImps ?? 0;
    if (pitImps > 0 && !pitDone[side] && countLiving(side) === 0) {
      pitDone[side] = true;
      const imp = cards['impscrap'];
      if (imp) { nextStep(); for (let i = 0; i < pitImps; i++) summonMinion(side, imp, undefined); }
    }
    // Rune of Blood and Coin: every N friendly deaths banks Gold for next turn. Player-only — a served enemy
    // has no run to carry Gold back into.
    const bacStep = modsFor(side).runeBloodAndCoin ?? 0;
    if (bacStep > 0 && side === 'player' && deaths[side] % 5 === 0) { // owner 2026-08-11: Avenge(5) (was every 4 deaths)
      fireTrigger('runeBloodAndCoin', side);
      bonusGoldGain += bacStep;
    }
    // Rune of Finality: the Warded sibling of Pit Without End — same "your last minion died" trigger, but the
    // Imps arrive with Ward. Its own latch, so holding both runes pays both once rather than one eating the other.
    const finalImps = modsFor(side).runeFinality ?? 0;
    if (finalImps > 0 && !finalityDone[side] && countLiving(side) === 0) {
      finalityDone[side] = true;
      fireTrigger('runeFinality', side);
      const imp = cards['impscrap'];
      if (imp) { nextStep(); for (let i = 0; i < finalImps; i++) summonMinion(side, imp, undefined, ['DS']); }
    }
  }

  // The Reclaimer's pending resummons. A marked minion is destroyed at Start of Combat (its
  // Deathrattle fires + overflows the board); the exact body waits here and "reclaims" its slot the
  // next time the board has room — i.e. after a friend dies — never mid-summon-cascade. So its own
  // tokens win the immediate scramble and the original returns later. `anchor` is the dead body it
  // was killed from, so the copy comes back in (or next to) its original slot.
  const deadBeasts: Record<Side, { uid: string; cardId: string; golden?: boolean; attack?: number; maxHealth?: number }[]> = { player: [], enemy: [] };
  // Rune of the Old Pack: the FIRST Beast resummoned each combat returns at full stats (per side, once).
  const oldPackUsed: Record<Side, number> = { player: 0, enemy: 0 }; // full-stat returns paid (one per Old Pack copy)
  const resummonedUids = new Set<string>(); // a corpse comes back at most once, however many Colossi Echo
  const emberlineBank: Record<Side, { attack: number; health: number } | undefined> = { player: undefined, enemy: undefined };
  const emberlinePaid: Record<Side, boolean> = { player: false, enemy: false };
  const spareChairUsed: Record<Side, number> = { player: 0, enemy: 0 }; // qualifying summons paid (one per Spare Chair copy)
  const backbeatUsed: Record<Side, boolean> = { player: false, enemy: false };
  const scriptureSpent: Record<Side, boolean> = { player: false, enemy: false };
  // SHOP→COMBAT CARRY-OVER (owner ruling 2026-08-26): an UNSPENT War Drum charge applies to the FIRST Shout
  // triggered in combat, and unspent Warm Embers double-charges apply to the next N. Per side, so a served
  // rival whose snapshot carried its own unspent charges gets them too. Spend trackers live here (per-combat),
  // never on shared defs; consumed via ctx.shoutCarryExtras in replayCombatBattlecry.
  const warDrumCarrySpent: Record<Side, boolean> = { player: false, enemy: false };
  const shoutDoubleCarryLeft: Record<Side, number> = {
    player: modsFor('player').shoutDoubleCharges ?? 0,
    enemy: modsFor('enemy').shoutDoubleCharges ?? 0,
  };
  const undertowUsed: Record<Side, number> = { player: 0, enemy: 0 }; // Rune of the Undertow's 4-Ward budget
  const raisedBodies = new Set<string>(); // uids of bodies that ARE a resurrection — their deaths don't re-bank
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
      applyTribeAuras(copy); // a resummoned Beast (The Reclaimer) inherits the aura too — AURAS FIRST (owner 2026-08-12)
      emitOnSummonOrdered(copy, side); // …then the augmenting watchers, board order left→right
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
    overkill = false,
  ): void {
    // `overkill`: keep dealing to a body already at ≤0 that has NOT yet been resolved to `dead`. A multi-volley
    // Echo (Fel Spikes, gilded / Sylus / Echohorn) hits the SAME captured targets each pass and defers death to
    // the end, so a low-HP victim reads EVERY volley's damage — and procs the per-volley reactors + pops a Ward
    // on the first, takes damage on the next — instead of vanishing after the first hit.
    if (target.dead || (!overkill && target.health <= 0)) return;
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
    // Stamp the dealer's uid when we have one (attacker, poisoner, an AoE caster like Fel Spikes) so a damage
    // MOMENT can be attributed to its actor for source→target FX. Conditional so genuinely sourceless damage
    // stays byte-identical (no `source: undefined` key on the event).
    emit({ type: 'dmg', target: target.uid, amount, remainingHp: Math.max(0, target.health), ...(poisoner ? { source: poisoner.uid } : {}) });
    // The hit landed (Immune + Divine Shield already returned above) — notify on-damaged watchers (Gryphon).
    if (amount > 0) bus.emit('onDamaged', { minion: target, side: target.side });
    // Set 2: a FRIENDLY-relative Demon just dealt damage that LANDED (Immune / Divine Shield / 0-dmg all
    // returned above, so a Ward-absorbed hit never gets here). Watchers filter by side; the emit filters to Demons.
    if (amount > 0 && poisoner && isTribeOf(poisoner, 'demon', cards)) {
      bus.emit('friendlyDemonDealtDamage', { minion: poisoner, side: poisoner.side });
      // RUNE OF RUINS: the same landed hit pumps that side's whole board. Run-wide (no minion source), so it
      // rides the emit rather than a card effect. NOT permanent by itself — the gains carry back only for a
      // body that is Engraved, which is the standing rule for every combat stat gain.
      if (modsFor(poisoner.side).runeRuins) {
        fireTrigger('runeRuins', poisoner.side);
        // The buff lands once per copy held (boolean-flag family, owner 2026-08-27).
        const rr = RUNE_RUINS_BUFF * flagCopiesOf(poisoner.side, 'runeRuins');
        for (const m of living(poisoner.side)) ctx.buff(m, rr, rr, 'Rune of Ruins');
      }
    }
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
    // STOLEN INITIATIVE (spell): after the OPPONENT'S FIRST attack, the caster's right-most body strikes out of
    // turn order. Queued through the existing `attackNow` lane (the same one Solaris Fang / attack-on-summon
    // use), so it drains at the normal flush point rather than re-entering the attack loop here — turn order
    // itself is untouched, which is the hard line on this file.
    const victimMods = modsFor(defenderSide);
    if (victimMods.stolenInitiative) {
      victimMods.stolenInitiative = false; // one-shot, spent on the opponent's opening swing
      const mine = boards[defenderSide].filter((m) => !m.dead && m.health > 0);
      const rightmost = mine[mine.length - 1];
      if (rightmost) {
        emit({ type: 'sc', source: rightmost.uid, text: `${rightmost.name} steals the initiative` });
        ctx.attackNow?.(rightmost);
      }
    }
    nextStep(); // a new exchange begins (re-attacks and Whelp strikes each get their own step too)
    // Stealth is lost the moment a minion attacks (A.4) — it becomes targetable.
    if (attacker.keywords.includes('ST')) {
      attacker.keywords = attacker.keywords.filter((k) => k !== 'ST');
      emit({ type: 'reveal', target: attacker.uid });
    }
    const swings = attacker.keywords.includes('W') ? 2 : 1; // Windfury (A.3 step 5)
    // A Flurry minion that DIES on its first swing and RISES does not get the second swing (owner ruling
    // 2026-07-21). Rise sets `dead = false` and restores Health mid-exchange, so the plain liveness guard
    // below saw a healthy attacker and let swing 2 through — the minion appeared to attack twice after dying.
    // The risen body is a fresh body: its turn is over, the next minion attacks, and it swings again on a
    // later turn like anything else. (Granted Flurry is already shed by the Rise itself, which rebuilds
    // `keywords` from the card def; an INNATE Flurry survives but still doesn't re-swing this exchange.)
    const rebornAtStart = attacker.rebornAvailable;
    for (let s = 0; s < swings; s++) {
      if (attacker.dead || attacker.health <= 0) break;
      if (rebornAtStart && !attacker.rebornAvailable) break; // it died and rose during this exchange
      let target = chooseTarget(defenderSide);
      // TUTORIAL scripted death: on the enemy's FIRST swing, steer it onto the flagged card (if still alive),
      // regardless of where the player placed it. One-shot; normal random targeting resumes after.
      if (forcedEnemyTargetPending && attacker.side === 'enemy') {
        forcedEnemyTargetPending = false;
        const forced = living(defenderSide).find((m) => m.cardId === forceEnemyFirstTargetCard && !m.keywords.includes('ST'));
        if (forced) target = forced;
      }
      if (!target) break;
      if (s > 0) nextStep(); // each Windfury swing is its own exchange
      // Critical Strike (Commander Impala): roll per swing — a hit doubles this swing's OUTGOING damage (main
      // hit + cleave splash), not the retaliation. Only consumes RNG for a minion that actually has critChance.
      const crit = !!attacker.critChance && attacker.critChance > 0 && rng.next() < attacker.critChance;
      const critMult = crit ? 2 : 1;
      emit({ type: 'attack', attacker: attacker.uid, defender: target.uid, swing: s, ...(crit ? { crit: true } : {}) });
      bus.emit('onAttack', { minion: attacker, side: attacker.side, target }); // Rally + on-attack effects (target = the enemy being hit this swing)
      // RUNE OF THE CHEF: an attacking Chef Gary Toast buffs ANOTHER random friendly Dwarf by the combined
      // stats it handed out last shop turn. The tally rides on the INSTANCE (`chefGrantedLast`), so two Chefs
      // each pay their own, and a Chef bought this turn has banked nothing and pays nothing.
      //
      // `m !== attacker` (owner ruling 2026-08-07): the Chef can never feed itself. A lone Chef with no other
      // Dwarf therefore does nothing — which is the honest reading of "another", not an edge case to paper
      // over. Two Chefs CAN feed each other, since each is "another" from the other's view.
      {
        const banked = attacker.chefGrantedLast ?? 0;
        if (banked > 0 && modsFor(attacker.side).runeChef && !attacker.dead && attacker.cardId === 'dw_chef') {
          const dwarves = boards[attacker.side].filter((m) => m !== attacker && !m.dead && m.health > 0
            && (m.tribe === 'dwarf' || m.tribe2 === 'dwarf' || !!cards[m.cardId]?.universalTribe));
          if (dwarves.length > 0) {
            fireTrigger('runeChef', attacker.side);
            ctx.buff(rng.pick(dwarves), banked, banked, attacker.uid);
          }
        }
      }
      // Rune of Dragonscale: an attacking Dragon earns Ward (= Divine Shield), N times per combat. The
      // allowance is decremented on the GRANT, not the attack, so a Dragon that already has a shield does not
      // burn a charge — the sheet promises 3 shields, not 3 attempts.
      {
        const dsLeft = runeDragonscaleLeft[attacker.side];
        const isDragon = attacker.tribe === 'dragon' || attacker.tribe2 === 'dragon'
          || !!cards[attacker.cardId]?.universalTribe;
        if (dsLeft > 0 && isDragon && !attacker.divineShield && !attacker.dead) {
          runeDragonscaleLeft[attacker.side] = dsLeft - 1;
          fireTrigger('runeDragonscale', attacker.side);
          attacker.divineShield = true;
          if (!attacker.keywords.includes('DS')) attacker.keywords.push('DS');
          emit({ type: 'shieldUp', target: attacker.uid });
        }
      }
      // Rune of Attacking Gems: every friendly attack plays a Ruby on your whole board. A Ruby is 1/1 plus the
      // side's Ruby strength — the same body the shop mints — so a late-run board scales with its Rubies.
      const gems = modsFor(attacker.side).runeAttackingGems ?? 0;
      if (gems > 0) {
        const rb = ctx.rubyBonusFor(attacker.side) ?? { attack: 0, health: 0 };
        nextStep(); fireTrigger('runeAttackingGems', attacker.side);
        for (const m of boards[attacker.side]) {
          if (m.dead || m.health <= 0) continue;
          for (let i = 0; i < gems; i++) ctx.buff(m, 1 + rb.attack, 1 + rb.health, 'Rune of Attacking Gems');
        }
      }
      // Rune of the Warpath: after your LEFT-most minion attacks, your RIGHT-most attacks too — out of turn
      // order, via the same immediate-attack queue the Whelp/Spear Warden use. Guards, each load-bearing: the
      // attacker must BE the left-most living body; the right-most must be a DIFFERENT minion (else a
      // one-minion board chains into itself); and `warpathChaining` stops the chained attack chaining again.
      if (modsFor(attacker.side).runeWarpath && !warpathChaining[attacker.side]) {
        const living = boards[attacker.side].filter((m) => !m.dead && m.health > 0);
        const tail = living[living.length - 1];
        if (living[0] === attacker && tail && tail !== attacker) {
          warpathChaining[attacker.side] = true;
          nextStep(); fireTrigger('runeWarpath', attacker.side);
          // One chained attack per copy held (boolean-flag family, owner 2026-08-27); the latch still
          // prevents any chained attack from chaining again.
          for (let k = 0; k < flagCopiesOf(attacker.side, 'runeWarpath'); k++) {
            if (tail.dead || tail.health <= 0) break;
            ctx.attackNow?.(tail, false);
          }
          warpathChaining[attacker.side] = false;
        }
      }
      // Rune of the War Chorus: your FIRST Rally each combat also triggers your left-most Shout. Gated on the
      // attacker actually having a Rally, so a plain swing does not spend it.
      if (modsFor(attacker.side).runeWarChorus && !warChorusSpent[attacker.side] && canRally(attacker)) {
        const lead = boards[attacker.side].find((m) => !m.dead && m.health > 0 && m.effects.some((e) => e.on === 'onPlay'));
        if (lead) {
          warChorusSpent[attacker.side] = true;
          nextStep(); fireTrigger('runeWarChorus', attacker.side);
          // q-interact-combat-shout-multipliers (owner APPROVE 2026-08-27): the chorus' forced Shout folds
          // the Battlecry multipliers (Drakko) like every other combat Shout re-fire — AND fires once per
          // rune copy held (boolean-flag duplicate family, owner 2026-08-27). The two multiply.
          const chorusReps = drakkoRepeats(ctx, attacker.side) * flagCopiesOf(attacker.side, 'runeWarChorus');
          for (let r = 0; r < chorusReps; r++) {
            emit({ type: 'sc', source: lead.uid, text: 'Shout' });
            for (const effect of lead.effects) {
              if (effect.on !== 'onPlay') continue;
              withEffect(lead, effect, () => FACTORIES[effect.do]?.(ctx, lead, effect.params ?? {}, { minion: lead, side: lead.side }));
            }
          }
        }
      }
      // The Burning Legion: an attacking Imp summons a copy of itself, while uses remain AND there is room.
      // Bounded by `burningLegionUses` — an unbounded version fills the board on the first swing and turns
      // every fight into a 7-Imp wall regardless of what else you built.
      const legion = modsFor(attacker.side).burningLegionUses ?? 0;
      if (legion > 0 && cards[attacker.cardId]?.imp && !attacker.dead) {
        const def = cards[attacker.cardId];
        if (def && countLiving(attacker.side) < 7) {
          burningLegionSpent[attacker.side] = (burningLegionSpent[attacker.side] ?? 0) + 1;
          if (burningLegionSpent[attacker.side]! <= legion) summonMinion(attacker.side, def, attacker.uid);
        }
      }
      // Uron: your RALLIES trigger extra times. Deliberately NOT a second bus.emit — that would also
      // re-tick Rally quests and re-notify broadcast ally-attack watchers (Crypt Drake). Only the
      // attacker's own on-attack effects repeat.
      // Gate on the RL keyword: `on: 'onAttack'` covers BOTH true Rallies and broadcast ally-attack
      // watchers (Crypt Drake counts every ally swing). Only the former are "Rallies" — repeating the
      // latter would inflate a counter Uron has no business touching. Caught by a test that asserts
      // Crypt Drake's payout count is unchanged with Uron on board.
      // Elderhorn (Hunt) adds extra fires for BEAST rallies only — tribe-scoped, unlike the board-wide
      // card multipliers (Drakko/Uron) that `extraTriggerFires` reads.
      const huntExtra = isTribeOf(attacker, 'beast', cards)
        ? (attacker.side === 'player' ? playerState.beastHuntExtra ?? 0 : enemyState.beastHuntExtra ?? 0)
          + beastExtraGain[attacker.side].hunt // a mid-fight Elderhorn re-fire counts from now on
        : 0;
      const rallyExtra = attacker.keywords.includes('RL')
        ? extraTriggerFires('rally', boards[attacker.side].filter((m) => !m.dead && m.health > 0), (id) => cards[id]) + huntExtra
        : 0;
      for (let i = 0; i < rallyExtra; i++) {
        for (const effect of attacker.effects) {
          if (effect.on !== 'onAttack') continue;
          withEffect(attacker, effect, () => FACTORIES[effect.do]?.(ctx, attacker, effect.params ?? {}, { minion: attacker, side: attacker.side, target }));
        }
        refireRallyWatchers(attacker); // Paragon scales with the Uron/Drakko rally multiplier too
      }
      // …and each of those extra fires COUNTS as a Rally trigger, exactly like the additive doublers below
      // (Law of Teeth / Rallying Offensive / Infinite Assembly / Spark Permit) already do. Missing this was
      // a real bug: with Uron out, two rallying minions read as 2 toward "Trigger 7 Rallies" instead of 4
      // (owner report). Player-only, matching every other quest tally.
      if (attacker.side === 'player') bumpRally(rallyExtra);
      // The Old Hunt: each Beast attack pumps that SIDE's run-wide Beast Attack aura by `oldHuntStep` — live
      // (every current Beast gains it; later summons inherit via the grown aura). A served enemy pumps its own
      // captured aura; the player also carries the gain back (the enemy has no run to persist to).
      // Rune of the Wild Hunt (owner rework 2026-08-19): the ATTACKING Beast gains +N Attack, and N improves
      // permanently with every Beast attack. It used to be a board-wide Health drip; it is now a single-body
      // Attack snowball, so it rewards one Beast swinging often rather than a wide board. The grown step
      // carries back across combats (`playerWildHuntGrown`), which is what "permanently" buys.
      const wildStep = modsFor(attacker.side).runeWildHunt ?? 0;
      if (wildStep > 0 && isBeast(attacker) && !attacker.dead && attacker.health > 0) {
        wildHuntGrown[attacker.side] += wildStep;
        ctx.buff(attacker, wildHuntGrown[attacker.side], 0, 'Rune of the Wild Hunt');
        fireTrigger('runeWildHunt', attacker.side);
      }
      // GORUN — BLADE MASTERY. Every friendly attack grants the ATTACKER +3 Attack, and the grant improves by
      // another +3 for every 8 attacks made. Placed here, before the exchange below, so the grant sharpens the
      // very swing that earned it — the natural reading of "when your minions attack, give them +3 Attack",
      // and the same timing Rune of the Wild Hunt uses one block up.
      //
      // The level reads the count BEFORE this swing, so "improves every 8 attacks" means the 9th attack is the
      // first bigger one. Combat-only (owner ruling 2026-08-23): `ctx.buff` without a carry-back channel, so a
      // fight's snowball dies with the fight and the board opens clean next round. Per side, off `modsFor`.
      const blade = modsFor(attacker.side).bladeMastery;
      if (blade && !attacker.dead && attacker.health > 0) {
        const total = blade.attacks + bladeAttacks[attacker.side];
        ctx.buff(attacker, 3 * (1 + Math.floor(total / 8)), 0, 'Blade Mastery');
        bladeAttacks[attacker.side] += 1;
        fireTrigger('bladeMastery', attacker.side);
      }
      const oldHuntStep = modsFor(attacker.side).oldHuntStep ?? 0;
      if (oldHuntStep > 0 && isBeast(attacker)) {
        // Reworked 2026-07-21: the grant is now SYMMETRIC (+N/+N, was Attack-only), so it pumps both aura
        // channels and carries both halves back for the player.
        beastAtkAuraFor[attacker.side] += oldHuntStep;
        beastHpAuraFor[attacker.side] += oldHuntStep;
        if (attacker.side === 'player') { beastBuyAtkGain += oldHuntStep; beastBuyHpGain += oldHuntStep; }
        for (const m of boards[attacker.side]) if (!m.dead && m.health > 0 && isBeast(m)) ctx.buff(m, oldHuntStep, oldHuntStep, 'The Old Hunt');
      }
      // Empty Graves: the Start-of-Combat-marked body triggers your LEFT-MOST living Echo each time it attacks.
      // Fired through `asEcho`, so it counts as a real Echo trigger (Rune of Aftershocks/Undertow see it too).
      if (attacker.emptyGravesRally && !attacker.dead && attacker.health > 0) {
        const echo = boards[attacker.side].find((m) => !m.dead && m.health > 0 && m.effects.some((e) => e.on === 'onDeath'));
        if (echo) {
          nextStep();
          fireTrigger('emptyGraves', attacker.side);
          // q-interact-empty-graves-flat (owner APPROVE 2026-08-27): the forced Echo folds the side's Echo
          // multipliers (Sylus / Uron / Funeral Engine / the first-Echo bonus, via `playerEchoExtras`) and
          // the marked body's gild — like every other forced-Echo path (Rune of the Herald, `triggerEcho`).
          // One `asEcho` wrap PER PROC (a two-Echo body is still one trigger; each multiplier proc is its
          // own), deaths deferred across all procs to mirror the death-fired path's scope.
          const procs = (1 + playerEchoExtras(echo)) * (attacker.golden ? 2 : 1);
          withEchoDefer(() => {
            for (let r = 0; r < procs; r++) {
              asEcho(attacker.side, () => {
                for (const effect of echo.effects) {
                  if (effect.on !== 'onDeath') continue;
                  withEffect(echo, effect, () => FACTORIES[effect.do]?.(ctx, echo, effect.params ?? {}, { minion: echo, side: attacker.side }));
                }
              }, echo);
            }
          });
        }
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
            withEffect(attacker, effect, () => FACTORIES[effect.do]?.(ctx, attacker, effect.params ?? {}, { minion: attacker, side: attacker.side }));
          }
          refireRallyWatchers(attacker); // Paragon scales with the additive rally doublers too
        }
        if (attacker.side === 'player') bumpRally(extras);
      }
      if (attacker.side === 'player') bumpQuestTally('attack', attacker); // "Attack N times with Beasts" quest — player-only
      // Better Bot (Rally): each time this attacks — once per swing, so a Windfury body rallies TWICE if it
      // survives the first swing — give your OTHER Mechs +N Attack (N = accrued rallyMechAtk, stacks via
      // magnetize). Fires per hit alongside the onAttack rallies (rallyBuff / rallyProcDeathrattle) above.
      if (attacker.rallyMechAtk && attacker.rallyMechAtk > 0) {
        for (const m of boards[attacker.side]) { // iterate the board directly — no living() array per swing
          if (!m.dead && m.health > 0 && m !== attacker && (m.tribe === 'mech' || m.tribe2 === 'mech' || !!m.universalTribe)) {
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
        const pool = ctx.poolCards('player').filter((c) => c.spell && !c.token);
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
      // Mauron's splash — ONE adjacent enemy, or BOTH when gilded. Deliberately separate from Cleave (which
      // always hits both and carries the C badge): same living-order neighbour lookup, narrower by default.
      if (cards[attacker.cardId]?.splashAdjacent) {
        const live = boards[defenderSide].filter((m) => !m.dead && m.health > 0);
        const di = live.indexOf(target);
        const both = [live[di - 1], live[di + 1]].filter((n): n is Minion => !!n);
        const hit = attacker.golden ? both : both.slice(0, 1); // ungilded: the first available side
        for (const n of hit) {
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
        // Mauron's immunity never depletes — it is "while attacking", not a charge count.
        if (!cards[attacker.cardId]?.attackImmuneAlways) attacker.attackImmuneLeft = attacker.attackImmuneLeft! - 1;
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
          // Uron: your SLAUGHTERS trigger extra times — the killer's own on-kill effects only. The KILL
          // count (`slaughter`) still counts one, but each re-trigger bumps the "Trigger N Slaughters" tally.
          // NOT `beastHuntExtra` — Elderhorn's first branch is RALLIES ONLY as of 2026-07-31 (owner). It used to
          // read here as well, so after the text was narrowed the card was still doubling Slaughters: it promised
          // less than it did. `extraTriggerFires` still covers Uron and the tribe-scoped quest flags, which are
          // the effects that genuinely mean "your Slaughters trigger again".
          const killExtra = extraTriggerFires('slaughter', boards[killer.side].filter((x) => !x.dead && x.health > 0), (id) => cards[id]);
          const killerHasSlaughter = killer.effects.some((e) => e.on === 'onKill');
          for (let i = 0; i < killExtra; i++) {
            for (const effect of killer.effects) {
              if (effect.on !== 'onKill') continue;
              withEffect(killer, effect, () => FACTORIES[effect.do]?.(ctx, killer, effect.params ?? {}, { attacker: killer, victim: m }));
            }
          }
          // Each Uron re-fire that actually re-triggers a Slaughter EFFECT counts toward "Trigger N Slaughters"
          // (`slaughterKeyword`) — the kill count (`slaughter`) stays one, owner ruling 2026-07-21: a Slaughter
          // is a kill, but a Slaughter EFFECT can trigger multiple times. Matches the Rally treatment (#594).
          if (killExtra > 0 && killerHasSlaughter && killer.side === 'player' && m.side !== killer.side) {
            for (let i = 0; i < killExtra; i++) bumpSlaughterKeyword();
          }
          // A player minion felling an enemy by attacking is a "Slaughter" — tally it for the Slaughter quests
          // (credited to the KILLER's tribe for "with Beasts").
          if (m.side !== killer.side) { // this attacker felled an OPPONENT minion — a Slaughter, for whichever side
            const kmods = modsFor(killer.side); // per-side quest/rune Slaughter effects
            const killerAlive = !killer.dead && killer.health > 0;
            if (killer.side === 'player') {
              bumpQuestTally('slaughter', killer);
              if (killer.effects.some((e) => e.on === 'onKill')) bumpSlaughterKeyword(); // The Red Trail: a Slaughter-keyword trigger
              // Rune of the Trophy (reworked 2026-07-21): record the FIRST enemy minion you KILL this combat —
              // a plain copy of the VICTIM (was: of the killer) is conjured to hand at settle ("get a plain copy
              // of the first minion you kill each combat"). Player-only (a served enemy has no run to receive it).
              // Conjured fresh from the card def at settle, so the copy is plain — none of the victim's buffs.
              if (kmods.runeTrophy && slaughterCopyId === undefined) {
                fireTrigger('runeTrophy', 'player'); // the first kill claims the copy — pulse the badge on it
                slaughterCopyId = m.cardId;
                // Fly the copy to hand as a live VISUAL only, on the kill beat — the real plain copy is still
                // conjured at settle from `slaughterCopyId` (a bare `toHand` is presentation, NOT a
                // `playerHandGrants` record, exactly like the quest-reward toHand above). Owner directive
                // 2026-08-14: combat card grants should arrive in real time, not snap in at settle.
                emit({ type: 'toHand', cardId: m.cardId, side: 'player', source: killer.uid });
              }
              // Blood Trail (Beast → hand) + Deep Hunger (Fodder → next shop) are ECONOMY/HAND — player-only (a
              // served enemy has no hand or shop). Their SoC marks are also only set on the player board.
              if (playerState.questMods.bloodTrail && killer === bloodTrailMinion && killerAlive) ctx.grantRandomMinion(1, 'beast', 'player', undefined, killer.uid);
            }
            // Law of Teeth: a Beast's Slaughter triggers one extra time — re-run only this killer's own on-kill
            // effects once more (direct call, not via the bus, so other minions' on-kills don't double-fire). Per side.
            if (killerAlive && ((kmods.lawOfTeeth && isBeast(killer)) || (kmods.tribeRallySlaughterExtra && isTribeOf(killer, kmods.tribeRallySlaughterExtra, cards)))) {
              let refired = false;
              for (const effect of killer.effects) {
                if (effect.on !== 'onKill') continue;
                withEffect(killer, effect, () => FACTORIES[effect.do]?.(ctx, killer, effect.params ?? {}, { attacker: killer, victim: m }));
                refired = true;
              }
              // The extra Slaughter EFFECT trigger counts toward "Trigger N Slaughters" (player only).
              if (refired && killer.side === 'player') bumpSlaughterKeyword();
            }
            // Author's Hand: the FIRST Slaughter each combat fires an extra time (any tribe; additive with Law of
            // Teeth). Re-runs only this killer's own on-kill effects, once per combat. Per side.
            const slfe = kmods.slaughterFirstEachCombat ?? 0;
            if (slfe > 0 && killerAlive && !firstSlaughterDone[killer.side]) {
              firstSlaughterDone[killer.side] = true;
              const authorsHasSlaughter = killer.effects.some((e) => e.on === 'onKill');
              for (let r = 0; r < slfe; r++) {
                for (const effect of killer.effects) {
                  if (effect.on !== 'onKill') continue;
                  withEffect(killer, effect, () => FACTORIES[effect.do]?.(ctx, killer, effect.params ?? {}, { attacker: killer, victim: m }));
                }
              }
              // Each extra Slaughter EFFECT trigger counts toward "Trigger N Slaughters" (player only).
              if (authorsHasSlaughter && killer.side === 'player') for (let r = 0; r < slfe; r++) bumpSlaughterKeyword();
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

  // --- CLOSED CASKET (spell): a marked body is DESTROYED at the start of combat (owner ruling 2026-08-15).
  //     Deliberately a REAL death through the normal kill path rather than a bespoke "fire its Echo" hook:
  //     everything that keys off a death comes along for free — its Echo, Avenge counters, friend-death
  //     watchers, the Deathrattle tally, Rune of the Burrow, and so on. Reborn is NOT suppressed here (unlike
  //     The Reclaimer above, which forces a true death because it resummons the body itself): "destroy" should
  //     behave like any other destruction, so a Rise body dies, pays its Echo, and returns. ---
  for (const minion of [...boards.player, ...boards.enemy]) {
    if (!minion.closedCasket || minion.dead || minion.health <= 0) continue;
    minion.closedCasket = false; // one-shot, spent as it fires
    nextStep();
    emit({ type: 'sc', source: minion.uid, text: `${minion.name}'s casket closes` });
    killOrReborn(minion);
  }

  // --- Start of Combat: player minions left→right first (A.3 step 1), then the enemy's (owner ruling
  //     2026-07-03: a captured board's Start-of-Combat effects are live, not inert — an enemy Taurus
  //     engraves its line too). Effects reading the player's RUN state (Abhorrent Horror's consumed-Fodder
  //     tally) side-gate themselves, since an enemy snapshot carries no run state. ---
  // Blood Trail: mark the leftmost living player minion — its kills this fight conjure a random Beast (above).
  if (playerState.questMods.bloodTrail) bloodTrailMinion = boards.player.find((m) => !m.dead && m.health > 0);
  // Run-level SoC quest/rune grants, PER SIDE (a served enemy runs its own): Rulebreaker's Crown, Umbral Energy,
  // Contract Rewrite. Enemy values come from the captured mods / scalers.
  for (const scSide of ['player', 'enemy'] as const) {
    const smods = modsFor(scSide);
    // Rulebreaker's Crown: the leftmost living minion gains +Attack equal to its Attack (doubles it).
    if (smods.doubleLeftmostAttack) {
      const lead = boards[scSide].find((m) => !m.dead && m.health > 0);
      if (lead && lead.attack > 0) { nextStep(); fireTrigger('doubleLeftmostAttack', scSide); ctx.buff(lead, lead.attack, 0, lead.uid); }
    }
    // Atrius's Possession: the leftmost living minion gains the rightmost's Attack, and the rightmost gains
    // the leftmost's Health — simultaneous (both read the pre-buff values). Needs 2+ living minions.
    if (smods.possession) {
      const living = boards[scSide].filter((m) => !m.dead && m.health > 0);
      if (living.length >= 2) {
        const first = living[0]!, last = living[living.length - 1]!;
        const gainAtk = last.attack, gainHp = first.health;
        if (gainAtk > 0) { nextStep(); ctx.buff(first, gainAtk, 0, first.uid); }
        if (gainHp > 0) { nextStep(); ctx.buff(last, 0, gainHp, last.uid); }
      }
    }
    // Umbral Energy: give every living Dragon +3/+3 for every spell cast this game (lifetime spellsCast, per side).
    const scSpells = scSide === 'player' ? playerState.spellsCast : enemyState.spellsCast;
    if (smods.umbralEnergy && scSpells > 0) {
      const amt = 3 * scSpells;
      let stepped = false;
      for (const m of boards[scSide]) {
        if (m.dead || m.health <= 0) continue;
        if (m.tribe !== 'dragon' && m.tribe2 !== 'dragon' && !m.universalTribe) continue;
        if (!stepped) { nextStep(); stepped = true; fireTrigger('umbralEnergy', scSide); } // its own beat + badge pulse
        ctx.buff(m, amt, amt, m.uid);
      }
    }
    // Contract Rewrite: the rightmost living Demon gains a Deathrattle — summon 2 Imps with Ward. Gets its own
    // beat + badge pulse (it used to apply silently — no event at all).
    if (smods.contractRewrite) {
      const demon = [...boards[scSide]].reverse().find((m) => !m.dead && m.health > 0 && isDemon(m));
      if (demon) {
        nextStep();
        fireTrigger('contractRewrite', scSide);
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
        // CELESTIAL: skip a half gated to the other alignment (see `registerEffect` — SC is dispatched
        // directly, so it needs its own gate).
        if (!alignAllows(effect, minion.align)) continue;
        if (effect.on === 'startOfCombat' && effect.do === 'scEngraveAll') { nextStep(); withEffect(minion, effect, () => FACTORIES[effect.do]?.(ctx, minion, effect.params ?? {}, {})); }
      }
    }
  }
  for (const side of ['player', 'enemy'] as const) {
    // Uron: Start-of-Combat effects fire extra times. Resolved per SIDE from that side's own board.
    const scReps = 1 + extraTriggerFires('startOfCombat', boards[side].filter((m) => !m.dead && m.health > 0), (id) => cards[id]);
    for (let rep = 0; rep < scReps; rep++) {
      for (const minion of [...boards[side]]) {
        if (minion.dead || minion.health <= 0) continue;
        for (const effect of minion.effects) {
          if (effect.do === 'scEngraveAll') continue; // already ran in the priority pass above
          if (effect.on !== 'startOfCombat') continue;
          // CELESTIAL: an alignment-gated half is inert for a body on the wrong side of the sky. Start of
          // Combat is dispatched by direct iteration (not through the bus), so the registration-time gate
          // in `registerEffect` does NOT cover it — this is the second half of the same rule.
          if (!alignAllows(effect, minion.align)) continue;
          const fn = FACTORIES[effect.do];
          if (fn) { nextStep(); withEffect(minion, effect, () => fn(ctx, minion, effect.params ?? {}, {})); }
        }
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
      if (knit) { nextStep(); fireTrigger('runeWarden', rside); summonMinion(rside, knit, undefined); }
    }
    // Rune of the Mirror March: if the board has room, summon an EXACT copy of the leftmost minion (current
    // combat stats + shield/Rise, the Mirrorhide `copyStats` path), placed to its right.
    if (rmods.runeMirrorMarch && boards[rside].length < 7) {
      const lead = boards[rside].find((m) => !m.dead && m.health > 0);
      const leadDef = lead ? cards[lead.cardId] : undefined;
      if (lead && leadDef) {
        nextStep();
        fireTrigger('runeMirrorMarch', rside);
        // One copy per rune copy held (boolean-flag family, owner 2026-08-27) — room permitting.
        for (let k = 0; k < flagCopiesOf(rside, 'runeMirrorMarch') && boards[rside].length < 7; k++) {
          summonMinion(rside, leadDef, lead.uid, undefined, lead.golden, false, {
            attack: lead.attack, health: lead.health, maxHealth: lead.maxHealth,
            divineShield: lead.divineShield, rebornAvailable: lead.rebornAvailable,
          });
        }
      }
    }
    // Rune of Twilight: Start-of-Combat effects trigger an ADDITIONAL time — extra SoC pass(es) for this
    // board. The pass count comes from `socTwilightExtraFires`, THE shared definition the shop End-of-Turn
    // replay (Rune of Combat Prowess) also consults — owner reversal 2026-08-20: the two runes STACK, so the
    // count must have one home. One extra pass today; the loop keeps this byte-identical while letting the
    // definition grow.
    let twilightFired = false; // one badge pulse announcing the extra SoC pass (on its first effect's beat)
    for (let twPass = 0; twPass < socTwilightExtraFires(rmods); twPass++) {
      for (const minion of [...boards[rside]]) {
        if (minion.dead || minion.health <= 0) continue;
        for (const effect of minion.effects) {
          if (effect.on !== 'startOfCombat') continue;
          if (!alignAllows(effect, minion.align)) continue; // CELESTIAL gate (see above)
          const fn = FACTORIES[effect.do];
          if (fn) {
            nextStep();
            if (!twilightFired) { twilightFired = true; fireTrigger('runeTwilight', rside); }
            withEffect(minion, effect, () => fn(ctx, minion, effect.params ?? {}, {}));
          }
        }
      }
    }
    // Shared Circuit: give up to N friendly Mechs (leftmost first, skipping already-shielded) a Ward.
    if ((rmods.sharedCircuitWard ?? 0) > 0) {
      const sideMods = rmods.sharedCircuitWard!;
      let left = sideMods;
      let sharedFired = false;
      for (const m of boards[rside]) {
        if (left <= 0) break;
        if (m.dead || m.health <= 0 || m.divineShield) continue;
        if (m.tribe !== 'mech' && m.tribe2 !== 'mech') continue;
        nextStep();
        if (!sharedFired) { fireTrigger('sharedCircuit', rside); sharedFired = true; } // one pulse for the SoC grant
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
        const next = boards[tSide].find((m) => !m.dead && m.health > 0 && !m.divineShield && (m.tribe === 'mech' || m.tribe2 === 'mech' || !!m.universalTribe));
        if (!next) return;
        transfers--;
        nextStep();
        next.divineShield = true;
        if (!next.keywords.includes('DS')) next.keywords.push('DS');
        emit({ type: 'shieldUp', target: next.uid });
      });
    }
    // Rune of Warding: give the RIGHT-most living minion a Ward and DOUBLE its Health (owner ruling 2026-07-29;
    // was the left-most, Ward only). Right-most so it protects the tail your opponent reaches last, and the
    // doubling is why it wants a big body rather than a spare one.
    // Rune of the Vanguard: give your three LEFT-most living minions Critical Strike and Ward. Left-most (not
    // right) because these are the bodies that swing first — the Crit wants to land early.
    // Rune of the Food Chain arms here: capture the left-most living Demon's CURRENT stats.
    if (rmods.runeFoodChain) {
      const demon = boards[rside].find((m) => !m.dead && m.health > 0 && (m.tribe === 'demon' || m.tribe2 === 'demon'));
      if (demon) {
        // The captured stats land × copies held on the first summon (boolean-flag family, owner 2026-08-27).
        const fcN = flagCopiesOf(rside, 'runeFoodChain');
        foodChainStats[rside] = { attack: demon.attack * fcN, health: demon.health * fcN };
        nextStep(); fireTrigger('runeFoodChain', rside);
      }
    }
    // Weaken (next-combat spell): set N random living ENEMIES (from this side's view) to 1 Health.
    const weaken = rmods.weakenTargets ?? 0;
    if (weaken > 0) {
      const other: Side = rside === 'player' ? 'enemy' : 'player';
      const pool = boards[other].filter((m) => !m.dead && m.health > 1);
      for (let w = 0; w < weaken && pool.length > 0; w++) {
        const m = pool.splice(ctx.rng.int(pool.length), 1)[0]!;
        nextStep();
        m.health = 1;
        m.maxHealth = Math.min(m.maxHealth ?? 1, 1) || 1;
        emit({ type: 'sc', source: m.uid, text: `${m.name} is Weakened to 1 Health`, cast: true });
      }
    }
    // Rune of Forthcoming (owner sheet 2026-07-31): the LEFT-MOST minion gains Ward and attacks immediately.
    // Replaces the old "you always attack first" turn-priority version (see the reducer's playerAttacksFirst).
    if (rmods.runeForthcoming) {
      const front = boards[rside].filter((m) => !m.dead && m.health > 0)[0];
      if (front) {
        nextStep(); fireTrigger('runeForthcoming', rside);
        if (!front.divineShield) {
          front.divineShield = true;
          if (!front.keywords.includes('DS')) front.keywords.push('DS');
          emit({ type: 'shieldUp', target: front.uid });
        }
        // One immediate attack per copy held (boolean-flag family, owner 2026-08-27).
        for (let k = 0; k < flagCopiesOf(rside, 'runeForthcoming'); k++) {
          if (front.dead || front.health <= 0) break;
          ctx.attackNow?.(front, false);
          flushImmediateAttacks();
        }
      }
    }
    // RUNE OF SPELLHIDE: re-cast the turn's remembered stat spell onto the very Beast it was cast on in the
    // shop. The spell RUNS again rather than its stats being copied, so anything that scales with run state
    // pays its live value here. The uid is the run board card's, which `instantiate` carries onto the combat
    // body, so the same Beast is found; if it isn't on the board any more, the re-cast is simply skipped.
    const hide = (rside === 'player' ? playerState : enemyState).spellhide ?? [];
    for (const rec of hide) {
      const def = cards[rec.spellId];
      const onto = boards[rside].find((m) => m.uid === rec.uid && !m.dead);
      if (!def?.spell || !onto || !combatCastable(def)) continue;
      nextStep();
      fireTrigger('runeSpellhide', rside);
      resolveCombatSpellCast(ctx, onto, def, def.target ? [onto] : undefined);
    }
    if (rmods.runeFiveBanners) {
      // Rune of the Five Banners: ONE friendly minion of each type gains +6/+6 — the Paragon rule, so a
      // dual-type body can stand in for either tribe and an all-type body (Paragon itself) always collects.
      const living = boards[rside].filter((m) => !m.dead && m.health > 0);
      const recipients: Minion[] = living.filter((m) => !!cards[m.cardId]?.universalTribe);
      const taken = new Set<string>();
      for (const m of living) {
        if (cards[m.cardId]?.universalTribe) continue;
        for (const t of [m.tribe, m.tribe2]) {
          if (!t || t === 'neutral' || taken.has(t)) continue;
          taken.add(t);
          if (!recipients.includes(m)) recipients.push(m);
          break; // one banner per body: a Dragon/Demon covers whichever tribe was still open
        }
      }
      if (recipients.length > 0) {
        nextStep(); fireTrigger('runeFiveBanners', rside);
        // +6/+6 per copy held (boolean-flag family, owner 2026-08-27: "+6/+6 twice").
        const fb = 6 * flagCopiesOf(rside, 'runeFiveBanners');
        for (const m of recipients) ctx.buff(m, fb, fb, 'Rune of the Five Banners');
      }
    }
    if (rmods.unitedFront && rmods.unitedFront > 0) {
      // Emissary (United Front): the Five Banners rule — one friendly of each type gains +N/+N, where N is
      // the number of spells cast this GAME (owner respec 2026-08-17; it was the hero's tavern tier). Same
      // one-banner-per-body selection: a body claims the first type nobody has claimed yet.
      const n = rmods.unitedFront;
      const living = boards[rside].filter((m) => !m.dead && m.health > 0);
      const recipients: Minion[] = living.filter((m) => !!cards[m.cardId]?.universalTribe);
      const taken = new Set<string>();
      for (const m of living) {
        if (cards[m.cardId]?.universalTribe) continue;
        for (const t of [m.tribe, m.tribe2]) {
          if (!t || t === 'neutral' || taken.has(t)) continue;
          taken.add(t);
          if (!recipients.includes(m)) recipients.push(m);
          break;
        }
      }
      if (recipients.length > 0) {
        nextStep(); fireTrigger('unitedFront', rside);
        for (const m of recipients) ctx.buff(m, n, n, 'United Front');
      }
    }
    if (rmods.runeCenterline) {
      // Rune of the Centerline: a positional payoff — if the two END minions are of DIFFERENT types, the
      // middle one gains Ward + Critical Strike. Needs at least three bodies for "ends" and "middle" to mean
      // anything, and the ends must both have a real (non-neutral) type to be different.
      const living = boards[rside].filter((m) => !m.dead && m.health > 0);
      if (living.length >= 3) {
        const left = living[0]!;
        const right = living[living.length - 1]!;
        const mid = living[Math.floor(living.length / 2)]!;
        const typeOf = (m: Minion): string | undefined => (m.tribe && m.tribe !== 'neutral' ? m.tribe : undefined);
        const lt = typeOf(left);
        const rt = typeOf(right);
        if (lt && rt && lt !== rt) {
          nextStep(); fireTrigger('runeCenterline', rside);
          if (!mid.keywords.includes('CR')) mid.keywords.push('CR');
          if (!mid.divineShield) {
            mid.divineShield = true;
            if (!mid.keywords.includes('DS')) mid.keywords.push('DS');
            emit({ type: 'shieldUp', target: mid.uid });
          }
        }
      }
    }
    if (rmods.runeTemperedTime) {
      // Rune of Tempered Time: +Health equal to HALF each minion's Attack (floored — a 5-Attack body gains 2).
      const living = boards[rside].filter((m) => !m.dead && m.health > 0);
      const gains = living.filter((m) => Math.floor(m.attack / 2) > 0);
      if (gains.length > 0) {
        nextStep(); fireTrigger('runeTemperedTime', rside);
        // The grant lands once per copy held (boolean-flag family, owner 2026-08-27).
        const tt = flagCopiesOf(rside, 'runeTemperedTime');
        for (const m of gains) ctx.buff(m, 0, Math.floor(m.attack / 2) * tt, 'Rune of Tempered Time');
      }
    }
    if (rmods.runeHerald) {
      // Rune of the Herald: trigger EVERY Echo on the side. "Any onDeath effect is an Echo" — the same rule
      // Echohorn's proc uses (a factory-id prefix filter was the bug there). The bodies do NOT die; each Echo
      // simply fires once, and every Echo multiplier the side has (Sylus, Uron, Elderhorn…) applies.
      const echoes = boards[rside].filter((m) => !m.dead && m.health > 0 && m.effects.some((e) => e.on === 'onDeath'));
      if (echoes.length > 0) {
        nextStep(); fireTrigger('runeHerald', rside);
        // The whole pass runs once per copy held (boolean-flag family, owner 2026-08-27).
        const heraldReps = flagCopiesOf(rside, 'runeHerald');
        for (const target of echoes) {
          const procs = (1 + (rside === 'player' ? playerEchoExtras(target) : 0)) * heraldReps;
          for (let r = 0; r < procs; r++) {
            // ONE wrap per proc: each re-fire is its own Echo TRIGGER, and everything hanging off `asEcho`
            // (Aftershocks, Burrow) must see a Herald-forced Echo exactly like a death-fired one.
            asEcho(rside, () => {
              ctx.countDeathrattle?.(target.side);
              for (const effect of target.effects) {
                if (effect.on !== 'onDeath') continue;
                withEffect(target, effect, () => FACTORIES[effect.do]?.(ctx, target, effect.params ?? {}, { minion: target, side: target.side }));
              }
            }, target);
          }
        }
      }
    }
    // Rune of Dawnclaw: your Dawnclaws ALSO fire their adjacent-Shout Echo at Start of Combat (they don't die).
    if (rmods.runeDawnclaw) {
      for (const m of boards[rside].filter((x) => !x.dead && x.health > 0 && x.cardId === 'b2_dawnclaw')) {
        nextStep(); fireTrigger('runeDawnclaw', rside);
        // A Dawnclaw firing its own Echo without dying is still an Echo TRIGGER (see `asEcho`).
        asEcho(rside, () => {
          FACTORIES['deathrattleReplayAdjacentBattlecry']?.(ctx, m, {}, { minion: m, side: rside });
        }, m);
      }
    }
    // Rune of Sylus: your Sylus double their own Health at Start of Combat.
    if (rmods.runeSylus) {
      for (const m of boards[rside].filter((x) => !x.dead && x.health > 0 && x.cardId === 'sylus')) {
        nextStep(); fireTrigger('runeSylus', rside);
        ctx.buff(m, 0, m.health, m.uid);
      }
    }
    if (rmods.runeCrucible) {
      // Rune of the Crucible: sacrifice the N left-most now; when the side's LAST minion dies, they return.
      // Snapshotted at full current stats so the resummon is the body you gave up, not a base-stat copy.
      const n = rmods.runeCrucible ?? 3;
      const doomed = boards[rside].filter((m) => !m.dead && m.health > 0).slice(0, n);
      if (doomed.length > 0) {
        nextStep(); fireTrigger('runeCrucible', rside);
        crucibleBank[rside] = doomed.map((m) => ({
          cardId: m.cardId, attack: m.attack, health: m.maxHealth ?? m.health,
          keywords: [...m.keywords], golden: !!m.golden,
        }));
        for (const m of doomed) killOrReborn(m);
      }
    }
    if (rmods.runeUnderdog) {
      // Rune of the Underdog: double the stats of the TWO lowest-Attack living minions (ties by board order,
      // so the pick is a seating decision rather than RNG — Rune of Rallying's rule).
      const lowest = boards[rside].filter((m) => !m.dead && m.health > 0)
        .slice().sort((a, b) => a.attack - b.attack).slice(0, 2);
      if (lowest.length > 0) {
        nextStep(); fireTrigger('runeUnderdog', rside);
        // One doubling per copy held (boolean-flag family, owner 2026-08-27) — each reads the grown body.
        for (let k = 0; k < flagCopiesOf(rside, 'runeUnderdog'); k++) {
          for (const m of lowest) ctx.buff(m, m.attack, m.health, 'Rune of the Underdog');
        }
      }
    }
    if (rmods.runeStokedMenagerie) {
      // Rune of the Stoked Menagerie: controlling EVERY active minion type doubles 3 random minions. "All 5"
      // is read off the side's OWN active tribe list rather than a hardcoded 5, so a set with a different tribe
      // count still asks for a full house (the same rule `uncontrolled` uses for the Menagerie payoffs).
      const living = boards[rside].filter((m) => !m.dead && m.health > 0);
      const onBoard = new Set<string>();
      for (const m of living) {
        const def = cards[m.cardId];
        for (const t of [def?.tribe, def?.tribe2]) if (t && t !== 'neutral') onBoard.add(t);
        // A universal-tribe body (Amalgam-likes) counts as every active type at once.
        if (def?.universalTribe) for (const t of ctx.activeTribesFor(rside)) if (t !== 'neutral') onBoard.add(t);
      }
      const wanted = ctx.activeTribesFor(rside).filter((t) => t !== 'neutral');
      if (wanted.length > 0 && wanted.every((t) => onBoard.has(t)) && living.length > 0) {
        // Pick 3 WITHOUT replacement — "3 random minions" is three bodies, not three rolls that can collide.
        const pool = living.slice();
        const picked: typeof pool = [];
        for (let i = 0; i < 3 && pool.length > 0; i++) picked.push(...pool.splice(rng.int(pool.length), 1));
        nextStep(); fireTrigger('runeStokedMenagerie', rside);
        // One doubling per copy held (boolean-flag family, owner 2026-08-27) — same three bodies.
        for (let k = 0; k < flagCopiesOf(rside, 'runeStokedMenagerie'); k++) {
          for (const m of picked) ctx.buff(m, m.attack, m.health, 'Rune of the Stoked Menagerie');
        }
      }
    }
    if (rmods.runeVanguard) {
      const front = boards[rside].filter((m) => !m.dead && m.health > 0).slice(0, 3);
      if (front.length > 0) {
        nextStep(); fireTrigger('runeVanguard', rside);
        for (const m of front) {
          if (!m.keywords.includes('CR')) m.keywords.push('CR');
          if (!m.divineShield) {
            m.divineShield = true;
            if (!m.keywords.includes('DS')) m.keywords.push('DS');
            emit({ type: 'shieldUp', target: m.uid });
          }
        }
      }
    }
    if (rmods.runeWarding) {
      const living = boards[rside].filter((m) => !m.dead && m.health > 0);
      const lead = living[living.length - 1];
      if (lead) {
        nextStep(); fireTrigger('runeWarding', rside);
        if (!lead.divineShield) {
          lead.divineShield = true;
          if (!lead.keywords.includes('DS')) lead.keywords.push('DS');
          emit({ type: 'shieldUp', target: lead.uid });
        }
        // TRIPLE the current Health (owner sheet 2026-07-30; was double), lifting maxHealth with it so
        // healing/Rise can't clip it back down. `gain` is 2x because it is ADDED to the existing body.
        // One tripling per copy held (boolean-flag family, owner 2026-08-27) — each reads the grown Health.
        for (let k = 0; k < flagCopiesOf(rside, 'runeWarding'); k++) {
          const gain = lead.health * 2;
          lead.health += gain;
          lead.maxHealth = Math.max(lead.maxHealth ?? lead.health, lead.health);
          emit({ type: 'buff', target: lead.uid, attack: 0, health: gain, source: lead.uid });
        }
      }
    }
    // RUNE OF HELD STRENGTH (owner rework 2026-08-27, q-runedup-oneshot revise — was a one-shot on purchase):
    // Start of Combat, the left and right-most living minions gain the stats of the LEFT-MOST card the run
    // held in hand when this combat was built (`mods.runeHeldStrength`, captured live at combat build; a
    // served rival's snapshot carries its own captured value). `copies` fires the grant once per rune copy.
    if (rmods.runeHeldStrength && (rmods.runeHeldStrength.attack > 0 || rmods.runeHeldStrength.health > 0)) {
      const hs = rmods.runeHeldStrength;
      const alive = boards[rside].filter((m) => !m.dead && m.health > 0);
      const ends = alive.length === 0 ? [] : alive.length === 1 ? [alive[0]!] : [alive[0]!, alive[alive.length - 1]!];
      if (ends.length > 0) {
        nextStep(); fireTrigger('runeHeldStrength', rside);
        const reps = Math.max(1, hs.copies ?? 1);
        for (const m of ends) ctx.buff(m, hs.attack * reps, hs.health * reps, 'Rune of Held Strength');
      }
    }
    // Echoing Coop: trigger every minion's Echo once, without killing the body (Sylus doubles them). The
    // Deathrattle tally (Grim) is player-only.
    if (rmods.echoingCoop) {
      let coopFired = false;
      for (const minion of [...boards[rside]]) {
        if (minion.dead || minion.health <= 0 || !minion.effects.some((e) => e.on === 'onDeath')) continue;
        nextStep();
        if (!coopFired) { fireTrigger('echoingCoop', rside); coopFired = true; }
        emit({ type: 'sc', source: minion.uid, text: 'Echo' });
        if (rside === 'player') bumpDeathrattles(1);
        fireOwnDeathrattles(minion);
      }
    }
    // Rune of Rallying: trigger each minion's Rally (on-attack) effects once — a free rally without an attack.
    // Rune of Rallying (owner clarification 2026-07-31): trigger the LEFT-MOST Rally effect only — it used
    // to fire every Rally on the board.
    if (rmods.runeRallying) {
      const first = [...boards[rside]].find((m) => canRally(m));
      if (first) {
        nextStep();
        fireTrigger('runeRallying', rside);
        // One Rally fire per copy held (boolean-flag family, owner 2026-08-27: "trigger your left-most Rally twice").
        for (let k = 0; k < flagCopiesOf(rside, 'runeRallying'); k++) fireFreeRally(first, rside);
      }
    }
    // Empty Graves (reworked 2026-07-21): give your LEFT-MOST minion "Rally: trigger your left-most Echo".
    // Previously the first friendly death summoned a Gravebody. The grant rides the body (not the position),
    // so it dies with that minion rather than sliding onto whoever is leftmost later.
    if (rmods.emptyGraves) {
      const lm = boards[rside].find((m) => !m.dead && m.health > 0);
      if (lm) {
        nextStep();
        fireTrigger('emptyGraves', rside);
        lm.emptyGravesRally = true;
        if (!lm.keywords.includes('RL')) lm.keywords.push('RL');
        emit({ type: 'keyword', target: lm.uid, keyword: 'RL', source: lm.uid });
      }
    }
    // Rune of Rebirth (owner sheet 2026-07-31): ONE random friendly minion gains the EXACT-COPY Echo —
    // the same Rise-vs-copy distinction Living Treasure hit (Rise returns the printed body; the Echo copies
    // current stats). Registered explicitly: the initial board's effects were already registered before
    // Start of Combat, so the normal registration pass will not see this graft.
    if (rmods.runeRebirth) {
      // One grant per copy held (boolean-flag family, owner 2026-08-27) — each lands on a fresh eligible body.
      for (let k = 0; k < flagCopiesOf(rside, 'runeRebirth'); k++) {
        const eligible = boards[rside].filter((m) => !m.dead && m.health > 0 && !m.effects.some((e) => e.do === 'echoSummonCopyNoEcho'));
        if (eligible.length === 0) break;
        const m = eligible[ctx.rng.int(eligible.length)]!;
        nextStep(); // step FIRST so the badge pulse lands on the grant's own beat
        fireTrigger('runeRebirth', rside);
        const eff: EffectDef = { on: 'onDeath', do: 'echoSummonCopyNoEcho', params: {} };
        m.effects = [...m.effects, eff];
        registerEffect(m, eff);
        emit({ type: 'sc', source: m.uid, text: `${m.name} gains an Echo`, cast: true, grantsEcho: true });
      }
    }
    // Rune of Rising Graves: give the two left-most Undead Rise (Reborn) — a foldable `keyword` R grant.
    if (rmods.runeRisingGraves) {
      let given = 0;
      // 2 Rise grants per copy held (boolean-flag family, owner 2026-08-27) — the walk simply reaches deeper.
      const graveCap = 2 * flagCopiesOf(rside, 'runeRisingGraves');
      for (const m of boards[rside]) {
        if (given >= graveCap) break;
        if (m.dead || m.health <= 0 || m.rebornAvailable || !isUndeadMinion(m)) continue;
        nextStep(); // step FIRST so the badge pulse lands on the grant's own beat, not the previous one
        if (given === 0) fireTrigger('runeRisingGraves', rside);
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
  const runeAvenge = (everyN: number, flag: string, mask: (m: QuestCombatMods, side: Side) => boolean, fire: (side: Side) => void): void => {
    bus.on('avenge', (payload) => {
      const { side, count } = payload as { side: Side; count: number };
      if (count % everyN !== 0) return;
      const m = modsFor(side);
      if (!mask(m, side)) return;
      fireTrigger(flag, side); // pulse the rune's badge when its Avenge fires
      // COPIES (Rune of Duplication, owner report 2026-08-06): a boolean flag can't say "twice", so the
      // copy count says it here. Two Rune of the Procession = two fires. `?? 1` keeps every single-copy run
      // byte-identical, and Rune of Fury multiplies the whole thing exactly as it always did.
      const copies = Math.max(1, m.flagCopies?.[flag] ?? 1);
      for (let c = 0; c < copies; c++) {
        fire(side);
        // "your Avenge effects trigger twice" — per side, one extra fire per Fury copy held (owner 2026-08-27).
        if (m.runeFury) for (let k = 0; k < flagCopiesOf(side, 'runeFury'); k++) fire(side);
      }
    });
  };
  // Combat avenge runes — PER SIDE (a served enemy runs its own): Broodpit + Spearline summon to their own side.
  runeAvenge(4, 'runeBroodpit', (m) => !!m.runeBroodpit, (side) => { // Avenge (4): summon 2 Imps with Taunt (owner rebalance 2026-08-03, was 3)
    const imp = cards['impscrap'];
    if (imp) { nextStep(); for (let i = 0; i < 2; i++) summonMinion(side, imp, undefined, ['T']); }
  });
  // CINDARA — HOARD. Avenge (4): summon a Whelp that strikes immediately, then improve every Whelp on that
  // side by +2/+2. Registered through `runeAvenge` like the rune Avenges, so it inherits the modulo, the
  // per-side mask and the Rune of Fury re-fire for free.
  //
  // ORDER IS LOAD-BEARING (owner ruling 2026-08-23: "both whelps would be 5/5"). Summon at the CURRENT level,
  // then buff the Whelps that were ALREADY out, then raise the level. The new Whelp defers onto the
  // immediate-attack queue and is not on the board yet, so it cannot receive the retroactive buff — but it was
  // minted at the level the buff brings everyone else up TO, so they converge exactly. Walk it through:
  //   fire 1 → level 0: Whelp A lands 1/1, nobody to buff, level → 2
  //   fire 2 → level 2: Whelp B lands 3/3, A buffed to 3/3, level → 4   (both 3/3 ✓)
  //   fire 3 → level 4: Whelp C lands 5/5, A+B buffed to 5/5, level → 6 (all 5/5 ✓)
  // The base stats ride on a CLONED def rather than `copyStats`, because `placeSummon` skips `applyAuras` for
  // an exact copy — a copyStats Whelp would silently miss the side's Dragon auras.
  runeAvenge(4, 'hoard', (m) => !!m.hoard, (side) => {
    const base = cards['cindarawhelp'];
    if (!base) return;
    const lvl = hoardLevel[side];
    nextStep();
    summonMinion(side, { ...base, attack: base.attack + lvl.attack, health: base.health + lvl.health }, undefined, undefined, false, true);
    for (const m of boards[side]) {
      if (m.dead || m.health <= 0 || m.cardId !== 'cindarawhelp') continue;
      ctx.buff(m, 2, 2, 'Hoard');
    }
    lvl.attack += 2; lvl.health += 2;
  });
  runeAvenge(4, 'runeSpearline', (m) => !!m.runeSpearline, (side) => { // summon a Spear Warden that attacks immediately
    const knit = cards['knit'];
    if (knit) { nextStep(); summonMinion(side, knit, undefined, undefined, false, true); }
  });
  // Economy avenge runes — PLAYER-ONLY (grant to the run's spell power / max Gold; no enemy meaning).
  runeAvenge(3, 'runeAppraisal', (m, side) => side === 'player' && !!m.runeAppraisal, () => { const r = ctx.improveRepsFor('player'); ctx.grantSpellPower(r, r, 'player', undefined); }); // "improve your spells +1/+1" — ×2 under Rune of Mastery
  // Batch 5 (owner sheet 2026-07-30). All three go through `runeAvenge`, which already owns the modulo, the
  // per-side mask and the Rune of Fury re-fire — so these are registrations, not new machinery.
  runeAvenge(4, 'runeLastCall', (m, side) => side === 'player' && !!m.runeLastCall, (side) => {
    // Player-only: `grantToHand` has no meaning for a served enemy. A set without the Ales grants nothing
    // rather than injecting cards the run could never otherwise see. Owner 2026-08-11: Avenge(4), TWO Ales.
    const ales = ctx.poolCards(side).filter((c) => ALE_IDS.includes(c.id));
    if (ales.length > 0) for (let i = 0; i < 2; i++) ctx.grantToHand(ctx.rng.pick(ales).id, side, undefined);
  });
  runeAvenge(3, 'runeCinderLedger', (m, side) => side === 'player' && !!m.runeCinderLedger, (side) => {
    const n = modsFor(side).runeCinderLedger ?? 6;
    ctx.grantImpBuff(n, n, side); // run-wide + carried back, the same channel Imp King uses
  });
  // Rune of Counterpoint — Avenge (1), i.e. EVERY friendly death, sends your left-most in for a free swing.
  //
  // Routed through `runeAvenge` + `ctx.attackNow` deliberately. An earlier cut queued the strike straight from
  // the death handler and it never resolved into an attack: measured identical to baseline across two board
  // shapes, through three different queueing attempts. Solaris Fang has done exactly this from an Avenge for
  // ages, so the working path was the avenge dispatch, not the raw death site — this uses that.
  runeAvenge(1, 'runeCounterpoint', (m) => !!m.runeCounterpoint, (side) => {
    const lead = boards[side].find((m) => !m.dead && m.health > 0 && m.attack > 0);
    if (lead) ctx.attackNow?.(lead, false);
  });
  runeAvenge(3, 'runeHuntingBell', (m) => !!m.runeHuntingBell, (side) => {
    // Left-MOST rally-capable body, so which minion answers the bell is a seating decision rather than RNG.
    const lead = boards[side].find(canRally);
    if (!lead) return;
    nextStep();
    fireFreeRally(lead, side);
  });
  runeAvenge(4, 'runeCarrionCoin', (m) => !!m.runeCarrionCoin, (side) => {
    // Rune of Carrion Coin: every 4th friendly death hands over a random Shop spell. `grantRandomSpell` is
    // the shared grant Badgington's Rally uses — it already picks from the run's pinned pool, respects the
    // hand cap and carries back at settle, and it is player-only, so a served enemy's deaths grant nothing.
    nextStep();
    ctx.grantRandomSpell(1, side, undefined);
  });
  runeAvenge(3, 'runeEngraving', (m) => !!m.runeEngraving, (side) => {
    // Rune of Engraving: the side's Rubies permanently give +1 more Health. Routed through gainRubyBonus —
    // the same channel Veinbreaker uses — so the "+0/+1 Ruby Power" narration, the live flourish and the
    // permanent carry-back all ride for free.
    nextStep();
    ctx.gainRubyBonus(0, 1, side, undefined);
  });
  // RUNE OF SHIFTING FACETS: the Engraving's Avenge with a MOVING axis. The axis in force is decided in the
  // shop (it alternates at every turn setup) and rides in on the mod, so a fight always resolves the half the
  // rune card was advertising. Same `gainRubyBonus` channel, so the narration, flourish and carry-back are free.
  runeAvenge(3, 'runeShiftingFacets', (m) => !!m.runeShiftingFacets, (side) => {
    const axis = modsFor(side).runeShiftingFacets;
    if (!axis) return;
    nextStep();
    ctx.gainRubyBonus(axis === 'attack' ? 1 : 0, axis === 'health' ? 1 : 0, side, undefined);
  });
  // RUNE OF THE DEEPENING VEIN: Engraving + Gemstorm in one Avenge — improve Rubies on BOTH axes, then play a
  // real Ruby on every friendly Kobold (the `playRubyOn` primitive, so the Paragon multiplier, the target's
  // on-Ruby watchers and the Spellstone cast-count all fire). Improving FIRST is deliberate: the Rubies it
  // plays are worth the new, larger line.
  runeAvenge(3, 'runeDeepeningVein', (m) => !!m.runeDeepeningVein, (side) => {
    nextStep();
    ctx.gainRubyBonus(1, 1, side, undefined);
    const kobolds = boards[side].filter((m) => !m.dead && m.health > 0 && (m.tribe === 'kobold' || m.tribe2 === 'kobold' || !!cards[m.cardId]?.universalTribe));
    for (const k of kobolds) playRubyOn(ctx, k, k, 1);
  });
  runeAvenge(2, 'runeGemstorm', (m) => !!m.runeGemstorm, (side) => {
    // "PLAY 2 Rubies", so it goes through the real Ruby-play primitive — which folds in the side's Ruby
    // strength (a late-run Gemstorm pays full value rather than 1/1s), Deepdelve Paragon's multiplier, the
    // target's `onRubyPlayed` listeners, the Spellstone cast-count and the `rubyGain` ledger. The original
    // hand-rolled `ctx.buff` here carried only the first of those, which is why the Paragon was silently not
    // amplifying Gemstorm's Rubies (owner report 2026-08-06). Each Kobold is the play's own source: the rune
    // has no body on the board, and the side/attribution are what the primitive actually reads.
    const n = modsFor(side).runeGemstorm ?? 2;
    const kobolds = boards[side].filter((m) => !m.dead && m.health > 0 && (m.tribe === 'kobold' || m.tribe2 === 'kobold'));
    if (kobolds.length === 0) return;
    nextStep();
    for (const k of kobolds) playRubyOn(ctx, k, k, n);
  });
  runeAvenge(4, 'runeProcession', (m) => !!m.runeProcession, (side) => {
    // Right-most LIVING body: doubling a corpse would read as the rune doing nothing.
    const living = boards[side].filter((m) => !m.dead && m.health > 0);
    const tail = living[living.length - 1];
    if (!tail) return;
    nextStep();
    ctx.buff(tail, tail.attack, tail.health, 'Rune of the Procession');
  });
  runeAvenge(4, 'runeSoulTaxes', (m, side) => side === 'player' && !!m.runeSoulTaxes, () => ctx.grantMaxGold(1, 'player')); // +1 max Gold
  // Deep Hunger (Demon capstone, reworked 2026-07-21): Avenge (3) → add 2 Fodder to your next shop. Was "the
  // leftmost Demon gains Slaughter: add 3 Fodder". Player-only — a served enemy has no shop to stock.
  runeAvenge(3, 'deepHunger', (m, side) => side === 'player' && !!m.deepHunger, () => { fodderGrants += 2; });

  // Rune of Packcraft (owner rework 2026-08-04): the BODY YOU SUMMON comes in +6/+6. It used to be an
  // `onSummon` listener that buffed your whole Beast line whenever a Beast was summoned; it is now applied at
  // the summon SITE beside Rune of the Hatchery — see the grant there. Kept as an empty branch-free note so
  // the rune reads in one place: nothing subscribes to the bus for Packcraft any more.
  // Rune of Inheritance: when your LEFT-MOST living minion dies, your right-most living minion gains its stats. Per side.
  if (playerState.questMods.runeInheritance || enemyState.questMods.runeInheritance) {
    bus.on('onDeath', (payload) => {
      const { minion, side } = payload as { minion: Minion; side: Side };
      if (!modsFor(side).runeInheritance) return;
      const idx = boards[side].indexOf(minion);
      if (idx < 0 || boards[side].slice(0, idx).some((m) => !m.dead && m.health > 0)) return; // not the leftmost
      const right = [...boards[side]].reverse().find((m) => !m.dead && m.health > 0 && m !== minion);
      // The stats land once per copy held (boolean-flag family, owner 2026-08-27).
      const ih = flagCopiesOf(side, 'runeInheritance');
      if (right) { fireTrigger('runeInheritance', side); ctx.buff(right, minion.attack * ih, minion.maxHealth * ih, 'Rune of Inheritance'); }
    });
  }
  // Passing Spears: your Spear Wardens gain "Echo: when this dies, give its stats to a friendly minion" — on a
  // Spear Warden's death, hand its full stats (attack + max Health) to your strongest OTHER living minion. Per side.
  if (playerState.questMods.passingSpears || enemyState.questMods.passingSpears) {
    bus.on('onDeath', (payload) => {
      const { minion, side } = payload as { minion: Minion; side: Side };
      if (minion.cardId !== 'knit' || !modsFor(side).passingSpears) return;
      let best: Minion | undefined;
      for (const m of boards[side]) {
        if (m === minion || m.dead || m.health <= 0) continue;
        if (!best || m.attack + m.maxHealth > best.attack + best.maxHealth) best = m;
      }
      if (best) { nextStep(); fireTrigger('passingSpears', side); ctx.buff(best, minion.attack, minion.maxHealth, 'Passing Spears'); } // its own beat, not the death's
    });
  }
  // Rune of Salvage: a friendly Mech losing its Ward drops a random Attachment into your hand next shop —
  // ECONOMY/HAND, so player-only (a served enemy has no hand; grantToHand no-ops for it anyway).
  if (playerState.questMods.runeSalvage) {
    fireTrigger('runeSalvage', 'player'); // pulse the badge when the Attachment is actually banked
    const magnetics = ctx.poolCards('player').filter((c) => (c.tribe === 'mech' || c.tribe2 === 'mech') && c.keywords.includes('M') && !c.token && !c.spell);
    if (magnetics.length > 0) {
      bus.on('onLoseDivineShield', (payload) => {
        const { minion, side } = payload as { minion: Minion; side: Side };
        if (side !== 'player' || !(minion.tribe === 'mech' || minion.tribe2 === 'mech' || !!minion.universalTribe)) return;
        // One Attachment per copy held (boolean-flag family, owner 2026-08-27).
        for (let k = 0; k < flagCopiesOf('player', 'runeSalvage'); k++) ctx.grantToHand(magnetics[rng.int(magnetics.length)]!.id, 'player', minion.uid);
      });
    }
  }
  // Rune of First Claws: at Start of Combat, the left-most + right-most Beasts attack immediately. Per side.
  for (const fside of ['player', 'enemy'] as const) {
    if (!modsFor(fside).runeFirstClaws) continue;
    const beasts = boards[fside].filter((m) => !m.dead && m.health > 0 && m.attack > 0 && isBeast(m));
    const targets = beasts.length <= 2 ? beasts : [beasts[0]!, beasts[beasts.length - 1]!];
    if (targets.length > 0) {
      nextStep(); fireTrigger('runeFirstClaws', fside);
      // One immediate attack each per copy held (boolean-flag family, owner 2026-08-27).
      for (let k = 0; k < flagCopiesOf(fside, 'runeFirstClaws'); k++) {
        for (const m of targets) if (!m.dead && m.health > 0) ctx.attackNow?.(m, false);
        flushImmediateAttacks();
      }
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
  // A board that BEGINS combat with room (fewer than 7) fills its "while you have space" summons NOW, before any
  // attacks — Rune of the Brood / Living Echoes / Decoy Sigil used to wait for the first attack's cascade to free
  // a slot (the only place fillFreeSlots ran), so on an already-short board they fired a beat late, after the
  // opponent had already swung (owner bug 2026-08-11). The bounded per-combat counters (broodSpent/echoesSpent/
  // decoysSpent) keep this from double-firing with the in-loop call below.
  fillFreeSlots();
  flushImmediateAttacks(); // Whelps summoned during Start-of-Combat / Reclaimer / the fills above strike before the rotation begins
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
    fillFreeSlots(); // Rune of the Brood / Living Echoes: a slot freed by this cascade gets filled
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
      ? enemyState.tier + survivorsE.reduce((sum, m) => sum + (cards[m.cardId]?.tier ?? 1), 0)
      : 0;
  // The SAME numbers, itemized, so the defeat animation can tally the real contributions instead of
  // recomputing them from its own inputs. It used to derive the counter from `nextOpponent()?.tier` and the
  // replay's final frame — two sources that can disagree with what the fight actually used (a procedural
  // fallback, a snapshot without a tier, a body still shown mid-death), and any disagreement read as the
  // counter saying one number while Resolve dropped by another (owner report 2026-08-08). Sums to
  // `playerDamage` by construction; the run loop's round cap is applied on top, by the caller.
  const damageBreakdown =
    result === 'lose'
      ? { oppTier: enemyState.tier, survivorTiers: survivorsE.map((m) => cards[m.cardId]?.tier ?? 1) }
      : undefined;
  // The MIRROR: what the enemy side would take, by the identical formula. A single-run fight never needed it
  // (only the player has a Resolve pool), but a lobby round has two sides that both take damage from ONE
  // authoritative combat — resolving the same fight twice with the sides swapped can disagree, so the number
  // has to come out of this call. Deliberately just the mirror: no per-side carry-backs, because a lobby seat
  // backed by a RECORDED run does not progress — its next board is already on disk.
  const enemyDamage =
    result === 'win'
      ? playerState.tier + survivorsP.reduce((sum, m) => sum + (cards[m.cardId]?.tier ?? 1), 0)
      : 0;

  // Per-instance state to carry back to the run board: a Kennelmaster whose Avenge
  // improved its summon buff this combat keeps the higher bonus for the run.
  // Rouge Rogue's escalation is "this combat" BY RULE — it rides `summonBonus` like the permanent improvers
  // (Kennelmaster, Oona, Broodwright) but must NOT persist, or three fights of Imp attacks would compound into
  // a permanent aura the card never printed. Excluded here, at the single point deciding what persists.
  const COMBAT_ONLY_SUMMON_BONUS = new Set(['dm_chancellor']);
  const playerSummonBonus = boards.player
    .filter((m) => m.sourceUid !== undefined && m.summonBonus > 0 && !COMBAT_ONLY_SUMMON_BONUS.has(m.cardId))
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
    .flatMap((m) => {
      // Split the permanent gain into its RUBY share and the rest, so each carries its own label. Before this
      // every non-Engraved permaGain was attributed to Flowing Monk, which made a combat Ruby show up on the
      // run board as a Flowing Monk gift (owner report 2026-07-25).
      const ruby = m.permaRuby ?? { attack: 0, health: 0 };
      const restA = m.permaGain!.attack - ruby.attack;
      const restH = m.permaGain!.health - ruby.health;
      const out: { sourceUid: string; attack: number; health: number; engraved: boolean; ruby?: boolean }[] = [];
      if (ruby.attack > 0 || ruby.health > 0) {
        out.push({ sourceUid: m.sourceUid!, attack: ruby.attack, health: ruby.health, engraved: false, ruby: true });
      }
      if (restA > 0 || restH > 0) {
        out.push({ sourceUid: m.sourceUid!, attack: restA, health: restH, engraved: m.keywords.includes('EG') || !!m.auraEngraved });
      }
      return out;
    });

  // Rune of Reinvestment: pays ONCE when the fight settles, scaled by how many bodies you put on the board.
  // Paid here rather than per summon so the Shop sees a single combined buff instead of a drip.
  const reinvest = modsFor('player').runeReinvestment ?? 0;
  if (reinvest > 0 && playerSummonCount > 0) {
    fireTrigger('runeReinvestment', 'player'); // pulse the badge on the settle payout (once, not per summon)
    tavernBuyGain.attack += reinvest * playerSummonCount;
    tavernBuyGain.health += reinvest * playerSummonCount;
  }
  // Flash's LAST claim: only knowable now the fight is over. Granted here rather than at settle so it still
  // rides `playerHandGrants` and flies to hand in the replay, exactly like the `first` branch does live.
  if (flashPick === 'last' && !flashDone && lastKill) {
    const lastDef = cards[lastKill];
    if (lastDef && !lastDef.spell && !lastDef.ruby) {
      flashDone = true;
      const holder = boards.player.find((m) => !m.dead)?.uid;
      for (let i = 0; i < flashCopies; i++) ctx.grantToHand(lastKill, 'player', holder);
    }
  }

  return {
    events,
    result,
    playerDamage,
    ...(damageBreakdown ? { damageBreakdown } : {}),
    enemyDamage,
    playerDeathrattles,
    playerRallies: playerRallies > 0 ? playerRallies : undefined,
    playerImpsSummoned: playerImpsSummoned > 0 ? playerImpsSummoned : undefined,
    playerDeaths: deaths.player,
    playerSurvivorCardIds: (() => {
      const alive = boards.player.filter((m) => !m.dead && m.health > 0).map((m) => m.cardId);
      return alive.length > 0 ? alive : undefined;
    })(),
    enemyDeaths,
    playerFirstKill: firstKill,
    playerLastKill: lastKill,
    playerQuestTally: (questTally.attack > 0 || questTally.summonCombat > 0 || questTally.slaughter > 0 || questTally.slaughterKeyword > 0 || Object.keys(questTally.statGainByTribe).length > 0) ? questTally : undefined,
    playerQuestEvents: questEvents.length > 0 ? questEvents : undefined,
    playerBeastBuyAtkGain: beastBuyAtkGain > 0 ? beastBuyAtkGain : undefined,
    playerBeastBuyHpGain: beastBuyHpGain > 0 ? beastBuyHpGain : undefined,
    playerBeastScaleProgress: beastScale ? beastScaleProgress : undefined,
    initial,
    playerSummonBonus,
    playerHpGrantBonus: playerHpGrantBonus.length > 0 ? playerHpGrantBonus : undefined,
    playerSpellProgress: playerSpellProgress.length > 0 ? playerSpellProgress : undefined,
    playerAscendCount: playerAscendCount.length > 0 ? playerAscendCount : undefined,
    playerPermaBuffs: playerPermaBuffs.length > 0 ? playerPermaBuffs : undefined,
    playerHandGrants: handGrants.length > 0 ? handGrants : undefined,
    playerRubyGrants: rubyGrants.n > 0 ? rubyGrants.n : undefined,
    playerNextTurnSpellCopies: nextTurnSpellCopies.n > 0 ? nextTurnSpellCopies.n : undefined,
    playerRubyBonusGain: (rubyBonusGain.player.attack > 0 || rubyBonusGain.player.health > 0) ? { ...rubyBonusGain.player } : undefined,
    playerRubyMints: rubyMintCount > 0 ? rubyMintCount : undefined,
    playerHandSummoned: handSummoned.length > 0 ? handSummoned : undefined,
    playerBeastExtraGain: (beastExtraGain.player.hunt > 0 || beastExtraGain.player.ritual > 0) ? { ...beastExtraGain.player } : undefined,
    playerTavernBuyGain: (tavernBuyGain.attack > 0 || tavernBuyGain.health > 0) ? { ...tavernBuyGain } : undefined,
    playerWildHuntGrown: wildHuntGrown.player > 0 ? wildHuntGrown.player : undefined,
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
    playerSpellEscalationGain: (spellEscalationGain.player.attack > 0 || spellEscalationGain.player.health > 0)
      ? { ...spellEscalationGain.player } : undefined,
    playerDiscoverCasts: discoverCasts.length > 0 ? discoverCasts : undefined,
    playerNextShopBuff: (nextShopBuffGain.attack > 0 || nextShopBuffGain.health > 0) ? { ...nextShopBuffGain } : undefined,
    playerUndeadBuyAtkGain: undeadBuyAtkGain > 0 ? undeadBuyAtkGain : undefined,
    playerSlaughterCopy: slaughterCopyId,
    playerUndeadAuraGain: undeadAuraGain.attack > 0 || undeadAuraGain.health > 0 ? undeadAuraGain : undefined,
    playerImpBuffGain: impBuffGain.attack > 0 || impBuffGain.health > 0 ? impBuffGain : undefined,
    // Cindara: only the GROWTH, not the level — settle adds it to the run's banked total, so a re-simulated
    // combat cannot double-count the improvement it started with.
    playerHoardGain: hoardLevel.player.attack > hoardStart.attack
      ? { attack: hoardLevel.player.attack - hoardStart.attack, health: hoardLevel.player.health - hoardStart.health }
      : undefined,
    playerRightmostSlotBuff: rightmostSlotGain.attack > 0 || rightmostSlotGain.health > 0 ? { ...rightmostSlotGain } : undefined,
    playerBeastialSwarmLevel: beastialLevel.player > beastialStart.player ? beastialLevel.player : undefined,
    playerBoardBuffGain: boardBuffGain.attack > 0 || boardBuffGain.health > 0 ? { ...boardBuffGain } : undefined,
    playerMagneticBuffGain: magneticBuffGain.attack > 0 || magneticBuffGain.health > 0 ? magneticBuffGain : undefined,
    playerFodderBuffGain: fodderBuffGain.attack > 0 || fodderBuffGain.health > 0 ? fodderBuffGain : undefined,
    // Enemy run-level scalers so the UI can render an enemy Grim/Taragosa/Pack Leader/Runescale at the
    // OPPONENT's value. Present only when the enemy actually had a nonzero scaler (else the card's base text
    // is already accurate → the UI's player-side fallback is fine).
    enemyScalers: (enemySpellPower.attack || enemySpellPower.health || enemySpellsThisTurn || enemyBeastsPlayed || enemyDeathrattles || enemyState.conductorBuff)
      ? { spellPower: { ...enemySpellPower }, spellsThisTurn: enemySpellsThisTurn, beastsPlayed: enemyBeastsPlayed, deathrattles: enemyDeathrattles, conductorBuff: enemyState.conductorBuff ?? 0 }
      : undefined,
  };
}
