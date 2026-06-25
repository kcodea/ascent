import { CARD_INDEX } from '@game/content';
import { spellAttackBonus, spellHealthBonus, type RunState } from '@game/sim';

export interface BuffRow {
  key: string;
  label: string;
  value: string;
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
export function gatherRunBuffs(run: RunState): BuffRow[] {
  const rows: BuffRow[] = [];

  // Spell power (hero amplify + Cinderwing/Skullblade/Gnasher card-driven) — every stat spell gains this.
  const spA = spellAttackBonus(run);
  const spH = spellHealthBonus(run);
  if (spA > 0 || spH > 0) rows.push({ key: 'spell', label: 'Spell power', value: `+${spA}/+${spH}` });

  // Permanent Undead buff everywhere: the "+Attack wherever they are" creation bonus (Deathswarmer / Forsaken
  // Weaver / Karthus) plus the run-wide Undead aura (Lantern of Souls).
  const undA = (run.undeadBuyAtk ?? 0) + (run.undeadAttackBonus ?? 0);
  const undH = run.undeadHealthBonus ?? 0;
  if (undA > 0 || undH > 0) rows.push({ key: 'undead', label: 'Undead · everywhere', value: `+${undA}/+${undH}` });

  // Permanent Fodder enchant (Ritualist / Bane) — applies to every Fodder, board/hand/future.
  const fod = run.cardBuffs?.fred;
  if (fod && (fod.attack > 0 || fod.health > 0)) rows.push({ key: 'fodder', label: 'Fodder', value: `+${fod.attack}/+${fod.health}` });

  // Permanent Imp buff (Fodder Feeder / Imp King / Brood / Bane) — applied to combat Imps.
  const imp = run.impBuff;
  if (imp && (imp.attack > 0 || imp.health > 0)) rows.push({ key: 'imp', label: 'Imps', value: `+${imp.attack}/+${imp.health}` });

  // Cling Drone run-wide enchant (each Cling magnetized grows all Clings).
  const cling = run.cardBuffs?.cling;
  if (cling && (cling.attack > 0 || cling.health > 0)) rows.push({ key: 'cling', label: 'Cling Drones', value: `+${cling.attack}/+${cling.health}` });

  // Eternal Knight run-wide enchant (each Eternal Knight death buffs all Eternal Knights +3/+2). Stored on
  // the 'knit' card-type buff.
  const knit = run.cardBuffs?.knit;
  if (knit && (knit.attack > 0 || knit.health > 0)) rows.push({ key: 'knit', label: 'Eternal Knights', value: `+${knit.attack}/+${knit.health}` });

  // Permanent tavern buy bonus (Staff of Guel / Demonic Anomaly) — every minion you buy enters at +atk/+hp.
  const tav = run.tavernBuyBonus;
  if (tav && (tav.atk > 0 || tav.hp > 0)) rows.push({ key: 'tavern', label: 'Tavern buys', value: `+${tav.atk}/+${tav.hp}` });

  // Permanent max-Gold gained (Soulsman's Avenge) — the actual Gold gained this run, golden-aware (matches the
  // "Gained X Gold" the card itself shows). `soulsmanGold` is the tracked total; the natural per-wave curve is
  // NOT counted (it's not a buff).
  const goldGain = run.soulsmanGold ?? 0;
  if (goldGain > 0) rows.push({ key: 'gold', label: 'Max Gold', value: `+${goldGain}` });

  // Mama Bear — only while on board. With MULTIPLE Mama Bears every summon is buffed by EACH of them, so total
  // their current per-summon grants ((base + accrued) × golden each).
  const mamaBears = run.board.filter((c) => c.cardId === 'mamabear');
  if (mamaBears.length > 0) {
    const total = mamaBears.reduce(
      (sum, mb) => sum + (effectParam('mamabear', 'summonBuffTribeImprove', 'attack', 3) + (mb.summonBonus ?? 0)) * (mb.golden ? 2 : 1),
      0,
    );
    rows.push({ key: 'mamabear', label: 'Mama Bear · per summon', value: `+${total}/+${total}` });
  }

  // Archmagus Guel — only while on board: current per-spell grant = (base + ⌊spellsCast/4⌋) × golden.
  const guel = run.board.find((c) => c.cardId === 'guel');
  if (guel) {
    const g = (effectParam('guel', 'spellCastBuffOthers', 'attack', 1) + Math.floor((run.spellsCast ?? 0) / 4)) * (guel.golden ? 2 : 1);
    rows.push({ key: 'guel', label: 'Guel · per spell', value: `+${g}/+${g}` });
  }

  return rows;
}
