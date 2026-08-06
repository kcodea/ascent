import { BlurFilter, Container, Graphics } from 'pixi.js';
import { syncArcs, type ArcEntry, type ArcMarker, type ArcOps } from './alignmentArcSync';
import { getAlignArcConfig } from './alignArcConfig';

/**
 * ── THE CELESTIAL ALIGNMENT ARC (Codex handoff, 2026-08-05) ─────────────────────────────────────────────
 *
 * A narrow luminous crescent beneath each Celestial: Dawn, Eclipse, Dusk. Deliberately NOT the pool of light
 * drafted earlier — the brief is a line that communicates position at a glance while staying subordinate to
 * combat and card FX, which a big aura does not.
 *
 * It draws the same curve three times: a thick blurred stroke for bloom, a saturated stroke for the readable
 * line, and a 1px white stroke for the energised centre. The card conceals the top of the arc, so it reads as
 * wrapping beneath the frame.
 *
 * ARCHITECTURE
 * - Renders into the `under` Pixi slot (`pixiFx.mountLayer(c, 'under')`) — a second canvas parked BELOW the
 *   DOM cards. "Beneath the cards" is a DOM z-index question, so it cannot be a container on the main stage.
 * - PERSISTENT and state-driven, not a fire-and-forget authored effect: one layer, one node per card uid.
 * - ONE shared `BlurFilter` on a single glow container — not one filter per minion, which would be one blur
 *   pass per card.
 *
 * THE IDLE TRAP (not in the handoff, found while reading `pixiFx`): the under canvas has its ticker STOPPED
 * and is rendered by the main app's ticker, which idles the moment nothing has live work. A static arc is
 * exactly what we want for cost, but it means a `sync()` that changes something must WAKE the renderer or
 * the change never presents — arcs correct on mount, stale after a drag. `requestPresent` below is that
 * wake: a one-shot updater that removes itself after a couple of frames, so the board returns to idle.
 */

type ArcNode = { glow: Graphics; core: Graphics; highlight: Graphics };

/** Trace the crescent: a shallow bezier that dips below the card's base and lifts at both ends. */
function traceArc(g: Graphics, width: number, depth: number): Graphics {
  const half = width * 0.5;
  return g.moveTo(-half, -2).bezierCurveTo(-half * 0.55, depth, half * 0.55, depth, half, -2);
}

export class AlignmentArcLayer {
  readonly container = new Container();

  private readonly glowLayer = new Container();
  private readonly coreLayer = new Container();
  private readonly entries = new Map<string, ArcEntry<ArcNode>>();
  private readonly ops: ArcOps<ArcNode>;

  constructor() {
    const cfg = getAlignArcConfig();
    // ONE filter for every glow stroke on the board — the handoff's explicit requirement, and the difference
    // between one blur pass and seven.
    this.glowLayer.filters = [new BlurFilter({ strength: cfg.blur, quality: 2 })];
    // No container-level blendMode: in Pixi v8 that requires promoting the container to a render group,
    // and the per-graphic setting below is both sufficient and cheaper to reason about.
    this.container.addChild(this.glowLayer, this.coreLayer);

    this.ops = {
      create: () => {
        const node: ArcNode = { glow: new Graphics(), core: new Graphics(), highlight: new Graphics() };
        // PLAIN alpha blending, on purpose. The handoff suggested additive, but the board art is LIGHT
        // stone — additive clipped the arcs toward white and they vanished into it. The owner dialled the
        // shipped look (2026-08-06) against normal blending, including a near-black Dusk that additive
        // could never show at all.
        this.glowLayer.addChild(node.glow);
        this.coreLayer.addChild(node.core, node.highlight);
        return node;
      },
      destroy: (_id, node) => {
        this.glowLayer.removeChild(node.glow);
        this.coreLayer.removeChild(node.core, node.highlight);
        node.glow.destroy();
        node.core.destroy();
        node.highlight.destroy();
      },
      redraw: (node, width) => {
        const c = getAlignArcConfig();
        node.glow.clear();
        traceArc(node.glow, width, c.depth).stroke({ color: 0xffffff, width: c.glowStroke, alpha: 0.8, cap: 'round' });
        node.core.clear();
        traceArc(node.core, width, c.depth).stroke({ color: 0xffffff, width: c.coreStroke, alpha: 0.95, cap: 'round' });
        node.highlight.clear();
        traceArc(node.highlight, width, c.depth).stroke({ color: 0xffffff, width: 1, alpha: 0.7, cap: 'round' });
      },
      place: (node, m) => {
        const c = getAlignArcConfig();
        const intensity = m.emphasized ? c.emphasis : 1;
        for (const g of [node.glow, node.core, node.highlight]) g.position.set(m.x, m.y);
        // Strokes are drawn WHITE and tinted here, so a colour change is a property write rather than a
        // re-trace of the geometry.
        node.glow.tint = m.color;
        node.core.tint = m.color;
        node.glow.alpha = Math.min(1, c.glowAlpha * intensity);
        node.core.alpha = Math.min(1, c.coreAlpha * intensity);
        node.highlight.tint = 0xffffff;
        node.highlight.alpha = Math.min(1, (m.emphasized ? c.highlightAlpha * 1.6 : c.highlightAlpha));
      },
    };
  }

  /** Reconcile against the resolved markers. Returns true when something actually changed, so the caller can
   *  skip waking an idle renderer for a no-op. */
  sync(markers: readonly ArcMarker[]): boolean {
    const r = syncArcs(this.entries, markers, this.ops);
    return r.created + r.destroyed + r.redrawn > 0 || r.placed > 0;
  }

  /** Re-read the blur dial (the tuner changed it). Cheap: one filter, rebuilt only on demand. */
  refreshBlur(): void {
    this.glowLayer.filters = [new BlurFilter({ strength: getAlignArcConfig().blur, quality: 2 })];
  }

  destroy(): void {
    this.entries.clear();
    this.container.destroy({ children: true });
  }
}
