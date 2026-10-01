import type { CombatEvent } from '@game/core';

const SPELL_POWER_RE = /^\+(-?\d+)\/\+(-?\d+) Spell Power$/;

/**
 * WHERE a mid-combat "+A/+H Spell Power" narration plays its flourish: on the HERO-POWER button when the grant came
 * from the hero's power (`sc.heroPower`, Hunch × Ancient of Death: owner 2026-09-30, "make the +1/+1 show there as
 * well, not in board"), else over the player body that caused it. Null = not a spell-power narration, a zero gain, or
 * a body that is not the player's. Pure, so the anchor rule is testable without a DOM.
 */
export function spellPowerNarrationAnchor(
  e: CombatEvent | undefined,
  playerUids: ReadonlySet<string>,
): { kind: 'heroPower'; attack: number; health: number } | { kind: 'unit'; uid: string; attack: number; health: number } | null {
  if (!e || e.type !== 'sc' || !e.text) return null;
  const m = SPELL_POWER_RE.exec(e.text);
  if (!m) return null;
  const attack = Number(m[1]), health = Number(m[2]);
  if (attack <= 0 && health <= 0) return null;
  if (e.heroPower) return e.side === 'enemy' ? null : { kind: 'heroPower', attack, health };
  if (!e.source || !playerUids.has(e.source)) return null;
  return { kind: 'unit', uid: e.source, attack, health };
}
