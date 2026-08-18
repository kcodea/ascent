/**
 * TUTORIAL — the overlay container (the ONE component the integration mounts).
 *
 * A pure presentational component: it receives a fully-computed `TutorialOverlayView` (rects already measured
 * and cached by the controller) and renders the focus mask, an optional connector line, and an optional coach
 * panel. It does NO measuring and reads NO store — the controller owns state and the anchor registry owns
 * measurement. Mount it once at the React root, above the other overlays.
 *
 * Returns null when `view` is null (tutorial inactive), so mounting it always is free.
 */

import { FocusMask, type FocusCutout } from './FocusMask';
import { ConnectorLine } from './ConnectorLine';
import { CoachPanel } from './CoachPanel';
import type { TutorialConnector, TutorialFocusMode } from '@game/sim';
import './tutorialCoach.css';

/** The fully-resolved view the controller hands the overlay each step. Every rect is already measured; the
 *  overlay just draws. */
export interface TutorialOverlayView {
  /** Spotlight holes (1 primary + up to a few secondaries). Empty = a dim scrim with no cutout. */
  cutouts: FocusCutout[];
  /** An optional line between two anchors (drag hint, causal trail). */
  connector?: { from: DOMRect; to: DOMRect; style: TutorialConnector['style']; label?: string };
  /** The coach panel copy + its anchor rect (null = centered foundation panel). */
  panel?: {
    anchorRect: DOMRect | null;
    title?: string;
    body: string;
    why?: string;
    focusMode?: TutorialFocusMode;
    keyword?: string;
    onNext?: () => void;
    nextLabel?: string;
    step?: number;
    total?: number;
  };
  /** Combat mode lowers the scrim so the board stays readable during a Predict/Confirm hold. */
  combat?: boolean;
  /** Override the base scrim opacity (defaults handled by FocusMask). */
  dim?: number;
}

export function TutorialOverlay({ view }: { view: TutorialOverlayView | null }): JSX.Element | null {
  if (!view) return null;
  const { cutouts, connector, panel, combat, dim } = view;

  return (
    <>
      <FocusMask cutouts={cutouts} dim={dim} combat={combat} />
      {connector && (
        <ConnectorLine
          from={connector.from}
          to={connector.to}
          style={connector.style}
          label={connector.label}
        />
      )}
      {panel && (
        <CoachPanel
          anchorRect={panel.anchorRect}
          title={panel.title}
          body={panel.body}
          why={panel.why}
          focusMode={panel.focusMode}
          keyword={panel.keyword}
          onNext={panel.onNext}
          nextLabel={panel.nextLabel}
          step={panel.step}
          total={panel.total}
        />
      )}
    </>
  );
}
