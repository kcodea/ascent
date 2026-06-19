import type {
  BoardMinion,
  CombatContext,
  CombatEvent,
  CombatOutcome,
  CombatResult,
  Minion,
  MinionSnapshot,
  Side,
} from '../types';
import type { Rng } from '../rng';
import { CombatBus } from '../events';
import { FACTORIES } from '../effects/factories';
import { instantiate, type CardIndex } from './minion';

const OTHER: Record<Side, Side> = { player: 'enemy', enemy: 'player' };
const ITERATION_GUARD = 300;
const REATTACK_GUARD = 50;

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
): CombatResult {
  const events: CombatEvent[] = [];
  const bus = new CombatBus();
  let uidCounter = 0;
  const mkUid = (): string => `m${uidCounter++}`;
  const handGrants: string[] = []; // cards the player's deathrattles add to hand after combat

  const boards: Record<Side, Minion[]> = {
    player: player.map((b) => instantiate(b, 'player', cards, mkUid)),
    enemy: enemy.map((b) => instantiate(b, 'enemy', cards, mkUid)),
  };

  // Corrupted Lifebinder: `linkUid` arrives as the linked board card's uid — remap it to that minion's
  // fresh combat uid (matched via sourceUid) so mid-fight buffs on the demon can find their mirror.
  for (const side of ['player', 'enemy'] as const) {
    for (const m of boards[side]) {
      if (m.linkUid) m.linkUid = boards[side].find((x) => x.sourceUid === m.linkUid)?.uid;
    }
  }
  /** Lifebinder mirror: anyone linked to `target` gains the same buff (source-guarded so the mirror
   *  buff doesn't itself re-mirror, and so the UI shows it as a distinct gain on the Lifebinder). */
  function mirrorLink(target: Minion, attack: number, health: number): void {
    for (const m of boards[target.side]) {
      if (!m.dead && m.linkUid === target.uid) ctx.buff(m, attack, health, 'Lifebinder');
    }
  }

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
  });

  const living = (side: Side): Minion[] => boards[side].filter((m) => !m.dead && m.health > 0);

  const ctx: CombatContext = {
    rng,
    bus,
    boards,
    events,
    log: (event) => {
      events.push(event);
    },
    living,
    getCard: (id) => {
      const card = cards[id];
      if (!card) throw new Error(`Unknown card: ${id}`);
      return card;
    },
    buff: (target, attack, health, source) => {
      target.attack += attack;
      target.health += health;
      if (health > 0) target.maxHealth += health;
      events.push({ type: 'buff', target: target.uid, attack, health, source });
      if (source !== 'Lifebinder') mirrorLink(target, attack, health); // Corrupted Lifebinder follows along
    },
    damage: (target, amount, poison = false, bypassShield = false) =>
      dealDamage(target, amount, poison, bypassShield),
    summon: (side, card, nearUid) => {
      const minion = instantiate(
        { cardId: card.id, attack: card.attack, health: card.health },
        side,
        cards,
        mkUid,
      );
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
      registerEffects(minion);
      events.push({ type: 'summon', minion: snapshot(minion), side, index, source: nearUid });
      bus.emit('onSummon', { minion, side });
      return minion;
    },
    grantToHand: (cardId, side, sourceUid) => {
      // Combat can't touch the recruit hand directly; record player-side grants so the
      // run loop can add them after the replay (Arcane Weaver → a Spirit Fire copy), and log a
      // `toHand` event so the replay shows the card flying to your hand as it happens.
      if (side === 'player') {
        handGrants.push(cardId);
        events.push({ type: 'toHand', cardId, side, source: sourceUid });
      }
    },
  };

  function registerEffects(minion: Minion): void {
    for (const effect of minion.effects) {
      const fn = FACTORIES[effect.do];
      if (!fn) continue; // recruit-phase effects without a combat factory are inert here
      bus.on(effect.on, (payload) => {
        // A dead minion fires nothing except its own Deathrattle.
        if (minion.dead && effect.on !== 'onDeath') return;
        fn(ctx, minion, effect.params ?? {}, payload);
      });
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

  function killOrReborn(minion: Minion): void {
    // Reborn (A.3 step 6): the first death returns the minion at its *base* card stats — it sheds
    // every combat buff and granted keyword (Divine Shield, etc.), keeping only its printed keywords
    // (minus the spent Reborn). A golden minion returns at doubled base. So a 2/1 buffed to a 10/3
    // Divine-Shield body comes back a plain 2/1. (Recruit-permanent stats live on the run board and
    // are untouched — this only resets the combat instance.)
    if (minion.rebornAvailable) {
      minion.rebornAvailable = false;
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
      }
      events.push({ type: 'reborn', target: minion.uid, hp: minion.health, attack: minion.attack, keywords: [...minion.keywords] });
      return;
    }
    minion.dead = true;
    minion.health = 0;
    events.push({ type: 'death', target: minion.uid });
    bus.emit('onDeath', { minion, side: minion.side });
    // Sylus the Reaper: the dying minion's own Deathrattle procs extra times (golden = +2;
    // multiple Sylus stack additively). Re-runs only this minion's onDeath effects.
    const reaperBonus = living(minion.side).reduce(
      (n, m) => n + (m.cardId === 'sylus' ? (m.golden ? 2 : 1) : 0),
      0,
    );
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
    if (target.health <= 0) killOrReborn(target);
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
      if (killed && attacker.reAttackOnKill && !attacker.dead && attacker.health > 0 && depth < REATTACK_GUARD) {
        bus.emit('onKill', { attacker, victim: target });
        performAttack(attacker, defenderSide, depth + 1);
      }
    }
  }

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
      if (m && !m.dead && m.health > 0) {
        lastAttacker[side] = m;
        return m;
      }
    }
    return undefined;
  };
  let guard = 0;
  while (living('player').length > 0 && living('enemy').length > 0 && guard++ < ITERATION_GUARD) {
    const defenderSide = OTHER[turn];
    const attacker = nextAttacker(turn);
    if (!attacker) {
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

  // Player damage on loss (A.3 step 9): scaled by the size of the surviving
  // enemy board, min 1. Stat-based (no flat per-survivor term) so a gentle early
  // board costs ~1 Resolve while a fat late board bites — the climb still ends.
  const playerDamage =
    result === 'lose'
      ? Math.max(1, Math.round(survivorsE.reduce((sum, m) => sum + (m.attack + m.health) / 8, 0)))
      : 0;

  // Per-instance state to carry back to the run board: a Kennelmaster whose Avenge
  // improved its summon buff this combat keeps the higher bonus for the run.
  const playerSummonBonus = boards.player
    .filter((m) => m.sourceUid !== undefined && m.summonBonus > 0)
    .map((m) => ({ sourceUid: m.sourceUid!, bonus: m.summonBonus }));

  return {
    events,
    result,
    playerDamage,
    initial,
    playerSummonBonus,
    playerHandGrants: handGrants.length > 0 ? handGrants : undefined,
  };
}
