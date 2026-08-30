import { CARD_INDEX, poolFor } from '@game/content';
import { spellAttackBonus, spellHealthBonus, type RunState, type BoardSnapshot, cardBuff } from '@game/sim';
import type { CombatEvent } from '@game/core';

export interface BuffRow {
  key: string;
  label: string;
  value: string;
}

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
  let spellAttack = 0;
  let spellHealth = 0;
  let rubyAttack = 0;
  let rubyHealth = 0;
  let gold = 0;
  const auras: Record<string, { attack: number; health: number }> = {};
  const n = Math.min(upto, events.length);
  for (let i = 0; i < n; i++) {
    const e = events[i];
    if (e.type === 'sc') {
      const m = SPELL_POWER_RE.exec(e.text);
      if (m) {
        spellAttack += Number(m[1]);
        spellHealth += Number(m[2]);
      }
      // Ruby Power is stamped with `side` because BOTH sides can gain it (an enemy Crownvein's Rally) —
      // only the player's ticks the drawer. Spell Power needs no check: the sim never emits it for an enemy.
      const rb = RUBY_POWER_RE.exec(e.text);
      if (rb && e.side === 'player') {
        rubyAttack += Number(rb[1]);
        rubyHealth += Number(rb[2]);
      }
    } else if (e.type === 'maxGold' && e.side === 'player') {
      gold += e.amount;
    } else if (e.type === 'tribeAura' && e.side === 'player' && e.aura) {
      const a = (auras[e.aura] ??= { attack: 0, health: 0 });
      a.attack += e.attack ?? 0;
      a.health += e.health ?? 0;
    }
  }
  return { spellAttack, spellHealth, rubyAttack, rubyHealth, gold, auras };
}

/** Read a card def's first effect of a given `do` id and pull a numeric param (for live magnitudes). */
function effectParam(cardId: string, doId: string, param: string, fallback: number): number {
  const eff = CARD_INDEX[cardId]?.effects.find((e) => e.do === doId);
  return Number((eff?.params as Record<string, unknown> | undefined)?.[param] ?? fallback);
}

/**
 * Gather the run-wide buffs worth surfacing in the Buffs window — only those currently active (a row is
 * pushed only when its value is non-zero / the source is on board), so the window stays empty until
 * something actually applies. Each value is the LIVE current magnitude.
 */
/** Does this run's SET contain Fodder at all? Set 2 has none, so its "Fodder Aura" row was always noise
 *  (owner report 2026-08-15). Derived from the run's pinned pool rather than a hardcoded set list, so a new
 *  set that DOES ship Fodder lights the row up on its own. Cached per set — the panel re-renders per frame. */
const FODDER_BY_SET = new Map<string, boolean>();
function setHasFodder(run: RunState): boolean {
  const id = run.setId ?? 'set1';
  let has = FODDER_BY_SET.get(id);
  if (has === undefined) {
    has = poolFor(id as never).all.some((c) => c.keywords.includes('FD'));
    FODDER_BY_SET.set(id, has);
  }
  return has;
}

export function gatherRunBuffs(run: RunState, combat?: CombatBuffDelta | null): BuffRow[] {
  const rows: BuffRow[] = [];

  // Spell power (hero amplify + Cinderwing/Skullblade/Gnasher card-driven) — every stat spell gains this. In
  // combat, add the gains telegraphed so far this fight (`combat`, carried back at settle) so the row ticks up
  // live as Bladesmith/Gnasher/Cinderwing fire, instead of jumping only once the shop reopens.
  const spA = spellAttackBonus(run) + (combat?.spellAttack ?? 0);
  const spH = spellHealthBonus(run) + (combat?.spellHealth ?? 0);
  if (spA > 0 || spH > 0) rows.push({ key: 'spell', label: 'Spell power', value: `+${spA}/+${spH}` });

  // Ruby power — the run-wide "your Rubies are worth more" bonus (Faultline Scrapper, Deepvein Tender,
  // Alchemist Brisbane, Rune of the Cindergem…). It is a RUN buff in exactly the sense Spell power is: every
  // Ruby you play from now on carries it. It was missing from this window entirely (owner report 2026-08-04),
  // so a board built on the Ruby engine had its single most important scaler invisible.
  //
  // In combat, add the gains telegraphed so far this fight ("+a/+h Ruby Power", player side) so the row
  // ticks up AT the beat — a Dawnclaw Echo re-firing Deepvein Tender used to animate live while this row sat
  // frozen until settle (owner report 2026-08-04); mechanically the gain applied at once, only the drawer
  // lagged. The sc is side-stamped because enemies gain Ruby Power too (Crownvein) and theirs must not count.
  const rbA = (run.rubyBonus?.attack ?? 0) + (combat?.rubyAttack ?? 0);
  const rbH = (run.rubyBonus?.health ?? 0) + (combat?.rubyHealth ?? 0);
  if (rbA > 0 || rbH > 0) rows.push({ key: 'ruby', label: 'Ruby power', value: `+${rbA}/+${rbH}` });

  // Permanent Undead buff everywhere: the "+Attack wherever they are" creation bonus (Deathswarmer / Forsaken
  // Weaver / Karthus) plus the run-wide Undead aura (Lantern of Souls).
  const undA = (run.undeadBuyAtk ?? 0) + (run.undeadAttackBonus ?? 0) + (combat?.auras.undead?.attack ?? 0);
  const undH = (run.undeadHealthBonus ?? 0) + (combat?.auras.undead?.health ?? 0);
  if (undA > 0 || undH > 0) rows.push({ key: 'undead', label: 'Undead Aura', value: `+${undA}/+${undH}` });

  // Fodder buff — BOTH channels. `cardBuffs.fred` is the permanent enchant (Ritualist / Bane); Heckbinder's
  // `fodderAura` is a LIVE aura that applies while it's on the board. `cardBuff()` folds the two together,
  // which is exactly what a Fodder is created with — reading the raw map missed every Heckbinder (owner
  // report 2026-07-21; the same class of bug the tavern display had, in a second place).
  // Gated on the RUN'S SET actually containing Fodder (owner report 2026-08-15: the row showed in set 2,
  // which has no Fodder at all). A stale enchant from a set-1 save can still carry a value, so the set — not
  // the number — decides whether the row means anything.
  const fod = cardBuff(run, 'fred');
  const fodA = fod.attack + (combat?.auras.fodder?.attack ?? 0);
  const fodH = fod.health + (combat?.auras.fodder?.health ?? 0);
  if ((fodA > 0 || fodH > 0) && setHasFodder(run)) rows.push({ key: 'fodder', label: 'Fodder Aura', value: `+${fodA}/+${fodH}` });

  // Permanent Imp buff (Fodder Feeder / Imp King / Brood / Bane) — applied to combat Imps.
  const impA = (run.impBuff?.attack ?? 0) + (combat?.auras.imp?.attack ?? 0);
  const impH = (run.impBuff?.health ?? 0) + (combat?.auras.imp?.health ?? 0);
  if (impA > 0 || impH > 0) rows.push({ key: 'imp', label: 'Imp Aura', value: `+${impA}/+${impH}` });

  // Cling Drone run-wide enchant (each Cling magnetized grows all Clings).
  const cling = run.cardBuffs?.cling;
  if (cling && (cling.attack > 0 || cling.health > 0)) rows.push({ key: 'cling', label: 'Cling Drones', value: `+${cling.attack}/+${cling.health}` });

  // Eternal Knight run-wide enchant (each Eternal Knight death buffs all Eternal Knights +3/+2). Stored on
  // the 'knit' card-type buff.
  const knit = run.cardBuffs?.knit;
  if (knit && (knit.attack > 0 || knit.health > 0)) rows.push({ key: 'knit', label: 'Spear Warden Aura', value: `+${knit.attack}/+${knit.health}` });

  // Run-wide ATTACHMENT aura (Scrap Herald): your Magnetics get +atk/+hp wherever they are. Had no row at
  // all until the 2026-07-21 audit — the panel has to list every live buff or it can't be trusted.
  const magA = (run.magneticBuyAtk ?? 0) + (combat?.auras.attachment?.attack ?? 0), magH = (run.magneticBuyHp ?? 0) + (combat?.auras.attachment?.health ?? 0);
  if (magA > 0 || magH > 0) rows.push({ key: 'magnetic', label: 'Attachment Aura', value: `+${magA}/+${magH}` });

  // Run-wide BEAST creation aura (The Old Hunt / beast-buy sources) — same omission.
  const bstA = (run.beastBuyAtk ?? 0) + (combat?.auras.beast?.attack ?? 0), bstH = (run.beastBuyHp ?? 0) + (combat?.auras.beast?.health ?? 0);
  if (bstA > 0 || bstH > 0) rows.push({ key: 'beast', label: 'Beast Aura', value: `+${bstA}/+${bstH}` });

  // Permanent tavern buy bonus (Staff of Guel / Demonic Anomaly) — every minion you buy enters at +atk/+hp.
  const tav = run.tavernBuyBonus;
  if (tav && (tav.atk > 0 || tav.hp > 0)) rows.push({ key: 'tavern', label: 'Shop Stats', value: `+${tav.atk}/+${tav.hp}` });

  // Permanent SHOP-SLOT enchants (Market Tormentor / Feastmaster Vhal / Right Hand Hank -> right-most; Rune of
  // the Display Case -> left-most). These are run-long accumulators re-landed on every fresh roll, so they are
  // exactly the kind of standing buff this panel exists to show — they had no row at all (owner report
  // 2026-08-15: "right-most shop buffs aren't shown and they should").
  const rms = run.rightmostSlotBuff;
  if (rms && (rms.attack > 0 || rms.health > 0)) rows.push({ key: 'shopright', label: 'Right-most Shop slot', value: `+${rms.attack}/+${rms.health}` });
  const lms = run.leftmostSlotBuff;
  if (lms && (lms.attack > 0 || lms.health > 0)) rows.push({ key: 'shopleft', label: 'Left-most Shop slot', value: `+${lms.attack}/+${lms.health}` });

  // Veinstorm's banked Ruby stamp — the +atk/+hp each shop offer carries, re-landed on every fresh roll by
  // `spellBuffShopByRuby` (the bank in `run.veinstormRubies`). Owner ask 2026-08-20: surface it as its own row.
  const vein = run.veinstormRubies;
  if (vein && (vein.atk > 0 || vein.hp > 0)) rows.push({ key: 'veinstorm', label: 'Veinstorm Stats', value: `+${vein.atk}/+${vein.hp}` });

  // Permanent max-Gold gained (Soulsman's Avenge) — the actual Gold gained this run, golden-aware (matches the
  // "Gained X Gold" the card itself shows). `soulsmanGold` is the tracked total; the natural per-wave curve is
  // NOT counted (it's not a buff). In combat, add this fight's `maxGold` procs so far so the row ticks up live.
  const goldGain = (run.soulsmanGold ?? 0) + (combat?.gold ?? 0);
  if (goldGain > 0) rows.push({ key: 'gold', label: 'Max Gold', value: `+${goldGain}` });

  // Mama Bear — only while on board. With MULTIPLE Mama Bears every summon is buffed by EACH of them, so total
  // their current per-summon grants ((base + accrued) × golden each).
  const mamaBears = run.board.filter((c) => c.cardId === 'mamabear');
  if (mamaBears.length > 0) {
    const total = mamaBears.reduce(
      (sum, mb) => sum + (effectParam('mamabear', 'summonBuffTribeImprove', 'attack', 3) + (mb.summonBonus ?? 0)) * (mb.golden ? 2 : 1),
      0,
    );
    rows.push({ key: 'mamabear', label: 'Den Mother · per summon', value: `+${total}/+${total}` });
  }

  // Archmagus Guel — only while on board: current per-spell grant = (base + ⌊spellProgress/4⌋) × golden,
  // where `spellProgress` is the spells cast while THIS Guel has been on the board (per-instance).
  const guel = run.board.find((c) => c.cardId === 'guel');
  if (guel) {
    const g = (effectParam('guel', 'spellCastBuffOthers', 'attack', 1) + Math.floor((guel.spellProgress ?? 0) / 4)) * (guel.golden ? 2 : 1);
    rows.push({ key: 'guel', label: 'Guel · per spell', value: `+${g}/+${g}` });
  }

  return rows;
}

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
