import { useEffect, useState } from 'react';
import { useGame } from './store';

/**
 * Font Lab (dev) — a bottom-right panel on the title menu for previewing typefaces live. Three roles map to
 * the `--font-title` / `--font-ui` / `--font-body` CSS variables the stylesheet now reads, so a pick reflows
 * the whole app instantly. Choices persist to localStorage and are applied at boot (below), so the preview
 * survives reloads. Purely a design tool — no gameplay effect.
 */
const FONTS = ['Outfit', 'Sora', 'Plus Jakarta Sans', 'Nunito Sans'] as const;
const ROLES = [
  { key: 'title', cssVar: '--font-title', label: 'Titles', fallback: 'Outfit' },
  { key: 'ui', cssVar: '--font-ui', label: 'UI / Labels', fallback: 'Outfit' },
  { key: 'body', cssVar: '--font-body', label: 'Body / Text', fallback: 'Nunito Sans' },
] as const;

type FontChoices = Partial<Record<(typeof ROLES)[number]['key'], string>>;

function loadFonts(): FontChoices {
  try { return JSON.parse(localStorage.getItem('ascent.fonts') || '{}') as FontChoices; } catch { return {}; }
}
function applyFonts(fonts: FontChoices): void {
  for (const r of ROLES) {
    document.documentElement.style.setProperty(r.cssVar, `'${fonts[r.key] ?? r.fallback}', sans-serif`);
  }
}
// Apply the persisted choice at module load, before React mounts — so a saved font is live on every screen,
// not just once the title's panel has rendered.
applyFonts(loadFonts());

export function FontLab() {
  const onTitle = useGame((s) => s.showTitle);
  const [fonts, setFonts] = useState<FontChoices>(loadFonts);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    applyFonts(fonts);
    try { localStorage.setItem('ascent.fonts', JSON.stringify(fonts)); } catch { /* ignore */ }
  }, [fonts]);
  // Fonts are already applied by the effect above; the panel itself only shows on the menu.
  if (!onTitle) return null;
  const set = (key: string, val: string): void => setFonts((f) => ({ ...f, [key]: val }));
  return (
    <div className="fontlab">
      {open && (
        <div className="fontlab-panel">
          <div className="fontlab-title">Font Lab · dev</div>
          {ROLES.map((r) => (
            <label className="fontlab-row" key={r.key}>
              <span>{r.label}</span>
              <select value={fonts[r.key] ?? r.fallback} onChange={(e) => set(r.key, e.target.value)} style={{ fontFamily: `'${fonts[r.key] ?? r.fallback}', sans-serif` }}>
                {FONTS.map((f) => <option key={f} value={f} style={{ fontFamily: `'${f}', sans-serif` }}>{f}</option>)}
              </select>
            </label>
          ))}
          <button className="fontlab-reset" onClick={() => setFonts({})}>Reset to default</button>
        </div>
      )}
      <button className="fontlab-toggle" onClick={() => setOpen((o) => !o)} title="Preview fonts (dev)">Aa</button>
    </div>
  );
}
