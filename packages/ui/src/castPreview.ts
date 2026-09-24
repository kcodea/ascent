/**
 * THE CAST PREVIEW (owner ask 2026-09-23): when a RUNE or a MINION casts a spell — never the player from hand
 * or shop — the spell's own card preview floats above its caster for a moment, "like a hover preview": fades
 * in, lingers about two seconds, fades out.
 *
 *   *"please have a copy of the spell that gets cast pop up above the rune when it is cast. use a hover preview
 *   and let it linger for about 2 seconds. have it fade in/out like a preview"* — owner, Rune of the Gilded Ledger
 *   *"this should become the norm, when a spell or something is cast or triggered from runes and minions."*
 *
 * This module is the STORE and the pure rules, with no React and no DOM at module level so it can be tested
 * under node. `CastPreviewLayer.tsx` renders the entries; three feeders call `showCastPreview`:
 *   · the shop — Recruit.tsx's `castFxSeq` watcher (the sim's per-action `castFx` channel);
 *   · End of Turn — the `spellResolved` presenter (authoritative path) / `EotStepFx.casts` (legacy path);
 *   · combat — the `castPreviewFx` cue channel in `choreo/score.ts`, on the replay clock, once per
 *     (caster, spell) per fight (`channels/castPreview.ts`).
 *
 * STACKING (a judgement call, flagged in the PR): a second cast from the SAME source while its preview is still
 * up REPLACES it — the card swaps to the new spell, a small ×N count appears and the linger restarts — so a
 * rapid-fire caster (a Gemstorm Instigator's five Rubies, a gilded Rope Wrangler's Lassos) reads as one preview
 * refreshing rather than a pile of identical cards over one slot. Casts from DIFFERENT sources run side by
 * side, each above its own caster; `placeCastPreview` nudges a newcomer sideways when its footprint would lap
 * a live one, so two neighbouring casters never overlap.
 *
 * PERF: one-shot CSS animations on opacity/transform only (no looping paint work); ONE layout read per preview
 * at mount (the clamp), never per frame; a fixed, pointer-events:none layer that never shifts layout.
 */

/** Timings, ms. Fade in like the hover reveal, linger the owner's "about 2 seconds", fade out a touch slower. */
export const CAST_PREVIEW_MS = { fadeIn: 180, linger: 2000, fadeOut: 320 } as const;

/** Where the caster sits (viewport px) — measured ONCE by the feeder, never re-read. */
export interface CastPreviewAnchor { left: number; top: number; width: number; height: number }

export interface CastPreviewEntry {
  id: number;
  /** The caster's identity — a board uid or `rune:<id>`; the replace-per-source key. */
  sourceKey: string;
  spellId: string;
  anchor: CastPreviewAnchor;
  /** How many casts this entry has absorbed (a replace bumps it; ≥2 shows the ×N chip). */
  count: number;
  /** The fade-out has begun; the entry leaves after `fadeOut`. */
  leaving: boolean;
}

let entries: readonly CastPreviewEntry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function commit(next: readonly CastPreviewEntry[]): void {
  entries = next;
  for (const l of listeners) l();
}

function scheduleLeave(id: number): void {
  const prior = timers.get(id);
  if (prior) clearTimeout(prior);
  timers.set(id, setTimeout(() => {
    commit(entries.map((e) => (e.id === id ? { ...e, leaving: true } : e)));
    timers.set(id, setTimeout(() => {
      timers.delete(id);
      commit(entries.filter((e) => e.id !== id));
    }, CAST_PREVIEW_MS.fadeOut));
  }, CAST_PREVIEW_MS.fadeIn + CAST_PREVIEW_MS.linger));
}

/** Show (or refresh) the preview of `spellId` above `anchor`. Returns the entry id. */
export function showCastPreview(input: { sourceKey: string; spellId: string; anchor: CastPreviewAnchor }): number {
  const live = entries.find((e) => e.sourceKey === input.sourceKey && !e.leaving);
  if (live) {
    // REPLACE, not stack: same caster, its preview still up → swap the card, count it, restart the linger.
    commit(entries.map((e) => (e.id === live.id ? { ...e, spellId: input.spellId, anchor: input.anchor, count: e.count + 1 } : e)));
    scheduleLeave(live.id);
    return live.id;
  }
  const id = nextId++;
  commit([...entries, { id, sourceKey: input.sourceKey, spellId: input.spellId, anchor: input.anchor, count: 1, leaving: false }]);
  scheduleLeave(id);
  return id;
}

/** Drop every preview at once — a phase flip, a replay seek, a new fight. */
export function clearCastPreviews(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  if (entries.length) commit([]);
}

export function getCastPreviews(): readonly CastPreviewEntry[] { return entries; }
export function subscribeCastPreviews(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** A caster as the sim records it (`CastFxSource`) or as a trigger source names it. */
export type CastPreviewSource = { kind: 'minion'; uid: string } | { kind: 'rune'; id: string };

export function castSourceKey(source: CastPreviewSource): string {
  return source.kind === 'minion' ? source.uid : `rune:${source.id}`;
}

/**
 * The DOM element a caster is drawn as, in the SHOP: a warband card by uid (then hand, then anywhere — a
 * caster can be a hand card whose effect fired), or a rune's badge on the rail. Null when it is not on screen.
 */
export function castSourceElement(source: CastPreviewSource): Element | null {
  if (typeof document === 'undefined') return null;
  if (source.kind === 'rune') return document.querySelector(`.questbadges .runebadge[data-source-id="${source.id}"]`);
  return document.querySelector(`[data-zone="warband"] .row .card[data-uid="${source.uid}"]`)
    ?? document.querySelector(`.row.hand .card[data-uid="${source.uid}"]`)
    ?? document.querySelector(`[data-uid="${source.uid}"]`);
}

export function anchorOfElement(el: Element): CastPreviewAnchor {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/**
 * Show a preview above a caster drawn in the shop. The caster's element can lag the commit by a frame (a
 * minion summoned and casting in the same action), so a missing element is retried for a few frames, the way
 * the Starform watcher retries, rather than dropped. Returns a cancel for the retry.
 */
export function fireCastPreviewAt(source: CastPreviewSource, spellId: string, tries = 20): () => void {
  let raf = 0;
  let left = tries;
  const attempt = (): void => {
    const el = castSourceElement(source);
    if (el) {
      const anchor = anchorOfElement(el);
      if (anchor.width > 0) { showCastPreview({ sourceKey: castSourceKey(source), spellId, anchor }); return; }
    }
    if (left-- > 0 && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(attempt);
  };
  attempt();
  return () => { if (raf) cancelAnimationFrame(raf); };
}

/** A live preview's horizontal footprint, for the de-overlap pass. */
export interface OccupiedSpan { left: number; right: number }

/**
 * WHERE A PREVIEW SITS — centred above its anchor, clamped on-screen, nudged sideways off any live preview it
 * would lap. `w`/`h` are the preview's own rendered size (measured once at mount). Falls BELOW the anchor when
 * there is no room above (a top-row unit on a short window). Pure, so it is testable without a browser.
 */
export function placeCastPreview(args: {
  anchor: CastPreviewAnchor;
  w: number;
  h: number;
  viewportW: number;
  viewportH: number;
  occupied: readonly OccupiedSpan[];
  gap?: number;
  edge?: number;
}): { left: number; top: number } {
  const { anchor, w, h, viewportW, viewportH, occupied, gap = 8, edge = 6 } = args;
  const clampX = (x: number): number => Math.max(edge, Math.min(x, viewportW - w - edge));
  let left = clampX(anchor.left + anchor.width / 2 - w / 2);
  const laps = (x: number): OccupiedSpan | undefined => occupied.find((o) => x < o.right && x + w > o.left);
  // Nudge RIGHT past whatever it laps; if that runs off the edge, try LEFT of the leftmost lapped span.
  let hit = laps(left);
  for (let n = 0; hit && n < 8; n++) {
    const right = hit.right + gap;
    if (right + w <= viewportW - edge) { left = right; hit = laps(left); continue; }
    const leftOf = hit.left - gap - w;
    if (leftOf >= edge) { left = leftOf; hit = laps(left); continue; }
    break; // no free x at all — overlap beats vanishing
  }
  let top = anchor.top - gap - h;
  if (top < edge) top = Math.min(anchor.top + anchor.height + gap, viewportH - h - edge);
  return { left, top: Math.max(edge, top) };
}
