/**
 * The pack shop's sounds. The scene calls these; the shell creates and disposes them. Silent for now: the cues
 * (existing recorded clips) are filled in with the carry and the counter.
 */
export interface ShopSounds { pickUp(): void; shake(): void; overLine(): void; till(): void; land(): void; refuse(): void; rack(): void; play(): void; dispose(): void }

const silent = (): void => undefined;

export function createShopSounds(): ShopSounds {
  return { pickUp: silent, shake: silent, overLine: silent, till: silent, land: silent, refuse: silent, rack: silent, play: silent, dispose: silent };
}
