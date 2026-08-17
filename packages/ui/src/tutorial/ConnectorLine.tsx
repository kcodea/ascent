/**
 * TUTORIAL — the connector line.
 *
 * A single SVG line between two cached anchor rects: a drag hint (source → dest, dashed with an arrowhead), a
 * causal trail, an adjacency seam, or an order arrow. Full-screen `fixed; inset:0; pointer-events:none` so it
 * overlays without stealing input. Both rects are passed in (measured once upstream) — no layout reads here.
 */

import type { TutorialConnector } from '@game/sim';

/** The point on a rect we anchor a connector to — its centre. Edge trimming toward the far point keeps the
 *  line/arrow off the middle of the box so it reads as pointing AT the target, not through it. */
function centre(rect: DOMRect): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** Pull the endpoint from the centre toward the other point until it sits on the rect's padded edge, so the
 *  arrowhead lands just outside the box rather than at its centre. */
function edgePoint(rect: DOMRect, toward: { x: number; y: number }, pad = 6): { x: number; y: number } {
  const c = centre(rect);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const halfW = rect.width / 2 + pad;
  const halfH = rect.height / 2 + pad;
  // Scale the direction vector to the nearest rect edge.
  const scale = 1 / Math.max(Math.abs(dx) / halfW, Math.abs(dy) / halfH);
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}

export function ConnectorLine({
  from,
  to,
  style,
  label,
}: {
  from: DOMRect;
  to: DOMRect;
  style: TutorialConnector['style'];
  label?: string;
}): JSX.Element {
  const fromC = centre(from);
  const toC = centre(to);
  const start = edgePoint(from, toC);
  const end = edgePoint(to, fromC);
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };

  const isDrag = style === 'drag';
  const arrowId = 'tut-connector-arrow';

  return (
    <div className="tut-connector" aria-hidden="true">
      <svg className="tut-connector-svg" width="100%" height="100%" preserveAspectRatio="none">
        <defs>
          <marker
            id={arrowId}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" className="tut-connector-arrowhead" />
          </marker>
        </defs>
        <line
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          className={`tut-connector-line ${isDrag ? 'drag' : 'solid'}`}
          strokeDasharray={isDrag ? '7 6' : undefined}
          markerEnd={isDrag ? `url(#${arrowId})` : undefined}
        />
        {label && (
          <g>
            <rect
              className="tut-connector-label-bg"
              x={mid.x - 40}
              y={mid.y - 12}
              width={80}
              height={20}
              rx={6}
              ry={6}
            />
            <text className="tut-connector-label" x={mid.x} y={mid.y + 2} textAnchor="middle">
              {label}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
