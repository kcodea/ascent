import type {
  BoardMinion,
  CardDef,
  CombatContext,
  CombatEvent,
  CombatOutcome,
  CombatResult,
  Keyword,
  Minion,
  MinionSnapshot,
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
const IMMEDIATE_ATTACK_GUARD = 64; // bounds a chain of attack-on-summon Whelps (each kill can spawn another)

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
): CombatResult {
  const events: CombatEvent[] = [];
  const bus = new CombatBus();
  let uidCounter = 0;
  const mkUid = (): string => `m${uidCounter++}`;
  const handGrants: string[] = []; // cards the player's deathrattles add to hand after combat
  const spellPowerGain = { attack: 0, health: 0 }; // run-wide spell-power gained this combat (Skullblade)
  let undeadBuyAtkGain = 0; // permanent Undead buy-time attack from this combat (Karthus)
  const impBuffGain = { attack: 0, health: 0 }; // permanent Imp buff from this combat (Imp King / Brood Avenge)
  const fodderBuffGain = { attack: 0, health: 0 }; // permanent run-wide Fodder enchant from this combat (Bane via Ryme)
  const cardBuffGains: { cardId: string; attack: number; health: number }[] = []; // run-wide card-type buffs (Grave Knit)
  let fodderGrants = 0; // Fodder queued into the next tavern (Burial Imp's Deathrattle)
  let maxGoldGain = 0; // permanent max-Gold gain (Soulsman's Avenge)
  const buffCounts = new Map<string, number>(); // # of stat-grants per minion this combat (Tara → Taragosa ascend)
  let freeRollGrants = 0; // free shop rerolls banked from combat (Gryphon's on-damaged)
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
    m.tribe === 'undead' || m.tribe2 === 'undead' || !!cards[m.cardId]?.universalTribe;

  // Each aura yields the +atk/+hp it grants a given minion (0/0 = doesn't apply). `bakedAtk` is the slice of
  // Attack already folded into run-board stats at buy time (re-added only to a from-base body).
  const AURAS: { label: string; grant: (m: Minion) => { attack: number; health: number; bakedAtk?: number } }[] = [
    {
      label: 'Undead Aura',
      grant: (m) =>
        isUndeadMinion(m)
          ? { attack: undeadAttackBonus, health: undeadHealthBonus, bakedAtk: undeadBuyAtk }
          : { attack: 0, health: 0 },
    },
    {
      label: 'Imp Aura',
      grant: (m) =>
        cards[m.cardId]?.imp ? { attack: impAtkBonus, health: impHpBonus } : { attack: 0, health: 0 },
    },
  ];

  const applyAuras = (m: Minion, fromBase: boolean): void => {
    if (m.side !== 'player') return;
    for (const aura of AURAS) {
      const g = aura.grant(m);
      const a = g.attack + (fromBase ? g.bakedAtk ?? 0 : 0);
      if (a > 0) m.attack = Math.max(0, m.attack + a);
      if (g.health > 0) { m.health += g.health; m.maxHealth += g.health; }
    }
    // Per-card run enchant (Fodder Aura + Eternal Knight). The prior-run total is authoritative in `cardBuffs`
    // (already baked on run-board bodies → only re-add from base); fall back to the minion's own buff breakdown
    // (keyed under the card's own name) so a board that carries the enchant inline still re-applies it. The
    // stacks banked THIS fight apply to every fresh body.
    const def = cards[m.cardId];
    const prior = fromBase
      ? cardBuffs[m.cardId] ?? (def ? m.buffs?.find((b) => b.source === def.name) : undefined)
      : undefined;
    const gain = cardBuffGains.find((c) => c.cardId === m.cardId);
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

  // Enemy-side deaths this combat — Cassen's Collision banks these toward its 5-kill payoff (carried back).
  let enemyDeaths = 0;

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
    hpGrantBonus: m.hpGrantBonus,
    ascendProgress: m.ascendProgress,
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

  const ctx: CombatContext = {
    rng,
    bus,
    boards,
    events,
    spellsThisTurn,
    spellPower,
    fodderConsumedAtk,
    fodderConsumedHp,
    deathrattleTally: () => deathrattlesBase + playerDeathrattles,
    log: (event) => {
      events.push(event);
    },
    living,
    getCard: (id) => {
      const card = cards[id];
      if (!card) throw new Error(`Unknown card: ${id}`);
      return card;
    },
    allCards: () => Object.values(cards),
    buff: (target, attack, health, source) => {
      target.attack = Math.max(0, target.attack + attack); // Attack never drops below 0
      target.health += health;
      if (health > 0) target.maxHealth += health;
      events.push({ type: 'buff', target: target.uid, attack, health, source });
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
    summon: (side, card, nearUid, grantKeywords) => summonMinion(side, card, nearUid, false, grantKeywords),
    flushImmediateAttacks: () => flushImmediateAttacks(),
    grantToHand: (cardId, side, sourceUid) => {
      // Combat can't touch the recruit hand directly; record player-side grants so the
      // run loop can add them after the replay (Arcane Weaver → a Spirit Fire copy), and log a
      // `toHand` event so the replay shows the card flying to your hand as it happens.
      if (side === 'player') {
        handGrants.push(cardId);
        events.push({ type: 'toHand', cardId, side, source: sourceUid });
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
      if (sourceUid && (attack !== 0 || health !== 0)) events.push({ type: 'sc', source: sourceUid, text: `+${attack}/+${health} Spell Power` });
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
    deferBattlecry: (cardId, golden, side) => {
      if (side !== 'player') return; // enemies have no run state to carry economy battlecries back to
      deferredBattlecries.push({ cardId, golden });
    },
    grantMaxGold: (amount, side) => {
      if (side !== 'player') return; // enemies have no economy
      maxGoldGain += amount;
    },
    grantFreeRolls: (count, side) => {
      if (side !== 'player') return; // enemies have no shop
      freeRollGrants += count;
    },
    grantRandomSpell: (count, side, sourceUid) => {
      if (side !== 'player') return; // enemies have no hand
      // Pick the ACTUAL spell now (tavern tier passed in) and route it through grantToHand — so the replay
      // shows the real card flying to your hand (a `toHand` event), and settle just adds the carried cardId.
      const pool = Object.values(cards).filter((c) => c.spell && c.tier <= playerTier);
      for (let i = 0; i < count && pool.length > 0; i++) {
        const pick = pool[Math.floor(rng.next() * pool.length)]!;
        handGrants.push(pick.id);
        events.push({ type: 'toHand', cardId: pick.id, side, source: sourceUid });
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
        events.push({ type: 'toHand', cardId: pick.id, side, source: sourceUid });
      }
    },
    grantImpBuff: (attack, health, side) => {
      if (side !== 'player') return; // enemies have no run state
      impBuffGain.attack += attack;
      impBuffGain.health += health;
    },
    grantFodderBuff: (attack, health, side) => {
      if (side !== 'player') return; // enemies have no run state
      fodderBuffGain.attack += attack;
      fodderBuffGain.health += health;
    },
    grantUndeadBuyAtk: (amount, side) => {
      if (side !== 'player') return; // enemies have no run state
      undeadBuyAtkGain += amount;
    },
    castSpell: (side) => {
      spellTotals[side] += 1; // count the cast first (the triggering spell is included, like recruit-phase Guel)
      if (side === 'player') playerCombatSpells += 1; // carried back → permanently bumps the run's spellsCast
      bus.emit('spellCast', { side, count: spellTotals[side] });
    },
  };

  /**
   * Summon one minion (the single summon chokepoint). Echo Warden: each summoned unit gets one more
   * copy per living Echo Warden (golden = 2) — recursion-guarded by `isEcho` so the copies don't echo
   * themselves. Because this lives in the summon path, it applies to *any* summon (token Deathrattles,
   * `deathrattleFillTribe`'s real minions, Brood Matron, future effects), not just token effects.
   */
  function summonMinion(side: Side, card: CardDef, nearUid: string | undefined, isEcho: boolean, grantKeywords?: Keyword[]): Minion {
    const minion = instantiate({ cardId: card.id, attack: card.attack, health: card.health }, side, cards, mkUid);
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
    applyAuras(minion, true); // run-wide auras — a summon starts from base stats, so re-apply all of them
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
    events.push({ type: 'summon', minion: snapshot(minion), side, index, source: nearUid, ...(isEcho && { echo: true }) });
    bus.emit('onSummon', { minion, side });
    // Persistent tribe auras (Grim) catch minions summoned after they were registered.
    for (const aura of tribeAuras) {
      if (aura.side === side && (aura.tribe === 'any' || minion.tribe === aura.tribe || minion.tribe2 === aura.tribe || (aura.tribe !== 'neutral' && !!cards[minion.cardId]?.universalTribe))) {
        ctx.buff(minion, aura.attack, aura.health, aura.source);
      }
    }
    if (!isEcho) {
      let echoes = 0; // count Echo Wardens without allocating a living() array on every summon
      for (const m of boards[side]) if (!m.dead && m.health > 0 && m.cardId === 'echo') echoes += m.golden ? 2 : 1;
      for (let i = 0; i < echoes && countLiving(side) < 7; i++) summonMinion(side, card, minion.uid, true);
    }
    // Attack-on-summon (Whelp): queue this body to strike immediately, out of turn order. Overflowed summons
    // already returned above, so only minions actually placed on the board reach here.
    if (card.attackOnSummon && !minion.dead && minion.health > 0) pendingAttackOnSummon.push(minion);
    return minion;
  }

  function registerEffects(minion: Minion): void {
    for (const effect of minion.effects) {
      const fn = FACTORIES[effect.do];
      if (!fn) continue; // recruit-phase effects without a combat factory are inert here
      bus.on(effect.on, (payload) => {
        // A mid-combat ascension swaps a minion's effects; the CombatBus can't unregister, so a handler whose
        // effect is no longer in the minion's current set self-disables — the old form's abilities stop firing.
        if (!minion.effects.includes(effect)) return;
        // A dead minion fires nothing except its own Deathrattle.
        if (minion.dead && effect.on !== 'onDeath') return;
        fn(ctx, minion, effect.params ?? {}, payload);
      });
    }
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
    minion.cardId = into;
    minion.name = def.name;
    minion.tribe = def.tribe;
    minion.tribe2 = def.tribe2;
    for (const k of def.keywords) if (!minion.keywords.includes(k)) minion.keywords.push(k);
    minion.effects = def.effects; // old handlers self-disable (the includes-guard above); register the new ones
    registerEffects(minion);
    events.push({ type: 'ascend', target: minion.uid, into });
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
  // Minions summoned mid-combat that strike immediately, out of turn order (Twilight Whelp's 3/3 Whelp) —
  // filled in summonMinion, drained by flushImmediateAttacks after each attack's death cascade settles.
  const pendingAttackOnSummon: Minion[] = [];

  // Fire a minion's OWN Deathrattle / on-death effects directly (no global onDeath broadcast / Avenge / death
  // event) — used by Reborn so a reborn death procs the unit's own Deathrattle without re-triggering other
  // minions' death-watchers. Sylus the Reaper re-procs it (a reborn death is still a death).
  function fireOwnDeathrattles(minion: Minion): void {
    const fireOnce = (): void => {
      for (const effect of minion.effects) {
        if (effect.on !== 'onDeath') continue;
        FACTORIES[effect.do]?.(ctx, minion, effect.params ?? {}, { minion, side: minion.side });
      }
    };
    fireOnce();
    let reaperBonus = 0;
    for (const m of boards[minion.side]) if (!m.dead && m.health > 0 && m.cardId === 'sylus') reaperBonus += m.golden ? 2 : 1;
    for (let r = 0; r < reaperBonus; r++) fireOnce();
  }

  function killOrReborn(minion: Minion, killer?: Minion): void {
    // Reborn (A.3 step 6): a minion's FIRST death fires its Deathrattle / on-death effects, then it returns
    // ONCE at its *base* card stats — shedding combat buffs + granted keywords (Divine Shield, etc.), keeping
    // printed keywords (minus the spent Reborn). Golden → doubled base. So a 2/1 buffed to a 10/3 Divine-Shield
    // body comes back a plain 2/1, but a Twilight Whelp leaves a Whelp on each death. Undead carry-through buffs
    // are re-applied on top (Lantern/buy-time "everywhere" + the run-wide Eternal-Knight enchant); general stat
    // / Imp / Fodder buffs do NOT carry. (Recruit-permanent run-board stats are untouched — instance only.)
    if (minion.rebornAvailable) {
      minion.rebornAvailable = false;
      // It really died: proc the unit's own Deathrattle / on-death effects (each death procs them) BEFORE the
      // body returns — so the Whelp's spawn + the Eternal Knight's +3/+2 land per death, not just on the last.
      if (minion.side === 'player' && minion.effects.some((e) => e.on === 'onDeath')) playerDeathrattles++;
      fireOwnDeathrattles(minion);
      const def = cards[minion.cardId];
      const mul = minion.golden ? 2 : 1;
      if (def) {
        minion.attack = Math.max(0, def.attack * mul);
        minion.health = Math.max(1, def.health * mul);
        minion.maxHealth = minion.health;
        minion.keywords = def.keywords.filter((k) => k !== 'R');
        minion.divineShield = def.keywords.includes('DS');
      } else {
        minion.keywords = minion.keywords.filter((k) => k !== 'R');
        minion.health = 1;
        minion.maxHealth = 1;
      }
      applyAuras(minion, true); // Reborn reset stats to base — re-apply every run-wide aura on top
      events.push({ type: 'reborn', target: minion.uid, hp: minion.health, attack: minion.attack, keywords: [...minion.keywords] });
      return;
    }
    minion.dead = true;
    minion.health = 0;
    events.push({ type: 'death', target: minion.uid, side: minion.side });
    // Count enemy deaths (Cassen's Collision banks them toward its 5-kill payoff).
    if (minion.side === 'enemy') enemyDeaths++;
    // Count your Deathrattles as they trigger (before firing, so Grim's own death counts toward its buff).
    if (minion.side === 'player' && minion.effects.some((e) => e.on === 'onDeath')) playerDeathrattles++;
    bus.emit('onDeath', { minion, side: minion.side, killer });
    // Sylus the Reaper: the dying minion's own Deathrattle procs extra times (golden = +2;
    // multiple Sylus stack additively). Re-runs only this minion's onDeath effects.
    let reaperBonus = 0; // count Sylus without allocating a living() array on every death
    for (const m of boards[minion.side]) if (!m.dead && m.health > 0 && m.cardId === 'sylus') reaperBonus += m.golden ? 2 : 1;
    for (let r = 0; r < reaperBonus; r++) {
      for (const effect of minion.effects) {
        if (effect.on !== 'onDeath') continue;
        FACTORIES[effect.do]?.(ctx, minion, effect.params ?? {}, { minion, side: minion.side });
      }
    }
    // Avenge: count the death and notify that side's avengers.
    deaths[minion.side] += 1;
    bus.emit('avenge', { side: minion.side, count: deaths[minion.side] });
  }

  // The Reclaimer's pending resummons. A marked minion is destroyed at Start of Combat (its
  // Deathrattle fires + overflows the board); the exact body waits here and "reclaims" its slot the
  // next time the board has room — i.e. after a friend dies — never mid-summon-cascade. So its own
  // tokens win the immediate scramble and the original returns later. `anchor` is the dead body it
  // was killed from, so the copy comes back in (or next to) its original slot.
  const pendingResummons: { anchor: Minion; board: BoardMinion }[] = [];
  function flushResummons(): void {
    while (pendingResummons.length > 0 && living('player').length < 7) {
      const { anchor, board } = pendingResummons.shift()!;
      const copy = instantiate(board, 'player', cards, mkUid);
      applyCombatGains(copy); // re-apply per-card stacks banked this fight (its own destroy + other deaths)
      const at = boards.player.indexOf(anchor);
      boards.player.splice(at >= 0 ? at + 1 : boards.player.length, 0, copy);
      registerEffects(copy);
      events.push({ type: 'summon', minion: snapshot(copy), side: 'player', index: boards.player.indexOf(copy), source: anchor.uid });
      bus.emit('onSummon', { minion: copy, side: 'player' });
    }
  }

  function dealDamage(
    target: Minion,
    amount: number,
    poison: boolean,
    bypassShield: boolean,
    poisoner?: Minion,
  ): void {
    if (target.dead || target.health <= 0) return;
    // Immune: takes no damage at all (A.4) — even from Venomous or destroy effects.
    if (target.keywords.includes('IMM')) return;
    // Divine Shield absorbs the first instance — and still blocks Venomous (A.3).
    if (!bypassShield && target.divineShield) {
      target.divineShield = false;
      target.keywords = target.keywords.filter((k) => k !== 'DS');
      events.push({ type: 'shield', target: target.uid });
      bus.emit('onLoseDivineShield', { minion: target, side: target.side });
      return;
    }
    target.health -= amount;
    events.push({ type: 'dmg', target: target.uid, amount, remainingHp: Math.max(0, target.health) });
    // The hit landed (Immune + Divine Shield already returned above) — notify on-damaged watchers (Gryphon).
    if (amount > 0) bus.emit('onDamaged', { minion: target, side: target.side });
    // Venomous: reaching here means the hit actually landed (Immune + Divine Shield already returned
    // above), so any damage from a Venomous source destroys the target — even if the raw hit was
    // already lethal. So attacking a Venomous minion is fatal *unless you were shielded from the
    // damage*, and the venom procs/drops off whichever side it lands on (main hit or retaliation).
    if (poison) {
      if (target.health > 0) target.health = 0;
      events.push({ type: 'poison', target: target.uid });
      // Venomous proc: the poisoner spends its venom (drops off for the rest of combat).
      if (poisoner && poisoner.keywords.includes('V')) {
        poisoner.keywords = poisoner.keywords.filter((k) => k !== 'V');
        events.push({ type: 'venomLost', target: poisoner.uid });
      }
    }
    if (target.health <= 0) killOrReborn(target, poisoner);
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

  function performAttack(attacker: Minion, defenderSide: Side, depth: number): void {
    if (attacker.dead || attacker.health <= 0) return;
    // Stealth is lost the moment a minion attacks (A.4) — it becomes targetable.
    if (attacker.keywords.includes('ST')) {
      attacker.keywords = attacker.keywords.filter((k) => k !== 'ST');
      events.push({ type: 'reveal', target: attacker.uid });
    }
    const swings = attacker.keywords.includes('W') ? 2 : 1; // Windfury (A.3 step 5)
    for (let s = 0; s < swings; s++) {
      if (attacker.dead || attacker.health <= 0) break;
      const target = chooseTarget(defenderSide);
      if (!target) break;
      events.push({ type: 'attack', attacker: attacker.uid, defender: target.uid, swing: s });
      bus.emit('onAttack', { minion: attacker, side: attacker.side }); // Rally + on-attack effects
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

      const targetWasAlive = !target.dead && target.health > 0;
      const targetCouldReborn = target.rebornAvailable; // a Reborn target that "dies" returns to life
      const poison = attacker.keywords.includes('V'); // Venomous

      // Cleave hits the target's neighbours before retaliation (A.3 step 5).
      if (attacker.keywords.includes('C')) {
        const arr = boards[defenderSide];
        const di = arr.indexOf(target);
        const neighbours = [arr[di - 1], arr[di + 1]].filter(
          (n): n is Minion => !!n && !n.dead && n.health > 0,
        );
        for (const n of neighbours) dealDamage(n, attacker.attack, poison, false, attacker);
      }

      dealDamage(target, attacker.attack, poison, false, attacker); // main hit
      dealDamage(attacker, target.attack, target.keywords.includes('V'), false, target); // retaliation

      // On-kill re-attack (Gnasher). Dropping a Reborn target to 0 counts as a kill even though it
      // returns to life — it spent its Reborn — so detect a consumed Reborn alongside an outright death.
      const killed =
        targetWasAlive &&
        (target.dead || target.health <= 0 || (targetCouldReborn && !target.rebornAvailable));
      if (killed) {
        bus.emit('onKill', { attacker, victim: target });
        if (attacker.reAttackOnKill && !attacker.dead && attacker.health > 0 && depth < REATTACK_GUARD) {
          performAttack(attacker, defenderSide, depth + 1);
        }
      }
    }
  }

  // Drain the attack-on-summon queue (Twilight Whelp's 3/3 Whelps): each strikes once, out of turn order,
  // right after the attack that spawned it settles. A Whelp's hit can spawn the enemy's Whelps (a chain),
  // bounded by IMMEDIATE_ATTACK_GUARD. A Whelp with no living foe is skipped (combat may be ending).
  function flushImmediateAttacks(): void {
    let guard = 0;
    while (pendingAttackOnSummon.length > 0 && guard++ < IMMEDIATE_ATTACK_GUARD) {
      const m = pendingAttackOnSummon.shift()!;
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
  for (const minion of [...boards.player]) {
    if (!minion.resummon || minion.dead || minion.health <= 0) continue;
    // Capture the full combat state for an exact copy (stats + granted keywords + golden + bonus).
    const copyBoard: BoardMinion = {
      cardId: minion.cardId,
      attack: minion.attack,
      health: minion.health,
      keywords: [...minion.keywords],
      golden: minion.golden,
      summonBonus: minion.summonBonus,
    };
    minion.rebornAvailable = false; // force a true death (skip Reborn) so the Deathrattle fires
    killOrReborn(minion); // tokens summon now and may overflow the board
    pendingResummons.push({ anchor: minion, board: copyBoard });
  }
  flushResummons(); // non-full board → the original rejoins immediately; full board → it waits

  // --- Start of Combat: player minions left→right (A.3 step 1) ---
  for (const minion of [...boards.player]) {
    if (minion.dead || minion.health <= 0) continue;
    for (const effect of minion.effects) {
      if (effect.on !== 'startOfCombat') continue;
      const fn = FACTORIES[effect.do];
      if (fn) fn(ctx, minion, effect.params ?? {}, {});
    }
  }

  // --- First attacker: more living minions goes first; tie → seeded (A.3 step 2) ---
  const playerCount = living('player').length;
  const enemyCount = living('enemy').length;
  let turn: Side =
    playerCount > enemyCount
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
    enemyDeaths,
    initial,
    playerSummonBonus,
    playerHpGrantBonus: playerHpGrantBonus.length > 0 ? playerHpGrantBonus : undefined,
    playerAscendCount: playerAscendCount.length > 0 ? playerAscendCount : undefined,
    playerPermaBuffs: playerPermaBuffs.length > 0 ? playerPermaBuffs : undefined,
    playerHandGrants: handGrants.length > 0 ? handGrants : undefined,
    playerSpellPower: spellPowerGain.attack !== 0 || spellPowerGain.health !== 0 ? spellPowerGain : undefined,
    playerCardBuffs: cardBuffGains.length > 0 ? cardBuffGains : undefined,
    playerFodderGrants: fodderGrants > 0 ? fodderGrants : undefined,
    playerDeferredBattlecries: deferredBattlecries.length > 0 ? deferredBattlecries : undefined,
    playerMaxGoldGain: maxGoldGain > 0 ? maxGoldGain : undefined,
    playerFreeRolls: freeRollGrants > 0 ? freeRollGrants : undefined,
    playerSpellsCast: playerCombatSpells > 0 ? playerCombatSpells : undefined,
    playerUndeadBuyAtkGain: undeadBuyAtkGain > 0 ? undeadBuyAtkGain : undefined,
    playerImpBuffGain: impBuffGain.attack > 0 || impBuffGain.health > 0 ? impBuffGain : undefined,
    playerFodderBuffGain: fodderBuffGain.attack > 0 || fodderBuffGain.health > 0 ? fodderBuffGain : undefined,
  };
}
