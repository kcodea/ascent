import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { loadSocial, peekSocial, useSocial } from '../socialCache';
import { activeSet } from '@game/content';
import { ACHIEVEMENT_CATEGORIES, UNIQUE_PLATE_REWARD_TEXT, type AchievementCategory } from '@game/progression';
import { Icon } from '../Icon';
import { MenuMedal, type MenuMedalName } from '../menuIcons';
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
 * tile album): categories Career, Ranked, Heroes, Economy and Build, Mechanics, Runes, Set 2 (grouped by tribe),
 * Combat and Milestones (the 2026-10-03 150);
 * filters All / Completed / In progress. A tile shows the name, the exact requirement, the reward ("+150 XP"), a
 * progress bar on the owner's own page for a counting achievement, and the completion date once done. A hidden one
 * is a blurred "Hidden" tile. Visible on anyone's Career: completions are public, progress values are the owner's.
 *
 * Read once per page owner the first time the tab is shown (like the Practice tab). Static tiles: no looping
 * animation, `AchTile` memoized, the list only re-renders on a tab or filter change. Only the CURRENT category's
 * tiles mount (Heroes, the largest, is 222 after the 2026-10-03 150), and each group skips layout and paint while
 * it is off screen (`content-visibility: auto` in achievements.css), so the 446-entry registry stays cheap.
 */
export interface AchievementsTabProps {
  /** The party home shell: seen data at once, a skeleton on a first read. */
  shell?: boolean;
  userId: string;
  /** Your own Career: progress bars show. */
  own: boolean;
  /** The page owner's display name (empty-state copy). */
  ownerName: string;
}

type Loaded = { userId: string; completions: AchievementCompletionRow[] | null; progress: Record<string, number> | null; retired: string[] };

const CATEGORY_ICONS: Readonly<Record<AchievementCategory, string>> = {
  career: 'crown', ranked: 'shield', heroes: 'taunt', economy: 'ember', mechanics: 'gear', runes: 'anvil', set2: 'paw',
  combat: 'sword', milestones: 'clock', collection: 'gift',
};
/** The painted category medallions (owner 2026-11-01). A category without art yet keeps its flat glyph above. */
const CATEGORY_ART: Partial<Record<AchievementCategory, MenuMedalName>> = {
  career: 'career', ranked: 'leaderboard', heroes: 'heroes', economy: 'spend', combat: 'attacks', collection: 'collection',
};
const TAB_KEY = 'ascent.career.achievements.cat';
function loadCat(): AchievementCategory {
  try {
    const v = localStorage.getItem(TAB_KEY);
    return (ACHIEVEMENT_CATEGORIES as readonly string[]).includes(v ?? '') ? v as AchievementCategory : 'career';
  } catch { return 'career'; }
}

/** The party home shell's memory of a player's achievements (socialCache): seen data paints at once, refreshes quietly. */
const achKey = (userId: string, own: boolean): string => `career:ach:${userId}:${own ? 'own' : 'view'}`;
async function readAchievements(userId: string, own: boolean): Promise<Loaded> {
  const [completions, progress, retired] = await Promise.all([
    fetchAchievementCompletions(userId),
    own ? fetchOwnAchievementProgress() : Promise.resolve(undefined),
    fetchRetiredAchievementIds(),
  ]);
  const prev = peekSocial<Loaded>(achKey(userId, own))?.data;
  if (!completions && prev) return prev; // a failed refresh never blanks what is on screen
  return { userId, completions: completions ?? null, progress: progress ?? null, retired: retired ?? [] };
}
/** Read them ahead of the tab (the Career page does, on open). */
export function warmAchievements(userId: string, own: boolean): void { void loadSocial(achKey(userId, own), () => readAchievements(userId, own)); }

const GHOST_CATS = ACHIEVEMENT_CATEGORIES.map((c) => c);
const GHOST_TILES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
/** A first read on the shell: the tab's final layout with nothing in it, so nothing jumps when it lands. */
function AchGhost() {
  return (
    <div className="ach-tab ach-ghost" role="status" aria-busy="true" aria-label="Loading achievements">
      <div className="ach-summary"><span className="ach-summary-n">&nbsp;</span></div>
      <div className="ach-cats" aria-hidden="true">{GHOST_CATS.map((c) => <div key={c} className="ach-cat" />)}</div>
      <div className="ach-filters" aria-hidden="true"><span className="ach-chip">&nbsp;</span><span className="ach-chip">&nbsp;</span><span className="ach-chip">&nbsp;</span></div>
      <div className="ach-grid" aria-hidden="true">{GHOST_TILES.map((i) => <div key={i} className="ach-tile" />)}</div>
    </div>
  );
}

export function AchievementsTab({ userId, own, ownerName, shell }: AchievementsTabProps): JSX.Element {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const seen = useSocial<Loaded>(shell && remoteEnabled() ? achKey(userId, own) : null, () => readAchievements(userId, own));
  const [tick, setTick] = useState(0);
  const [cat, setCat] = useState<AchievementCategory>(loadCat);
  const [filter, setFilter] = useState<AchievementFilter>('all');

  const mine = shell ? seen ?? null : loaded && loaded.userId === userId ? loaded : null;
  // Fades in only after a wait: seen data paints as it is.
  const waited = useRef(!mine);
  useEffect(() => {
    if (shell || mine || !remoteEnabled()) return;
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

  if (!mine && shell) return <AchGhost />;
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
        <button type="button" className="cv2-btn pressable" onClick={() => { sfx.pulse(); if (shell) void loadSocial(achKey(userId, own), () => readAchievements(userId, own), { force: true }); else { setLoaded(null); setTick((t) => t + 1); } }}>Retry</button>
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
    <div className={`ach-tab${shell && waited.current ? ' fadein' : ''}`}>
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
            <span className="ach-cat-ico">{CATEGORY_ART[c.id] ? <MenuMedal name={CATEGORY_ART[c.id]!} /> : <Icon name={CATEGORY_ICONS[c.id]} />}</span>
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
        {def.rewards.xp > 0 && <span className="ach-tile-xp">{rewardText(def)}</span>}
      </div>
      <div className="ach-tile-req">{def.requirement}</div>
      {/* A title reward (the hero Titled and Mastery tiers, owner 2026-09-29), shown as it will be worn. */}
      {def.rewards.titleId && <div className="ach-tile-title"><span>Title</span><TitleBadge id={def.rewards.titleId} className="ach-titlebadge" /></div>}
      {/* A cosmetic reward (the Secret Plushie Plate, owner 2026-10-27): named only by its reward line, never shown. */}
      {def.rewards.cosmeticId && <div className="ach-tile-title ach-tile-secret"><span>Reward</span><span className="ach-secret-reward">{UNIQUE_PLATE_REWARD_TEXT}</span></div>}
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
