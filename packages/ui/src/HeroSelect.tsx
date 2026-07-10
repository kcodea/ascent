import { getHero } from '@game/sim';
import { heroArt } from './art';
import { Icon } from './Icon';
import { sfx } from './sfx';
import { useGame } from './store';

/**
 * Pre-run hero picker. Shows whenever the store has `heroChoices` (first load + after a
 * game over). Picking one starts a fresh run as that hero. This is the first slice of the
 * eventual Title → Mode → Hero flow — a single store flag drives it, no router.
 */
export function HeroSelect() {
  const choices = useGame((s) => s.heroChoices);
  const pickHero = useGame((s) => s.pickHero);
  const openTitle = useGame((s) => s.openTitle);
  const mode = useGame((s) => s.pendingMode);
  const profile = useGame((s) => s.profile);
  if (!choices) return null;

  return (
    <div className="heroselect">
      <button className="hsback" onClick={() => { sfx.pulse(); openTitle(); }}>← Back</button>
      <div className="hsbox">
        <div className="eyebrow">Choose your champion</div>
        <h1 className="disp hstitle">THE ASCENT</h1>
        {/* Run-start telegraph (ascent only): your rating-derived Line — the wins this run is expected to
            cover. Practice is unscored, so it's hidden there. */}
        {mode === 'ascent' && (
          <div className="hsline" aria-label="Your Line for this run">
            <span className="hsline-rat">Rating {profile.rating}</span>
            <span className="hsline-line">Line {profile.currentLine}</span>
            <span className="hsline-note">Cover {profile.currentLine} wins · Strong {profile.currentLine + 2}+</span>
          </div>
        )}
        {/* Naming yourself now lives on the home screen (the account chip). Practice shows EVERY hero (20+), which
            overflows at the full card size — the `dense` grid shrinks the cards so they all fit without scrolling.
            Ascent only offers 3, so it keeps the big cards. */}
        <div className={`hsrow${choices.length > 6 ? ' dense' : ''}`}>
          {choices.map((id) => {
            const hero = getHero(id);
            const power = hero.power;
            const art = heroArt(hero.id);
            return (
              <button key={id} className="herocard" onClick={() => { sfx.pulse(); pickHero(id); }}>
                <div className="hcart">
                  {art ? <img src={art} alt={hero.name} draggable={false} /> : <Icon name="anvil" />}
                </div>
                <div className="hcname">{hero.name}</div>
                <div className="hchp" title="Starting Resolve (HP)">
                  <Icon name="heart" />
                  {hero.resolve}
                  {hero.armor > 0 && <span className="hcarmor" title="Starting Armor — extra effective HP on top of Resolve">+{hero.armor}</span>}
                </div>
                <div className="hcpw">
                  <b>{power.name}</b> · {power.text}
                </div>
                {power.unlockWave && power.unlockWave > 1 && (
                  <div className="hclock">Unlocks turn {power.unlockWave}</div>
                )}
                <div className="hcpick">Choose</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
