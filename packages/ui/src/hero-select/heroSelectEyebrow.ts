import { gauntletStage } from '@game/content';
import type { RunMode } from '@game/sim';

/**
 * THE MODE LINE over Hero Select's title (party home look, DEV switch): which game this pick is for, in the mode names
 * the party home's tabs use (partyHome/partyModes.ts), so the screen after START says where it came from. Plain words,
 * no em dashes. A watched screen says so first.
 */
export function heroSelectEyebrow(o: {
  mode: RunMode; ranked: boolean; rankedDuos: boolean; gauntletStage?: number; watching: boolean;
}): string {
  const name = o.mode === 'lobby' ? (o.ranked ? 'Ranked' : 'Lobby')
    : o.mode === 'versus' ? (o.rankedDuos ? 'Ranked Duos' : 'Versus')
    : o.mode === 'gauntlet' ? gauntletName(o.gauntletStage)
    : o.mode === 'practice' ? 'Practice'
    : o.mode === 'rift' ? 'Rift'
    : o.mode === 'tutorial' ? 'Learn'
    : 'Ascent';
  return o.watching ? `Watching: ${name}` : name;
}

/** "Gauntlet: Dragons" (the stage's own name), or just "Gauntlet". */
function gauntletName(stage: number | undefined): string {
  const st = stage != null ? gauntletStage(stage) : undefined;
  return st ? `Gauntlet: ${st.name}` : 'Gauntlet';
}
