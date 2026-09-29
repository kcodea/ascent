import { memo, useEffect, useMemo, useState } from 'react';
import { activeSet } from '@game/content';
import type { AchievementCategory } from '@game/progression';
import { Icon } from '../Icon';
import { sfx } from '../sfx';
import { remoteEnabled } from '../remoteBoards';
import {
  ACHIEVEMENT_FILTERS, achievementView, completedDateText, passesFilter, rewardText,
  type AchievementFilter, type AchievementTile, type AchievementView,
} from './achievementsModel';
import { fetchAchievementCompletions, fetchOwnAchievementProgress, fetchRetiredAchievementIds, type AchievementCompletionRow } from './progressionRemote';
import { TitleBadge } from '../titles/TitleBadge';
import './achievements.css';

/**
 * THE CAREER "ACHIEVEMENTS" TAB (achievements batch 1, owner 2026-09-28: "we'll need an achievements tab in career
 * next to practice. most should show, with their reward, but the hidden ones will be blurred or say "Hidden"").
 *
 * The Collection's visual language (the gold-rimmed panel, a category strip with done / total, filter chips, a
 * tile album): categories Career, Ranked, Heroes, Economy and Build, Mechanics, Runes, Set 2 (grouped by tribe);
 * filters All / Completed / In progress. A tile shows the name, the exact requirement, the reward ("+150 XP"), a
 * progress bar on the owner's own page for a counting achievement, and the completion date once done. A hidden one
 * is a blurred "Hidden" tile. Visible on anyone's Career: completions are public, progress values are the owner's.
 *
 * Read once per page owner the first time the tab is shown (like the Practice tab). Static tiles: no looping
 * animation, `AchTile` memoized, the list only re-renders on a tab or filter change.
 */
export interface AchievementsTabProps {
  userId: string;
  /** Your own Career: progress bars show. */
  own: boolean;
  /** The page owner's display name (empty-state copy). */
  ownerName: string;
}

type Loaded = { userId: string; completions: AchievementCompletionRow[] | null; progress: Record<string, number> | null; retired: string[] };

const CATEGORY_ICONS: Readonly<Record<AchievementCategory, string>> = {
  career: 'crown', ranked: 'shield', heroes: 'taunt', economy: 'ember', mechanics: 'gear', runes: 'anvil', set2: 'paw',
};
const TAB_KEY = 'ascent.career.achievements.cat';
function loadCat(): AchievementCategory {
  try {
    const v = localStorage.getItem(TAB_KEY);
    return v === 'ranked' || v === 'heroes' || v === 'economy' || v === 'mechanics' || v === 'runes' || v === 'set2' ? v : 'career';
  } catch { return 'career'; }
}

export function AchievementsTab({ userId, own, ownerName }: AchievementsTabProps): JSX.Element {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [tick, setTick] = useState(0);
  const [cat, setCat] = useState<AchievementCategory>(loadCat);
  const [filter, setFilter] = useState<AchievementFilter>('all');

  const mine = loaded && loaded.userId === userId ? loaded : null;
  useEffect(() => {
    if (mine || !remoteEnabled()) return;
    let live = true;
    void Promise.all([
      fetchAchievementCompletions(userId),
      own ? fetchOwnAchievementProgress() : Promise.resolve(undefined),
      fetchRetiredAchievementIds(),
    ]).then(([completions, progress, retired]) => {
      if (!live) return;
      setLoaded({ userId, completions: completions ?? null, progress: progress ?? null, retired: retired ?? [] });
    });
    return () => { live = false; };
  }, [userId, own, mine, tick]);

  const view: AchievementView | null = useMemo(() => (mine && mine.completions
    ? achievementView({ completions: mine.completions, progress: own ? mine.progress ?? {} : null, retired: mine.retired, activeSetId: activeSet().id })
    : null), [mine, own]);

  if (!mine) {
    return (
      <div className="cv2-panel cv2-none" role="status" aria-busy="true">
        <div className="cv2-state-ico spin"><Icon name="refresh" /></div>
        <div className="cv2-state-title">Loading achievements</div>
        <div className="cv2-state-body">Fetching completed achievements from the server…</div>
      </div>
    );
  }
  if (!view) {
    return (
      <div className="cv2-panel cv2-none">
        <div className="cv2-state-ico"><Icon name="mute" /></div>
        <div className="cv2-state-title">Couldn’t reach the server</div>
        <div className="cv2-state-body">Check your connection and try again.</div>
        <button type="button" className="cv2-btn pressable" onClick={() => { sfx.pulse(); setLoaded(null); setTick((t) => t + 1); }}>Retry</button>
      </div>
    );
  }

  const current = view.categories.find((c) => c.id === cat) ?? view.categories[0]!;
  const counts = Object.fromEntries(ACHIEVEMENT_FILTERS.map((f) => [f.id, current.groups.reduce((n, g) => n + g.tiles.filter((t) => passesFilter(t, f.id)).length, 0)])) as Record<AchievementFilter, number>;
  const groups = current.groups.map((g) => ({ ...g, tiles: g.tiles.filter((t) => passesFilter(t, filter)) })).filter((g) => g.tiles.length > 0);
  const pickCat = (c: AchievementCategory): void => {
    if (c === cat) return;
    sfx.pulse();
    setCat(c);
    try { localStorage.setItem(TAB_KEY, c); } catch { /* ignore */ }
  };

  return (
    <div className="ach-tab">
      <div className="ach-summary" aria-label="Achievements completed">
        <span className="ach-summary-n"><b>{view.done}</b> / {view.total} completed</span>
        <span className="ach-summary-xp">{view.xpEarned.toLocaleString('en-US')} XP earned</span>
      </div>
      <div className="ach-cats" role="tablist" aria-label="Achievement categories">
        {view.categories.map((c) => (
          <button
            type="button" role="tab" key={c.id} aria-selected={c.id === current.id}
            className={`ach-cat${c.id === current.id ? ' on' : ''}${c.done === c.total && c.total > 0 ? ' full' : ''}`}
            onClick={() => pickCat(c.id)}
          >
            <span className="ach-cat-ico"><Icon name={CATEGORY_ICONS[c.id]} /></span>
            <span className="ach-cat-name">{c.label}</span>
            <span className="ach-cat-count">{c.done} / {c.total}</span>
          </button>
        ))}
      </div>
      <div className="ach-filters" role="group" aria-label="Show">
        {ACHIEVEMENT_FILTERS.map((f) => (
          <button
            type="button" key={f.id} aria-pressed={filter === f.id}
            className={`ach-chip${filter === f.id ? ' on' : ''}`}
            onClick={() => { if (filter !== f.id) { sfx.pulse(); setFilter(f.id); } }}
          >
            {f.label}<span className="ach-chip-n">{counts[f.id]}</span>
          </button>
        ))}
      </div>
      <div className="ach-list" role="tabpanel" aria-label={current.label}>
        {groups.length === 0 ? (
          <div className="cv2-panel cv2-none">
            <div className="cv2-state-ico"><Icon name="star" /></div>
            <div className="cv2-state-title">{filter === 'completed' ? 'Nothing completed here yet' : 'All done here'}</div>
            <div className="cv2-state-body">
              {filter === 'completed'
                ? (own ? 'Complete one of these and it will show here with its date.' : `${ownerName} hasn’t completed one of these yet.`)
                : 'Every achievement in this category is complete.'}
            </div>
          </div>
        ) : groups.map((g) => (
          <section key={g.id || 'all'} className="ach-group" aria-label={g.label ?? current.label}>
            {g.label && <div className="ach-group-head">{g.label}</div>}
            <ul className="ach-grid">
              {g.tiles.map((t) => <li key={t.def.id}><AchTile tile={t} /></li>)}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

/** One achievement. Static: nothing on it animates. */
const AchTile = memo(function AchTile({ tile }: { tile: AchievementTile }): JSX.Element {
  const { def, completed, concealed, progress, legacy } = tile;
  if (concealed) {
    return (
      <article className="ach-tile concealed" aria-label="Hidden achievement">
        <div className="ach-tile-name ach-blur" aria-hidden>Hidden achievement</div>
        <div className="ach-tile-req ach-blur" aria-hidden>Complete it to reveal what it asks.</div>
        <div className="ach-hidden-label">Hidden</div>
      </article>
    );
  }
  const pct = progress === null ? null : Math.min(1, progress / def.target);
  return (
    <article className={`ach-tile${completed ? ' done' : ''}${legacy ? ' legacy' : ''}`} aria-label={`${def.name}${completed ? ', completed' : ''}`}>
      <div className="ach-tile-top">
        <span className="ach-tile-name">{def.name}</span>
        <span className="ach-tile-xp">{rewardText(def)}</span>
      </div>
      <div className="ach-tile-req">{def.requirement}</div>
      {/* A title reward (the hero Titled and Mastery tiers, owner 2026-09-29), shown as it will be worn. */}
      {def.rewards.titleId && <div className="ach-tile-title"><span>Title</span><TitleBadge id={def.rewards.titleId} className="ach-titlebadge" /></div>}
      {pct !== null && (
        <div className="ach-prog" aria-label={`${progress} of ${def.target}`}>
          <div className="ach-prog-track"><div className="ach-prog-fill" style={{ transform: `scaleX(${pct})` }} /></div>
          <span className="ach-prog-num">{progress!.toLocaleString('en-US')} / {def.target.toLocaleString('en-US')}</span>
        </div>
      )}
      <div className="ach-tile-foot">
        {completed ? <span className="ach-done"><Icon name="star" />{completedDateText(tile.completedAt)}</span> : <span className="ach-open">Not yet completed</span>}
        {legacy && <span className="ach-legacy">Legacy</span>}
      </div>
    </article>
  );
});
