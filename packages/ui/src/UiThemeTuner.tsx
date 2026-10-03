import { useState } from 'react';
import { Icon } from './Icon';
import { TipPanel } from './TipPanel';
import {
  SPEC, UI_THEMES, UI_THEME_GROUPS, UI_THEME_LABELS, UI_THEME_TIERS, getUiThemeConfig, getUiThemeShortlist, isUiThemeShortlisted, setUiTheme,
  toggleUiThemeShortlist, type UiThemeId,
} from './uiThemeConfig';
import { TunerPanel } from './TunerPanel';

export { SPEC } from './uiThemeConfig';

/** A pinned sample of the themed chrome, side by side: a tooltip, a name pill, a Health pill with Armor and a button.
 *  Static markup painted from the live `--ui-*` tokens, so switching the theme repaints it with everything else. */
function ThemePreview(): JSX.Element {
  return (
    <div className="uitsamples">
      <TipPanel title="Aegis" pills={['once per turn']}>
        Give a friendly minion <b>Ward</b>, then give your minions with <b>Ward +5 Attack</b>.
      </TipPanel>
      <div className="uitsamples-row">
        <span className="uitsample-name">Coran</span>
        <span className="uitsample-hp">
          <Icon name="heartPill" />
          30
          <b className="hudpill-arm"><Icon name="armor" />5</b>
        </span>
        <button type="button" className="uitsample-btn"><Icon name="sword" />Skip</button>
      </div>
    </div>
  );
}

type SwatchFilter = 'all' | 'basic' | 'shortlist';
const FILTERS: readonly { id: SwatchFilter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'basic', label: 'Basic' }, { id: 'shortlist', label: 'Shortlisted' },
];

/** Every theme as a small swatch, one row per colour group, so ninety themes can be browsed at a glance: the plate
 *  gradient inside the theme's edge colour, with a dot of its title and highlight colours. Click one to apply it (the
 *  same path as the dropdown); Shift+click stars it for the shortlist (a gold star marks starred swatches). The filter
 *  narrows the grid to the Basic themes or the shortlist. Colour only, from the registry; nothing animates. */
function ThemeSwatches({ onPick, filter, setFilter }: { onPick: () => void; filter: SwatchFilter; setFilter: (f: SwatchFilter) => void }): JSX.Element {
  const current = getUiThemeConfig().theme;
  const starred = getUiThemeShortlist();
  const rows: readonly { label: string; options: readonly UiThemeId[] }[] =
    filter === 'basic' ? UI_THEME_GROUPS.filter((g) => g.options.every((id) => UI_THEME_TIERS[id] === 'basic'))
      : filter === 'shortlist' ? (starred.length ? [{ label: 'Shortlisted', options: starred }] : [])
        : UI_THEME_GROUPS;
  const swatch = (id: UiThemeId): JSX.Element => {
    const t = UI_THEMES[id];
    const star = isUiThemeShortlisted(id);
    return (
      <button
        type="button"
        key={id}
        className={`uitswatch${id === current ? ' on' : ''}`}
        aria-label={`${UI_THEME_LABELS[id]}${star ? ' (shortlisted)' : ''}`}
        aria-pressed={id === current}
        style={{ background: `linear-gradient(180deg, ${t.plateTop}, ${t.plateBot})`, borderColor: t.edgeMain }}
        onClick={(e) => { if (e.shiftKey) toggleUiThemeShortlist(id); else setUiTheme(id); onPick(); }}
      >
        <i style={{ background: t.title }} />
        <i style={{ background: t.hl }} />
        {star && <b aria-hidden="true">★</b>}
      </button>
    );
  };
  const on = isUiThemeShortlisted(current);
  return (
    <div className="uitswatches">
      <div className="uitswatch-filter" role="group" aria-label="Show themes">
        {FILTERS.map((f) => (
          <button type="button" key={f.id} className={filter === f.id ? 'on' : ''} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.id === 'shortlist' ? `${f.label} (${starred.length})` : f.label}
          </button>
        ))}
      </div>
      {rows.map((g) => (
        <div className="uitswatch-group" key={g.label}>
          <span className="uitswatch-label">{g.label}</span>
          <div className="uitswatch-row">{g.options.map(swatch)}</div>
        </div>
      ))}
      {filter === 'shortlist' && !starred.length && (
        <span className="uitswatch-empty">Nothing starred yet. Star the current theme below, or Shift+click a swatch.</span>
      )}
      <div className="uitswatch-current">
        <span className="uitswatch-name">{UI_THEME_LABELS[current]}</span>
        <button
          type="button"
          className={`uitstar${on ? ' on' : ''}`}
          aria-pressed={on}
          aria-label={on ? `Remove ${UI_THEME_LABELS[current]} from the shortlist` : `Add ${UI_THEME_LABELS[current]} to the shortlist`}
          onClick={() => { toggleUiThemeShortlist(current); onPick(); }}
        >
          {on ? '★ Shortlisted' : '☆ Shortlist'}
        </button>
      </div>
    </div>
  );
}

/**
 * DEV tuner for the UI THEME (owner asks 2026-10-02 + 2026-10-03): ninety colour themes for the tooltips and every
 * Gem plate HUD pill at once, in colour-scheme groups (the dropdown's optgroups and the swatch grid), with Basic on
 * top, a shortlist star per theme and an All / Basic / Shortlisted filter on the grid. One switch rewrites
 * the shared `--ui-*` tokens on `:root` (uiThemeConfig.ts); no element re-renders. Copy values gives the bake-ready
 * `:root` block for uiTheme.css.
 */
export function UiThemeTuner(): JSX.Element {
  const [, bump] = useState(0);
  const [filter, setFilter] = useState<SwatchFilter>('all');
  const repaint = (): void => bump((n) => n + 1);
  return (
    <TunerPanel
      spec={{
        ...SPEC,
        readout: () => (
          <>
            <ThemePreview />
            <ThemeSwatches onPick={repaint} filter={filter} setFilter={setFilter} />
          </>
        ),
      }}
    />
  );
}
