import { CARD_INDEX } from '@game/content';
import type { CombatEvent, CombatResult } from '@game/core';
import { ANNOUNCER_HIGH_ODDS, ANNOUNCER_LOW_ODDS } from './announcer';

/**
 * FIGHT RECAP (owner ask 2026-09-24): the pure derivations behind the redesigned post-combat summary. Nothing
 * here computes an outcome. Every number is read off the recorded fight (`CombatResult`: its event log, its
 * carry-backs, its odds) so the recap can never disagree with what the replay showed.
 */

// ── Stars of the fight ─────────────────────────────────────────────────────────────────────────────────────

export type StarStat = 'damage' | 'kills' | 'procs';

export interface FightStar {
  uid: string;
  cardId: string;
  name: string;
  golden: boolean;
  /** Every category this minion led, in display order (damage, kills, procs). */
  stats: { stat: StarStat; value: number }[];
}

/** Event families that count as ONE trigger of the minion named by `sourceOf`. */
function triggerSource(e: CombatEvent): string | undefined {
  switch (e.type) {
    case 'sc': case 'shout': case 'rally': case 'proccrit': case 'pummelTrigger': return e.source;
    case 'summon': case 'toHand': case 'keyword': case 'buff': case 'handBuff': return e.source;
    case 'maxGold': return e.target; // Soulsman's Avenge names the minion that fired as `target`
    default: return undefined;
  }
}

/**
 * The player's standout minions, from the event log alone.
 *
 * - **damage**: the sum of every `dmg` a player minion dealt to an enemy.
 * - **kills**: an enemy death (a Rise's first death does not count, the body returns) is credited to the LAST
 *   player minion that damaged that body before it fell.
 * - **procs**: effect triggers the minion sourced. One trigger that lands on several targets (a buff wave, a
 *   multi-summon) emits several events on the same `step`, so events are folded per (family, source, step).
 *
 * Each category names its single leader (ties go to the minion that entered the fight first). A minion that
 * leads two categories is shown once with both chips, so the row holds at most three portraits. Returns []
 * when the log has nothing to credit (no events, or no player minion did anything).
 */
export function fightStars(r: CombatResult | null | undefined): FightStar[] {
  if (!r) return [];
  const mine = new Map<string, { cardId: string; name: string; golden: boolean; order: number }>();
  const theirs = new Set<string>();
  let order = 0;
  for (const m of r.initial?.player ?? []) mine.set(m.uid, { cardId: m.cardId, name: m.name, golden: !!m.golden, order: order++ });
  for (const m of r.initial?.enemy ?? []) theirs.add(m.uid);

  const damage = new Map<string, number>();
  const kills = new Map<string, number>();
  const procs = new Map<string, number>();
  const lastHit = new Map<string, string>();
  const seen = new Set<string>();
  const bump = (m: Map<string, number>, k: string, n = 1): void => void m.set(k, (m.get(k) ?? 0) + n);

  r.events.forEach((e, i) => {
    if (e.type === 'summon') {
      if (e.side === 'player') {
        if (!mine.has(e.minion.uid)) mine.set(e.minion.uid, { cardId: e.minion.cardId, name: e.minion.name, golden: !!e.minion.golden, order: order++ });
      } else theirs.add(e.minion.uid);
    } else if (e.type === 'ascend') {
      const m = mine.get(e.target);
      if (m) mine.set(e.target, { ...m, cardId: e.into, name: CARD_INDEX[e.into]?.name ?? m.name });
    } else if (e.type === 'dmg') {
      if (e.source && mine.has(e.source) && theirs.has(e.target) && e.amount > 0) {
        bump(damage, e.source, e.amount);
        lastHit.set(e.target, e.source);
      } else if (theirs.has(e.target) && e.amount > 0) {
        lastHit.delete(e.target); // the last blow came from someone else, so no player minion earns the kill
      }
    } else if (e.type === 'death') {
      if (!e.rise && theirs.has(e.target)) {
        const killer = lastHit.get(e.target);
        if (killer) bump(kills, killer);
      }
      lastHit.delete(e.target);
    }
    const src = triggerSource(e);
    if (src && mine.has(src)) {
      const k = `${e.type}|${src}|${e.step ?? `i${i}`}`;
      if (!seen.has(k)) { seen.add(k); bump(procs, src); }
    }
  });

  const leader = (m: Map<string, number>): [string, number] | null => {
    let best: [string, number] | null = null;
    for (const [uid, v] of m) {
      if (v <= 0) continue;
      if (!best || v > best[1] || (v === best[1] && (mine.get(uid)?.order ?? 0) < (mine.get(best[0])?.order ?? 0))) best = [uid, v];
    }
    return best;
  };

  const out: FightStar[] = [];
  for (const [stat, m] of [['damage', damage], ['kills', kills], ['procs', procs]] as const) {
    const lead = leader(m);
    if (!lead) continue;
    const [uid, value] = lead;
    const existing = out.find((s) => s.uid === uid);
    if (existing) { existing.stats.push({ stat, value }); continue; }
    const info = mine.get(uid)!;
    out.push({ uid, cardId: info.cardId, name: info.name, golden: info.golden, stats: [{ stat, value }] });
  }
  return out;
}

export const starStatLabel = (s: { stat: StarStat; value: number }): string =>
  s.stat === 'damage' ? `${s.value} damage`
    : s.stat === 'kills' ? `${s.value} ${s.value === 1 ? 'kill' : 'kills'}`
    : `${s.value} ${s.value === 1 ? 'trigger' : 'triggers'}`;

// ── Odds ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface OddsLike { win: number; draw: number; lose: number; avgLossDamage: number; lossDamageRange?: [number, number] }

export interface OddsRecap {
  /** The one line of copy. */
  line: string;
  /** "Upset!" for a win the odds gave at most ANNOUNCER_LOW_ODDS; "Heartbreaker" for a loss they gave at least
   *  ANNOUNCER_HIGH_ODDS. The SAME thresholds (and comparisons) the announcer uses for its lines. */
  tag: 'upset' | 'heartbreaker' | null;
  /** Whole-percent Win / Draw / Loss that always sum to 100 (largest remainder), for the bar's labels. The bar
   *  is ALWAYS shown, 100/0 included (owner ask 2026-09-24: "keep the odds bar"). */
  pcts: { win: number; draw: number; lose: number };
  /** "A loss here usually costs 7-9 damage" whenever a loss was possible (null when none was). */
  lossLine: string | null;
}

/** Round three shares to whole percents that sum to exactly 100 (largest remainder). */
export function wholePercents(win: number, draw: number, lose: number): { win: number; draw: number; lose: number } {
  const raw = [win, draw, lose].map((p) => Math.max(0, p) * 100);
  const total = raw.reduce((a, b) => a + b, 0);
  if (total <= 0) return { win: 0, draw: 0, lose: 0 };
  const scaled = raw.map((r) => (r / total) * 100);
  const floor = scaled.map(Math.floor);
  let left = 100 - floor.reduce((a, b) => a + b, 0);
  const order = scaled.map((v, i) => [v - floor[i]!, i] as const).sort((x, y) => y[0] - x[0] || x[1] - y[1]);
  for (const [, i] of order) { if (left <= 0) break; floor[i]!++; left--; }
  return { win: floor[0]!, draw: floor[1]!, lose: floor[2]! };
}

/** "a" or "an" before a spoken number: an 8, an 11, an 18, an 80-89 (they start with a vowel sound). */
export const articleFor = (n: number): 'a' | 'an' => (n === 8 || n === 11 || n === 18 || (n >= 80 && n <= 89) ? 'an' : 'a');

export function oddsRecap(odds: OddsLike | null | undefined, result: 'win' | 'lose' | 'draw' | null): OddsRecap | null {
  if (!odds) return null;
  const pcts = wholePercents(odds.win, odds.draw, odds.lose);
  const w = pcts.win;
  const d = pcts.draw;
  const line = w >= 100 ? 'You were always going to win this one'
    : w <= 0 && d <= 0 ? 'This one was never winnable'
    : w <= 0 ? `You could not win this one, only draw (${d}%)`
    : `You had ${articleFor(w)} ${w}% chance to win`;
  const tag = result === 'win' && odds.win <= ANNOUNCER_LOW_ODDS ? 'upset'
    : result === 'lose' && odds.win >= ANNOUNCER_HIGH_ODDS ? 'heartbreaker'
    : null;
  let lossLine: string | null = null;
  if (odds.lose > 0) {
    const [lo, hi] = odds.lossDamageRange ?? [odds.avgLossDamage, odds.avgLossDamage];
    const a = Math.round(lo);
    const b = Math.round(hi);
    if (b > 0) lossLine = `A loss here usually costs ${a === b ? a : `${a}-${b}`} damage`;
  }
  return { line, tag, pcts, lossLine };
}

// ── Damage header ──────────────────────────────────────────────────────────────────────────────────────────

export interface DamageSplit { total: number; armor: number; resolve: number }

/** Split a hit the way the lobby applies it: Armor absorbs first, the rest comes off Resolve. `pool` is the
 *  seat's Armor going in; absent (a non-lobby run) = no split, all of it reads as a plain total. */
export function splitDamage(total: number, armorGoingIn: number | undefined): DamageSplit {
  const t = Math.max(0, total);
  if (armorGoingIn === undefined) return { total: t, armor: 0, resolve: t };
  const armor = Math.min(Math.max(0, armorGoingIn), t);
  return { total: t, armor, resolve: t - armor };
}

// ── What you keep ──────────────────────────────────────────────────────────────────────────────────────────

export interface GainItem {
  key: string;
  /** The card whose art the mini card shows, when there is one. */
  cardId?: string;
  /** Otherwise an `Icon` name. */
  icon?: string;
  label: string;
  chip: string;
}

const sv = (a: number, h: number): string => `+${a}/+${h}`;
const nameOf = (id: string): string => CARD_INDEX[id]?.name ?? id;

/**
 * The permanent gains a fight left behind, as mini-card items (the same carry-back channels `combatGains`
 * reads, one item each, with kept stats broken out per minion so each gets its own portrait). [] = nothing
 * lasting, in which case the recap hides the section outright.
 */
export function combatGainItems(r: CombatResult | null | undefined, board: readonly { uid: string; cardId: string }[] = []): GainItem[] {
  if (!r) return [];
  const out: GainItem[] = [];
  if (r.playerSpellPower && (r.playerSpellPower.attack || r.playerSpellPower.health)) {
    out.push({ key: 'sp', icon: 'mana', label: 'Your spells', chip: sv(r.playerSpellPower.attack, r.playerSpellPower.health) });
  }
  if (r.playerMaxGoldGain) out.push({ key: 'gold', icon: 'spend', label: 'Maximum Gold', chip: `+${r.playerMaxGoldGain}` });
  if (r.playerUndeadBuyAtkGain) out.push({ key: 'undead', icon: 'skull', label: 'Your Undead', chip: `+${r.playerUndeadBuyAtkGain} Attack` });
  if (r.playerImpBuffGain && (r.playerImpBuffGain.attack || r.playerImpBuffGain.health)) {
    out.push({ key: 'imp', icon: 'flame', label: 'Your Imps', chip: sv(r.playerImpBuffGain.attack, r.playerImpBuffGain.health) });
  }
  if (r.playerFodderBuffGain && (r.playerFodderBuffGain.attack || r.playerFodderBuffGain.health)) {
    out.push({ key: 'fodderbuff', icon: 'fodder', label: 'Your Fodder', chip: sv(r.playerFodderBuffGain.attack, r.playerFodderBuffGain.health) });
  }
  (r.playerCardBuffs ?? []).forEach((b, i) => {
    if (b.attack || b.health) out.push({ key: `cb${i}`, cardId: b.cardId, label: `Every ${nameOf(b.cardId)}`, chip: sv(b.attack, b.health) });
  });
  // Kept / engraved combat stats, per minion (merged when one body kept stats more than once).
  // `sourceUid` is the RUN-board card's uid (combat instances carry it back to their card), so the run board
  // resolves it first; combat uids are the fallback for hand-built results.
  const initial = new Map<string, string>([...(r.initial?.player ?? []).map((m) => [m.uid, m.cardId] as const), ...board.map((c) => [c.uid, c.cardId] as const)]);
  for (const e of r.events) if (e.type === 'summon' && e.side === 'player' && !initial.has(e.minion.uid)) initial.set(e.minion.uid, e.minion.cardId);
  const kept = new Map<string, { a: number; h: number }>();
  for (const b of r.playerPermaBuffs ?? []) {
    const t = kept.get(b.sourceUid) ?? { a: 0, h: 0 };
    t.a += b.attack; t.h += b.health;
    kept.set(b.sourceUid, t);
  }
  for (const [uid, t] of kept) {
    if (!t.a && !t.h) continue;
    const cardId = initial.get(uid);
    out.push({ key: `pb${uid}`, cardId, icon: cardId ? undefined : 'engrave', label: cardId ? nameOf(cardId) : 'A minion', chip: sv(t.a, t.h) });
  }
  if (r.playerFodderGrants) out.push({ key: 'fodder', icon: 'fodder', label: 'Fodder next tavern', chip: `+${r.playerFodderGrants}` });
  if (r.playerFreeRolls) out.push({ key: 'rolls', icon: 'refresh', label: r.playerFreeRolls === 1 ? 'Free reroll' : 'Free rerolls', chip: `+${r.playerFreeRolls}` });
  (r.playerHandGrants ?? []).forEach((id, i) => out.push({ key: `hg${i}`, cardId: id, label: nameOf(id), chip: 'To hand' }));
  return out;
}
