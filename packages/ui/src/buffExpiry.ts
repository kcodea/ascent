import { CARD_INDEX } from '@game/content';

/**
 * THE BUFFS PANEL'S WHISPER ROWS (owner 2026-10-14: "runebind should be a tracked buff in the buffs panel"). A Shop
 * Whisper cast is ledgered under the Whisper's own name (`applyWhisperBuff`); a COMBAT cast (Whaloo, a Whisp echo in
 * combat) is ledgered by the replay under the same name (`whisperCombatBuffLabel`). The rows carry NO expiry note
 * (owner 2026-10-15: "remove the text 'until your next turn' or w/e it's unnecessary"): name, count and amount only.
 */

/** A combat Whisper cast's row: the Whisper's own name (owner 2026-10-14: "runebind doesnt need to say 'this combat'"),
 *  merged with any Shop row of the same Whisper. Null for anything that is not a Whisper. */
export function whisperCombatBuffLabel(spellId: string | undefined): string | null {
  const def = spellId ? CARD_INDEX[spellId] : undefined;
  return def?.whisper ? def.name : null;
}
