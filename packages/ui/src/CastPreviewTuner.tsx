import { anchorOfElement, clearCastPreviews, showCastPreview, type CastPreviewAnchor } from './castPreview';
import { SPEC as BASE_SPEC } from './castPreviewConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerSpec } from './tunerSchema';
import type { CastPreviewConfig } from './castPreviewConfig';

/**
 * DEV-only tuner for THE CAST PREVIEW — the spell card a rune or minion casts, floated beside its caster.
 * Owner 2026-09-23: *"this is far too large. can you build a tuner … size, positioning, and linger duration …
 * tune both. add an alpha/opacity lever as well."* Two knob groups (Shop / Combat), all live.
 *
 * "▶ Preview test" fires one of each without playing to the trigger: a SHOP preview above a rune badge (the
 * first on the rail) and a COMBAT-style preview above a minion (the first warband card, or a combat unit), each
 * falling back to a stand-in spot beside this panel when that source is not on screen.
 */
const SAMPLE_SHOP_SPELL = 'mightofaeon'; // Gilded Ledger's cast in the owner's screenshot
const SAMPLE_COMBAT_SPELL = 'growth';    // Fatecarver's cast

function standIn(panelEl: HTMLElement | null, dx: number, w: number, h: number): CastPreviewAnchor {
  // On whichever side of the panel has more room, so the sample never lands under the panel itself.
  const r = panelEl?.getBoundingClientRect();
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const top = Math.min(vh - h - 8, Math.max(8, vh * 0.55));
  if (r && r.left < vw - r.right) return { left: Math.min(vw - w - 8, r.right + 24 + dx), top, width: w, height: h };
  const right = r ? r.left - 24 : vw / 2;
  return { left: Math.max(8, right - dx - w), top, width: w, height: h };
}

export function fireCastPreviewSamples(panelEl: HTMLElement | null): void {
  clearCastPreviews(); // a fresh pair per click, never a ×N chip from the last test
  const rune = document.querySelector('.questbadges .runebadge');
  const runeAnchor = rune ? anchorOfElement(rune) : null;
  showCastPreview({
    sourceKey: 'tuner:rune', spellId: SAMPLE_SHOP_SPELL, context: 'shop',
    anchor: runeAnchor && runeAnchor.width > 0 ? runeAnchor : standIn(panelEl, 0, 64, 64),
  });
  const minion = document.querySelector('[data-zone="warband"] .row .card[data-uid]')
    ?? document.querySelector('.unit[data-uid]')
    ?? document.querySelector('[data-uid]');
  const minionAnchor = minion ? anchorOfElement(minion) : null;
  showCastPreview({
    sourceKey: 'tuner:minion', spellId: SAMPLE_COMBAT_SPELL, context: 'combat',
    anchor: minionAnchor && minionAnchor.width > 0 ? minionAnchor : standIn(panelEl, 260, 120, 150),
  });
}

export const SPEC: TunerSpec<CastPreviewConfig> = {
  ...BASE_SPEC,
  actions: [{ label: '▶ Preview test', run: (panelEl) => fireCastPreviewSamples(panelEl) }],
};

export function CastPreviewTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
