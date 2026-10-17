import type { QuestCombatMods } from '@game/core';
import { RUNE_INDEX } from '@game/content';
import { PACKCRAFT_STEP, type RunState } from './state';
import type { BoardSnapshot } from './snapshot';

/**
 * THE LIVE VALUE OF A SELF-IMPROVING RUNE (owner report 2026-10-16, R-RUNE-LIVE-TEXT-01).
 *
 * "Card text ALWAYS shows the CURRENT value" (CLAUDE.md) holds for runes too. A rune that improves ITSELF ("give it
 * +2 Attack and improve this by 2 permanently") printed its authored base forever, so after a few Beast swings
 * the Rune of the Wild Hunt still read "+2 Attack" while it was really paying +12. The owner's words: "this rune
 * should show the current value in real time."
 *
 * This module is the ONE place that reads the run's grown value for each such rune. It is pure and cheap, and the
 * UI's `liveRuneText` folds the result into the printed text in place. Three sources feed it:
 *   · `runeLiveStateOfRun`: the player's own run (the Shop, the Runeforge offer, the hero-slot rune);
 *   · `runeLiveStateOfSnapshot`: a captured board (an opponent, a spectated seat, match details, Career, Recent
 *     Games), whose final value rides on the snapshot the run recorded;
 *   · `runeLiveStateInCombat`: either of the above advanced by what the replay has shown so far this fight, so the
 *     tooltip ticks the moment each Beast attacks (real-time by default, R-REALTIME-01).
 *
 * Every number is PER COPY, so it reads against the rune's printed step: two Wild Hunts (Rune of Duplication) each
 * print half the combined grant and both still say "improve this by 2".
 */
export interface RuneLiveState {
  /** Rune of the Wild Hunt: the Attack the NEXT Beast attack grants, per copy. */
  wildHunt?: number;
  /** Rune of Packcraft: the stats the NEXT combat summon gets, per copy. */
  packcraft?: { attack: number; health: number };
  /** Copies of Packcraft held: each summon grows the per-copy level by the printed step × copies (simulate). */
  packcraftCopies?: number;
  /** Rune of Beastial Swarm: the per-Beast-death buff right now. */
  beastialSwarm?: number;
  /** Rune of the Seasoned Ledger: what the next minion you play gets. */
  seasonedLedger?: { attack: number; health: number };
  /** Rune of Compounding Wages: what the next 10 Gold pays your Dwarves. */
  compoundingWages?: { attack: number; health: number };
  /** Rune of the Wheel: the Shop aura right now. */
  wheel?: { attack: number; health: number };
  /** Rune of the Baller: what the NEXT sale pays, per copy, and which stat. */
  baller?: { amount: number; stat: 'Attack' | 'Health' };
}

const intIn = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100_000 ? Math.round(v) : undefined;
const pairIn = (v: unknown): { attack: number; health: number } | undefined => {
  if (!v || typeof v !== 'object') return undefined;
  const a = intIn((v as { attack?: unknown }).attack);
  const h = intIn((v as { health?: unknown }).health);
  return a !== undefined && h !== undefined ? { attack: a, health: h } : undefined;
};

/** Wild Hunt's authored grant (also its step) — the printed "+2". */
export const WILD_HUNT_BASE = 2;
/** Beastial Swarm's authored per-death buff and its Avenge (2) step (simulate's `beastialLevel += 2`). */
export const BEASTIAL_SWARM_BASE = 2;
const BEASTIAL_SWARM_EVERY = 2;

/** The inputs Wild Hunt needs, wherever they come from: the total grown escalation and the mod (sum of copies' steps). */
function wildHuntPerCopy(grown: number, step: number | undefined, copies: number | undefined): number {
  const n = Math.max(1, copies ?? 1);
  const totalStep = step && step > 0 ? step : WILD_HUNT_BASE * n;
  // simulate: `grown += step; buff(attacker, grown)`, so the next attack grants grown + step in total.
  return Math.round((grown + totalStep) / n);
}

/** The player's own run. Only runes the run can show are filled; an unowned rune reads its printed base. */
export function runeLiveStateOfRun(run: RunState): RuneLiveState {
  const out: RuneLiveState = {};
  const f = run.questFlags;
  const copies = run.flagCopies;
  if (f?.runeWildHunt || (run.runeWildHuntGrown ?? 0) > 0) {
    out.wildHunt = wildHuntPerCopy(run.runeWildHuntGrown ?? 0, f?.runeWildHunt, copies?.runeWildHunt);
  }
  if (f?.runePackcraft || run.packcraftLevel) {
    out.packcraft = { ...(run.packcraftLevel ?? PACKCRAFT_STEP) };
    out.packcraftCopies = Math.max(1, copies?.runePackcraft ?? 1);
  }
  if (f?.runeBeastialSwarm || run.beastialSwarmLevel) out.beastialSwarm = run.beastialSwarmLevel ?? BEASTIAL_SWARM_BASE;
  if (run.runeSeasonedLedger) out.seasonedLedger = { attack: run.runeSeasonedLedger.attack, health: run.runeSeasonedLedger.health };
  const wages = run.runeThresholds?.find((t) => t.sourceId === 'rune_compounding_wages');
  if (wages?.buff) out.compoundingWages = { attack: wages.buff.attack, health: wages.buff.health };
  if (run.shopAuraGrow) {
    // The base landed once at purchase (`tavernBuyBonus`); `grown` is every improve since.
    const r = RUNE_INDEX['rune_wheel']?.reward;
    const base = r?.kind === 'shopAuraGrowing' ? r : { attack: 2, health: 2 };
    out.wheel = { attack: base.attack + run.shopAuraGrow.grown, health: base.health + run.shopAuraGrow.grown };
  }
  if (run.runeBaller) {
    const next = run.runeBaller.sales + 1;
    // The reducer pays step × ceil(next/2) × copies; the badge text is per copy.
    out.baller = { amount: run.runeBaller.step * Math.ceil(next / 2), stat: next % 2 === 1 ? 'Attack' : 'Health' };
  }
  return out;
}

/** A captured board: the snapshot carries the grown values its owner's run had (the combat carry-ins). Shop-only
 *  meters (Ledger, Wages, Wheel, Baller) are not captured, so those print their base on a snapshot. Accepts any
 *  stored board shape (a Career / leaderboard row is untrusted JSON), reading numbers defensively. */
export function runeLiveStateOfSnapshot(snap: object | null | undefined): RuneLiveState {
  const out: RuneLiveState = {};
  if (!snap) return out;
  const b = snap as Partial<Pick<BoardSnapshot, 'wildHuntGrown' | 'questMods'>>;
  const m = (b.questMods && typeof b.questMods === 'object' ? b.questMods : undefined) as QuestCombatMods | undefined;
  const grown = intIn(b.wildHuntGrown) ?? 0;
  const step = intIn(m?.runeWildHunt);
  const copyOf = (flag: string): number => Math.max(1, intIn(m?.flagCopies?.[flag]) ?? 1);
  if (step || grown > 0) out.wildHunt = wildHuntPerCopy(grown, step, copyOf('runeWildHunt'));
  const lvl = pairIn(m?.packcraftLevel);
  if (m?.runePackcraft || lvl) {
    out.packcraft = lvl ?? { ...PACKCRAFT_STEP };
    out.packcraftCopies = copyOf('runePackcraft');
  }
  const bs = intIn(m?.beastialSwarmLevel);
  if (m?.runeBeastialSwarm || bs) out.beastialSwarm = bs || BEASTIAL_SWARM_BASE;
  return out;
}

/** What the replay has shown so far this fight, for ONE side: its `questTrigger` count per combat FLAG
 *  (`runeWildHunt` → fires) and that side's friendly deaths (the Avenge count). */
export interface RuneCombatProgress {
  triggers: Record<string, number>;
  deaths: number;
}

/**
 * Advance a pre-fight state by the fight replayed so far. Mirrors `simulate` exactly:
 *  · Wild Hunt: every fire grows the grant by its step (per copy, the printed step);
 *  · Packcraft: every fire (one per combat summon) grows the level by the printed +2/+1 per copy;
 *  · Beastial Swarm: Avenge (2) — every second friendly death adds +2.
 * `base` must be the PRE-fight state (the run before settle, or the served snapshot).
 */
export function runeLiveStateInCombat(base: RuneLiveState, prog: RuneCombatProgress | null | undefined): RuneLiveState {
  if (!prog) return base;
  const out: RuneLiveState = { ...base };
  const wh = prog.triggers['runeWildHunt'] ?? 0;
  if (wh > 0 && base.wildHunt != null) out.wildHunt = base.wildHunt + WILD_HUNT_BASE * wh;
  const pc = prog.triggers['runePackcraft'] ?? 0;
  if (pc > 0 && base.packcraft) {
    const lvl = base.packcraft;
    const c = Math.max(1, base.packcraftCopies ?? 1);
    out.packcraft = { attack: lvl.attack + PACKCRAFT_STEP.attack * c * pc, health: lvl.health + PACKCRAFT_STEP.health * c * pc };
  }
  if (base.beastialSwarm != null) {
    out.beastialSwarm = base.beastialSwarm + BEASTIAL_SWARM_BASE * Math.floor(prog.deaths / BEASTIAL_SWARM_EVERY);
  }
  return out;
}

/** Read a stored `RuneLiveState` back from an UNTRUSTED record (match details, a shared row): numbers only, every field
 *  optional. Undefined when nothing usable is there (an older record, which then prints the base text). */
export function parseRuneLiveState(v: unknown): RuneLiveState | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const out: RuneLiveState = {};
  const wh = intIn(o.wildHunt); if (wh !== undefined) out.wildHunt = wh;
  const pc = pairIn(o.packcraft); if (pc) out.packcraft = pc;
  const pcc = intIn(o.packcraftCopies); if (pcc) out.packcraftCopies = pcc;
  const bs = intIn(o.beastialSwarm); if (bs !== undefined) out.beastialSwarm = bs;
  const sl = pairIn(o.seasonedLedger); if (sl) out.seasonedLedger = sl;
  const cw = pairIn(o.compoundingWages); if (cw) out.compoundingWages = cw;
  const wl = pairIn(o.wheel); if (wl) out.wheel = wl;
  const b = o.baller as { amount?: unknown; stat?: unknown } | undefined;
  const ba = b && typeof b === 'object' ? intIn(b.amount) : undefined;
  if (ba !== undefined && (b!.stat === 'Attack' || b!.stat === 'Health')) out.baller = { amount: ba, stat: b!.stat };
  return Object.keys(out).length ? out : undefined;
}

/** One fight's carry-out for one side (`CombatResult.player*` / `enemyCarry`): only the fields that GREW in it. */
export interface RuneCarryOut { wildHuntGrown?: number; packcraftLevel?: { attack: number; health: number }; beastialSwarmLevel?: number }

/** The player's / the foe's carry-out of a finished fight, as a `RuneCarryOut`. */
export function runeCarryOf(result: { playerWildHuntGrown?: number; playerPackcraftLevel?: { attack: number; health: number }; playerBeastialSwarmLevel?: number; enemyCarry?: RuneCarryOut } | null | undefined, side: 'player' | 'enemy'): RuneCarryOut {
  if (!result) return {};
  if (side === 'enemy') return result.enemyCarry ?? {};
  return { wildHuntGrown: result.playerWildHuntGrown, packcraftLevel: result.playerPackcraftLevel, beastialSwarmLevel: result.playerBeastialSwarmLevel };
}

/**
 * A record that keeps only each round's FIGHT (Versus match stats): fold the carry-outs of the fights BEFORE the shown
 * round into the value the runes had going into it. A carry-out only names what grew, so a later fight overrides only
 * the fields it carries. No copy count rides a carry-out, so this reads one copy (Rune of Duplication on one of these
 * runes is the only case it under-reads, and it never over-states).
 */
export function runeLiveStateOfCarries(carries: readonly RuneCarryOut[]): RuneLiveState {
  let wh: number | undefined;
  let pc: { attack: number; health: number } | undefined;
  let bs: number | undefined;
  for (const c of carries) {
    if (c.wildHuntGrown != null && c.wildHuntGrown > 0) wh = c.wildHuntGrown;
    if (c.packcraftLevel) pc = { ...c.packcraftLevel };
    if (c.beastialSwarmLevel != null && c.beastialSwarmLevel > 0) bs = c.beastialSwarmLevel;
  }
  const out: RuneLiveState = {};
  if (wh != null) out.wildHunt = wildHuntPerCopy(wh, undefined, 1);
  if (pc) out.packcraft = pc;
  if (bs != null) out.beastialSwarm = bs;
  return out;
}
