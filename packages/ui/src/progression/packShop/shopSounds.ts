import { audioContext, playTailedClip } from '../../sfx';
import { DEFAULT_PACK_FEEL, getPackFeel } from '../packOpening/packFxConfig';

/**
 * The pack shop's sounds. The scene calls these; the shell creates one per shop and disposes it. Every cue is an
 * EXISTING recorded clip from the game's library (the opener's foil, the chest opener's buses), never a synthesised
 * tone, in one table so a clip can be swapped in one place. Cues ride the game's own category buses and are scaled by
 * the Pack Lab's volume knob, as the opener's card beats are (`packSounds.ts`).
 *
 * Nothing plays before a user gesture: with no AudioContext every method is a no-op.
 */
export interface ShopSounds { pickUp(): void; shake(): void; overLine(): void; till(): void; land(): void; refuse(): void; rack(): void; play(): void; dispose(): void }

/** `gain` levels each recording (they were not recorded at one level); `lenMs` plays only the start of a clip. */
export interface ClipCue { clip: string; cat: string; gain: number; rate?: number; delayMs?: number; lenMs?: number }

export const SHOP_CUES: Readonly<Record<string, readonly ClipCue[]>> = {
  // the pack comes off the shelf into the grip: the opener's wrapper crinkle (its sounding part) and squeeze
  pickUp: [{ clip: 'fx/pack-crinkle-1', cat: 'crateStamp', gain: 1.6, lenMs: 550 }, { clip: 'fx/pack-squeeze', cat: 'crateStamp', gain: 1.1, delayMs: 30 }],
  // shake to listen: the cards rattle inside
  shake: [{ clip: 'fx/pack-cards', cat: 'crateStamp', gain: 2.4 }],
  // the counter line lights under the pack
  overLine: [{ clip: 'fx/glass-tick', cat: 'crateTierShimmer', gain: 0.3 }],
  till: [{ clip: 'fx/cartoon-music-cha-ching-new-purchase-494486', cat: 'crateCoin', gain: 0.5 }],
  land: [{ clip: 'fx/pack-drop', cat: 'crateStamp', gain: 3 }],
  refuse: [{ clip: 'deny', cat: 'deny', gain: 0.6 }],
  // a tab change: the rack slides
  rack: [{ clip: 'fx/chess-slide', cat: 'crateWhoosh', gain: 0.6, rate: 1.2 }],
  play: [{ clip: 'fx/pack-drop', cat: 'crateStamp', gain: 3 }, { clip: 'fx/whoosh-03', cat: 'crateWhoosh', gain: 0.5 }],
};

const NO_CUE: readonly ClipCue[] = [];

export function createShopSounds(): ShopSounds {
  let disposed = false;
  const cues = (name: string): void => {
    if (disposed || !audioContext()) return;
    const vol = getPackFeel().volume / DEFAULT_PACK_FEEL.volume;
    for (const c of SHOP_CUES[name] ?? NO_CUE) {
      playTailedClip(c.clip, c.cat, { gain: c.gain * vol, rate: c.rate ?? 1, delayMs: c.delayMs ?? 0, lenMs: c.lenMs ?? 0 });
    }
  };
  return {
    pickUp: () => { cues('pickUp'); },
    shake: () => { cues('shake'); },
    overLine: () => { cues('overLine'); },
    till: () => { cues('till'); },
    land: () => { cues('land'); },
    refuse: () => { cues('refuse'); },
    rack: () => { cues('rack'); },
    play: () => { cues('play'); },
    dispose: () => { disposed = true; },
  };
}
