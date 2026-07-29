import { makeRng } from '@game/core';

/**
 * FAKE PLAYER HANDLES for generated seats.
 *
 * Seats used to be labelled with their HERO's name ("Nadja", "Drumline"), which read as scenery rather than as
 * opponents — and it also made real snapshot seats obvious by contrast, since those carry a player's actual
 * name. A lobby should look like eight players.
 *
 * The styles are modelled on the handles real players in the pool actually use — TitleCase mashups, a lowercase
 * word, `xx_Name_xx`, a trailing `z`, a lowercase phrase — so a generated name doesn't stand out from a real
 * one. Deterministic from a numeric key (a seat seed, or a hash of a run key), so a lobby seeds the same names
 * every time and a replay is faithful. `Math.random` is banned here as everywhere in sim.
 */

const ADJ = [
  'Lazer', 'Turbo', 'Grim', 'Salty', 'Feral', 'Vapor', 'Crispy', 'Toxic', 'Velvet', 'Rusty',
  'Cosmic', 'Sleepy', 'Frosty', 'Sneaky', 'Angry', 'Lucky', 'Silent', 'Golden', 'Hollow', 'Wicked',
];
const NOUN = [
  'Lemon', 'Goblin', 'Wizard', 'Turnip', 'Kobold', 'Dragon', 'Spoon', 'Badger', 'Cactus', 'Muffin',
  'Comet', 'Anvil', 'Otter', 'Pickle', 'Raven', 'Wombat', 'Biscuit', 'Gremlin', 'Noodle', 'Thistle',
];
const WORD = [
  'lemon', 'onion', 'gravy', 'pigeon', 'sock', 'moth', 'bagel', 'squid', 'toast', 'fern',
  'clover', 'pebble', 'gumbo', 'walnut', 'sprout', 'mango',
];
const PHRASE_A = ['someone', 'just', 'literally', 'basically', 'actually', 'definitely'];
const PHRASE_B = ['crazytown', 'a goblin', 'here to lose', 'winning', 'tired', 'vibing', 'no idea', 'built different'];
const SUFFIX = ['Himself', 'Prime', 'Jr', 'TheThird', 'Again', 'Returns'];

/** Turn any string into a stable numeric key (FNV-1a) — used for run keys, which aren't numbers. */
export function handleKeyOf(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

/** A deterministic player-looking handle for this key. */
export function handleFor(key: number): string {
  const rng = makeRng((key ^ 0x5eed_1abe) >>> 0);
  const pick = <T,>(xs: readonly T[]): T => xs[rng.int(xs.length)]!;
  switch (rng.int(7)) {
    case 0: return `${pick(ADJ)}${pick(NOUN)}`;
    case 1: return `${pick(WORD)}`;
    case 2: return `xx_${pick(NOUN)}_xx`;
    case 3: return `${pick(NOUN)}z`;
    case 4: return `${pick(PHRASE_A)} ${pick(PHRASE_B)}`;
    case 5: return `${pick(NOUN)}${pick(SUFFIX)}`;
    default: return `${pick(ADJ)}${pick(NOUN)}${10 + rng.int(89)}`;
  }
}

/**
 * A handle for this key that isn't already at the table.
 *
 * Two seats sharing a name would look like a rendering bug, and with 20×20 mashups plus the other styles a
 * collision is rare but not impossible — so perturb the key until it's free, with a bounded fallback.
 */
export function uniqueHandleFor(key: number, taken: ReadonlySet<string>): string {
  for (let i = 0; i < 24; i++) {
    const name = handleFor((key + i * 0x9e37_79b9) >>> 0);
    if (!taken.has(name.toLowerCase())) return name;
  }
  return `${handleFor(key)}${key % 1000}`; // exhausted the tries — stay deterministic rather than loop
}
