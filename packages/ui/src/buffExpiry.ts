import { CARD_INDEX, WHISPER_IDS } from '@game/content';

/**
 * THE BUFFS PANEL'S EXPIRY NOTE (owner 2026-10-14: "runebind should be a tracked buff in the buffs panel"). A Whisper's
 * grant is TEMPORARY, so its row says when it goes:
 *
 *  - a Shop cast (from hand, a Whisp echo, a Tamby copy, Jar of Secrets draws) is ledgered under the
 *    Whisper's own name (`applyWhisperBuff`) and lasts through that turn's combat: "until your next turn";
 *  - a COMBAT cast (Whaloo, a Whisp echo in combat) is ledgered by the replay under the same name
 *    (`whisperCombatBuffLabel`; owner 2026-10-14: no "(this combat)" suffix): a combat buff, gone when the fight ends.
 *
 * Null for every other source (a permanent buff needs no note).
 */
const WHISPER_NAMES: ReadonlySet<string> = new Set(WHISPER_IDS.map((id) => CARD_INDEX[id]?.name).filter((n): n is string => !!n));

/** A combat Whisper cast's row: the Whisper's own name (owner 2026-10-14: "runebind doesnt need to say 'this combat'"),
 *  merged with any Shop row of the same Whisper. Null for anything that is not a Whisper. */
export function whisperCombatBuffLabel(spellId: string | undefined): string | null {
  const def = spellId ? CARD_INDEX[spellId] : undefined;
  return def?.whisper ? def.name : null;
}

export function buffExpiryNote(source: string): string | null {
  if (WHISPER_NAMES.has(source)) return 'until your next turn';
  return null;
}
