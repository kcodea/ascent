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
  const playerName = useGame((s) => s.playerName);
  const setPlayerName = useGame((s) => s.setPlayerName);
  const openTitle = useGame((s) => s.openTitle);
  if (!choices) return null;

  return (
    <div className="heroselect">
      <button className="hsback" onClick={() => { sfx.pulse(); openTitle(); }}>← Back</button>
      <div className="hsbox">
        <div className="eyebrow">Choose your champion</div>
        <h1 className="disp hstitle">THE ASCENT</h1>
        {/* Name yourself at run start — stamped on every board you build this run, so friends who face it
            see who made it (and when). Persisted, so it's pre-filled next time. */}
        <label className="hsname">
          <span>Your name</span>
          <input
            type="text"
            value={playerName}
            maxLength={24}
            placeholder="Anonymous"
            aria-label="Your name"
            onChange={(e) => setPlayerName(e.target.value)}
          />
        </label>
        <div className="hsrow">
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
