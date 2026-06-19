import { getHero } from '@game/sim';
import { heroArt } from './art';
import { Icon } from './Icon';
import { useGame } from './store';

/**
 * Pre-run hero picker. Shows whenever the store has `heroChoices` (first load + after a
 * game over). Picking one starts a fresh run as that hero. This is the first slice of the
 * eventual Title → Mode → Hero flow — a single store flag drives it, no router.
 */
export function HeroSelect() {
  const choices = useGame((s) => s.heroChoices);
  const pickHero = useGame((s) => s.pickHero);
  if (!choices) return null;

  return (
    <div className="heroselect">
      <div className="hsbox">
        <div className="eyebrow">Choose your champion</div>
        <h1 className="disp hstitle">THE ASCENT</h1>
        <div className="hsrow">
          {choices.map((id) => {
            const hero = getHero(id);
            const art = heroArt(hero.id);
            return (
              <button key={id} className="herocard" onClick={() => pickHero(id)}>
                <div className="hcart">
                  {art ? <img src={art} alt={hero.name} draggable={false} /> : <Icon name="anvil" />}
                </div>
                <div className="hcname">{hero.name}</div>
                <div className="hcpw">
                  <b>{hero.power.name}</b> · {hero.power.text}
                </div>
                <div className="hcblurb">{hero.blurb}</div>
                <div className="hcpick">Choose</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
