import { TipPanel } from './TipPanel';
import { SPEC } from './tooltipConfig';
import { TunerPanel } from './TunerPanel';

/** A pinned sample of each tip shape, drawn with the live tokens, so a dial's effect shows without hunting for a
 *  hover. Static markup: the dials change CSS variables, and these samples repaint with every tooltip in the game. */
function TooltipPreview(): JSX.Element {
  return (
    <div className="tipsamples">
      <TipPanel title="Aegis" pills={['once per turn']}>
        Give a friendly minion <b>Ward</b>, then give your minions with <b>Ward +5 Attack</b>.
      </TipPanel>
      <TipPanel title="Rune of Ashen Payroll" pills={['Rune · active']}>
        Gain <b>1 Gold</b> next turn for each <b>Imp</b> you summon in combat.
      </TipPanel>
      <TipPanel simple arrow="up">Upgrade Shop to tier 2</TipPanel>
    </div>
  );
}

/**
 * DEV tuner for the shared TOOLTIP look (owner ask 2026-10-02): title, body, pill and one-line text sizes, line
 * height, max width and padding, applied live to every tooltip through the `--atip-*` custom properties. Values
 * persist in DEV only; Copy values gives the JSON to bake into `tooltipConfig.ts` DEFAULTS and tooltips.css.
 */
export function TooltipTuner(): JSX.Element {
  return <TunerPanel spec={{ ...SPEC, readout: () => <TooltipPreview /> }} />;
}
