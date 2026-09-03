/** Pure clip → mixer-category resolver, split out of sfx.ts so it carries no Web Audio and a test can assert
 *  EVERY committed clip resolves to a real fader (the "always has all sounds" guarantee). A clip's family is
 *  the category whose group fader it sits under on the desk; its OWN per-clip channel fader rides on top (the
 *  `clips` multiplier in the audio config). Keep this in step with the `playSample(clip, category)` call sites
 *  in sfx.ts — the completeness test flags a clip with no home, but only a human can spot a WRONG home. */

import { EQUIPMENT_CLIP_CATEGORY } from './config';

/** Clips whose sample-name differs from the category they play under (the bundle members + the renamed ones).
 *  A clip NOT listed here, not in a special directory, and not a numbered variant is assumed 1:1 (its name IS
 *  its category — `crit`, `death`, `consume`, …). */
const IRREGULAR_CLIP_CATEGORY: Record<string, string> = {
  // the `attack` bundle — several distinct clips share one group fader
  AttackPillAdd: 'attack', TallyTravel: 'attack', tallyimpact: 'attack', tallycounter: 'attack', windup: 'attack',
  // clip name ≠ category name (the tavern verbs, the reward, the shield)
  freezetavern: 'freeze', unfreezetavern: 'unfreeze', tavernupgrade: 'upgrade',
  reordercard: 'reorder', triplereward: 'triple', shieldgain: 'shield',
  'discover-select': 'discoverSelect', 'rune-chain-break': 'runeBreak', runeselectimplosion: 'runeArrival',
  'fel-spike-echo': 'felSpikeEcho', 'fel-spike-echo-land': 'felSpikeEchoLand',
  // equipment (non-use) clips
  equipclang: 'eqEquipClang', equipmentselect: 'eqSelect', equipmentsheen: 'eqSheen',
  // clips that used to ride the generic `ui` fallback with no fader — now their own categories
  auctioneerhp: 'auctioneerhp', runeselect: 'runeselect',
};

/** Numbered-variant bases (`buy1`/`buy2` → `buy`) — the logical clips backed by N files, one picked per play. */
const VARIANT_BASES = new Set(['buy', 'sell', 'smack', 'cleave']);

/**
 * The mixer category a clip sits under. Directory clips (heroes/cards/ceremony) group by kind; equipment-use
 * clips route by the shared `EQUIPMENT_CLIP_CATEGORY` map; a `<letters><digits>` name whose base is a known
 * variant family collapses onto that base; the irregular table catches the rest; anything else is 1:1.
 */
export function familyOf(clip: string): string {
  if (clip.startsWith('heroes/')) return clip.endsWith('.power') ? 'heroPower' : 'heroSelect';
  if (clip.startsWith('cards/')) return clip.endsWith('.effect') ? 'cardEffect' : clip.endsWith('.death') ? 'cardDeath' : 'cardVoice';
  if (clip.startsWith('ceremony/')) return 'ceremony';
  const eq = EQUIPMENT_CLIP_CATEGORY[clip];
  if (eq) return eq;
  const irregular = IRREGULAR_CLIP_CATEGORY[clip];
  if (irregular) return irregular;
  const m = /^([a-zA-Z]+)\d+$/.exec(clip);
  if (m && VARIANT_BASES.has(m[1]!)) return m[1]!;
  return clip; // 1:1 — the clip name is its own category
}

/**
 * Optional pretty names for individual clips on the desk (default = the clip's sample-name). Add an entry to
 * title a channel fader the way the Equipment section titles its clips; anything unlisted just shows its name.
 */
export const CLIP_LABEL: Record<string, string> = {
  // the attack bundle
  windup: 'Attack — wind-up', TallyTravel: 'Attack — tally travel', AttackPillAdd: 'Attack — pill add',
  tallyimpact: 'Attack — tally impact', tallycounter: 'Attack — tally counter',
  // ceremony stingers
  'ceremony/asiansong': 'Ceremony — anthem', 'ceremony/ceremonyrevealsound': 'Ceremony — reveal chime',
  'ceremony/woosh1': 'Ceremony — woosh 1', 'ceremony/woosh2': 'Ceremony — woosh 2',
  // the two that used to have no fader
  auctioneerhp: 'Auctioneer — hero power', runeselect: 'Rune select — frame clang',
};
