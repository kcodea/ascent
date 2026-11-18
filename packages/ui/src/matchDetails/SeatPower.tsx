import { memo, type CSSProperties } from 'react';
import { ANCIENTS, getHero, type MatchAncient } from '@game/sim';
import { heroPowerArt } from '../art';
import { mdBold } from '../Card';
import { AncientFace } from '../ancients/AncientFace';
import { AncientSplitStatic } from '../ancients/AncientMeter';
import { FoeAncientLine } from '../ancients/FoeAncientLine';
import { ancientColor } from '../ancients/ancientsConfig';

/**
 * A FINISHED GAME'S HERO POWER, WITH ITS ANCIENT (R-RESULTS-ANCIENT-01, owner 2026-11-18: "we need results to now show
 * the hero power w/ the ancient selected as well so players can see what ancient was selected").
 *
 * The in-game look, still: the round power art (`.heropowerbtn` + `.hpb-art`), cracked open with the picked Ancient's
 * half (`AncientSplitStatic`, the face the live button settles on), then the power's name and the Ancient's name in its
 * colour. Hover / focus shows the hero-power tip (`.herotip`): the power's name with the Ancient tag, the base power text
 * and the Ancient's pairing text (`FoeAncientLine`, the line a foe's power tip and the scout card already print).
 *
 * Static on purpose, as every other player's power is shown: a record is a still picture of a finished run, so there is
 * no live number to fold in. No Ancient (a game from before Ancients, or one that ended before the pick) = the plain power.
 * An unknown hero id renders nothing, so an old or odd record never breaks the page.
 */
export const SeatPower = memo(function SeatPower({ heroId, ancient, who }: { heroId: string | undefined; ancient?: MatchAncient | null; who: string }) {
  if (!heroId) return null;
  const power = getHero(heroId)?.power;
  if (!power) return null;
  const art = heroPowerArt(heroId);
  const def = ancient ? ANCIENTS[ancient.id] : undefined;
  const anc = def ? ancient! : undefined;
  const label = `${who}'s hero power: ${power.name}${def ? `, with the ${def.name}` : ''}`;
  return (
    // A focusable plate (not a button: it does nothing), so the tip opens from the keyboard too. No title= tooltip.
    <span className="rgp-power" tabIndex={0} aria-label={label}>
      <span className="heropowerbtn rgp-power-disc" aria-hidden="true">
        <span className="hpb-artwrap">{art && <img decoding="sync" className="hpb-art" src={art} alt="" draggable={false} />}</span>
        {anc && <AncientSplitStatic id={anc.id} />}
      </span>
      <span className="rgp-power-txt" aria-hidden="true">
        <span className="rgp-power-name">{power.name}</span>
        {anc && def && (
          <span className="rgp-power-anc" style={{ '--anc-c': ancientColor(anc.id) } as CSSProperties}>
            <span className="anc-pill-dot" />{def.name}
          </span>
        )}
      </span>
      <span className="herotip rgp-power-pop" role="tooltip">
        <span className="herotip-head">
          <b>{power.name}</b>
          {anc && def && <span className="herotip-anc" style={{ color: ancientColor(anc.id) }}>({def.name.replace(/^Ancient of /, '')})</span>}
          {power.passive && <span className="herotip-tag">passive</span>}
        </span>
        <span className="herotip-rule" dangerouslySetInnerHTML={{ __html: mdBold(power.text) }} />
        <FoeAncientLine ancient={anc} />
      </span>
    </span>
  );
});

/** A lobby tile's small Ancient badge on the hero portrait: the Ancient's round power face. Nothing without a pick. */
export const SeatAncientBadge = memo(function SeatAncientBadge({ ancient }: { ancient?: MatchAncient | null }) {
  if (!ancient || !ANCIENTS[ancient.id]) return null;
  return (
    <span className="lp-tile-anc" style={{ '--anc-c': ancientColor(ancient.id) } as CSSProperties} aria-hidden="true">
      <AncientFace id={ancient.id} variant="power" />
    </span>
  );
});
