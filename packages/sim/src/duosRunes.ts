/**
 * DUOS-ONLY RUNES (owner design 2026-10-30, R-DUOS-RUNES-01). The engines behind the nine Duos runes. Every rune is
 * offered only by a Duos run's forge (`RuneDef.duos`), so all state lives on the run's Duos record (`duos.runes`) and
 * nothing here runs outside Versus Duos / Ranked Duos.
 *
 *   Basic: Spell Theory, Gold Gifts (Equipment `gold_gifter`, content only), Teammate Synergy, Passable (a
 *          `recurringGrant` of Handout, content only), Playing Catch.
 *   Epic:  Shoutful Bounty, Echoing Results, Salesman of the Year, Megamimed (a `grant` of the Megamimic token; the
 *          transform lives in core `megamimic.ts`).
 *
 * THE METERS (Shoutful Bounty: every 2 Shouts, a random spell for the teammate, three per turn; Echoing Results: every
 * 3 Echoes, a random minion, two per turn; owner: "needs to work in combat + recruit and show the cards in real time").
 * ONE counter per rune, cross-phase: the Shop ticks it at the reducer's per-action Shout / Echo boundary (the same count
 * the Shout and Echo quest objectives read); a fight carries it in (`QuestCombatMods.duosMeters`), ticks it on every
 * combat Shout / Echo fire, sends the gift through `sendTeam` the moment the meter trips (a `teamSend` event, shipped by
 * the client when its replay reaches that beat, R-DUOS-RUNES-02), and carries the final state home
 * (`ShoutCarry.duosMeters`). The per-turn cap counts the Shop and its fight together (a "turn" is a round).
 */
import type { TeamEffect } from '@game/core';
import { CARD_INDEX } from '@game/content';
import type { QuestCombatMods, ShoutCarry } from '@game/core';
import type { RunState } from './state';
import { procRuneId } from './state';
import { queueTeamEffect } from './duosPass';
import { conjureToHand } from './recruit';

export interface DuosRuneMeter {
  sourceId: 'rune_shoutful_bounty' | 'rune_echoing_results';
  meter: 'shout' | 'echo';
  per: number;
  /** Fires banked toward the next gift (parks at `per - 1` once the turn's cap is reached). */
  tick: number;
  /** Gifts this turn may send. */
  cap: number;
  /** Gifts sent on turn `paidWave`. */
  paid: number;
  paidWave?: number;
}

/** The Duos runes' run state (`duos.runes`). Absent until a Duos rune is bought. */
export interface DuosRuneState {
  /** Spell Theory: copies held (each pays one copy), and the turn it last paid ("(Once per turn)"). */
  spellTheory?: number;
  spellTheoryWave?: number;
  /** Teammate Synergy: Triple Rewards still to give this game ("(3 per game)"). */
  synergyLeft?: number;
  /** Salesman of the Year: minion sales that pass each turn, and how many sold on turn `salesWave`. */
  salesman?: number;
  salesWave?: number;
  salesUsed?: number;
  /** Shoutful Bounty / Echoing Results. */
  meters?: DuosRuneMeter[];
  /** PLAYING CATCH ("Your first 3 passes as a team each round are free"): the team's free MANUAL passes per round my
   *  own runes give (`catchOwn`) and my teammate's runes give (`catchMate`, learned from their `catch` team effect),
   *  and how many the TEAM has used on round `catchWave` (my free passes plus my teammate's that landed here). */
  catchOwn?: number;
  catchMate?: number;
  catchWave?: number;
  catchUsed?: number;
  // ── DUOS BATCH 2 (owner picks 2026-11-01, R-DUOS-RUNES-04) ──
  /** HAND-ME-DOWNS ("When you sell a minion, your teammate gets 1 Gold. (Twice per turn)"): copies held (each pays 1
   *  Gold a sale), the paying sales a turn allows, and how many paid on turn `handMeDownsWave`. */
  handMeDowns?: number;
  handMeDownsCap?: number;
  handMeDownsWave?: number;
  handMeDownsUsed?: number;
  /** BUDDY SYSTEM ("When you buy a minion, give your teammate's left-most minion +3/+2"): copies held. */
  buddySystem?: number;
  /** GILD PACT ("When your teammate Gilds a minion, you and your teammate each get 2 Gold Pouches"): copies held. */
  gildPact?: number;
  /** PEP TALK ("When your teammate triggers a Shout, give your left-most minion +2/+3"): copies held. */
  pepTalk?: number;
  /** What my TEAMMATE's runes need to hear from my run (their `listen` team effect): my Gilds. */
  mateListens?: { gild?: true };
}

const runesOf = (s: RunState): DuosRuneState | null => (s.duos ? (s.duos.runes ??= {}) : null);
const SHOUT_BOUNTY_GIFT: TeamEffect = { kind: 'gift', randomSpell: true };
const ECHO_RESULTS_GIFT: TeamEffect = { kind: 'gift', randomMinion: true };

/** Arm a Duos rune engine (the `duosRune` reward). Outside a Duos run there is nothing to arm. */
export function armDuosRune(s: RunState, r: { rune: string; per?: number; cap?: number; uses?: number }): void {
  const d = runesOf(s);
  if (!d) return;
  switch (r.rune) {
    case 'spellTheory': d.spellTheory = (d.spellTheory ?? 0) + 1; break;
    case 'teammateSynergy': d.synergyLeft = (d.synergyLeft ?? 0) + (r.uses ?? 3); break;
    case 'salesman': d.salesman = (d.salesman ?? 0) + (r.uses ?? 2); break;
    case 'playingCatch': {
      const n = r.uses ?? 3;
      d.catchOwn = (d.catchOwn ?? 0) + n;
      // The teammate passes free too ("as a team"): their run learns the allowance through the team channel.
      queueTeamEffect(s, { kind: 'catch', amount: n });
      break;
    }
    case 'handMeDowns':
      d.handMeDowns = (d.handMeDowns ?? 0) + 1;
      d.handMeDownsCap = Math.max(d.handMeDownsCap ?? 0, r.uses ?? 2);
      break;
    case 'buddySystem': d.buddySystem = (d.buddySystem ?? 0) + 1; break;
    case 'gildPact':
      d.gildPact = (d.gildPact ?? 0) + 1;
      // The trigger is my TEAMMATE's Gild: their run learns to tell mine (the team channel, R-DUOS-RUNES-04).
      queueTeamEffect(s, { kind: 'listen', what: 'gild' });
      break;
    case 'pepTalk':
      d.pepTalk = (d.pepTalk ?? 0) + 1;
      break;
    case 'shoutfulBounty':
    case 'echoingResults': {
      const shout = r.rune === 'shoutfulBounty';
      (d.meters ??= []).push({
        sourceId: shout ? 'rune_shoutful_bounty' : 'rune_echoing_results', meter: shout ? 'shout' : 'echo',
        per: r.per ?? (shout ? 2 : 3), tick: 0, cap: r.cap ?? (shout ? 3 : 2), paid: 0,
      });
      break;
    }
  }
}

const giftOf = (m: DuosRuneMeter): TeamEffect => (m.meter === 'shout' ? SHOUT_BOUNTY_GIFT : ECHO_RESULTS_GIFT);
const paidNow = (s: RunState, m: DuosRuneMeter): number => (m.paidWave === s.wave ? m.paid : 0);

/** SHOP: `n` Shout / Echo fires this action. A trip queues the gift for the teammate now (the pass channel). */
export function advanceDuosMeters(s: RunState, meter: 'shout' | 'echo', n: number): void {
  const ms = s.duos?.runes?.meters;
  if (!ms || n <= 0) return;
  for (const m of ms) {
    if (m.meter !== meter || m.per <= 0) continue;
    for (let i = 0; i < n; i++) {
      // At the turn's cap the meter keeps counting but parks one short of a trip (the Chorus's "banked, not paid").
      if (paidNow(s, m) >= m.cap) { m.tick = Math.min(m.tick + 1, m.per - 1); continue; }
      m.tick += 1;
      if (m.tick < m.per) continue;
      m.tick -= m.per;
      m.paid = paidNow(s, m) + 1;
      m.paidWave = s.wave;
      procRuneId(s, m.sourceId);
      queueTeamEffect(s, giftOf(m), undefined, { rune: m.sourceId });
    }
  }
}

/** COMBAT: the meters a fight carries in (the shop's tick and this turn's payouts). */
export function duosMetersMods(s: RunState): QuestCombatMods['duosMeters'] {
  const ms = s.duos?.runes?.meters;
  if (!ms?.length) return undefined;
  return ms.map((m) => ({ sourceId: m.sourceId, meter: m.meter, per: m.per, tick: m.tick, cap: m.cap, paid: paidNow(s, m), gift: { ...giftOf(m) } }));
}

/** SETTLE: the fight's final meter state comes home (its gifts already rode `teamEffects`). */
export function settleDuosMeters(s: RunState, carry: ShoutCarry | undefined): void {
  const ms = s.duos?.runes?.meters;
  if (!ms || !carry?.duosMeters) return;
  carry.duosMeters.forEach((c, i) => {
    const m = ms[i];
    if (!m || m.sourceId !== c.sourceId) return;
    const before = paidNow(s, m);
    m.tick = c.tick;
    m.paid = c.paid;
    m.paidWave = s.wave;
    if (c.paid > before) procRuneId(s, m.sourceId, c.paid - before);
  });
}

/** SPELL THEORY ("When you pass a spell, get a copy of it. (Once per turn)"): YOUR pass of a spell, manual or by an
 *  effect. One copy per rune held, the first spell passed each turn. */
export function duosOnPassed(s: RunState, cardId: string): void {
  const d = s.duos?.runes;
  if (!d?.spellTheory || d.spellTheoryWave === s.wave) return;
  const def = CARD_INDEX[cardId];
  if (!def?.spell || def.ruby) return;
  d.spellTheoryWave = s.wave;
  procRuneId(s, 'rune_spell_theory');
  conjureToHand(s, [def], d.spellTheory, true);
}

/** Gild Pact on my TEAMMATE's run hears every Gild of mine (R-DUOS-RUNES-04), whatever made it: called by the one gild
 *  chokepoint (`noteGilded`: a triple and every other Gild). */
export function duosOnGild(s: RunState | undefined): void {
  if (s?.duos?.runes?.mateListens?.gild) queueTeamEffect(s, { kind: 'mateGild' });
}

/** TEAMMATE SYNERGY (owner 2026-11-01, R-DUOS-RUNES-05: "when you get a triple reward, your teammate does too. (3 per
 *  game)"): called by the one Triple Reward grant (`grantGoldenDiscover`) for every Triple Reward that LANDED in my hand,
 *  whatever gave it. My teammate gets one at the same tier, streaming from the rune badge. A reward my teammate's
 *  Teammate Synergy sent me (`fromSynergy`) never sends one back, so two copies never ping-pong. */
export function duosOnTripleReward(s: RunState, tier: number, fromSynergy: boolean): void {
  const d = s.duos?.runes;
  if (fromSynergy || !d?.synergyLeft || d.synergyLeft <= 0) return;
  d.synergyLeft -= 1;
  procRuneId(s, 'rune_teammate_synergy');
  queueTeamEffect(s, { kind: 'tripleReward', count: 1, tier, synergy: true }, undefined, { rune: 'rune_teammate_synergy' });
}

/** SALESMAN OF THE YEAR ("The first 2 minions you sell per turn pass to your teammate"): does THIS sale pass? Counts
 *  every minion sale of the turn (the first `salesman` of them pass), and spends the slot. */
export function duosSaleShouldPass(s: RunState): boolean {
  const d = s.duos?.runes;
  if (!d?.salesman) return false;
  if (d.salesWave !== s.wave) { d.salesWave = s.wave; d.salesUsed = 0; }
  if ((d.salesUsed ?? 0) >= d.salesman) return false;
  d.salesUsed = (d.salesUsed ?? 0) + 1;
  return true;
}

// ── DUOS BATCH 2 (owner picks 2026-11-01, R-DUOS-RUNES-04) ──────────────────────────────────────────────────────────

/** My teammate's rune wants to hear `what` from my run (their `listen` team effect). */
export function duosListen(s: RunState, what: unknown): void {
  const d = runesOf(s);
  if (!d || what !== 'gild') return;
  d.mateListens = { ...(d.mateListens ?? {}), [what]: true };
}

/** HAND-ME-DOWNS: a minion sale. My teammate gets 1 Gold per copy, on the first `cap` sales each turn. */
export function duosOnSoldHandMeDowns(s: RunState): void {
  const d = s.duos?.runes;
  if (!d?.handMeDowns) return;
  if (d.handMeDownsWave !== s.wave) { d.handMeDownsWave = s.wave; d.handMeDownsUsed = 0; }
  if ((d.handMeDownsUsed ?? 0) >= (d.handMeDownsCap ?? 2)) return;
  d.handMeDownsUsed = (d.handMeDownsUsed ?? 0) + 1;
  procRuneId(s, 'rune_hand_me_downs');
  queueTeamEffect(s, { kind: 'gold', amount: d.handMeDowns }, undefined, { rune: 'rune_hand_me_downs' });
}

/** BUDDY SYSTEM: a minion bought. My teammate's left-most minion gets +3/+2 per copy, permanently (no limit). */
export function duosOnBoughtBuddy(s: RunState): void {
  const n = s.duos?.runes?.buddySystem ?? 0;
  if (n <= 0) return;
  procRuneId(s, 'rune_buddy_system');
  queueTeamEffect(s, { kind: 'buffLeftmost', attack: 3 * n, health: 2 * n, runeId: 'rune_buddy_system' }, undefined, { rune: 'rune_buddy_system' });
}

/** PEP TALK, the Shop half: `n` Shout fires of mine this action give my teammate's left-most +2/+3 each (per copy),
 *  permanently (a Shop trigger: the buff-permanence-by-phase rule), as one buff streaming from the rune badge. */
export function duosPepTalkShop(s: RunState, n: number): void {
  const b = pepTalkBuff(s);
  if (!b || n <= 0) return;
  procRuneId(s, 'rune_pep_talk');
  queueTeamEffect(s, { kind: 'buffLeftmost', attack: b.attack * n, health: b.health * n, runeId: 'rune_pep_talk' }, undefined, { rune: 'rune_pep_talk' });
}

/** PEP TALK's buff per Shout I trigger: +2/+3 per copy held (null without the rune). */
export function pepTalkBuff(s: Pick<RunState, 'duos'>): { attack: number; health: number } | null {
  const n = s.duos?.runes?.pepTalk ?? 0;
  return n > 0 ? { attack: 2 * n, health: 3 * n } : null;
}

/** COMBAT: Pep Talk rides into the fight on the holder's side (`QuestCombatMods.duosPepTalk`). */
export function duosPepTalkMods(s: RunState): QuestCombatMods['duosPepTalk'] {
  return pepTalkBuff(s) ?? undefined;
}

// ── PLAYING CATCH ────────────────────────────────────────────────────────────────────────────────────────────────

/** The team's free manual passes per round (both teammates' Playing Catch). */
export const duosCatchAllowance = (s: RunState): number => (s.duos?.runes?.catchOwn ?? 0) + (s.duos?.runes?.catchMate ?? 0);
/** The team's Playing Catch passes used this round, as this run knows them. */
export const duosCatchUsed = (s: RunState): number => (s.duos?.runes?.catchWave === s.wave ? s.duos.runes.catchUsed ?? 0 : 0);
/** Is a Playing Catch free pass left for the team this round? */
export const duosCatchLeft = (s: RunState): boolean => duosCatchUsed(s) < duosCatchAllowance(s);

/** One more team Playing Catch pass this round (mine, or my teammate's landing here); `-1` gives one back (a refund). */
export function duosCatchBump(s: RunState, by: 1 | -1, wave = s.wave): void {
  const d = runesOf(s);
  if (!d || wave !== s.wave) return;
  if (d.catchWave !== s.wave) { d.catchWave = s.wave; d.catchUsed = 0; }
  d.catchUsed = Math.max(0, (d.catchUsed ?? 0) + by);
}

/** The teammate's Playing Catch arrived (their `catch` team effect). Clamped: the payload is a client's. */
export function duosCatchFromMate(s: RunState, amount: number): void {
  const d = runesOf(s);
  if (!d) return;
  d.catchMate = Math.min(30, (d.catchMate ?? 0) + Math.max(0, Math.min(10, Math.floor(amount))));
}

// ── LIVE TALLIES (the rune badge, R-TEXT live-value rule) ──────────────────────────────────────────────────────────

/** The live badge read-out for a Duos rune, or null when it is not one (or not armed). */
export function duosRuneTally(s: RunState, runeId: string): string | null {
  const d = s.duos?.runes;
  if (!d) return null;
  switch (runeId) {
    case 'rune_spell_theory':
      return d.spellTheory ? (d.spellTheoryWave === s.wave ? 'Used this turn' : 'Ready') : null;
    case 'rune_teammate_synergy':
      return d.synergyLeft != null ? `${d.synergyLeft} left` : null;
    case 'rune_salesman_of_the_year':
      return d.salesman ? `${d.salesWave === s.wave ? Math.min(d.salesUsed ?? 0, d.salesman) : 0}/${d.salesman} this turn` : null;
    case 'rune_playing_catch': {
      const all = duosCatchAllowance(s);
      return all > 0 ? `${Math.max(0, all - duosCatchUsed(s))}/${all} free` : null;
    }
    case 'rune_hand_me_downs':
      return d.handMeDowns ? `${d.handMeDowns > 1 ? `${d.handMeDowns} Gold · ` : ''}${d.handMeDownsWave === s.wave ? Math.min(d.handMeDownsUsed ?? 0, d.handMeDownsCap ?? 2) : 0}/${d.handMeDownsCap ?? 2} this turn` : null;
    // No limit and a fixed size: the badge speaks only when a second copy changed the printed number (the live-value rule).
    case 'rune_buddy_system':
      return (d.buddySystem ?? 0) > 1 ? `+${3 * d.buddySystem!}/+${2 * d.buddySystem!}` : null;
    case 'rune_pep_talk':
      return (d.pepTalk ?? 0) > 1 ? `+${2 * d.pepTalk!}/+${3 * d.pepTalk!}` : null;
    case 'rune_gild_pact':
      return (d.gildPact ?? 0) > 1 ? `${2 * d.gildPact!} Pouches` : null;
    case 'rune_shoutful_bounty':
    case 'rune_echoing_results': {
      const m = d.meters?.find((x) => x.sourceId === runeId);
      if (!m) return null;
      const unit = m.meter === 'shout' ? 'Shouts' : 'Echoes';
      return `${Math.min(m.tick, m.per)}/${m.per} ${unit} · ${paidNow(s, m)}/${m.cap} this turn`;
    }
  }
  return null;
}
