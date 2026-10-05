import type { GauntletStage } from './types';
import s1 from './stages/01-demons.json';
import s2 from './stages/02-kobolds.json';
import s3 from './stages/03-dragons.json';
import s4 from './stages/04-dwarves.json';
import s5 from './stages/05-beasts.json';

export * from './types';
export * from './buffs';
export { validateStage } from './schema';
export { stageDrift, type GauntletDrift } from './drift';

/** Every authored stage, in play order. Stages 6–10 are added as their files are authored. */
export const GAUNTLET_STAGES: readonly GauntletStage[] = ([s1, s2, s3, s4, s5] as GauntletStage[])
  .slice().sort((a, b) => a.number - b.number);

export const gauntletStage = (n: number): GauntletStage | undefined => GAUNTLET_STAGES.find((s) => s.number === n);
