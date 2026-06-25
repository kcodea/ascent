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
  if (cling && (cling.attack > 0 || cling.health > 0)) rows.push({ key: 'cling', label: 'Clings', value: `+${cling.attack}/+${cling.health}` });

  // Mama Bear — only while on board: its current per-summon grant ((base + accrued) × golden).
  const mb = run.board.find((c) => c.cardId === 'mamabear');
  if (mb) {
    const m = (effectParam('mamabear', 'summonBuffTribeImprove', 'attack', 3) + (mb.summonBonus ?? 0)) * (mb.golden ? 2 : 1);
    rows.push({ key: 'mamabear', label: 'Mama Bear · per summon', value: `+${m}/+${m}` });
  }

  // Archmagus Guel — only while on board: current per-spell grant = (base + ⌊spellsCast/4⌋) × golden.
  const guel = run.board.find((c) => c.cardId === 'guel');
  if (guel) {
    const g = (effectParam('guel', 'spellCastBuffOthers', 'attack', 1) + Math.floor((run.spellsCast ?? 0) / 4)) * (guel.golden ? 2 : 1);
    rows.push({ key: 'guel', label: 'Guel · per spell', value: `+${g}/+${g}` });
  }

  return rows;
}
