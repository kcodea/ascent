import { useState } from 'react';
import { Icon } from './Icon';
import { TipPanel } from './TipPanel';
import { SPEC, UI_THEMES, UI_THEME_GROUPS, UI_THEME_LABELS, getUiThemeConfig, setUiTheme } from './uiThemeConfig';
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

/** Every theme as a small swatch, one row per colour group, so sixty themes can be browsed at a glance: the plate
 *  gradient inside the theme's edge colour, with a dot of its title and highlight colours. Click one to apply it (the
 *  same path as the dropdown). Colour only, from the registry; nothing animates. */
function ThemeSwatches({ onPick }: { onPick: () => void }): JSX.Element {
  const current = getUiThemeConfig().theme;
  return (
    <div className="uitswatches">
      {UI_THEME_GROUPS.map((g) => (
        <div className="uitswatch-group" key={g.label}>
          <span className="uitswatch-label">{g.label}</span>
          <div className="uitswatch-row">
            {g.options.map((id) => {
              const t = UI_THEMES[id];
              return (
                <button
                  type="button"
                  key={id}
                  className={`uitswatch${id === current ? ' on' : ''}`}
                  aria-label={UI_THEME_LABELS[id]}
                  aria-pressed={id === current}
                  style={{ background: `linear-gradient(180deg, ${t.plateTop}, ${t.plateBot})`, borderColor: t.edgeMain }}
                  onClick={() => { setUiTheme(id); onPick(); }}
                >
                  <i style={{ background: t.title }} />
                  <i style={{ background: t.hl }} />
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <span className="uitswatch-name">{UI_THEME_LABELS[current]}</span>
    </div>
  );
}

/**
 * DEV tuner for the UI THEME (owner asks 2026-10-02 + 2026-10-03): sixty colour themes for the tooltips and every Gem
 * plate HUD pill at once, in colour-scheme groups (the dropdown's optgroups and the swatch grid). One switch rewrites
 * the shared `--ui-*` tokens on `:root` (uiThemeConfig.ts); no element re-renders. Copy values gives the bake-ready
 * `:root` block for uiTheme.css.
 */
export function UiThemeTuner(): JSX.Element {
  const [, bump] = useState(0);
  const repaint = (): void => bump((n) => n + 1);
  return (
    <TunerPanel
      spec={{
        ...SPEC,
        readout: () => (
          <>
            <ThemePreview />
            <ThemeSwatches onPick={repaint} />
          </>
        ),
      }}
    />
  );
}
