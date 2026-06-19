import type { CombatContext, EffectFactoryId, Minion, Side, Tribe } from '../types';

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

/** Echo Warden: each living one adds *extra* summoned tokens (additive, not multiplicative) —
 *  a golden Echo Warden counts as 2. So Pack Scrounger (2 Pups) + one Echo Warden → 3 Pups. */
function echoBonus(ctx: CombatContext, side: Side): number {
  return ctx
    .living(side)
    .filter((m) => m.cardId === 'echo')
    .reduce((sum, m) => sum + (m.golden ? 2 : 1), 0);
}

/**
 * Combat-time factories. This is a *partial* registry: recruit-time ids
 * (battlecries, buff-on-buy) are implemented in `@game/sim` against the run
 * board, and any effect without a combat factory here is simply inert during
 * `simulate()` (see `registerEffects`).
 */
export const FACTORIES: Partial<Record<EffectFactoryId, EffectFn>> = {
  /** Deathrattle: summon `count` copies of token `tokenId` beside self. */
  deathrattleSummon: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const card = ctx.getCard(str(params.tokenId));
    const total = num(params.count, 1) + echoBonus(ctx, self.side);
    for (let i = 0; i < total; i++) ctx.summon(self.side, card, self.uid);
  },

  /** When a friendly minion of `tribe` is summoned, buff it. The per-stat magnitude is the
   *  base buff + `self.summonBonus` (Kennelmaster's Avenge / triple-combined bonus). No golden
   *  doubling here — a golden's bonus already encodes the combined magnitude (see checkTriples). */
  buffOnSummon: (ctx, self, params, payload) => {
    const { minion, side } = payload as MinionPayload;
    if (self.dead || side !== self.side || minion === self) return;
    const tribe = str(params.tribe) as Tribe | 'any';
    if (tribe !== 'any' && minion.tribe !== tribe) return;
    const bonus = self.summonBonus;
    ctx.buff(minion, num(params.attack) + bonus, num(params.health) + bonus, self.uid);
  },

  /** Deathrattle: buff all living friends of `tribe` (+atk/+hp). */
  deathrattleBuffTribe: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const tribe = str(params.tribe) as Tribe | 'any';
    const attack = num(params.attack) * mul(self);
    const health = num(params.health) * mul(self);
    for (const m of ctx.living(self.side)) {
      if (tribe === 'any' || m.tribe === tribe || m.tribe2 === tribe) ctx.buff(m, attack, health, self.uid);
    }
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
    const others = ctx.living(self.side).filter((m) => m !== self && (m.tribe === tribe || m.tribe2 === tribe)).length;
    for (let i = 0; i < others; i++) {
      const targets = ctx.living(foe);
      if (targets.length === 0) break;
      ctx.damage(ctx.rng.pick(targets), per);
    }
  },

  // --- Undead (combat-time Deathrattle / on-death value) ---

  /** Deathrattle (Sporeling): buff a random living friend. */
  deathrattleBuffRandom: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    const friends = ctx.living(self.side);
    if (friends.length === 0) return;
    ctx.buff(ctx.rng.pick(friends), num(params.attack) * mul(self), num(params.health) * mul(self), self.uid);
  },

  /** Deathrattle (Arcane Weaver): add a copy of a spell to your hand after combat. Golden grants two. */
  deathrattleGrantSpell: (ctx, self, params, payload) => {
    if ((payload as MinionPayload).minion !== self) return;
    for (let i = 0; i < mul(self); i++) ctx.grantToHand(str(params.cardId), self.side);
  },

  /** Rally — when *this* minion attacks, buff your other living minions (+atk/+hp). */
  rallyBuff: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion !== self) return; // only on this minion's own attack
    const attack = num(params.attack, 1) * mul(self);
    const health = num(params.health, 1) * mul(self);
    for (const m of ctx.living(self.side)) if (m !== self) ctx.buff(m, attack, health, self.uid);
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
    // The Deathrattle procs exactly as a real death would: once, plus Sylus the Reaper's extra procs
    // (+1 per Sylus, +2 if golden). Echo Warden's extra tokens are already folded into the summon
    // factories, so e.g. Pack Scrounger here = (2 + Echo) Pups × (1 + Sylus) procs.
    const reaperBonus = ctx.living(self.side).reduce((n, m) => n + (m.cardId === 'sylus' ? (m.golden ? 2 : 1) : 0), 0);
    for (let r = 0; r < 1 + reaperBonus; r++) {
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
   *  buff a random living friend (+3/+3; golden doubles). The combat half of its recruit overflow buff. */
  overflowBuffRandom: (ctx, self, params, payload) => {
    if (self.dead || (payload as { side?: Side }).side !== self.side) return;
    const friends = ctx.living(self.side);
    if (friends.length === 0) return;
    ctx.buff(ctx.rng.pick(friends), num(params.attack, 3) * mul(self), num(params.health, 3) * mul(self), self.uid);
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

  /** Omega Bulwark — Start of Combat: give all your Mechs a Divine Shield. */
  scGrantShieldTribe: (ctx, self, params) => {
    const tribe = (str(params.tribe) || 'mech') as Tribe;
    const friends = ctx.living(self.side).filter((m) => m.tribe === tribe || m.tribe2 === tribe);
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
    if (self.dead || side !== self.side || minion.tribe !== 'mech') return;
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

  /** Brood Matron — each time another friend dies, summon a token beside self. */
  onFriendDeathSummon: (ctx, self, params, payload) => {
    const { minion } = payload as MinionPayload;
    if (self.dead || minion === self || minion.side !== self.side) return;
    // Golden Brood Matron breeds two per death; Echo Wardens add extra on top (additive).
    const reps = mul(self) + echoBonus(ctx, self.side);
    for (let i = 0; i < reps; i++) ctx.summon(self.side, ctx.getCard(str(params.tokenId)), self.uid);
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
};
