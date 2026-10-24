/// <reference types="vite/client" />
/**
 * WHICH SOUND CLIPS A GAME WILL NEED (R-TOUCH-AUDIO-QUALITY-01, owner report 2026-10-23: "the sound effects were all
 * terrible/not loaded" on a real iPhone). A phone holds only part of the SFX bank decoded (the whole bank is far too
 * big for an iPhone tab, see audio/phoneAudio.ts), so it has to decode the rest AHEAD of its first play or that play
 * is silent. This module answers "what will play soon" from data the game already ships:
 *
 *  - COMMON: the clips of every FX def bound to a generic moment kind (`choreo/bindings.json` `kinds`) or played
 *    straight from code (`fx/directCalls.ts`). They play in every game, so a phone keeps them with the core bank.
 *  - PER CARD: the card's own voice clips (`cards/<id>`, `.effect`, `.death`) and the clips of every FX def bound to
 *    it (`bindings.json` `cards[<id>]`: its Shout, Rally, death, cast, ...).
 *  - PER HERO: the hero's lines (`heroes/<id>`, `heroes/<id>.power`).
 *  - CODE: the `fx/` clips named in code (the hero-attack styles, the Discover and Ancients entrances), listed in
 *    audio/codeClips.ts and pinned by its scan test.
 *
 * Pure apart from the two static imports and the glob, so the selection is unit-tested on the real data.
 */
import rawBindings from '../choreo/bindings.json';
import { DIRECT_CALL_SITES } from '../fx/directCalls';
import { CODE_FX_CLIPS } from './codeClips';

/** Every `clip` string in a def's layers' params (the `sound` primitive's clip). */
export function clipsOfDef(def: unknown): string[] {
  const out: string[] = [];
  const layers = (def as { layers?: unknown } | null)?.layers;
  if (!Array.isArray(layers)) return out;
  for (const l of layers) {
    const clip = (l as { params?: { clip?: unknown } } | null)?.params?.clip;
    if (typeof clip === 'string' && clip && !out.includes(clip)) out.push(clip);
  }
  return out;
}

/** Every def id named anywhere inside a bindings value (`def`, `critDef`, nested per-kind entries). */
function defIdsIn(v: unknown, out: Set<string>): Set<string> {
  if (!v || typeof v !== 'object') return out;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if ((k === 'def' || k === 'critDef') && typeof x === 'string' && x) out.add(x);
    else if (x && typeof x === 'object') defIdsIn(x, out);
  }
  return out;
}

export interface ClipIndex {
  /** Clips every game plays: a phone decodes them with the core bank and never evicts them. */
  readonly common: ReadonlySet<string>;
  /** The clips a card can play: its voice clips plus its bound FX defs' clips. */
  forCard(cardId: string): readonly string[];
  /** The hero's own lines. */
  forHero(heroId: string): readonly string[];
  /** The `fx/` clips named in code (hero attacks, entrances). */
  readonly code: readonly string[];
}

/**
 * Build the index. `defs` is def id to def, `bindings` the bindings table (`{ kinds, cards }`), `directIds` the defs
 * fired from code, `clipNames` every clip in the bank (`cards/x`, `heroes/x`, `fx/x`, ...). A clip not in the bank is
 * dropped, so a stale binding never asks for a file that is not there.
 */
export function buildClipIndex(
  defs: Readonly<Record<string, unknown>>,
  bindings: unknown,
  directIds: readonly string[],
  clipNames: readonly string[],
  codeClips: readonly string[] = [],
): ClipIndex {
  const bank = new Set(clipNames);
  const clipsOf = (ids: Iterable<string>): string[] => {
    const out: string[] = [];
    for (const id of ids) for (const c of clipsOfDef(defs[id])) if (bank.has(c) && !out.includes(c)) out.push(c);
    return out;
  };
  const b = (bindings ?? {}) as { kinds?: unknown; cards?: Record<string, unknown> };
  const common = new Set(clipsOf([...defIdsIn(b.kinds, new Set()), ...directIds]));
  const cardCache = new Map<string, readonly string[]>();
  const voice = (prefix: string): string[] => clipNames.filter((n) => n === prefix || n.startsWith(`${prefix}.`));
  return {
    common,
    code: codeClips.filter((c) => bank.has(c)),
    forCard(cardId) {
      let hit = cardCache.get(cardId);
      if (!hit) {
        const own = b.cards && Object.prototype.hasOwnProperty.call(b.cards, cardId) ? clipsOf(defIdsIn(b.cards[cardId], new Set())) : [];
        hit = [...voice(`cards/${cardId}`), ...own.filter((c) => !common.has(c))];
        cardCache.set(cardId, hit);
      }
      return hit;
    },
    forHero(heroId) { return voice(`heroes/${heroId}`); },
  };
}

/** What a phone should have decoded for the moment the game is in. Every field is optional. */
export interface PrewarmScene {
  /** The heroes on offer in hero select (their pick lines). */
  heroChoices?: readonly string[] | null;
  /** The player's hero. */
  heroId?: string | null;
  /** Cards that can act soon, most urgent first: the board, the hand, the Shop, the fight's minions. */
  cardIds?: readonly string[];
}

/**
 * The clips to decode ahead of time for a scene, most urgent first, de-duplicated, minus the common set (decoded with
 * the core bank) and anything `has` says is already held or loading. Order: the player's hero, the cards (in the
 * order given), the heroes on offer, then the code clips (the hero attacks play at the end of a fight).
 */
export function prewarmList(index: ClipIndex, scene: PrewarmScene, has: (clip: string) => boolean = () => false): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (cs: readonly string[]): void => {
    for (const c of cs) {
      if (seen.has(c)) continue;
      seen.add(c);
      if (!index.common.has(c) && !has(c)) out.push(c);
    }
  };
  if (scene.heroId) add(index.forHero(scene.heroId));
  for (const id of scene.cardIds ?? []) add(index.forCard(id));
  for (const h of scene.heroChoices ?? []) add(index.forHero(h));
  if (scene.heroId || (scene.cardIds?.length ?? 0) > 0) add(index.code);
  return out;
}

let shipped: ClipIndex | null = null;
/** The index over the shipped defs and bindings, built once on first use. */
export function shippedClipIndex(clipNames: readonly string[]): ClipIndex {
  if (shipped) return shipped;
  let mods: Record<string, unknown> = {};
  try {
    mods = import.meta.glob('../fx/defs/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
  } catch { /* a loader without Vite's glob: no defs, so only voice clips are found */ }
  const defs: Record<string, unknown> = {};
  for (const [p, d] of Object.entries(mods)) defs[p.split('/').pop()!.replace(/\.json$/, '')] = d;
  shipped = buildClipIndex(defs, rawBindings, Object.keys(DIRECT_CALL_SITES), clipNames, CODE_FX_CLIPS);
  return shipped;
}
