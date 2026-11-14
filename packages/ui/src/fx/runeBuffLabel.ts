/**
 * WHICH RUNE A COMBAT BUFF CAME FROM (owner 2026-11-13: *"yes add the trail in combat too"*).
 *
 * A combat rune buff carries the rune's display NAME as its `source` label, not an id or a uid, so the replay had
 * nowhere to draw a trail from and only sparkled the unit. This resolves the label back to the rune's id so the
 * gold `rune-buff-trail` can leave the rune's own node. A label from before the "Rune of" prefix was dropped
 * (2026-10-22) still resolves. A generic label that names no particular rune (`'Rune'`) resolves to null: there is
 * no node to leave, and the unit keeps its sparkle alone.
 */
import { ARCHIVED_RUNES, EPIC_RUNES, RUNES, bareRuneLabel } from '@game/content';

const RUNE_ID_BY_NAME: ReadonlyMap<string, string> = new Map(
  [...ARCHIVED_RUNES, ...EPIC_RUNES, ...RUNES].flatMap((r) => [[r.name, r.id], [bareRuneLabel(r.name), r.id]] as [string, string][]),
);

/** The id of the rune a buff `source` label names, or null when it names no particular rune. */
export function runeIdForBuffLabel(label: string): string | null {
  return RUNE_ID_BY_NAME.get(label) ?? RUNE_ID_BY_NAME.get(bareRuneLabel(label)) ?? null;
}

type BuffRows = { buffs?: ReadonlyArray<{ source: string; attack: number; health: number }> };

/** A card's buff total (attack + health) per source label. */
export function buffTotalsByLabel(card: BuffRows): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of card.buffs ?? []) m.set(b.source, (m.get(b.source) ?? 0) + b.attack + b.health);
  return m;
}

/**
 * WHICH RUNES JUST BUFFED THIS CARD IN THE SHOP: the rune ids whose buff row on `card` grew past `before` (the
 * card's `buffTotalsByLabel` from before the action; undefined for a card that was not there, so every rune row
 * counts). The sim only says THAT a rune buffed the card (`runeBuffFxUnits`); the trail needs to know which rune's
 * node to leave, and the answer is already on the card's own buff ledger.
 */
export function runesThatBuffed(before: ReadonlyMap<string, number> | undefined, card: BuffRows): string[] {
  const out: string[] = [];
  for (const [label, total] of buffTotalsByLabel(card)) {
    if (total <= (before?.get(label) ?? 0)) continue;
    const id = runeIdForBuffLabel(label);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}
