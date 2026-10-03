import { Icon } from './Icon';
import { TipPanel } from './TipPanel';
import { SPEC } from './uiThemeConfig';
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

/**
 * DEV tuner for the UI THEME (owner asks 2026-10-02 + 2026-10-03): eighteen colour themes for the tooltips and every Gem plate HUD
 * pill at once. One switch rewrites the shared `--ui-*` tokens on `:root` (uiThemeConfig.ts); no element
 * re-renders. Copy values gives the bake-ready `:root` block for uiTheme.css.
 */
export function UiThemeTuner(): JSX.Element {
  return <TunerPanel spec={{ ...SPEC, readout: () => <ThemePreview /> }} />;
}
