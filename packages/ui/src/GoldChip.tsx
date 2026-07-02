import { CONFIG, boardManaBonus } from '@game/sim';
import { Icon } from './Icon';
import { useGame } from './store';

/**
 * The Gold counter (shown as "Gold"; the currency is `embers` internally). Lives at the LEFT of the shop
 * control frame — opposite the End Turn button — so the round's resources bracket the shop. Hovering shows the
 * projected starting Gold for the next two waves. (Moved here from the bottom StatusBar.)
 */
export function GoldChip() {
  const run = useGame((s) => s.run);
  // Projected starting Gold for the next two waves (cap-aware), plus board mana income (Money Bot) and the
  // Hoarder one-turn bank folded into Wave+1.
  const manaBonus = boardManaBonus(run);
  const nextEmbers =
    Math.max(run.maxEmbers, Math.min(CONFIG.embersCap, run.maxEmbers + CONFIG.embersPerWave)) + manaBonus + (run.bonusEmbersNextTurn ?? 0);
  const afterEmbers = Math.max(run.maxEmbers, Math.min(CONFIG.embersCap, run.maxEmbers + 2 * CONFIG.embersPerWave)) + manaBonus;
  return (
    <div className="chip g mana">
      <span className="ic"><Icon name="mana" /></span>
      <div>
        <div className="v">{run.embers}</div>
        <div className="l">Gold</div>
      </div>
      {/* hover: how much Gold you'll start the next two waves with (cascading up) */}
      <div className="emberproj" role="tooltip">
        <div className="ept">Gold · coming up</div>
        <div className="epr"><span>Wave {run.wave + 2}</span><b><Icon name="mana" />{afterEmbers}</b></div>
        <div className="epr"><span>Wave {run.wave + 1}</span><b><Icon name="mana" />{nextEmbers}</b></div>
      </div>
    </div>
  );
}
