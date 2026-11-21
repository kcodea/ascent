import { memo, useEffect, useRef, type CSSProperties } from 'react';
import type { RunCosmeticSnapshot } from '@game/progression';
import { useProgression } from '../progression/progressionStore';
import { cosmeticShown, useCosmeticVisEpoch } from '../cosmetics/cosmeticVisibility';
import { TITLE_STYLES, titleLookOf, titleLookOfId, type TitleCustomStyle } from './titleStyle';

/**
 * THE ONE TITLE BADGE (owner ask 2026-09-28). Every surface that shows a player's title renders this.
 *
 * OUT-OF-GAME REVIEW SURFACES ONLY (owner review 2026-09-28: "it's too much on the lobby rail and looks out of place
 * other places too. i think it should show in like leaderboard/match details views, but it looks bad in game"):
 * the Leaderboard, the Hall of Champions, Match details and the Career. NEVER during a live run or a replay's
 * gameplay view (lobby rail, combat plates, Now Facing, your hero); `titles.test.tsx` pins that.
 *
 * For another player, pass their snapshot through the opponent cosmetics switch (`opponentSkins(show, …)`).
 *
 * Give it a recorded cosmetic snapshot (`snapshot`) or a bare title id (`id`). It renders NOTHING when the title is
 * unknown, retired or absent, so a caller never has to check. Colour is the title's rarity; a title with a custom
 * style in `TITLE_STYLES` paints its gradient (and an optional transform-only shimmer) instead. A hero title's MASTER
 * version is always the master look (`.tb-master`, owner pick 2026-10-28, replacing the 2026-09-29 golden plate): a
 * glowing pill with the name in an ice to violet gradient, a slow light sweep and a twinkling star. Both loops animate
 * transform/opacity only and stop under reduced motion.
 *
 * A THEMED title (`CosmeticDef.look`, the secret titles, owner ask 2026-11-20) paints its theme instead of its rarity: one
 * look per tribe or feat family (`.tb-look-<key>`), each carrying the shared secret seal.
 *
 * Memoised on its props. It subscribes only to the server kill switch's epoch, so a retire hides it everywhere at
 * once and nothing else re-renders it. Plain text: no native tooltip (owner rule), no own cursor.
 */
export interface TitleBadgeProps {
  snapshot?: RunCosmeticSnapshot | null;
  id?: string | null;
  /** `sm` for rows and plates, `md` for splashes. Sized in em, so the host's font sets the scale. */
  size?: 'sm' | 'md';
  className?: string;
  /** A CATALOG item (the Collection, a reward), not a title someone wears: the Settings "Titles" switch never hides it. */
  item?: boolean;
  /** Test seam: custom styles by title id (defaults to the shipped table). */
  styles?: Readonly<Record<string, TitleCustomStyle>>;
}

export const TitleBadge = memo(function TitleBadge({ snapshot, id, size = 'sm', className, item = false, styles = TITLE_STYLES }: TitleBadgeProps): JSX.Element | null {
  useProgression((s) => s.catalogEpoch); // re-resolve on a server retire / restore
  useCosmeticVisEpoch(); // and on the Settings "Titles" switch (R-SETTINGS-COSMETICS-01)
  if (!item && !cosmeticShown('title')) return null;
  const look = snapshot !== undefined ? titleLookOf(snapshot, styles) : titleLookOfId(id, styles);
  if (!look) return null;
  // A MASTER hero title always paints the master look (owner pick 2026-10-28), on every surface.
  const custom = look.master ? null : look.custom;
  const style = custom?.gradient ? ({ '--tb-grad': custom.gradient } as CSSProperties) : undefined;
  const cls = [
    // The master look carries no rarity class, so no rarity rule (the Ancient gradient, the Legendary glow) paints over it.
    'titlebadge', `tb-${size}`, look.master ? 'tb-master' : `r-${look.rarity}`,
    custom?.gradient ? 'tb-grad' : '', custom?.effect === 'shimmer' ? 'tb-shimmer' : '', className ?? '',
  ].filter(Boolean).join(' ');
  if (look.master) {
    // The star is the badge's own ::before and the sweep its ::after (styles.css), so the text content stays exactly
    // the title name.
    return (
      <span className={cls} data-title-id={look.id} data-rarity={look.rarity} data-master="">
        <span className="tb-text">{look.name}</span>
      </span>
    );
  }
  if (look.look) {
    const lookCls = ['titlebadge', `tb-${size}`, 'tb-look', `tb-look-${look.look}`, className ?? ''].filter(Boolean).join(' ');
    return <ThemedBadge cls={lookCls} id={look.id} rarity={look.rarity} look={look.look} name={look.name} />;
  }
  return (
    <span className={cls} style={style} data-title-id={look.id} data-rarity={look.rarity}>
      <span className="tb-text">{look.name}</span>
    </span>
  );
});

/**
 * ONE shared IntersectionObserver for every themed badge (owner ask 2026-11-20: "can we have them animate a bit in game as
 * well?"). A themed badge's two accent loops (styles.css, transform and opacity only) stay PAUSED until the badge is on
 * screen, so a long leaderboard costs nothing for the rows you cannot see. The observer flips a class directly (no React
 * state, so no re-render). Without IntersectionObserver (tests, very old browsers) a badge is simply live.
 */
let liveObserver: IntersectionObserver | null | undefined;
function observeLive(el: HTMLElement): () => void {
  if (liveObserver === undefined) {
    liveObserver = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => { for (const e of entries) e.target.classList.toggle('tb-live', e.isIntersecting); })
      : null;
  }
  if (!liveObserver) { el.classList.add('tb-live'); return () => {}; }
  const o = liveObserver;
  o.observe(el);
  return () => o.unobserve(el);
}

/**
 * A THEMED title (owner asks 2026-11-20): its theme's colours, type and static glow (`.tb-look-<key>`), the shared secret
 * seal (a crimson inner rim and a small diamond after the name) and the theme's own accent motion, all in styles.css. The
 * seal's glyph is CSS content with empty alt text, so the text content stays the name. Re-observed when the class string
 * changes, because React then rewrites `className` and the observer's fresh first report restores `tb-live`.
 */
const ThemedBadge = memo(function ThemedBadge({ cls, id, rarity, look, name }: { cls: string; id: string; rarity: string; look: string; name: string }): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => (ref.current ? observeLive(ref.current) : undefined), [cls]);
  return (
    <span ref={ref} className={cls} data-title-id={id} data-rarity={rarity} data-look={look}>
      <span className="tb-text">{name}</span>
      <span className="tb-seal" aria-hidden="true" />
    </span>
  );
});
