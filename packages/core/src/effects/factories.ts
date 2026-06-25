import type { CombatContext, EffectFactoryId, Keyword, Minion, Side, Tribe } from '../types';

/**
 * An effect primitive. Bound to a `self` minion and invoked when its subscribed
 * `GameEvent` fires. Factories decide their own relevance from the payload
 * (is this about me? my side? the right tribe?) and mutate state only through
 * the `CombatContext`.
 *
 * Cards reference factories by id (data, not code). Adding a card is data-only
 * unless it needs a genuinely new primitive here.
 */
export type EffectFn = (
  ctx: CombatContext,
  self: Minion,
  params: Record<string, unknown>,
  payload: unknown,
) => void;

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' ? v : fallback);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
/** Tripled minions fire their buff/damage effects at doubled magnitude. */
const mul = (self: Minion): number => (self.golden ? 2 : 1);

interface MinionPayload {
  minion: Minion;
  side?: Side;
}

/** Grant a Divine Shield to a living minion (Mechs). Idempotent; logs a `shieldUp`. */
function grantShield(ctx: CombatContext, m: Minion): void {
  if (m.dead || m.health <= 0 || m.divineShield) return;
  m.divineShield = true;
  if (!m.keywords.includes('DS')) m.keywords.push('DS');
  ctx.log({ type: 'shieldUp', target: m.uid });
}

/** Whether a minion has a Battlecry at all (any `onPlay` effect) — Ryme targets ANY Battlecry neighbour,
 *  including economy ones (Discover, gain-Gold…) which simply no-op in combat (nothing to do there). */
const hasBattlecry = (m: Minion): boolean => m.effects.some((e) => e.on === 'onPlay');

/** Drakko the Drummer's doubling for Ryme's re-fired Battlecries (combat mirror of recruit's `bestCopyRepeats`):
 *  count living Drakkos on `side`, golden → +2 else any → +1 (best single copy, NO stacking). Total = 1 + that,
 *  so one Drakko makes each trigger fire twice, a golden Drakko three times. */
const drakkoRepeats = (ctx: CombatContext, side: Side): number => {
  let bonus = 0;
  for (const m of ctx.living(side)) if (m.cardId === 'drummer') bonus = Math.max(bonus, m.golden ? 2 : 1);
  return 1 + bonus;
};

/** Re-fire a minion's Battlecry (its `onPlay` effects) in COMBAT — used by Ryme's Deathrattle. Only the
 *  combat-meaningful battlecries do anything here; others no-op. Magnitude respects the source's own golden. */
function replayCombatBattlecry(ctx: CombatContext, m: Minion): void {
  const g = m.golden ? 2 : 1;
  const tribeOf = (t: Minion, tribe: string): boolean =>
    !tribe || tribe === 'any' || t.tribe === tribe || t.tribe2 === tribe || !!ctx.getCard(t.cardId)?.universalTribe;
  for (const eff of m.effects) {
    if (eff.on !== 'onPlay') continue;
    const p = eff.params ?? {};
    if (eff.do === 'battlecrySummon') {
      const token = ctx.getCard(str(p.tokenId));
      if (token) for (let i = 0; i < num(p.count, 1) * g; i++) ctx.summon(m.side, token, m.uid);
    } else if (eff.do === 'battlecryBuffTribe') {
      const tribe = str(p.tribe), a = num(p.attack) * g, h = num(p.health) * g;
      const includeSelf = p.includeSelf !== false;
      for (const t of ctx.living(m.side)) if ((includeSelf || t !== m) && tribeOf(t, tribe)) ctx.buff(t, a, h, m.uid);
    } else if (eff.do === 'battlecryBuffUndeadAttack') {
      const a = num(p.amount, 1) * g;
      for (const t of ctx.living(m.side)) if (tribeOf(t, 'undead')) ctx.buff(t, a, 0, m.uid);
    } else if (eff.do === 'battlecryGrantKeyword') {
      const kws = Array.isArray(p.keywords) ? (p.keywords as Keyword[]) : [];
      const friends = ctx.living(m.side).filter((t) => t !== m); // auto-pick the highest-Attack friend (no chosen target in combat)
      if (friends.length && kws.length) {
        const target = friends.reduce((a, b) => (b.attack > a.attack ? b : a));
        for (const kw of kws) if (!target.keywords.includes(kw)) {
          target.keywords.push(kw);
          if (kw === 'DS') target.divineShield = true;
        }
      }
    } else if (eff.do === 'battlecryDiscoverSpell') {
      // A Discover Battlecry can't open the interactive 1-of-3 peek mid-combat — grant a random pool card
      // instead (resolved at settle, respecting the tavern tier). Golden Discovers twice → grant ×2.
      ctx.grantRandomSpell(g, m.side);
    } else if (eff.do === 'battlecryDiscoverMinion') {
      ctx.grantRandomMinion(g, str(p.tribe) || undefined, m.side, m.cardId); // …a random minion of the tribe, ≤ tavern tier
    } else if (eff.do === 'battlecryBuffSpellPower') {
      // Cinderwing Matron — permanently raise run-wide spell power; carried back via playerSpellPower (the
      // same channel Skullblade/Gnasher use), so re-firing it in combat actually grants the spell power.
      ctx.grantSpellPower(num(p.attack) * g, num(p.health) * g, m.side);
    }
  }
}

/**
 * Combat-time factories. This is a *partial* registry: recruit-time ids
 * (battlecries, buff-on-buy) are implemented in `@game/sim` against the run
 * board, and any effect without a combat factory here is simply inert during
 * `simulate()` (see `registerEffects`).
 */
export const FACTORIES: Partial<Record<EffectFactoryId, EffectFn>> = {
  /** Deathrattle: summon `count` copies of token `tokenId` beside self. (Echo Warden adds copies
   *  in the summon path itself — see `simulate`'s summonMinion — so it isn't applied here.) */
  deathrattleSummon: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const card = ctx.getCard(str(params.tokenId));
    // golden doubles the count (Deathless Hand 1 → 2) UNLESS `fixed` is set (Imp King keeps 2; golden lifts its buff instead)
    const total = num(params.count, 1) * (params.fixed ? 1 : mul(self));
    const kw = str(params.keyword) as Keyword | ''; // optional: grant each summoned token a keyword (Broodmother → Taunt)
    const grantKws = kw ? [kw] : undefined; // passed into summon so the keyword is in the snapshot from the start
    for (let i = 0; i < total; i++) {
      ctx.summon(self.side, card, self.uid, grantKws);
      // Sequential spawning for attack-on-summon tokens (Twilight Whelp → Whelp): each Whelp attacks
      // immediately after spawning. Only spawn the next one if there's room after the first has attacked
      // (if the first dies, it frees a slot; if it lives and the board was full, the next overflows).
      if (card.attackOnSummon) ctx.flushImmediateAttacks?.();
    }
  },

  /** Nanon — Deathrattle: summon `count` tokens; every one that can't fit the full board (a `summonOverflow`)
   *  instead buffs your minions of `tribe` by +atk/+hp EACH. Golden doubles the *buff* (the summon count is
   *  fixed — a full board converts more bodies into a bigger Mech-wide pump). The gift lasts the combat. */
  deathrattleSummonOverflowBuff: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const card = ctx.getCard(str(params.tokenId));
    const total = num(params.count, 6); // fixed — golden scales the overflow buff, not the summon count
    let overflowed = 0;
    for (let i = 0; i < total; i++) {
      const before = ctx.living(self.side).length;
      ctx.summon(self.side, card, self.uid); // emits `summonOverflow` when the board is already full
      if (ctx.living(self.side).length === before) overflowed++; // didn't land → it overflowed
    }
    if (overflowed === 0) return;
    const tribe = str(params.tribe) as Tribe | '';
    const a = num(params.attack, 2) * mul(self) * overflowed; // +2/+2 per overflow (golden +4/+4)
    const h = num(params.health, 2) * mul(self) * overflowed;
    for (const m of ctx.living(self.side)) {
      if (!tribe || m.tribe === tribe || m.tribe2 === tribe || ctx.getCard(m.cardId)?.universalTribe) ctx.buff(m, a, h, self.uid);
    }
  },

  /** Sporebat — Deathrattle: grant N random tavern-tier spells to your hand after combat (golden 2). The
   *  tier-bounded pick happens at settle (where the tavern tier is known); combat just banks the count. */
  deathrattleGrantRandomSpell: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ctx.grantRandomSpell(num(params.count, 1) * mul(self), self.side);
  },

  /** Gryphon — when it takes damage, bank a free shop reroll (carried back). Once PER HIT, capped at
   *  `max` (default 4) banks per combat (the `grantedRefresh` counter), so a Taunt soaking a whole board
   *  tops out at the cap instead of rolling unlimited refreshes. Golden grants 2 per hit. */
  onDamagedGrantRefresh: (ctx, self, params, payload) => {
    if (self.dead || (payload as MinionPayload).minion !== self) return;
    const cap = num(params.max, 4);
    const got = self.grantedRefresh ?? 0;
    if (got >= cap) return;
    self.grantedRefresh = got + 1;
    ctx.grantFreeRolls(num(params.count, 1) * mul(self), self.side);
  },

  /** Mama Bear (combat half) — when a friendly minion of `tribe` is summoned, buff it +M/+M where M =
   *  (base + accrued) × golden, then the accrued (`summonBonus`, carried back) climbs by `base`. Mirrors the
   *  recruit half so the improve persists in AND out of combat. */
  summonBuffTribeImprove: (ctx, self, params, payload) => {
    const { minion, side } = payload as MinionPayload;
    if (self.dead || side !== self.side || minion === self) return;
    const tribe = str(params.tribe) as Tribe | '';
    if (tribe && minion.tribe !== tribe && minion.tribe2 !== tribe && !ctx.getCard(minion.cardId)?.universalTribe) return;
    const base = num(params.attack, 3);
    const mag = (base + self.summonBonus) * mul(self);
    ctx.buff(minion, mag, mag, self.uid);
    self.summonBonus += base;
  },

  /** When a friendly minion of `tribe` is summoned, buff it. The per-stat magnitude is the
   *  base buff + `self.summonBonus` (Kennelmaster's Avenge / triple-combined bonus). No golden
   *  doubling here — a golden's bonus already encodes the combined magnitude (see checkTriples). */
  buffOnSummon: (ctx, self, params, payload) => {
    const { minion, side } = payload as MinionPayload;
    if (self.dead || side !== self.side || minion === self) return;
    const tribe = str(params.tribe) as Tribe | 'any';
    if (tribe !== 'any' && minion.tribe !== tribe && minion.tribe2 !== tribe && !ctx.getCard(minion.cardId)?.universalTribe) return;
    const bonus = self.summonBonus;
    ctx.buff(minion, num(params.attack) + bonus, num(params.health) + bonus, self.uid);
  },

  /** Spirit Worgen (combat half): when a friendly minion of one of `tribes` is summoned mid-fight,
   *  gain +X/+X where X = base + spells cast this turn (frozen at combat start). Temporary — combat is
   *  a simulation, so the gain doesn't touch the run board and the Worgen is back to its recruit stats
   *  next shop. (The recruit half of the same effect id buffs permanently when you play a Beast/Dragon.) */
  summonBuffSelfTribe: (ctx, self, params, payload) => {
    const { minion, side } = payload as MinionPayload;
    if (self.dead || side !== self.side || minion === self) return;
    const tribes = Array.isArray(params.tribes) ? (params.tribes as Tribe[]) : [];
    if (!tribes.includes(minion.tribe) && !(minion.tribe2 && tribes.includes(minion.tribe2)) && !ctx.getCard(minion.cardId)?.universalTribe) return;
    const x = (num(params.attack, 1) + ctx.spellsThisTurn) * mul(self);
    const y = (num(params.health, 1) + ctx.spellsThisTurn) * mul(self);
    ctx.buff(self, x, y, self.name);
  },

  /** Deathrattle: buff all living friends of `tribe` (+atk/+hp). */
  deathrattleBuffTribe: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const tribe = str(params.tribe) as Tribe | 'any';
    const attack = num(params.attack) * mul(self);
    const health = num(params.health) * mul(self);
    // "For the rest of combat": register a persistent aura so friends summoned *after* this gain it too…
    ctx.addTribeAura(self.side, tribe, attack, health, self.uid);
    // …then buff the friends already on the board.
    for (const m of ctx.living(self.side)) {
      if (tribe === 'any' || m.tribe === tribe || m.tribe2 === tribe || ctx.getCard(m.cardId)?.universalTribe) ctx.buff(m, attack, health, self.uid);
    }
  },

  /** Deathrattle (Grim): buff your `tribe` by +`per`/+`per` per Deathrattle triggered this game (the
   *  run-wide base + this combat's player Deathrattles, snapshotted now — Grim's own death is counted).
   *  Registers a rest-of-combat aura at that magnitude, then buffs the friends already on the board.
   *  Golden doubles `per`. */
  deathrattleBuffTribeByTally: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const tribe = str(params.tribe) as Tribe | 'any';
    const amount = ctx.deathrattleTally() * num(params.per, 1) * mul(self);
    ctx.addTribeAura(self.side, tribe, amount, amount, self.uid);
    for (const m of ctx.living(self.side)) {
      if (tribe === 'any' || m.tribe === tribe || m.tribe2 === tribe || ctx.getCard(m.cardId)?.universalTribe) ctx.buff(m, amount, amount, self.uid);
    }
  },

  /** On kill (Gnasher): buff self by +atk/+hp. Pairs with Engraved so the gain is permanent. The onKill
   *  payload carries the killer as `attacker`, so only the minion that scored the kill fires. */
  onKillBuffSelf: (ctx, self, params, payload) => {
    if ((payload as { attacker?: Minion }).attacker !== self) return;
    ctx.buff(self, num(params.attack) * mul(self), num(params.health) * mul(self), self.uid);
  },

  /** On kill (Gnasher): each kill permanently raises run-wide spell power +atk/+hp (golden doubles).
   *  Player carry-back via `CombatResult.playerSpellPower` → applied in settleCombat. Same attacker-guard
   *  as onKillBuffSelf (the onKill payload carries the killer as `attacker`). */
  onKillBuffSpellPower: (ctx, self, params, payload) => {
    if ((payload as { attacker?: Minion }).attacker !== self) return;
    ctx.grantSpellPower(num(params.attack, 1) * mul(self), num(params.health) * mul(self), self.side);
  },

  /** Deathrattle (Blaster): deal `amount` to every living minion on BOTH sides (friendly included).
   *  Snapshots each side's living list first so cascading deaths don't disturb the sweep. */
  deathrattleDamageAll: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const amount = num(params.amount, 3) * mul(self);
    for (const side of ['player', 'enemy'] as Side[]) {
      for (const m of [...ctx.living(side)]) ctx.damage(m, amount);
    }
  },

  /** Deathrattle (Jenkins & Fi): destroy the minion that dealt the killing blow (`killer` on the onDeath
   *  payload). Bypasses Divine Shield — it's a destroy, not a hit. No-op if the killer died too / is absent. */
  deathrattleDestroyKiller: (ctx, self, _params, payload) => {
    const p = payload as MinionPayload & { killer?: Minion };
    if (p.minion !== self) return;
    const killer = p.killer;
    if (killer && !killer.dead && killer.health > 0) ctx.damage(killer, killer.health + 999, false, true);
  },

  /**
   * Capability marker (Gnasher). The re-attack is control flow, resolved by the
   * simulator via the derived `Minion.reAttackOnKill` flag; this handler is a
   * no-op so the card can still declare the effect as data.
   */
  reAttackOnKill: () => {
    /* handled in simulate() */
  },

  // --- Start of Combat (Dragons). Player SC resolves first, left→right (A.3). ---

  /** Deal `amount` to the leftmost / a random / every living enemy. */
  scDamage: (ctx, self, params) => {
    const foe: Side = self.side === 'player' ? 'enemy' : 'player';
    const targets = ctx.living(foe);
    if (targets.length === 0) return;
    ctx.log({ type: 'sc', source: self.uid, text: str(params.text) || `${self.name} strikes` });
    const amount = num(params.amount, 1) * mul(self);
    const mode = str(params.target) || 'leftmost';
    if (mode === 'all') {
      for (const t of targets) ctx.damage(t, amount);
    } else if (mode === 'random') {
      ctx.damage(ctx.rng.pick(targets), amount);
    } else {
      ctx.damage(targets[0]!, amount);
    }
  },

  /** Deal damage equal to self's Attack, as 1-damage hits split across random enemies. */
  scSplitDamage: (ctx, self, params) => {
    const foe: Side = self.side === 'player' ? 'enemy' : 'player';
    if (ctx.living(foe).length === 0) return;
    ctx.log({ type: 'sc', source: self.uid, text: str(params.text) || `${self.name} splits its breath` });
    let n = self.attack;
    while (n-- > 0) {
      const targets = ctx.living(foe);
      if (targets.length === 0) break;
      ctx.damage(ctx.rng.pick(targets), 1);
    }
  },

  /** Deal `base` to every enemy, then `perTribe` more to a random enemy per other friendly `tribe`. */
  scAoePerTribe: (ctx, self, params) => {
    const foe: Side = self.side === 'player' ? 'enemy' : 'player';
    if (ctx.living(foe).length === 0) return;
    ctx.log({ type: 'sc', source: self.uid, text: str(params.text) || `${self.name} rains fire` });
    const base = num(params.base, 3) * mul(self);
    const per = num(params.perTribe, 3) * mul(self);
    const tribe = str(params.tribe) as Tribe;
    for (const t of ctx.living(foe)) ctx.damage(t, base);
    const others = ctx.living(self.side).filter((m) => m !== self && (m.tribe === tribe || m.tribe2 === tribe || ctx.getCard(m.cardId)?.universalTribe)).length;
    for (let i = 0; i < others; i++) {
      const targets = ctx.living(foe);
      if (targets.length === 0) break;
      ctx.damage(ctx.rng.pick(targets), per);
    }
  },

  /** Taurus — Start of Combat: grant Engraved (EG) to the adjacent minion(s) on self's own side, so they
   *  keep whatever stats they gain this fight. Base engraves the minion to self's LEFT (the lower board
   *  index); golden also engraves the one to its RIGHT. Granting EG to the *combat* Minion (not its run
   *  board CardDef) is clone-safe: the keyword lasts only this fight, and `ctx.buff` then accrues that
   *  minion's gains into `permaGain` → carried back by `playerPermaBuffs`. Taurus itself is not engraved.
   *  No-op for a neighbor that already has EG, and for an absent neighbor (Taurus leftmost/rightmost). */
  scEngraveNeighbor: (ctx, self, params) => {
    const board = ctx.boards[self.side];
    const i = board.indexOf(self);
    if (i < 0) return;
    const engrave = (m: Minion | undefined): boolean => {
      if (!m || m.dead || m.health <= 0 || m.keywords.includes('EG')) return false;
      m.keywords.push('EG'); // mutates the per-combat clone's keywords, never a shared CardDef
      return true;
    };
    const did = [engrave(board[i - 1]), self.golden ? engrave(board[i + 1]) : false];
    if (did.some(Boolean)) {
      ctx.log({ type: 'sc', source: self.uid, text: str(params.text) || `${self.name} engraves the line` });
    }
  },

  // --- Undead (combat-time Deathrattle / on-death value) ---

  /** Deathrattle: buff a random living friend (both stats). */
  deathrattleBuffRandom: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const friends = ctx.living(self.side);
    if (friends.length === 0) return;
    ctx.buff(ctx.rng.pick(friends), num(params.attack) * mul(self), num(params.health) * mul(self), self.uid);
  },

  /** Deathrattle (Sporeling): coin-flip Attack vs Health, then buff EVERY living friend by +amount of it. */
  deathrattleBuffAllRandomStat: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const friends = ctx.living(self.side);
    if (friends.length === 0) return;
    const amt = num(params.amount, 1) * mul(self);
    const useAtk = ctx.rng.pick([true, false]);
    for (const f of friends) ctx.buff(f, useAtk ? amt : 0, useAtk ? 0 : amt, self.uid);
  },

  /** Deathrattle (Arcane Weaver): add a copy of a spell to your hand after combat. Golden grants two. */
  deathrattleGrantSpell: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    for (let i = 0; i < mul(self); i++) ctx.grantToHand(str(params.cardId), self.side, self.uid);
  },

  /** Deathrattle (Skullblade): permanently raise the run-wide spell power by +atk/+hp (golden doubles).
   *  Carried back via `CombatResult.playerSpellPower` (player-side only — `grantSpellPower` guards it),
   *  then applied to the run's spell bonus in settleCombat. Each Skullblade death stacks another +atk/+hp. */
  deathrattleBuffSpellPower: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ctx.grantSpellPower(num(params.attack, 1) * mul(self), num(params.health) * mul(self), self.side);
  },

  /** Deathrattle (Grave Knit): permanently buff a card type run-wide by +atk/+hp (golden doubles).
   *  Carried back via `CombatResult.playerCardBuffs` (player-side only), then applied run-wide in
   *  settleCombat (board / hand / future copies). Each death stacks; `cardId` defaults to self's. */
  deathrattleBuffCardTypeRunWide: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const cardId = str(params.cardId) || self.cardId;
    ctx.grantCardBuff(cardId, num(params.attack, 1) * mul(self), num(params.health, 1) * mul(self), self.side);
  },

  /** Deathrattle (Burial Imp): queue `count` Fodder (golden doubles) into your next tavern. Player-side
   *  carry-back via `CombatResult.playerFodderGrants` → pushed onto pendingTavern in settleCombat. */
  deathrattleAddFodder: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    ctx.grantTavernFodder(num(params.count, 1) * mul(self), self.side);
  },

  /** Deathrattle (Junkyard Titan): add a random Magnetic minion to your hand after combat. Sibling of
   *  Arcane Weaver's grant, but the card is chosen at random (via ctx.rng) from the Magnetic-keyword
   *  minion pool (tokens/spells excluded) rather than a fixed id. Each pick is independent, so a golden's
   *  two grants can differ. Emits the same `toHand` event so the replay flies it to the hand; golden → 2.
   *  (Today the pool is Cling Drone / Money Bot / Heckbinder.) */
  deathrattleGrantMagnetic: (ctx, self, _params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const pool = ctx.allCards().filter((c) => c.keywords.includes('M') && !c.token && !c.spell);
    if (pool.length === 0) return;
    for (let i = 0; i < mul(self); i++) ctx.grantToHand(ctx.rng.pick(pool).id, self.side, self.uid);
  },

  /** Rally — when *this* minion attacks, buff friendly minions (+atk/+hp). With no extra params it buffs
   *  every other living friend; `tribe` restricts to that tribe (dual-types count) and `count` caps how many
   *  are hit (a random pick when there are more eligible) — Supporter: 2 friendly Dragons. */
  rallyBuff: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // only on this minion's own attack
    const attack = num(params.attack, 1) * mul(self);
    const health = num(params.health, 1) * mul(self);
    const tribe = str(params.tribe) as Tribe | '';
    let friends = ctx.living(self.side).filter((m) => m !== self && (!tribe || m.tribe === tribe || m.tribe2 === tribe || ctx.getCard(m.cardId)?.universalTribe));
    const cap = num(params.count, 0); // 0 = all eligible friends
    if (cap > 0 && friends.length > cap) {
      const pickable = [...friends];
      friends = [];
      for (let i = 0; i < cap && pickable.length > 0; i++) {
        const m = ctx.rng.pick(pickable);
        pickable.splice(pickable.indexOf(m), 1);
        friends.push(m);
      }
    }
    for (const m of friends) ctx.buff(m, attack, health, self.uid);
  },

  /** Raptor — when ANOTHER friendly minion of `tribe` attacks, buff it (+atk/+hp) before its hit lands
   *  (onAttack is broadcast pre-damage). Excludes self — a support body, not a self-ramp. Golden doubles. */
  onFriendlyAttackBuffTribe: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion === self || minion.side !== self.side) return;
    const tribe = str(params.tribe) as Tribe | 'any';
    if (tribe !== 'any' && minion.tribe !== tribe && minion.tribe2 !== tribe && !ctx.getCard(minion.cardId)?.universalTribe) return;
    ctx.buff(minion, num(params.attack, 1) * mul(self), num(params.health, 1) * mul(self), self.uid);
  },

  /** Crypt Drake — when ANY ally attacks (itself included), buff every living friend +mag/+mag, where mag
   *  starts at `step` and improves by `step` every `every` ally attacks this combat (1–3: +2/+2, 4–6: +4/+4,
   *  …). Per-combat counter on `self.attackSeen`. Golden doubles `step`. */
  onAllyAttackBuffAll: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion.side !== self.side) return; // any ally's attack (self included)
    self.attackSeen = (self.attackSeen ?? 0) + 1;
    const every = Math.max(1, num(params.every, 3));
    const improvements = Math.floor((self.attackSeen - 1) / every);
    const mag = num(params.step, 2) * (1 + improvements) * mul(self);
    for (const m of ctx.living(self.side)) ctx.buff(m, mag, mag, self.uid);
  },

  /** Taragosa — when any ally attacks, "cast Growth": buff every living friend +atk/+hp (golden casts it
   *  twice). Explosive on a wide board. Growth is a REAL spell, so each cast inherits the run's spell power
   *  (`ctx.spellPower`, passed in from the run loop) on top of the base — exactly like a shop-cast Growth. */
  onAllyAttackCastGrowth: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion.side !== self.side) return; // any ally's attack
    const a = num(params.attack, 3) + ctx.spellPower.attack;
    const h = num(params.health, 4) + ctx.spellPower.health;
    for (let r = 0; r < mul(self); r++) {
      ctx.castSpell(self.side); // Growth is a REAL spell cast — fires Guel + counts toward his (permanent) improvement
      for (const m of ctx.living(self.side)) ctx.buff(m, a, h, self.uid);
    }
  },

  /** Archmagus Guel (combat half) — when a friendly spell is cast mid-fight (Taragosa's Growth), give
   *  `count` other random friendly minions +atk/+hp, scaling +1/+1 per 4 spells cast so far (the running
   *  per-side tally rides in the `spellCast` payload; the triggering cast is already counted, matching the
   *  recruit half). Golden doubles. The grant is a normal combat buff (temporary) — the PERMANENT
   *  improvement comes from the cast being carried back to the run's `spellsCast` (see `ctx.castSpell`). */
  spellCastBuffOthers: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const pickable = ctx.living(self.side).filter((m) => m !== self);
    const step = Math.floor(count / 4);
    const a = (num(params.attack, 1) + step) * mul(self);
    const h = (num(params.health, 1) + step) * mul(self);
    const targets = num(params.count, 2);
    for (let i = 0; i < targets && pickable.length > 0; i++) {
      const m = ctx.rng.pick(pickable);
      pickable.splice(pickable.indexOf(m), 1);
      ctx.buff(m, a, h, self.uid);
    }
  },

  /** Hunter — when THIS minion's Attack rises (onGainAttack), give every living friend +`health` Health.
   *  Health-only, so it never re-triggers onGainAttack (no loop). Golden doubles. */
  onGainAttackBuffAll: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // only when self gains Attack
    const h = num(params.health, 2) * mul(self);
    for (const m of ctx.living(self.side)) ctx.buff(m, 0, h, self.uid);
  },

  /** Deathsayer's Rally — when *this* attacks, fire your leftmost living minion's Deathrattle *first*
   *  (before the hit lands; `onAttack` is emitted before damage). Logs a `rally` event (source =
   *  Deathsayer, target = that minion) so the UI pauses + shows whose Deathrattle goes off, then runs
   *  that minion's onDeath effects once — it stays alive (only true `deathrattle*` effects count, not
   *  friend-death watchers like Brood Matron). Any buffs/summons it produces resolve before the attack. */
  rallyProcDeathrattle: (ctx, self, _params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return;
    const isDeathrattle = (m: Minion): boolean => m.effects.some((e) => e.on === 'onDeath' && e.do.startsWith('deathrattle'));
    const target = ctx.living(self.side).find(isDeathrattle);
    if (!target) return;
    ctx.log({ type: 'rally', source: self.uid, target: target.uid });
    // The Deathrattle procs like a real death would: once + Sylus the Reaper's extra procs (+1 per
    // Sylus, +2 golden). A *golden Deathsayer* then doubles the whole thing — it's a multiplier, so it
    // stacks multiplicatively on Sylus (e.g. golden Deathsayer + 2 Sylus = (1+2)×2 = 6 procs). Echo
    // Warden's extra tokens are already folded into the summon factories.
    const reaperBonus = ctx.living(self.side).reduce((n, m) => n + (m.cardId === 'sylus' ? (m.golden ? 2 : 1) : 0), 0);
    const procs = (1 + reaperBonus) * (self.golden ? 2 : 1);
    for (let r = 0; r < procs; r++) {
      for (const effect of target.effects) {
        if (effect.on !== 'onDeath' || !effect.do.startsWith('deathrattle')) continue;
        FACTORIES[effect.do]?.(ctx, target, effect.params ?? {}, { minion: target, side: target.side });
      }
    }
  },

  /** Rot Weaver: each time another friend dies, buff a random living friend. */
  onFriendDeathBuffRandom: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion === self || minion.side !== self.side) return;
    const friends = ctx.living(self.side);
    if (friends.length === 0) return;
    ctx.buff(ctx.rng.pick(friends), num(params.attack) * mul(self), num(params.health) * mul(self), self.uid);
  },

  /** Flowing Monk: when a summon on this minion's side can't fit the full board (a `summonOverflow`),
   *  buff a random living friend (+3/+3; golden doubles). The combat half of its recruit overflow buff —
   *  and PERMANENT: the gift is recorded on the recipient (`permaGain`) so it carries back to the run
   *  board after combat, not just for this fight. */
  overflowBuffRandom: (ctx, self, params, payload) => {
    if (self.dead || (payload as { side?: Side }).side !== self.side) return;
    const friends = ctx.living(self.side);
    if (friends.length === 0) return;
    const recipient = ctx.rng.pick(friends);
    const a = num(params.attack, 3) * mul(self);
    const h = num(params.health, 3) * mul(self);
    ctx.buff(recipient, a, h, self.uid);
    // ctx.buff already accrues permaGain for an Engraved recipient; record it here for everyone else
    // (Flowing Monk's gift is permanent regardless of the recipient's keywords).
    if (!recipient.keywords.includes('EG')) {
      recipient.permaGain = { attack: (recipient.permaGain?.attack ?? 0) + a, health: (recipient.permaGain?.health ?? 0) + h };
    }
  },

  /** Avenge (X): after every `count` friendly deaths in combat, buff self (+atk/+hp). */
  avengeBuff: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const x = Math.max(1, num(params.count, 3));
    if (count % x !== 0) return;
    ctx.buff(self, num(params.attack, 1) * mul(self), num(params.health, 1) * mul(self), self.uid);
  },

  /** Avenge (X) — Kennelmaster: after every `count` friendly deaths, permanently improve this
   *  minion's summon buff by +1/+1 (its `summonBonus`, carried back to the run board afterwards).
   *  Affects every Beast it summons for the rest of the fight, and every future fight. Logs an
   *  `improve` event so the UI can pulse it. */
  avengeImproveSummon: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const x = Math.max(1, num(params.count, 3));
    if (count % x !== 0) return;
    self.summonBonus += 1;
    ctx.log({ type: 'improve', target: self.uid, amount: 1 });
  },

  /** Avenge (Soulsman): every X friendly deaths, permanently raise your max Gold by 1 (golden +2).
   *  Player-side carry-back via `CombatResult.playerMaxGoldGain` → applied to maxEmbers in settleCombat.
   *  Logs a `maxGold` event (player only — enemies have no economy, so it'd be a phantom proc) so the UI
   *  can pulse Soulsman + float the gain when it triggers. */
  avengeMaxGold: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const x = Math.max(1, num(params.count, 4));
    if (count % x !== 0) return;
    const gain = mul(self);
    ctx.grantMaxGold(gain, self.side);
    if (self.side === 'player') ctx.log({ type: 'maxGold', target: self.uid, side: self.side, amount: gain });
  },

  /** Avenge (X) — Stuntdrake: after every `count` friendly deaths, hand `targets` other living friends a
   *  copy of THIS minion's current Attack (+atk only). A golden's bigger Attack flows through automatically;
   *  the threshold + target count are unchanged. Recipients are a random pick when more than `targets` live. */
  avengeGiveAttack: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const x = Math.max(1, num(params.count, 3));
    if (count % x !== 0) return;
    const amount = self.attack;
    if (amount <= 0) return;
    const targets = num(params.targets, 2);
    // Golden procs twice — each proc independently picks `targets` random friends (can overlap).
    for (let t = 0; t < mul(self); t++) {
      const pickable = ctx.living(self.side).filter((m) => m !== self);
      for (let i = 0; i < targets && pickable.length > 0; i++) {
        const m = ctx.rng.pick(pickable);
        pickable.splice(pickable.indexOf(m), 1);
        ctx.buff(m, amount, 0, self.uid);
      }
    }
  },

  /** Deathrattle (Ghastweaver): fill the board with random cards from `pool`. */
  deathrattleFillTribe: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const pool = Array.isArray(params.pool) ? (params.pool as string[]) : [];
    if (pool.length === 0) return;
    let guard = 0;
    while (ctx.living(self.side).length < 7 && guard++ < 7) {
      ctx.summon(self.side, ctx.getCard(ctx.rng.pick(pool)), self.uid);
    }
  },

  // --- Mechs (Divine Shield walls + shield-break payoffs) ---

  /** Start of Combat: give every friendly minion of `tribe` a Divine Shield (a reusable shield-wall
   *  primitive — currently unused after Omega Bulwark's removal, kept for a future Mech wall card). */
  scGrantShieldTribe: (ctx, self, params) => {
    const tribe = (str(params.tribe) || 'mech') as Tribe;
    const friends = ctx.living(self.side).filter((m) => m.tribe === tribe || m.tribe2 === tribe || ctx.getCard(m.cardId)?.universalTribe);
    if (friends.length === 0) return;
    ctx.log({ type: 'sc', source: self.uid, text: str(params.text) || `${self.name} raises the shieldwall` });
    for (const m of friends) grantShield(ctx, m);
  },

  /** Selfless Sentinel — Deathrattle: give a random other friend a Divine Shield. */
  deathrattleGrantShield: (ctx, self, _params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const pool = ctx.living(self.side).filter((m) => m !== self && !m.divineShield);
    if (pool.length === 0) return;
    grantShield(ctx, ctx.rng.pick(pool));
  },

  /** Shield Capacitor — when a friendly Shield breaks, give another friend a Shield. */
  onShieldBreakGrantShield: (ctx, self, _params, payload) => {
    const { minion, side } = payload as MinionPayload;
    if (self.dead || side !== self.side) return;
    const pool = ctx.living(self.side).filter((m) => m !== self && m !== minion && !m.divineShield);
    if (pool.length === 0) return;
    grantShield(ctx, ctx.rng.pick(pool));
  },

  /** Arclight Reactor — when a friendly Mech's Shield breaks, deal `amount` to a random enemy. */
  onShieldBreakDamage: (ctx, self, params, payload) => {
    const { minion, side } = payload as MinionPayload;
    if (self.dead || side !== self.side || (minion.tribe !== 'mech' && minion.tribe2 !== 'mech' && !ctx.getCard(minion.cardId)?.universalTribe)) return;
    const foe: Side = self.side === 'player' ? 'enemy' : 'player';
    const targets = ctx.living(foe);
    if (targets.length === 0) return;
    ctx.damage(ctx.rng.pick(targets), num(params.amount, 3) * mul(self));
  },

  /** Junkyard Titan — when any friendly Shield breaks, give your minions +atk/+hp. */
  onShieldBreakBuffAll: (ctx, self, params, payload) => {
    const { side } = payload as MinionPayload;
    if (self.dead || side !== self.side) return;
    const attack = num(params.attack, 1) * mul(self);
    const health = num(params.health, 1) * mul(self);
    for (const m of ctx.living(self.side)) ctx.buff(m, attack, health, self.uid);
  },

  // --- Demons (combat-resolved: Brood Matron breeds, the Sovereign destroys) ---

  /** Brood Matron — each time another friend dies, summon one Imp beside self, capped at `max` per combat
   *  (golden doubles the cap). The `bredCount` tracks how many it has bred this fight. */
  onFriendDeathSummon: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion === self || minion.side !== self.side) return;
    const cap = num(params.max, 3); // golden does NOT raise the cap — it doubles the Avenge buff instead
    if ((self.bredCount ?? 0) >= cap) return;
    ctx.summon(self.side, ctx.getCard(str(params.tokenId)), self.uid);
    self.bredCount = (self.bredCount ?? 0) + 1;
  },

  /** Abyssal Sovereign — Start of Combat: destroy the enemy with the highest Attack. */
  scDestroyHighestAttack: (ctx, self, params) => {
    const foe: Side = self.side === 'player' ? 'enemy' : 'player';
    const targets = ctx.living(foe);
    if (targets.length === 0) return;
    const victim = targets.reduce((a, b) => (b.attack > a.attack ? b : a));
    ctx.log({ type: 'sc', source: self.uid, text: str(params.text) || `${self.name} drags down the mightiest` });
    ctx.damage(victim, victim.health, false, true); // destroy: ignores Divine Shield
  },

  // ─── New content batch factories ────────────────────────────────────────────

  /** Trickster — Deathrattle: give a random friendly minion this minion's current maxHealth.
   *  Golden picks a target twice (independently). */
  deathrattleGiveHealth: (ctx, self, _params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const hp = self.maxHealth;
    if (hp <= 0) return;
    for (let i = 0; i < mul(self); i++) {
      const targets = ctx.living(self.side).filter((m) => m !== self);
      if (targets.length === 0) break;
      ctx.buff(ctx.rng.pick(targets), 0, hp, self.uid);
    }
  },

  /** Abhorrent Horror — Start of Combat: gain +Attack/+Health equal to all Fodder consumed this turn
   *  (passed in on the CombatContext). Golden doubles everything. */
  scGainFodderStats: (ctx, self, _params, _payload) => {
    const atk = ctx.fodderConsumedAtk * mul(self);
    const hp = ctx.fodderConsumedHp * mul(self);
    if (atk > 0 || hp > 0) {
      ctx.log({ type: 'sc', source: self.uid, text: `${self.name} absorbs the consumed essence` });
      ctx.buff(self, atk, hp, self.uid);
    }
  },

  /** Thundering Abomination (Engraved) — when a friendly minion is summoned in combat, buff self
   *  +atk/+hp. The Engraved keyword carries the gains back to the run board after combat. */
  onSummonSelfBuff: (ctx, self, params, payload) => {
    const { side } = payload as { side: Side };
    if (self.dead || side !== self.side) return;
    ctx.buff(self, num(params.attack, 3) * mul(self), num(params.health, 3) * mul(self), self.uid);
  },

  /** Thundering Abomination — when a summon on this side OVERFLOWS (board already full), buff all
   *  living friendly minions of `tribe` by +atk/+hp. */
  onSummonOverflowBuffTribe: (ctx, self, params, payload) => {
    const { side } = payload as { side: Side };
    if (self.dead || side !== self.side) return;
    const tribe = str(params.tribe) as Tribe | '';
    const a = num(params.attack, 2) * mul(self);
    const h = num(params.health, 2) * mul(self);
    for (const m of ctx.living(self.side)) {
      if (tribe && m.tribe !== tribe && m.tribe2 !== tribe && !ctx.getCard(m.cardId)?.universalTribe) continue;
      ctx.buff(m, a, h, self.uid);
    }
  },

  /** Sergeant — Deathrattle: give all living friendly minions +Health equal to `params.health` × golden,
   *  plus any `hpGrantBonus` accumulated by the Sergeant gaining Attack during this combat. */
  deathrattleBuffAllHealth: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const hp = num(params.health, 2) * mul(self) + (self.hpGrantBonus ?? 0);
    for (const m of ctx.living(self.side)) ctx.buff(m, 0, hp, self.uid);
  },

  /** Sergeant — when THIS minion's Attack rises in combat (onGainAttack), improve the Deathrattle's
   *  HP grant by +`improve` (golden +`improve`×2). Stored in `self.hpGrantBonus`; also emits a
   *  `hpGrant` event so the UI can show the live HP grant total in the combat card text. */
  onGainAttackImproveHpGrant: (ctx, self, params, payload) => {
    if (self.dead || (payload as MinionPayload).minion !== self) return;
    self.hpGrantBonus = (self.hpGrantBonus ?? 0) + num(params.improve, 2) * mul(self);
    ctx.log({ type: 'hpGrant', target: self.uid, amount: self.hpGrantBonus });
  },

  /** Forsaken Weaver (combat half) — when a spell is cast on this side, give all living friendly
   *  Undead (+ universalTribe minions) +`attack` Attack. */
  spellCastBuffUndeadAttack: (ctx, self, params, payload) => {
    const { side } = payload as { side: Side };
    if (self.dead || side !== self.side) return;
    const a = num(params.attack, 2) * mul(self);
    for (const m of ctx.living(self.side)) {
      if (m.tribe !== 'undead' && m.tribe2 !== 'undead' && !ctx.getCard(m.cardId)?.universalTribe) continue;
      ctx.buff(m, a, 0, self.uid);
    }
  },

  /** Pillager — Deathrattle: add a specific card (e.g. Gold Pouch) to the player's hand after combat.
   *  Golden grants `count`×2 copies. Carried back via CombatResult.playerHandGrants. */
  deathrattleGrantCardToHand: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const cardId = str(params.cardId);
    if (!cardId) return;
    const count = num(params.count, 1) * mul(self);
    for (let i = 0; i < count; i++) ctx.grantToHand(cardId, self.side, self.uid);
  },

  /** Karthus — when this kills an enemy, give your Undead +`attack` permanently (golden ×2).
   *  Buffs all living friendly Undead immediately, then carries back via `grantUndeadBuyAtk` so
   *  existing run-board Undead and future buys also benefit. */
  onKillBuffUndeadAttack: (ctx, self, params, payload) => {
    const { attacker } = payload as { attacker: Minion; victim: Minion };
    if (self !== attacker || self.dead) return;
    const amount = num(params.attack, 3) * mul(self);
    for (const m of ctx.living(self.side)) {
      if (m.tribe !== 'undead' && m.tribe2 !== 'undead' && !ctx.getCard(m.cardId)?.universalTribe) continue;
      ctx.buff(m, amount, 0, self.uid);
    }
    ctx.grantUndeadBuyAtk(amount, self.side);
  },

  /** Buff every living friendly Imp (the 1/1 Imp token) +atk/+hp, AND raise the run-wide Imp buff so the
   *  gain is PERMANENT (future Imps inherit it). Shared by Imp King (Deathrattle) and Brood Matron (Avenge).
   *  Golden doubles the per-proc amount. */
  deathrattleBuffImps: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const a = num(params.attack, 2) * mul(self);
    const h = num(params.health, 3) * mul(self);
    for (const m of ctx.living(self.side)) if (ctx.getCard(m.cardId)?.imp) ctx.buff(m, a, h, self.uid);
    ctx.grantImpBuff(a, h, self.side); // permanent — carried back to RunState.impBuff
  },

  /** Brood Matron — Avenge (X): every X friendly deaths, buff your Imps +atk/+hp (permanent, carried back).
   *  Golden doubles the stat gain (the summon cap stays at 3). */
  avengeBuffImps: (ctx, self, params, payload) => {
    const { side, count } = payload as { side: Side; count: number };
    if (self.dead || side !== self.side) return;
    const every = Math.max(1, num(params.count, 3));
    if (count % every !== 0) return;
    const a = num(params.attack, 3) * mul(self);
    const h = num(params.health, 2) * mul(self);
    for (const m of ctx.living(self.side)) if (ctx.getCard(m.cardId)?.imp) ctx.buff(m, a, h, self.uid);
    ctx.grantImpBuff(a, h, self.side); // permanent — carried back to RunState.impBuff
  },

  /** Ryme — Deathrattle: re-fire an adjacent minion's Battlecry in combat. Considers living neighbours that
   *  HAVE a Battlecry (random pick if both qualify); golden re-fires BOTH. Each trigger: (1) narrates via an
   *  `sc` event (so the replay shows Ryme proccing), (2) runs the Battlecry's combat-meaningful effect
   *  (economy battlecries no-op), and (3) emits `battlecryTriggered` so reactive cards (Karwind/Bane) proc —
   *  once per trigger. Drakko the Drummer doubles each trigger. Sylus / Deathsayer re-run this whole
   *  Deathrattle (they re-invoke by factory id), so their multiplication composes for free. */
  deathrattleReplayAdjacentBattlecry: (ctx, self, _params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const arr = ctx.boards[self.side];
    const i = arr.indexOf(self);
    const neighbors = [arr[i - 1], arr[i + 1]].filter(
      (m): m is Minion => !!m && !m.dead && m.health > 0 && hasBattlecry(m),
    );
    if (neighbors.length === 0) return;
    const chosen = self.golden ? neighbors : [ctx.rng.pick(neighbors)];
    const repeats = drakkoRepeats(ctx, self.side); // Drakko doubles each trigger (×2, golden Drakko ×3)
    for (const n of chosen) {
      for (let r = 0; r < repeats; r++) {
        ctx.log({ type: 'sc', source: self.uid, text: `${self.name} triggers ${n.name}'s Battlecry` });
        replayCombatBattlecry(ctx, n); // the Battlecry's own combat effect (no-op for economy battlecries)
        ctx.bus.emit('battlecryTriggered', { side: self.side, minion: n }); // procs Karwind / Bane per trigger
      }
    }
  },

  /** Karwind (combat half) — when a Battlecry is triggered on this side (Ryme re-firing an adjacent
   *  Battlecry), buff your minions of `tribe` +atk/+hp. Golden doubles. Mirrors the recruit factory. */
  onBattlecryBuffTribe: (ctx, self, params, payload) => {
    if (self.dead || (payload as { side: Side }).side !== self.side) return;
    const tribe = str(params.tribe);
    const a = num(params.attack, 1) * mul(self);
    const h = num(params.health, 1) * mul(self);
    for (const m of ctx.living(self.side)) {
      if (tribe && tribe !== 'any' && m.tribe !== tribe && m.tribe2 !== tribe && !ctx.getCard(m.cardId)?.universalTribe) continue;
      ctx.buff(m, a, h, self.uid);
    }
  },

  /** Bane (combat half) — on a triggered Battlecry, buff your living Fodder + Imps +atk/+hp, and raise BOTH
   *  the run-wide Imp buff AND the run-wide Fodder enchant (permanent — carried back) so future Fodder/Imps
   *  inherit it, exactly like the recruit-phase Bane. Golden doubles. */
  onBattlecryBuffFodder: (ctx, self, params, payload) => {
    if (self.dead || (payload as { side: Side }).side !== self.side) return;
    const a = num(params.attack, 1) * mul(self);
    const h = num(params.health, 1) * mul(self);
    for (const m of ctx.living(self.side)) {
      const def = ctx.getCard(m.cardId);
      if (def?.keywords.includes('FD') || def?.imp) ctx.buff(m, a, h, self.uid);
    }
    ctx.grantImpBuff(a, h, self.side); // Imps permanent — carried back to RunState.impBuff
    ctx.grantFodderBuff(a, h, self.side); // Fodder enchant permanent — carried back, mirrors recruit buffFodderRunWide
  },
};
