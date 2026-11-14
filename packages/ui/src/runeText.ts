import type { RuneLiveState } from '@game/sim';
import { CARD_INDEX } from '@game/content';
import { SEQUENCING_DISTINCT } from '@game/core';

/** Rune of Sequencing's live readout (owner design 2026-11-14): the spells in the current sequence, by name, and how
 *  many more different ones complete it. Plain words, no dashes (R-TEXT-STYLE). */
export function sequencingReadout(seq: readonly string[]): string {
  if (seq.length === 0) return '(Sequence: none yet.)';
  const names = seq.map((id) => CARD_INDEX[id]?.name ?? id).join(', ');
  return `(Sequence: ${names}. ${Math.max(0, SEQUENCING_DISTINCT - seq.length)} more.)`;
}

/**
 * LIVE RUNE TEXT (owner report 2026-10-16, R-RUNE-LIVE-TEXT-01): "this rune should show the current value in real
 * time." The rune-side twin of `liveCardText`: a rune that improves ITSELF prints the number it will produce RIGHT
 * NOW, in place, on every surface that shows its text (the rack badge in the Shop and in combat, the hero-slot
 * rune, the Runeforge offer, opponents, spectators, match details, Career, Recent Games).
 *
 * The value comes from `@game/sim`'s `RuneLiveState` (run, snapshot, or either advanced by the replay); this only
 * rewrites the printed number. No state for a rune = the printed text unchanged, which is exactly right for an
 * unowned offer or an older record that never captured the value.
 *
 * Plain numbers (no green `{{…}}` marker): rune text renders through `mdBold`, which does not process it — the same
 * reason `withImpStats` passes wrap=false for runes.
 */
const PAIR = /\+\d+\/\+\d+/;
const ATTACK = /\*\*\+\d+ Attack\*\*/;

const pair = (text: string, a: number, h: number): string => text.replace(PAIR, `+${a}/+${h}`);

export function liveRuneText(runeId: string, text: string, st: RuneLiveState | null | undefined): string {
  if (!st) return text;
  switch (runeId) {
    // "When a Beast attacks, give it +2 Attack and improve this by 2 permanently."
    case 'rune_wild_hunt':
      return st.wildHunt != null ? text.replace(ATTACK, `**+${st.wildHunt} Attack**`) : text;
    // "When you summon a minion in combat, give it +2/+1 and improve this permanently."
    case 'rune_packcraft':
      return st.packcraft ? pair(text, st.packcraft.attack, st.packcraft.health) : text;
    // "When a friendly Beast dies, give all Friendly and summoned Beasts +2/+2. Avenge (2): Improve this."
    case 'rune_beastial_swarm':
      return st.beastialSwarm != null ? pair(text, st.beastialSwarm, st.beastialSwarm) : text;
    // "Whenever you play a minion, give it +1/+1. Improves by +1/+1 after every 5 minions played."
    case 'rune_seasoned_ledger':
      return st.seasonedLedger ? pair(text, st.seasonedLedger.attack, st.seasonedLedger.health) : text;
    // "Every 10 Gold spent, give your Dwarves +2/+2 and improve this by +2/+2."
    case 'rune_compounding_wages':
      return st.compoundingWages ? pair(text, st.compoundingWages.attack, st.compoundingWages.health) : text;
    // "Minions in the Shop have +2/+2. Improves every 4 refreshes."
    case 'rune_wheel':
      return st.wheel ? pair(text, st.wheel.attack, st.wheel.health) : text;
    // "When you sell a minion, give your minions +1 Attack. Alternates between Attack and Health, improving every
    // 2 sales." The NEXT sale's amount AND stat.
    case 'rune_baller':
      return st.baller ? text.replace(ATTACK, `**+${st.baller.amount} ${st.baller.stat}**`) : text;
    // "Whenever you cast a Whisper on a Dragon, give it +1/+1 and improve this." (Set 3 Dragon runes, 2026-10-21)
    case 'rune_borrowed_flame':
      return st.borrowedFlame != null ? pair(text, st.borrowedFlame, st.borrowedFlame) : text;
    // "When you cast an Ale, Shop minions get +1/+1 permanently." The step stays printed; the running total is appended.
    case 'rune_drunk_shopkeeper':
      return st.drunkShopkeeper ? `${text} (Now +${st.drunkShopkeeper.attack}/+${st.drunkShopkeeper.health}.)` : text;
    // "When you cast 3 different spells, get a copy of the first one." (Set 2 Epic, 2026-11-14): the sequence so far.
    case 'rune_sequencing':
      return st.sequence ? `${text} ${sequencingReadout(st.sequence)}` : text;
    default:
      return text;
  }
}
