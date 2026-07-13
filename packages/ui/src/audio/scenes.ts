/** Test scenes for the mixing desk: realistic stacks so you tune against overlap, not single clips.
 *  Each step names an `sfx` cue + a delay (ms). The desk fires them via `playScene` (sfx.ts). */
export interface SceneStep { cue: string; delay: number; arg?: string }
export interface Scene { id: string; name: string; steps: SceneStep[] }

export const SCENES: Scene[] = [
  { id: 'combat', name: 'Combat beat', steps: [
    { cue: 'attack', delay: 0 }, { cue: 'death', delay: 40 }, { cue: 'death', delay: 70 },
    { cue: 'shieldBreak', delay: 55 }, { cue: 'cardVoice', delay: 90, arg: '__first__' }, { cue: 'buff', delay: 120 },
  ] },
  { id: 'shop', name: 'Shop spam', steps: [
    { cue: 'buy', delay: 0 }, { cue: 'buy', delay: 90 }, { cue: 'buy', delay: 180 },
    { cue: 'roll', delay: 250 }, { cue: 'play', delay: 320 },
  ] },
  { id: 'hero', name: 'Hero moment', steps: [
    { cue: 'heroSelect', delay: 0, arg: '__first__' }, { cue: 'heroPower', delay: 300, arg: '__first__' },
  ] },
  { id: 'torture', name: 'Torture (all at once)', steps: [
    { cue: 'attack', delay: 0 }, { cue: 'death', delay: 0 }, { cue: 'skullBurst', delay: 0 },
    { cue: 'buy', delay: 0 }, { cue: 'summon', delay: 0 }, { cue: 'combatStart', delay: 0 },
    { cue: 'discover', delay: 0 }, { cue: 'buff', delay: 0 }, { cue: 'shieldBreak', delay: 0 },
  ] },
];
