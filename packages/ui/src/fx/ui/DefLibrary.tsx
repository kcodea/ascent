import { useState } from 'react';
import { parseDef, type StoredFxDef } from '../defStore';

/**
 * The committed-def library: the read side of durable defs.
 *
 * Three ways a def gets INTO the editor, all of them landing on the same `onLoad`/`onDuplicate` callbacks so
 * the workbench owns the single "replace the editor state coherently" path (see `FxWorkbench.loadDef`):
 *
 * - **Load** — click a row; the editor becomes that def, named after it.
 * - **Duplicate** — same load, but the name field is pre-filled `<id>-copy`. This is the TEMPLATE workflow and
 *   it deliberately writes nothing: no file exists until the author hits Save. (So "duplicate" costs nothing
 *   if you change your mind, and can't clobber the original by accident.)
 * - **Paste def** — the missing counterpart to Copy def. Reads the clipboard (which can reject: a denied
 *   permission, a non-focused document, a browser without the API) or, failing that, a textarea you can paste
 *   into by hand. Both run the JSON through `parseDef`, which validates + coerces and returns null rather
 *   than throwing.
 *
 * Deleting is deliberately absent — no endpoint exists for it, and a button that pretends to delete a
 * git-tracked file would be a lie. Defs are removed with `git rm`.
 */
export function DefLibrary({
  defs,
  onLoad,
  onDuplicate,
}: {
  defs: StoredFxDef[];
  /** Load this def into the editor, named after itself. */
  onLoad: (def: StoredFxDef) => void;
  /** Load this def into the editor as an unsaved copy (name pre-filled `<id>-copy`). */
  onDuplicate: (def: StoredFxDef) => void;
}): React.ReactElement {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadJson = (json: string): boolean => {
    const def = parseDef(json);
    if (def === null) {
      // Leave the current work completely alone — a bad paste is a message, not a state change.
      setError("That isn't a valid FX def.");
      return false;
    }
    setError(null);
    onLoad(def);
    return true;
  };

  const pasteFromClipboard = async (): Promise<void> => {
    let json: string;
    try {
      json = await navigator.clipboard.readText();
    } catch {
      // Permission denied / unfocused document / no API — fall back to the manual textarea.
      setError('Could not read the clipboard — paste the JSON below instead.');
      setPasteOpen(true);
      return;
    }
    if (loadJson(json)) {
      setPasteOpen(false);
      setPasteText('');
    }
  };

  return (
    <div className="fxwb-deflib">
      <h3 className="fxwb-def-head">Library</h3>
      {defs.length === 0 ? (
        <div className="fxwb-def-empty">No saved defs yet — tune an effect and hit Save.</div>
      ) : (
        <div className="fxwb-def-list">
          {defs.map((def) => (
            <div className="fxwb-def-row" key={def.id}>
              <button
                type="button"
                className="fxwb-def-load"
                title={`Load '${def.id}' into the editor`}
                onClick={() => {
                  setError(null);
                  onLoad(def);
                }}
              >
                <span className="fxwb-def-name">{def.id}</span>
                <span className="fxwb-def-meta">
                  {def.layers.length} layer{def.layers.length === 1 ? '' : 's'} · {def.duration} ms
                </span>
              </button>
              <span className="fxwb-def-actions">
                <button
                  type="button"
                  title={`Duplicate '${def.id}' as a template (nothing is written until you Save)`}
                  aria-label={`Duplicate ${def.id}`}
                  onClick={() => {
                    setError(null);
                    onDuplicate(def);
                  }}
                >
                  ⧉
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="fxwb-def-pasterow">
        <button type="button" className="fxwb-def-paste" onClick={() => void pasteFromClipboard()}>
          Paste def
        </button>
        <button
          type="button"
          className="fxwb-def-paste-toggle"
          title={pasteOpen ? 'Hide the manual paste box' : 'Paste JSON by hand instead'}
          aria-expanded={pasteOpen}
          onClick={() => setPasteOpen((open) => !open)}
        >
          {pasteOpen ? '▾' : '▸'}
        </button>
      </div>
      {pasteOpen && (
        <div className="fxwb-def-pastebox">
          <textarea
            className="fxwb-def-pastearea"
            aria-label="Def JSON"
            placeholder="Paste def JSON here…"
            spellCheck={false}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <button
            type="button"
            className="fxwb-def-paste"
            disabled={pasteText.trim() === ''}
            onClick={() => {
              if (loadJson(pasteText)) {
                setPasteOpen(false);
                setPasteText('');
              }
            }}
          >
            Load pasted def
          </button>
        </div>
      )}
      {error !== null && <div className="fxwb-def-err">{error}</div>}
    </div>
  );
}
