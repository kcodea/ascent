import type { CSSProperties } from 'react';
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

  // The "dense" grid (Practice — every hero) balances the roster into as few rows as read well, then sizes each
  // card as a fraction of the container so EXACTLY `cols` fit per row (the short last row auto-centers). This
  // beats flex-wrap's greedy packing, which stranded a sparse trailing row (e.g. 19 + 4) and wasted the space.
  const dense = choices.length > 6;
  const rows = choices.length > 24 ? 3 : 2;
  const cols = Math.ceil(choices.length / rows);
  const rowStyle = dense ? ({ '--hs-cols': cols } as CSSProperties) : undefined;

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
        <div className={`hsrow${dense ? ' dense' : ''}`} style={rowStyle}>
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
