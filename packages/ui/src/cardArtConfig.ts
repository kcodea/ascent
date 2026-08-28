import shippedJson from './cardArt.data.json';
/**
 * PER-CARD art framing — how one card's illustration sits inside its frame window, and an optional colour
 * tweak. The 🖼️ Card Frames tuner already dials `--artY` / `--artZoom` per frame FAMILY (every oval minion at
 * once); this is the per-CARD layer on top, for the illustrations that need their own framing.
 *
 * ── Why it's cheap ────────────────────────────────────────────────────────────────────────────────────────
 * The family values are plain CSS vars declared on `.card.compact.stdframe` (and `.spellframe` / `.taunt`).
 * A per-card override is therefore just the SAME var set inline on that card's root element, where it wins
 * over the class rule by specificity. So a card with no entry here renders byte-identically to before — the
 * override literally isn't emitted. No CSS restructuring, no new render path, nothing for untouched cards.
 *
 * ── Units: everything is scale-invariant, on purpose ──────────────────────────────────────────────────────
 * The same illustration renders in the shop, the hand, the board, combat and the Compendium at very different
 * pixel sizes. Every value here is therefore a PERCENTAGE of the art window (x/y) or a MULTIPLIER (zoom) —
 * never a pixel. A pixel offset would look right where it was tuned and wrong on every other surface, and
 * you would only find out after tuning a hundred cards.
 *
 * ── Persistence ───────────────────────────────────────────────────────────────────────────────────────────
 * DEV-only localStorage while you tune (Layout Lab convention, per the #615 prod-leak fix) — production
 * renders `SHIPPED` and nothing else. The tuner emits the JSON to paste back into `SHIPPED`, which is how a
 * tuning session becomes a reviewed commit rather than a runtime side effect.
 */

/** One card's framing. Every field optional: an override sets only what it changes, and anything absent
 *  falls through to the frame family's own value. */
export interface CardArt {
  /** Horizontal nudge, as a % of the art window. Negative moves the illustration left. 0 = untouched. */
  x?: number;
  /** Vertical nudge, as a % of the art window. Negative moves it up. 0 = untouched. */
  y?: number;
  /** Content zoom. >1 fills more of the window (a tighter crop), <1 shows more of the illustration. */
  zoom?: number;
  /** Hue rotation in degrees (−180…180). 0 = untouched. */
  hue?: number;
  /** Saturation multiplier. 1 = untouched. */
  sat?: number;
  /** Contrast multiplier. 1 = untouched. */
  contrast?: number;
}

/** The identity framing — what a card renders as when it has no entry. Not applied as values (that would
 *  override the family); it is the baseline the tuner opens on and compares against. */
export const CARD_ART_IDENTITY: Required<CardArt> = { x: 0, y: 0, zoom: 1.12, hue: 0, sat: 1, contrast: 1 };

/** Slider bounds: [min, max, step]. */
export const CARD_ART_RANGES: Record<keyof CardArt, [number, number, number]> = {
  x: [-50, 50, 0.5],
  y: [-50, 50, 0.5],
  zoom: [0.6, 2.2, 0.01],
  hue: [-180, 180, 1],
  sat: [0, 2.5, 0.01],
  contrast: [0, 2.5, 0.01],
};

export const CARD_ART_DESC: Record<keyof CardArt, string> = {
  x: 'Nudge the illustration left/right, as a % of the window. Negative moves it left.',
  y: 'Nudge it up/down, as a % of the window. Negative moves it up.',
  zoom: 'Zoom into the illustration. Above 1 crops tighter; below 1 shows more of it.',
  hue: 'Rotate the colours, in degrees. 0 leaves them alone.',
  sat: 'Saturation. 1 leaves it alone, 0 is greyscale.',
  contrast: 'Contrast. 1 leaves it alone.',
};

/**
 * THE SHIPPED OVERRIDES — the committed result of tuning sessions, keyed by cardId.
 *
 * A real git-tracked file, written by the tuner's "Save to file" through the dev-only `/__fx/cardart`
 * endpoint (see `apps/web/fxDefsPlugin.ts`), exactly as the FX workbench commits its defs and bindings. That
 * is what makes a tuning session durable: it survives a reload, a cleared browser cache and a branch switch,
 * and it reviews as a normal diff. A static import, so a write invalidates through the import graph and HMR
 * picks it up without a restart.
 */
const SHIPPED = shippedJson as Record<string, CardArt>;

const KEY = 'ascent.cardart';

let overrides: Record<string, CardArt> = (() => {
  if (!import.meta.env.DEV) return { ...SHIPPED };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return saved && typeof saved === 'object' ? { ...SHIPPED, ...(saved as Record<string, CardArt>) } : { ...SHIPPED };
  } catch {
    return { ...SHIPPED };
  }
})();

/** This card's override, or undefined when it has none (the overwhelmingly common case). */
export function getCardArt(cardId: string | undefined): CardArt | undefined {
  return cardId ? overrides[cardId] : undefined;
}

/** Every card that currently has an override — the tuner's "edited" list. */
export function tunedCardIds(): string[] {
  return Object.keys(overrides).sort();
}

/** Set (or with `null`, clear) one card's framing. DEV only — production has no writer. */
export function setCardArt(cardId: string, art: CardArt | null): void {
  if (!import.meta.env.DEV) return;
  if (art === null) delete overrides[cardId];
  else overrides[cardId] = art;
  try { localStorage.setItem(KEY, JSON.stringify(overrides)); } catch { /* private mode — tuning is ephemeral */ }
  bump();
}

/** Drop every local edit and fall back to what is committed in `SHIPPED`. */
export function resetCardArt(): void {
  if (!import.meta.env.DEV) return;
  overrides = { ...SHIPPED };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  bump();
}

/**
 * Commit the current overrides to `cardArt.data.json`.
 *
 * The local (localStorage) layer is deliberately NOT cleared afterwards. The file write and the running
 * page's state are two different things: HMR will reload the module, and dropping the local layer first
 * would briefly render every card unframed if the write failed. Local edits and the file agree after a
 * successful save, so the overlay is a no-op either way — and if it failed, your work is still there.
 */
export async function saveCardArtToFile(): Promise<{ ok: boolean; error?: string }> {
  if (!import.meta.env.DEV) return { ok: false, error: 'Saving is DEV-only.' };
  try {
    const res = await fetch('/__fx/cardart', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: JSON.stringify(overrides, null, 2) }),
    });
    if (!res.ok) return { ok: false, error: `${res.status} ${(await res.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The tuning session as source you can paste into `SHIPPED` above — option (a) of the owner's brief. */
export function exportCardArt(): string {
  const sorted: Record<string, CardArt> = {};
  for (const id of Object.keys(overrides).sort()) sorted[id] = overrides[id]!;
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

/* ── THE TUNER'S SELECTION ────────────────────────────────────────────────────────────────────────────────
   Which card the panel is editing. It lives here rather than in the panel so the eventual double-click-a-card
   flow and the panel's own picker are the SAME state: clicking a card in the game selects it, and the sliders
   follow, with no prop-drilling between two unrelated trees. */
let selected = '';
/* True while the Card Art panel is open. Double-clicking a card then SELECTS it instead of doing nothing —
   the owner's "click the card directly" flow. Gated on the panel so a stray double-click during normal play
   can never retarget a tuner that isn't on screen. */
let picking = false;

export function isPickingCardArt(): boolean {
  return picking;
}

export function setPickingCardArt(on: boolean): void {
  picking = on;
  bump();
}

export function getSelectedCard(): string {
  return selected;
}

export function selectCard(cardId: string): void {
  if (!import.meta.env.DEV) return;
  selected = cardId;
  bump();
}

/* ── THE EDIT SESSION ─────────────────────────────────────────────────────────────────────────────────────
   Double-clicking a card opens a transform session ON that card: drag its art to reposition, wheel to zoom,
   then ✓ to keep or ✗ to put it back.

   `before` is the card's entry as it was when the session opened — `undefined` when the card had none, which
   is a DIFFERENT state from "an entry of all zeroes" and has to round-trip as such: cancelling out of a card
   that had never been tuned must leave it untuned, not leave behind a no-op entry that pins it against later
   family retunes. The edits are written live (so you see them on every surface at once), and Cancel restores
   this snapshot. */
let editing: string | null = null;
let before: CardArt | undefined;

export function editingCardArt(): string | null {
  return editing;
}

/** Open a transform session, snapshotting what the card looks like now so ✗ can restore it. */
export function beginEditCardArt(cardId: string): void {
  if (!import.meta.env.DEV) return;
  const cur = getCardArt(cardId);
  before = cur ? { ...cur } : undefined;
  editing = cardId;
  selected = cardId;              // the panel's sliders follow the card you are dragging
  bump();
}

/** ✓ — keep the live values and close. They are already written; this only ends the session. */
export function commitEditCardArt(): void {
  editing = null;
  before = undefined;
  bump();
}

/** ✗ — put the card back exactly as it was, including back to having no entry at all. */
export function cancelEditCardArt(): void {
  if (editing) setCardArt(editing, before ?? null);
  editing = null;
  before = undefined;
  bump();
}

/** The selected card's values, IDENTITY-FILLED so every slider has a position to sit at. An absent field
 *  means "inherit the frame family", which a slider cannot express — it opens at the family's own value. */
export function readSelected(): Required<CardArt> & { card: string } {
  const a = getCardArt(selected) ?? {};
  return { card: selected, ...CARD_ART_IDENTITY, ...a };
}

/** Write one field of the selected card. Writing makes the card an override even if the value equals the
 *  family default — that is intended: an explicit entry is how you PIN a framing against later family retunes. */
export function writeSelected(key: keyof CardArt, value: number): void {
  if (!selected) return;
  const cur = getCardArt(selected) ?? {};
  setCardArt(selected, { ...cur, [key]: value });
}

/** Drop just the selected card back to its frame family. */
export function clearSelected(): void {
  if (selected) setCardArt(selected, null);
}

/* Re-render subscribers (the tuner, and any card on screen) when an override changes. A plain listener set
   rather than a store dependency: this module is imported by `Card`, which must not pull in Zustand. */
const listeners = new Set<() => void>();
let version = 0;
function bump(): void { version++; for (const fn of listeners) fn(); }
export function subscribeCardArt(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
/** Monotonic edit counter — the `getSnapshot` half of `useSyncExternalStore`, so a card re-renders the
 *  instant its framing is dialled. Never changes in production: nothing there can call `setCardArt`. */
export function cardArtVersion(): number {
  return version;
}

/**
 * The inline CSS vars for one card, or `undefined` when it has no override.
 *
 * `--ca-filter` is emitted ONLY when a colour field is actually non-identity. A `filter` establishes a
 * stacking context and forces its own compositing layer, so declaring one unconditionally would make every
 * card on screen pay for a feature almost none of them use.
 */
/**
 * `fallbackId` lets a BRANCH art key (`n2_spellsword2`) inherit the card's own framing until someone dials the
 *  branch specifically — so adding per-branch overrides changed nothing for the cards that had none.
 */
export function cardArtVars(cardId: string | undefined, fallbackId?: string): Record<string, string> | undefined {
  const a = getCardArt(cardId) ?? (fallbackId ? getCardArt(fallbackId) : undefined);
  if (!a) return undefined;
  const out: Record<string, string> = {};
  if (a.x) out['--ca-tx'] = `${a.x}%`;
  if (a.y) out['--ca-ty'] = `${a.y}%`;
  if (a.zoom !== undefined) out['--artZoom'] = String(a.zoom);
  const fx: string[] = [];
  if (a.hue) fx.push(`hue-rotate(${a.hue}deg)`);
  if (a.sat !== undefined && a.sat !== 1) fx.push(`saturate(${a.sat})`);
  if (a.contrast !== undefined && a.contrast !== 1) fx.push(`contrast(${a.contrast})`);
  if (fx.length) out['--ca-filter'] = fx.join(' ');
  return Object.keys(out).length ? out : undefined;
}
