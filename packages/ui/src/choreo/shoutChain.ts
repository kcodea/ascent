import { PRESENTATION_POLICIES } from '@game/core';
import { CARD_INDEX } from '@game/content';
import type { RunState } from '@game/sim';
import { CHAIN_LINK_PACING } from '../choreographer/compileTimeline';

/**
 * SHOUT CHAIN IN THE SHOP (R-SHRIEKER-BEATS-01, owner 2026-10-10: "dawnclaw and mykel should also do one at a time").
 *
 * A mid-turn Shop action does not play the beat batch (only End of Turn does), so the Shop presents the same chain
 * from the sim's `shoutLinkFx` records: link k starts at `k × slot`, the trigger-er's tribe tendril flies to the
 * Shout's owner, and that fire's own buff records (`recruitBuffFx[fxStart, fxEnd)`) play at the link's delivery.
 * The slot and delivery are the compiler's `CHAIN_LINK_PACING`, so a Shop chain and an End-of-Turn chain read alike.
 *
 * PURE: no DOM, no clock. The caller schedules the times and draws.
 */
export type ShoutLink = NonNullable<RunState['shoutLinkFx']>[number];
type BuffFx = RunState['recruitBuffFx'][number];

export const SHOP_CHAIN_SLOT_MS = CHAIN_LINK_PACING.completionMs + CHAIN_LINK_PACING.recoveryMs;

export interface PlannedShoutLink {
  link: ShoutLink;
  /** When the tendril leaves the trigger-er, ms from now. */
  linkAtMs: number;
  /** When this fire's buffs play, ms from now (after the tendril has landed). */
  buffAtMs: number;
  /** This fire's buff records (the caller's filters already applied). */
  buffs: BuffFx[];
}

export function planShoutChain(links: readonly ShoutLink[], recruitBuffFx: readonly BuffFx[]): { links: PlannedShoutLink[]; claimed: Set<BuffFx> } {
  const claimed = new Set<BuffFx>();
  const out = links.map((link, k) => {
    const buffs = recruitBuffFx.slice(link.fxStart, link.fxEnd);
    for (const b of buffs) claimed.add(b);
    return { link, linkAtMs: k * SHOP_CHAIN_SLOT_MS, buffAtMs: k * SHOP_CHAIN_SLOT_MS + CHAIN_LINK_PACING.deliveryMs, buffs };
  });
  return { links: out, claimed };
}

/**
 * Does this card trigger Shouts as a CHAIN (an effect whose registry entry is `children: 'sequential'` — Dawnclaw and
 * Ryme's Echo, High King Mykel, Shrieker, Moira)? Read off the registry by `factory:<do>:<on>`, the same key gameplay
 * stamps, so a future card on one of those factories inherits the tendril and nothing is keyed by card id. Combat
 * reads it to draw the trigger-er's tendril on each `shout` re-fire moment.
 */
export function isShoutChainTrigger(cardId: string | null | undefined): boolean {
  const def = cardId ? CARD_INDEX[cardId] : undefined;
  return !!def?.effects.some((e) => PRESENTATION_POLICIES[`factory:${e.do}:${e.on}`]?.children === 'sequential');
}
