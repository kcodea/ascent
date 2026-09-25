import { CARD_INDEX } from '@game/content';
import type { CombatResult } from '@game/core';
import { ANNOUNCER_HIGH_ODDS, ANNOUNCER_LOW_ODDS } from './announcer';

/**
 * FIGHT RECAP (owner ask 2026-09-24): the pure derivations behind the redesigned post-combat summary. Nothing
 * here computes an outcome. Every number is read off the recorded fight (`CombatResult`: its event log, its
 * carry-backs, its odds) so the recap can never disagree with what the replay showed.
 */

// ── Odds ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface OddsLike { win: number; draw: number; lose: number; avgLossDamage: number; avgWinDamage?: number }

export interface OddsRecap {
  /** "Upset!" for a win the odds gave at most ANNOUNCER_LOW_ODDS; "Heartbreaker" for a loss they gave at least
   *  ANNOUNCER_HIGH_ODDS. The SAME thresholds (and comparisons) the announcer uses for its lines. */
  tag: 'upset' | 'heartbreaker' | null;
  /** Whole-percent Win / Draw / Loss that always sum to 100 (largest remainder), for the bar's labels. The bar
   *  is ALWAYS shown, 100/0 included (owner ask 2026-09-24: "keep the odds bar"). */
  pcts: { win: number; draw: number; lose: number };
  /** The average damage a WIN here deals, rounded, beside the Win odds (owner ask 2026-09-25). Null when no sim
   *  won, or on odds recorded before the probe tracked it. */
  winDmg: number | null;
  /** The average damage a LOSS here costs you, rounded, beside the Loss odds. Null when no sim lost. */
  lossDmg: number | null;
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

export function oddsRecap(odds: OddsLike | null | undefined, result: 'win' | 'lose' | 'draw' | null): OddsRecap | null {
  if (!odds) return null;
  const pcts = wholePercents(odds.win, odds.draw, odds.lose);
  const tag = result === 'win' && odds.win <= ANNOUNCER_LOW_ODDS ? 'upset'
    : result === 'lose' && odds.win >= ANNOUNCER_HIGH_ODDS ? 'heartbreaker'
    : null;
  const winDmg = odds.win > 0 && odds.avgWinDamage !== undefined ? Math.round(odds.avgWinDamage) : null;
  const lossDmg = odds.lose > 0 ? Math.round(odds.avgLossDamage) : null;
  return { tag, pcts, winDmg, lossDmg };
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
