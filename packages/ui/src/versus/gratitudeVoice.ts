/**
 * CINDY'S GOLDEN GRATITUDE LINE (owner 2026-11-14, R-DUOS-CINDY-01): "A voice line when she uses it, heard by Cindy AND
 * the teammate." One line, `audio/heroes/cindy.gratitude.mp3` (ElevenLabs Jessica: "A great big golden thank you in
 * advance!"), on the Hero Select fader like every hero's spoken line.
 *
 * WHERE IT PLAYS: on Cindy's screen as her arm leaves (`playEntryFlight`, the one place every send of her run passes),
 * and on her teammate's screen as the arm row lands on their run (`duosPasses.applyRows`). A reload's restore replays
 * through the reducer, not these call sites, so it says nothing.
 *
 * ONCE PER KEY on this screen (a re-delivered row, a retry of the send). PRESENTATION ONLY: module state.
 */
import { sfx } from '../sfx';

const spoken = new Set<string>();

/** Say the line for `key`, once. Returns whether it spoke. */
export function speakGratitude(key: string): boolean {
  if (!key || spoken.has(key)) return false;
  spoken.add(key);
  sfx.cindyGratitude();
  return true;
}

/** A new match: keys start over. */
export function resetGratitudeVoice(): void { spoken.clear(); }
