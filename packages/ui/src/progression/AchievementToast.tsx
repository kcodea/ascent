/**
 * THE ACHIEVEMENT TOAST (owner ask 2026-11-20, R-ACH-TOAST-01): an achievement just completed, so a small navy-and-gold
 * plate ducks in from the LEFT edge, says "Achievement unlocked" with its name (a hidden one reveals its name now), the
 * XP and any title or cosmetic it grants, with a short golden chime (`sfx.achievement`), holds about 3 s and ducks back out. Several queue one after another.
 *
 * Never in the way: `pointer-events: none` (the game underneath keeps every click and drag), placed in the left gutter
 * above the Friends dock, clear of the shop and board. Motion is ONE one-shot keyframe on transform + opacity (no
 * paint property, no loop, no layout read); the next toast mounts when the animation ends. Feeds and gating live in
 * `achievementToasts.ts`.
 */
import { useEffect } from 'react';
import { sfx } from '../sfx';
import { achievementOf, cosmeticOf } from '@game/progression';
import { installAchievementToasts, shiftAchievementToast, useAchievementToasts } from './achievementToasts';
import './achievementToast.css';

export function AchievementToast(): JSX.Element | null {
  useEffect(() => installAchievementToasts(), []);
  const head = useAchievementToasts((s) => s.queue[0] ?? null);
  const def = head ? achievementOf(head.id) : null; // the queue only takes ids this client knows
  // The chime as each one ducks in, on the SFX channel (its fader, the SFX volume and mute all apply).
  const key = head && def ? head.key : null;
  useEffect(() => { if (key !== null) sfx.achievement(); }, [key]);
  if (!head || !def) return null;
  const title = cosmeticOf(def.rewards.titleId)?.name ?? null;
  const cosmetic = def.rewards.cosmeticId ? cosmeticOf(def.rewards.cosmeticId)?.name ?? null : null;
  const xp = def.rewards.xp;
  const label = `Achievement unlocked: ${def.name}.${xp > 0 ? ` ${xp} XP.` : ''}${title ? ` Title: ${title}.` : ''}${cosmetic ? ` Reward: ${cosmetic}.` : ''}`;
  return (
    <div key={head.key} className="achtoast" role="status" aria-live="polite" aria-label={label}
      onAnimationEnd={(e) => { if (e.target === e.currentTarget) shiftAchievementToast(head.key); }}>
      <span className="achtoast-eyebrow">Achievement unlocked</span>
      <span className="achtoast-name">{def.name}</span>
      <span className="achtoast-rewards">
        {xp > 0 && <b className="achtoast-xp">+{xp.toLocaleString('en-US')} XP</b>}
        {title && <span className="achtoast-title">Title: {title}</span>}
        {cosmetic && <span className="achtoast-title">{cosmetic}</span>}
      </span>
    </div>
  );
}
