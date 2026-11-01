/**
 * VERSUS: THE OPPONENT'S HERO BLOCK (owner 2026-10-14: "MIRROR THE PLAYER'S OWN HERO BLOCK so the screen has one design
 * language"). No rail panel: the opponent sits on the right of the shop, its portrait centred on the board's vertical
 * middle, built the way your own block is:
 *  - the portrait in their skin, wearing their equipped portrait-frame cosmetic exactly as yours wears yours (owner
 *    2026-10-14: "just use the frame ... like the frame that the player has equipped. if they dont have one, use the
 *    default frame");
 *  - the name plate across the portrait's bottom rim (your hero-name pill) and the Health box under it: their Health
 *    and Armor exactly as your own box shows yours (owner 2026-10-26, R-VERSUS-HEALTH-01), with its hit treatment when a
 *    lost fight lands (the shake and the rising "-N", the number ticking down);
 *  - a small "Round N" plate above, centred on the block, with the round's max damage beside it (the lobby rail's MAX
 *    DMG chip, the same cap), and a labelled Guides plate under it.
 * What they are doing shows only when it matters (Locked in / Ready / Away / Disconnected), as a small gold-rimmed pill
 * under the Health box; shopping is the default and shows nothing. No round history here (owner 2026-10-14: "dont put the
 * round results under there") and no tier badge ("it is shown in the mouseover"): both live in the scout card. The
 * hero's name shows on hover; hovering the portrait opens the scout card, a click pins it.
 *
 * PERFORMANCE: static paint. One-shot feedback only (the Health hit, a shine across the portrait when they lock in, the
 * status pill's arrival), each a transform / opacity keyframe on a keyed element; nothing loops.
 */
import { memo, useEffect, useRef, useState } from 'react';
import { getHero, type LobbySeatState } from '@game/sim';
import { FoePortraitDisc } from '../FoePortraitDisc';
import { Icon } from '../Icon';
import { MenuMedal } from '../menuIcons';
import type { ResolvedFrame } from '../portraitFrame/portraitFrameConfig';
import { useGame } from '../store';
import { mySeat, useVersus } from './versusStore';
import { maxDamageLabel, maxDamageTip } from '../LobbyPanel';
import { useSpectate } from './spectate';

type Tone = 'ready' | 'away';

/** What the opponent is doing, when it matters (null while they are simply shopping or fighting). */
function useFoeStatus(): { label: string; tone: Tone } | null {
  const key = useVersus((s) => {
    const m = s.match;
    // A spectator reads it from the side of the player it is watching.
    const sp = useSpectate.getState();
    const seat = mySeat(m) ?? (sp.active ? sp.seat : null);
    if (!m || !seat || m.phase === 'complete') return '';
    const other = seat === 'p1' ? 'p2' : 'p1';
    if (m.paused_seat === other) return 'away|Disconnected';
    if (m[`${other}_auto`]) return 'away|Away';
    if (m.phase === 'shop' && m[`${other}_locked`]) return 'ready|Locked in';
    if (m.phase === 'combat' && m[`${other}_ready`]) return 'ready|Ready';
    return '';
  });
  if (!key) return null;
  const [tone, label] = key.split('|') as [Tone, string];
  return { tone, label };
}

/**
 * The Health and Armor on show, and a one-shot hit when they drop. Damage taken in a fight is shown when the block is
 * back on screen (it slides away for the fight): the numbers hold, then tick down with the hit, after the slide-in.
 */
function useShownPools(resolve: number, armor: number): { shown: { resolve: number; armor: number }; hit: { amt: number; key: number } | null } {
  const staged = useGame((s) => s.combatStaged);
  const [shown, setShown] = useState({ resolve, armor });
  const [hit, setHit] = useState<{ amt: number; key: number } | null>(null);
  const seq = useRef(0);
  const total = resolve + armor;
  const shownTotal = shown.resolve + shown.armor;
  useEffect(() => {
    if (resolve === shown.resolve && armor === shown.armor) return undefined;
    if (total >= shownTotal) { setShown({ resolve, armor }); return undefined; } // a new match (or Armor gained): no hit
    if (staged) return undefined; // off screen: hold the old numbers until it is back
    const t = window.setTimeout(() => {
      seq.current += 1;
      setHit({ amt: shownTotal - total, key: seq.current });
      setShown({ resolve, armor });
    }, HIT_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [resolve, armor, total, shown, shownTotal, staged]);
  useEffect(() => {
    if (!hit) return undefined;
    const t = window.setTimeout(() => setHit(null), 1000);
    return () => window.clearTimeout(t);
  }, [hit]);
  return { shown, hit };
}
/** The block's slide back in (`.app.staged .vsfoe`, 420 ms) settles before the hit lands. */
export const HIT_DELAY_MS = 420;

/** Bumps once each time the opponent becomes ready (Locked in / Ready), never on mount. */
function useReadyShine(ready: boolean): number {
  const prev = useRef(ready);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (ready && !prev.current) setN((x) => x + 1);
    prev.current = ready;
  }, [ready]);
  return n;
}

export interface VersusFoeProps {
  foe: LobbySeatState;
  art: string | undefined;
  /** Their equipped portrait-frame cosmetic, else the default portrait frame (resolved by the caller). */
  frame: ResolvedFrame | null;
  round: number;
  /** The round's loss cap (`roundLossCap`, Infinity = none): the rail's MAX DMG chip, shown beside the Round plate. */
  cap: number;
  /** Bumps when the cap steps up (the rail's one-shot pop). */
  capPop: number;
  /** Opens the Guides drawer. */
  onGuides: () => void;
  guidesOpen: boolean;
  /** The portrait's hover / pin handlers (the lobby's scout card). */
  faceProps: React.HTMLAttributes<HTMLDivElement>;
}

export const VersusFoe = memo(function VersusFoe({ foe, art, frame, round, cap, capPop, faceProps, onGuides, guidesOpen }: VersusFoeProps) {
  const status = useFoeStatus();
  const hero = getHero(foe.heroId)?.name ?? '';
  const { shown, hit } = useShownPools(foe.resolve, foe.armor);
  const shine = useReadyShine(status?.tone === 'ready');
  const capTip = maxDamageTip(cap);
  return (
    <div className={`vsfoe${guidesOpen ? ' guides-open' : ''}`} aria-label={`Your opponent: ${foe.label}, Health ${foe.resolve}${foe.armor > 0 ? `, Armor ${foe.armor}` : ''}`}>
      <div className="vsfoe-group">
        <div className="vsfoe-roundline">
          <div className="vsfoe-round hudpill-name">Round {round}</div>
          {/* The lobby rail's MAX DMG chip and tip (R-VERSUS-HEALTH-01: the same cap as a ranked game). */}
          <span key={capPop} className={`vsfoe-round vsfoe-max hudpill-name${capPop ? ' vsfoe-max-pop' : ''}`} aria-label={`${capTip.title}. ${capTip.rule}`}>
            <Icon name="heart" />{maxDamageLabel(cap)}
          </span>
          <span className="herotip lobbymax-tip" role="tooltip" aria-hidden="true">
            <b>{capTip.title}</b>
            <span className="herotip-rule">{capTip.rule}</span>
          </span>
        </div>
        <div className="vsfoe-face" data-seat={foe.id} {...faceProps}>
          <FoePortraitDisc art={art} gauntlet={false} frame={frame} extraClass=" vsfoe-disc">
            {shine > 0 && <span key={shine} className="vsfoe-shine" aria-hidden="true"><span /></span>}
            {hero && <span className="vsfoe-hero" aria-hidden="true">{hero}</span>}
          </FoePortraitDisc>
          <div className="vsfoe-name hudpill-name">{foe.label}</div>
        </div>
        <div className="vsfoe-hpwrap">
          <div className={`vsfoe-hp hudpill-hp${hit ? ' hit' : ''}`} key={hit ? `h${hit.key}` : 'h'}>
            <Icon name="heartPill" />
            <span className="hpval">{shown.resolve}{shown.armor > 0 && <b className="armval hudpill-arm"><Icon name="armor" /><span className="hp-armplus">+</span>{shown.armor}</b>}</span>
            {hit && <span className="resfx">−{hit.amt}</span>}
          </div>
          {status && <span key={status.label} className={`vsfoe-status ${status.tone}`}>{status.label}</span>}
        </div>
        {/* GUIDES (owner 2026-10-14: the rail tab "is a botch job"): Versus has no rail to flip, so the build guides open
            from their own labelled plate, under the block, as a drawer (LobbyPanel). */}
        <button type="button" className={`vsfoe-guides hudpill-name${guidesOpen ? ' on' : ''}`} aria-pressed={guidesOpen}
          aria-label={guidesOpen ? 'Close build guides' : 'Open build guides'} onClick={onGuides}>
          <MenuMedal name="guides" className="vsfoe-guides-ico" />Guides
        </button>
      </div>
    </div>
  );
});
