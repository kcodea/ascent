/**
 * THE RUN-WIDE BUFF ROWS: one gatherer for the in-game Buffs panel (the hero portrait's) and for the rows a finished
 * game records on its final board (`BoardSnapshot.runBuffs`, R-MATCH-SHOPBUFF-01). It lives in sim so the snapshot can
 * stamp exactly what the panel showed; `@game/ui`'s runBuffs.ts re-exports it.
 */
import { CARD_INDEX, poolFor } from '@game/content';
import type { RunState } from './state';
import { cardBuff, spellAttackBonus, spellHealthBonus } from './recruit';

export interface BuffRow {
  key: string;
  label: string;
  value: string;
}

/** This fight's live gains so far, folded from the combat log by the UI (`combatBuffDelta`). */
export interface RunBuffCombatDelta {
  spellAttack: number;
  spellHealth: number;
  rubyAttack: number;
  rubyHealth: number;
  gold: number;
  auras: Record<string, { attack: number; health: number }>;
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

export function gatherRunBuffs(run: RunState, combat?: RunBuffCombatDelta | null): BuffRow[] {
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

  // Clue power (set 3, owner ask 2026-09-09) — the run's "your Clues are worth more" value, the same kind of
  // run buff as Ruby power: every Clue cast from now on grants base 1/1 plus this. Shop-only state (Clues are
  // never cast in combat), so there is no combat-side telegraph to add.
  const clue = run.clueBonus ?? 0;
  if (clue > 0) rows.push({ key: 'clue', label: 'Clue power', value: `+${clue}/+${clue}` });

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

  // LEGACY run-wide Beast channel: nothing feeds it since 2026-09-28 — Beast buffs are combat-only, never a
  // standing Aura (owner ruling, R-AURA-03) — so this row only ever shows on a run that banked it before then.
  // No combat fold: the sim no longer tags any combat Beast grant as a run-wide Aura row.
  const bstA = run.beastBuyAtk ?? 0, bstH = run.beastBuyHp ?? 0;
  if (bstA > 0 || bstH > 0) rows.push({ key: 'beast', label: 'Beast Aura', value: `+${bstA}/+${bstH}` });

  // Permanent tavern buy bonus (Staff of Guel / Demonic Anomaly) — every minion you buy enters at +atk/+hp.
  const tav = run.tavernBuyBonus;
  if (tav && (tav.atk > 0 || tav.hp > 0)) rows.push({ key: 'tavern', label: 'Shop Stats', value: `+${tav.atk}/+${tav.hp}` });
  // …itemized by SOURCE beneath the total (owner ask 2026-09-10): each rune / card that raised the channel.
  for (const [source, v] of Object.entries(run.tavernBuyBonusSources ?? {})) {
    if (v.atk > 0 || v.hp > 0) rows.push({ key: `tavern:${source}`, label: source, value: `+${v.atk}/+${v.hp}` });
  }

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
