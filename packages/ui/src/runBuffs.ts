import { foldPrefix, type PrefixFoldSpec } from './choreo/prefixFold';
import { gatherRunBuffs, type BoardSnapshot, type BuffRow } from '@game/sim';
import type { CombatEvent } from '@game/core';

export { gatherRunBuffs };
export type { BuffRow };

/**
 * The run-wide buffs that ACCRUE during a fight (carried back to the run at settle) and are cleanly
 * telegraphed per-beat, so the Buffs window can tick them up LIVE as the replay plays instead of jumping
 * at settle: spell power (the `+A/+B Spell Power` Start-of-Combat narration emitted by Bladesmith / Gnasher /
 * Cinderwing-via-Ryme) and max Gold (Soulsman's Avenge `maxGold` events). Other run buffs (Undead / Fodder /
 * Imp / Guel) have no clean per-beat signal, so they still update at settle.
 */
export interface CombatBuffDelta {
  spellAttack: number;
  spellHealth: number;
  /** Ruby Power gained so far this fight (Deepvein Tender re-fired by a Dawnclaw/Ryme Echo, Veinbreaker's
   *  Avenge…) — parsed from the side-stamped "+a/+h Ruby Power" telegraph, PLAYER side only (enemies gain
   *  Ruby Power too, and theirs must not tick your row). */
  rubyAttack: number;
  rubyHealth: number;
  gold: number;
  /** Per-row run-aura gains landed so far this fight, keyed by the Buffs-panel row ('imp' / 'fodder' /
   *  'undead' / 'beast' / 'attachment'). Carried on `tribeAura` events (with amounts), so the rows tick up
   *  live in combat instead of only at settle. */
  auras: Record<string, { attack: number; health: number }>;
}

const SPELL_POWER_RE = /^\+(\d+)\/\+(\d+) Spell Power$/;
const RUBY_POWER_RE = /^\+(\d+)\/\+(\d+) Ruby Power$/;

/** Sum the live-trackable combat buff gains over `events[0, upto)` (the events the replay has played so far). */
export function combatBuffDelta(events: readonly CombatEvent[], upto: number): CombatBuffDelta {
  return foldPrefix(COMBAT_BUFF_FOLD, events, upto, undefined);
}

/** `combatBuffDelta` as a continuable fold (`choreo/prefixFold.ts`): the replay hook steps it beat by beat. */
export const COMBAT_BUFF_FOLD: PrefixFoldSpec<CombatBuffDelta, CombatBuffDelta> = {
  init: () => ({ spellAttack: 0, spellHealth: 0, rubyAttack: 0, rubyHealth: 0, gold: 0, auras: {} }),
  step: (d, e) => {
    if (e.type === 'sc') {
      const m = SPELL_POWER_RE.exec(e.text);
      // Spell Power is side-tagged since R-SYMMETRY-01 (2026-10-13): the foe's grows live too. An untagged line is
      // the player's (logs recorded before the tag).
      if (m && e.side !== 'enemy') {
        d.spellAttack += Number(m[1]);
        d.spellHealth += Number(m[2]);
      }
      // Ruby Power is stamped with `side` because BOTH sides can gain it (an enemy Crownvein's Rally) —
      // only the player's ticks the drawer.
      const rb = RUBY_POWER_RE.exec(e.text);
      if (rb && e.side === 'player') {
        d.rubyAttack += Number(rb[1]);
        d.rubyHealth += Number(rb[2]);
      }
    } else if (e.type === 'maxGold' && e.side === 'player') {
      d.gold += e.amount;
    } else if (e.type === 'tribeAura' && e.side === 'player' && e.aura) {
      const a = (d.auras[e.aura] ??= { attack: 0, health: 0 });
      a.attack += e.attack ?? 0;
      a.health += e.health ?? 0;
    }
  },
  // A fresh reading every call (the state lives on): the aura rows are copied, in the order they first appeared.
  read: (d) => {
    const auras: CombatBuffDelta['auras'] = {};
    for (const k in d.auras) { const a = d.auras[k]!; auras[k] = { attack: a.attack, health: a.health }; }
    return { spellAttack: d.spellAttack, spellHealth: d.spellHealth, rubyAttack: d.rubyAttack, rubyHealth: d.rubyHealth, gold: d.gold, auras };
  },
};

/**
 * The display-only COMBAT PREVIEW counters, folded over `events[0, upto)` exactly the way `combatBuffDelta`
 * and `enemyDeaths` are folded: one absolute reading of "what the fight has done so far", recomputed from the
 * log for the beat now on screen.
 *
 * A FOLD, never an accumulate (review 2026-09-22). These four used to be bumped one reducer dispatch per
 * event, which is only correct when every beat is played exactly once: the Skip button jumps `beatIdx` to the
 * end and runs the beat effect for the LAST beat alone (every skipped beat's bumps lost), a seek re-runs the
 * same beat (its bumps counted twice), and a Save & Quit taken mid-fight persists the counter and then replays
 * the log from beat 0 on Continue (everything counted twice). Derived from the log, all three land on the same
 * number, which is the invariant the live readouts promise: ticks during the fight, equals settle at the end.
 */
export interface CombatPreviewFold {
  /** Front to Back and friends improving themselves mid-fight — summed "<spell> improves +A/+H" narrations. */
  escalation: { attack: number; health: number };
  /** Player Shop-spell casts so far this fight — Yirin's Attunement counter. */
  spellsCast: number;
  /** Player-side deaths so far this fight — Cindara's Hoard Avenge tracker. A Rise is not a death (it
   *  returns), matching `simulate`'s own avenge count on the common path. */
  friendlyDeaths: number;
  /** Player `bladeMastery` quest triggers so far — one per buffed attack, Gorun's live grant + countdown. */
  bladeAttacks: number;
  /** Squirl Scout's run-wide snowball grown so far this fight (the player's `improve` events carrying `scout`). */
  scout: number;
  /** Conductor's run-wide improvement grown so far this fight, per side (`improve` events carrying `conductor`). */
  conductor: number;
  conductorEnemy: number;
}

const ESCALATION_RE = /improves \+(\d+)\/\+(\d+)$/;

/** Fold the four display-only preview counters over `events[0, upto)`. Pure; one pass. */
export function combatPreviewFold(events: readonly CombatEvent[], upto: number): CombatPreviewFold {
  return foldPrefix(COMBAT_PREVIEW_FOLD, events, upto, undefined);
}

interface PreviewAcc { escA: number; escH: number; spellsCast: number; friendlyDeaths: number; bladeAttacks: number; scout: number; conductor: number; conductorEnemy: number }

/** `combatPreviewFold` as a continuable fold (`choreo/prefixFold.ts`): the replay hook steps it beat by beat. */
export const COMBAT_PREVIEW_FOLD: PrefixFoldSpec<PreviewAcc, CombatPreviewFold> = {
  init: () => ({ escA: 0, escH: 0, spellsCast: 0, friendlyDeaths: 0, bladeAttacks: 0, scout: 0, conductor: 0, conductorEnemy: 0 }),
  step: (a, e) => {
    // Every one of these is the PLAYER's own readout, so each channel checks `side` after narrowing (an enemy
    // Quil's casts must not move your hand). `side` lives on the individual event shapes, not the union base.
    if (e.type === 'spellcast') { if (e.side === 'player') a.spellsCast++; }
    else if (e.type === 'death') { if (e.side === 'player' && !e.rise) a.friendlyDeaths++; }
    else if (e.type === 'questTrigger') { if (e.side === 'player' && e.flag === 'bladeMastery') a.bladeAttacks++; }
    else if (e.type === 'improve') {
      if (e.scout && e.side !== 'enemy') a.scout += e.scout;
      if (e.conductor) { if (e.side === 'enemy') a.conductorEnemy += e.conductor; else a.conductor += e.conductor; } // Conductor (owner 2026-10-24), either side
    } // either side's Squirl Scout stamps `scout` + `side` (R-SYMMETRY-01); an untagged one is the player's (older logs)
    else if (e.type === 'sc' && e.side === 'player') {
      const m = ESCALATION_RE.exec(e.text);
      if (m) { a.escA += Number(m[1]); a.escH += Number(m[2]); }
    }
  },
  read: (a) => ({ escalation: { attack: a.escA, health: a.escH }, spellsCast: a.spellsCast, friendlyDeaths: a.friendlyDeaths, bladeAttacks: a.bladeAttacks, scout: a.scout, conductor: a.conductor, conductorEnemy: a.conductorEnemy }),
};

/**
 * The FOE's run-wide buffs, read off a served board's captured `BoardSnapshot` (owner ask 2026-08-30 — the
 * opponent portrait opens the same Buffs Panel the player's does). The snapshot carries the owner's
 * run-level combat scalers (see `snapshot.ts`); rows mirror `gatherRunBuffs`'s labels/format exactly so the
 * two panels read identically. Shop-only rows (Shop Stats, shop-slot enchants, Veinstorm, Max Gold, the
 * on-board Mama Bear / Guel live rows) have no snapshot fields — they don't affect the fight — so the foe
 * panel simply lists what its board actually brings. Legacy/bot snapshots lack most fields → few/no rows,
 * and the affordance gates on rows existing, same as the player's.
 */
export function gatherSnapshotBuffs(snap: BoardSnapshot | undefined): BuffRow[] {
  if (!snap) return [];
  const rows: BuffRow[] = [];
  const pair = (key: string, label: string, a: number, h: number): void => {
    if (a > 0 || h > 0) rows.push({ key, label, value: `+${a}/+${h}` });
  };
  pair('spell', 'Spell power', snap.spellPower?.attack ?? 0, snap.spellPower?.health ?? 0);
  pair('ruby', 'Ruby power', snap.rubyBonus?.attack ?? 0, snap.rubyBonus?.health ?? 0);
  pair('undead', 'Undead Aura', (snap.undeadBuyAtk ?? 0) + (snap.undeadAura?.attack ?? 0), snap.undeadAura?.health ?? 0);
  pair('fodder', 'Fodder Aura', snap.cardBuffs?.fred?.attack ?? 0, snap.cardBuffs?.fred?.health ?? 0);
  pair('imp', 'Imp Aura', snap.impAura?.attack ?? 0, snap.impAura?.health ?? 0);
  pair('cling', 'Cling Drones', snap.cardBuffs?.cling?.attack ?? 0, snap.cardBuffs?.cling?.health ?? 0);
  pair('knit', 'Spear Warden Aura', snap.cardBuffs?.knit?.attack ?? 0, snap.cardBuffs?.knit?.health ?? 0);
  pair('magnetic', 'Attachment Aura', snap.magneticAura?.attack ?? 0, snap.magneticAura?.health ?? 0);
  pair('beast', 'Beast Aura', snap.beastBuyAtk ?? 0, 0);
  return rows;
}

/**
 * A FINISHED GAME's run-wide buffs, for Match History's Buffs button (R-MATCH-SHOPBUFF-01, owner 2026-11-16: "everything
 * that can show in the run-wide buffs section of a game"). A board recorded with `runBuffs` gives exactly the rows the
 * in-game Buffs panel showed. An older board gives what it did store: the combat scalers (`gatherSnapshotBuffs`) and,
 * from 2026-11-08, the Shop buff and its sources. Null = nothing was recorded, so there is no button.
 */
const OLDER_BOARD_BUFFS = new WeakMap<BoardSnapshot, BuffRow[] | null>(); // one stable array per board: the game detail is memoised on it
export function finalBoardBuffs(snap: BoardSnapshot | null | undefined): readonly BuffRow[] | null {
  if (!snap) return null;
  if (snap.runBuffs) return snap.runBuffs;
  const had = OLDER_BOARD_BUFFS.get(snap);
  if (had !== undefined) return had;
  const rows = gatherSnapshotBuffs(snap);
  const shop = snap.shopBuff;
  if (shop && (shop.attack > 0 || shop.health > 0)) {
    rows.push({ key: 'tavern', label: 'Shop Stats', value: `+${shop.attack}/+${shop.health}` });
    for (const s of shop.sources ?? []) rows.push({ key: `tavern:${s.source}`, label: s.source, value: `+${s.attack}/+${s.health}` });
  }
  const out = rows.length > 0 || shop ? rows : null;
  OLDER_BOARD_BUFFS.set(snap, out);
  return out;
}
