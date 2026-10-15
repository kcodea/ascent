/**
 * VERSUS: THE OPPONENT'S HERO BLOCK (owner 2026-10-14: "MIRROR THE PLAYER'S OWN HERO BLOCK so the screen has one design
 * language"). No rail panel: the opponent sits on the right of the shop, its portrait centred on the board's vertical
 * middle, built the way your own block is:
 *  - the portrait in their skin, wearing their equipped portrait-frame cosmetic exactly as yours wears yours (owner
 *    2026-10-14: "just use the frame ... like the frame that the player has equipped. if they dont have one, use the
 *    default frame");
 *  - the name plate across the portrait's bottom rim (your hero-name pill) and the heart pill under it (your heart pill,
 *    with your heart pill's hit treatment when they lose one: the shake and the rising "-1", the number ticking down);
 *  - a small "Round N" plate above, centred on the block, and a labelled Guides plate under it.
 * What they are doing shows only when it matters (Locked in / Ready / Away / Disconnected), as a small gold-rimmed pill
 * under the hearts; shopping is the default and shows nothing. No round history here (owner 2026-10-14: "dont put the
 * round results under there") and no tier badge ("it is shown in the mouseover"): both live in the scout card. The
 * hero's name shows on hover; hovering the portrait opens the scout card, a click pins it.
 *
 * PERFORMANCE: static paint. One-shot feedback only (the heart hit, a shine across the portrait when they lock in, the
 * status pill's arrival), each a transform / opacity keyframe on a keyed element; nothing loops.
 */
import { memo, useEffect, useRef, useState } from 'react';
import { getHero, type LobbySeatState } from '@game/sim';
import { FoePortraitDisc } from '../FoePortraitDisc';
import { Icon } from '../Icon';
import type { ResolvedFrame } from '../portraitFrame/portraitFrameConfig';
import { useGame } from '../store';
import { mySeat, useVersus } from './versusStore';
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
 * The hearts on show, and a one-shot hit when they drop. A heart lost in a fight is shown when the block is back on
 * screen (it slides away for the fight): the number holds, then ticks down with the hit, after the slide-in.
 */
function useShownHearts(hearts: number): { shown: number; hit: { amt: number; key: number } | null } {
  const staged = useGame((s) => s.combatStaged);
  const [shown, setShown] = useState(hearts);
  const [hit, setHit] = useState<{ amt: number; key: number } | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    if (hearts === shown) return undefined;
    if (hearts > shown) { setShown(hearts); return undefined; } // a new match: no hit
    if (staged) return undefined; // off screen: hold the old number until it is back
    const t = window.setTimeout(() => {
      seq.current += 1;
      setHit({ amt: shown - hearts, key: seq.current });
      setShown(hearts);
    }, HIT_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [hearts, shown, staged]);
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
  /** Opens the Guides drawer. */
  onGuides: () => void;
  guidesOpen: boolean;
  /** The portrait's hover / pin handlers (the lobby's scout card). */
  faceProps: React.HTMLAttributes<HTMLDivElement>;
}

export const VersusFoe = memo(function VersusFoe({ foe, art, frame, round, faceProps, onGuides, guidesOpen }: VersusFoeProps) {
  const status = useFoeStatus();
  const hero = getHero(foe.heroId)?.name ?? '';
  const { shown, hit } = useShownHearts(foe.resolve);
  const shine = useReadyShine(status?.tone === 'ready');
  return (
    <div className={`vsfoe${guidesOpen ? ' guides-open' : ''}`} aria-label={`Your opponent: ${foe.label}, ${foe.resolve} hearts`}>
      <div className="vsfoe-group">
        <div className="vsfoe-round hudpill-name">Round {round}</div>
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
            <span className="hpval">{shown}</span>
            {hit && <span className="resfx">−{hit.amt}</span>}
          </div>
          {status && <span key={status.label} className={`vsfoe-status ${status.tone}`}>{status.label}</span>}
        </div>
        {/* GUIDES (owner 2026-10-14: the rail tab "is a botch job"): Versus has no rail to flip, so the build guides open
            from their own labelled plate, under the block, as a drawer (LobbyPanel). */}
        <button type="button" className={`vsfoe-guides hudpill-name${guidesOpen ? ' on' : ''}`} aria-pressed={guidesOpen}
          aria-label={guidesOpen ? 'Close build guides' : 'Open build guides'} onClick={onGuides}>
          <Icon name="book" />Guides
        </button>
      </div>
    </div>
  );
});
