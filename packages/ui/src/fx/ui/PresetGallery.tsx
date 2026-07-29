import { useEffect, useMemo, useRef, useState } from 'react';
import { presetTable } from '../presets';

export interface PresetGalleryProps {
  /** Fired with (archetypeId, variantId) when the author picks a variant. */
  onPick: (archetypeId: string, variantId: string) => void;
  /**
   * Hover preview. Passes the IDS, never a constructed def id — the Workbench owns `<base>--<variant>` id
   * construction in exactly one place (`materialiseVariant`). Building it here too would be two spellings of
   * one rule. `variantId === null` means "stop previewing".
   */
  onPreview: (archetypeId: string, variantId: string | null) => void;
  onClose: () => void;
}

/** Hover settle before a preview fires — the same guard `LibraryBrowser` uses, for the same reason: sweeping
 *  the pointer across the variant row would otherwise start one effect per button passed over. */
const PREVIEW_DELAY_MS = 120;

export function PresetGallery({ onPick, onPreview, onClose }: PresetGalleryProps): React.ReactElement {
  // Cached inside `presetTable()` already; memoised here so the parse (which THROWS on a malformed file) is
  // touched once per open and the render stays a pure read.
  const table = useMemo(() => presetTable(), []);
  // The id, not the object: the selection has to survive any future re-parse of the table, and an object
  // identity comparison would silently stop matching.
  const [openId, setOpenId] = useState<string | null>(null);
  const open = table.archetypes.find((a) => a.id === openId) ?? null;

  // A ref, not state: the handle is only read inside handlers, so keeping it in state would re-render the
  // whole grid on every hover for no benefit.
  const hoverTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    // A pending preview must not fire after the overlay is gone.
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
  }, []);

  const hover = (archetypeId: string, variantId: string | null): void => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    if (variantId === null) { hoverTimerRef.current = null; onPreview(archetypeId, null); return; }
    hoverTimerRef.current = window.setTimeout(() => onPreview(archetypeId, variantId), PREVIEW_DELAY_MS);
  };

  const pick = (archetypeId: string, variantId: string): void => {
    hover(archetypeId, null);
    onPick(archetypeId, variantId);
  };

  return (
    <div className="fxgallery">
      <div className="fxgallery-h">
        <span className="fxgallery-title">Start a new effect</span>
        <button className="fxwb-btn" onClick={onClose}>Close</button>
      </div>

      <div className="fxgallery-body">
        {/* An empty table renders an empty grid — indistinguishable from "the button isn't wired yet", which
            is this subsystem's signature failure. Say it out loud instead. */}
        {table.archetypes.length === 0 ? (
          <p className="fxgallery-empty">
            No archetypes in <code>presets.json</code> — nothing to start from.
          </p>
        ) : (
          <>
            <div className="fxgallery-grid">
              {table.archetypes.map((a) => (
                <button
                  key={a.id}
                  className={`fxgallery-card${openId === a.id ? ' on' : ''}`}
                  onClick={() => setOpenId(openId === a.id ? null : a.id)}
                >
                  <span className="fxgallery-icon">{a.icon}</span>
                  <span className="fxgallery-name">{a.label}</span>
                  <span className="fxgallery-blurb">{a.blurb}</span>
                </button>
              ))}
            </div>

            {open !== null && (
              <div className="fxgallery-variants">
                <div className="fxgallery-variants-title">{open.label} — pick a flavour</div>
                {open.variants.length === 0 ? (
                  <p className="fxgallery-empty">
                    <code>{open.id}</code> lists no variants — it can only be started from as-is.
                  </p>
                ) : (
                  <div className="fxgallery-variant-row">
                    {open.variants.map((v) => {
                      const axis = table.variantAxes.find((x) => x.id === v);
                      return (
                        <button
                          key={v}
                          className="fxgallery-variant"
                          onPointerEnter={() => hover(open.id, v)}
                          onPointerLeave={() => hover(open.id, null)}
                          onClick={() => pick(open.id, v)}
                        >
                          {axis?.label ?? v}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
