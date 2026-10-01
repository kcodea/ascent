/**
 * GAUNTLET TRIBE EMBLEMS — each tribe's glyph, the same symbols the card footer and quest badges use (`Card.tsx`
 * `TRIBE_ICON`). Shared by every Gauntlet surface that stands a stage's tribe in for a hero portrait: the stage
 * select, the in-run panel, the combat opponent, the "Now Facing" wipe and the fight recap.
 */
import type { Tribe } from '@game/core';

export const TRIBE_ICON: Record<Tribe, string> = {
  beast: 'paw', dragon: 'flame', mech: 'gear', undead: 'skull', demon: 'eye', neutral: 'star', kobold: 'crown', dwarf: 'anvil',
  celestial: 'clock', spirit: 'clock',
};
