/**
 * PHONE SFX PREWARM (R-TOUCH-AUDIO-QUALITY-01, owner report 2026-10-23 on a real iPhone: "the sound effects were all
 * terrible/not loaded"). A phone holds only part of the SFX bank decoded, so the card, hero and FX clips must be
 * decoded BEFORE their first play or that play is silent. This reads the store and tells `prewarmSfx` (sfx.ts) what
 * the game is about to need: the heroes on offer in hero select, then the player's hero, and the cards on the board,
 * in the hand, in the Shop and in the fight (both sides, plus every card the fight's events name: its summons, its
 * cast spells, its gifts).
 *
 * Store-driven and React-free, like the music (music.ts): Game.tsx subscribes it, on desktop too since
 * R-AUDIO-MEMORY-02 (desktop no longer holds the whole bank). It reads a few references per store update and does the
 * work at most once per change of scene, after a short quiet spell, so a drag or a beat never pays for it. The decode
 * itself is inside sfx.ts (one clip at a time on a phone).
 */
import type { CombatResult } from '@game/core';
import type { RunState } from '@game/sim';
import { prewarmSfx } from '../sfx';
import type { PrewarmScene } from './clipIndex';
import { LITE_ART } from '../phoneArt';

/** The slice of the store this reads. */
export interface PrewarmStoreState {
  heroChoices: readonly string[] | null;
  run: Pick<RunState, 'heroId' | 'board' | 'hand' | 'shop' | 'lastCombat'> & { spell?: { cardId: string } | null; discover?: readonly string[] };
}

/** Every card id a fight can sound: both starting boards, then every `cardId` its events carry (summons, casts, gifts). */
export function combatCardIds(c: CombatResult | undefined | null): string[] {
  if (!c) return [];
  const out = new Set<string>();
  for (const m of c.initial?.player ?? []) out.add(m.cardId);
  for (const m of c.initial?.enemy ?? []) out.add(m.cardId);
  for (const e of c.events ?? []) {
    const id = (e as { cardId?: unknown }).cardId;
    if (typeof id === 'string' && id) out.add(id);
  }
  return [...out];
}

/** The scene to prewarm for this state: most urgent first (the board, the hand, an open Discover's offer, the Shop,
 *  the fight). A Discover pick can be played the moment it lands in the hand, so its offer is warmed while it is
 *  open (R-AUDIO-MEMORY-02). */
export function sceneOf(st: PrewarmStoreState): PrewarmScene {
  const r = st.run;
  const ids: string[] = [];
  for (const c of r.board ?? []) ids.push(c.cardId);
  for (const c of r.hand ?? []) ids.push(c.cardId);
  for (const id of r.discover ?? []) ids.push(id);
  for (const c of r.shop ?? []) ids.push(c.cardId);
  if (r.spell) ids.push(r.spell.cardId);
  ids.push(...combatCardIds(r.lastCombat));
  return { heroChoices: st.heroChoices, heroId: r.heroId || null, cardIds: ids };
}

/** Quiet spell before a changed scene is prewarmed: a burst of store updates (a buy, a roll) settles first. Shorter
 *  on desktop (R-AUDIO-MEMORY-02): it has no paced decode queue, and a fast player can buy and play a card a roll
 *  just offered within half a second. */
export const PREWARM_SETTLE_MS = LITE_ART ? 400 : 150;

let last: { heroChoices: unknown; heroId: unknown; board: unknown; hand: unknown; shop: unknown; combat: unknown; discover: unknown } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let latest: PrewarmStoreState | null = null;

/** Feed a store state. Cheap when nothing it reads changed (a handful of reference compares). */
export function syncPhoneSfxPrewarm(st: PrewarmStoreState): void {
  const r = st.run;
  if (last && last.heroChoices === st.heroChoices && last.heroId === r.heroId && last.board === r.board
    && last.hand === r.hand && last.shop === r.shop && last.combat === r.lastCombat && last.discover === r.discover) return;
  last = { heroChoices: st.heroChoices, heroId: r.heroId, board: r.board, hand: r.hand, shop: r.shop, combat: r.lastCombat, discover: r.discover };
  latest = st;
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    if (latest) prewarmSfx(sceneOf(latest));
  }, PREWARM_SETTLE_MS);
}

/** Test hook. */
export function __resetPhonePrewarm(): void {
  last = null; latest = null;
  if (timer !== null) clearTimeout(timer);
  timer = null;
}
