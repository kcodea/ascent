import { memo, type CSSProperties } from 'react';
import type { RunCosmeticSnapshot } from '@game/progression';
import { useProgression } from '../progression/progressionStore';
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
 * version (owner 2026-09-29: "the master title should be a golden plate and embroidered text") is always the golden
 * plate (`.tb-master`): static CSS only, no looping paint.
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
  /** Test seam: custom styles by title id (defaults to the shipped table). */
  styles?: Readonly<Record<string, TitleCustomStyle>>;
}

export const TitleBadge = memo(function TitleBadge({ snapshot, id, size = 'sm', className, styles = TITLE_STYLES }: TitleBadgeProps): JSX.Element | null {
  useProgression((s) => s.catalogEpoch); // re-resolve on a server retire / restore
  const look = snapshot !== undefined ? titleLookOf(snapshot, styles) : titleLookOfId(id, styles);
  if (!look) return null;
  // A MASTER hero title is the golden plate with embroidered text (owner 2026-09-29), on every surface.
  const custom = look.master ? null : look.custom;
  const style = custom?.gradient ? ({ '--tb-grad': custom.gradient } as CSSProperties) : undefined;
  const cls = [
    'titlebadge', `tb-${size}`, `r-${look.rarity}`, look.master ? 'tb-master' : '',
    custom?.gradient ? 'tb-grad' : '', custom?.effect === 'shimmer' ? 'tb-shimmer' : '', className ?? '',
  ].filter(Boolean).join(' ');
  if (look.master) {
    // The stitch border is an empty decorative layer; the thread's raised underside is the text's own ::before
    // (`data-text`), so the badge's text content stays exactly the title name.
    return (
      <span className={cls} data-title-id={look.id} data-rarity={look.rarity} data-master="">
        <span className="tb-stitch" aria-hidden />
        <span className="tb-text" data-text={look.name}>{look.name}</span>
      </span>
    );
  }
  return (
    <span className={cls} style={style} data-title-id={look.id} data-rarity={look.rarity}>
      <span className="tb-text">{look.name}</span>
    </span>
  );
});
