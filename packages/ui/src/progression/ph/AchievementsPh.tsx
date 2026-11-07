/**
 * THE CAREER ACHIEVEMENTS TAB, IN THE PARTY HOME SHELL (owner 2026-11-06: "the achievement page should be remodeled to look
 * exactly like the collection page. the right side will have all of the achievement info", "except i DO want to keep the
 * players top bar").
 *
 * The Collection's three columns (CollectionPh.tsx), in its own classes (`phc-*` from collectionPh.css), under the Career's
 * player strip:
 *
 *   LEFT    the categories as one list (medallion, name, done / total with a thin bar).
 *   CENTRE  the title row (the All / Completed / In progress tabs, then the completed meter and XP earned), then the album:
 *           one tile per achievement, grouped (Heroes by hero, Set 2 by tribe). Completed tiles are bright with a gold
 *           "Completed" band; open ones are dimmed, with their progress bar on your own page.
 *   RIGHT   the picked achievement, large: its medallion, category, name, reward, what it asks, and its completion date
 *           or progress.
 *
 * AchievementsTab.tsx keeps every read and the category / filter state; this file only draws. Static paint: hover is a
 * one-shot transform; no native tooltips; no own cursor. Off-screen groups skip layout and paint (achievementsPh.css).
 */
import { memo, useCallback, useState } from 'react';
import { UNIQUE_PLATE_REWARD_TEXT, type AchievementCategory } from '@game/progression';
import { PhEmpty, PhMeter, PhRow, PhTabs } from '../../partyHome/kit';
import { Icon } from '../../Icon';
import { MenuMedal, type MenuMedalName } from '../../menuIcons';
import { sfx } from '../../sfx';
import { TitleBadge } from '../../titles/TitleBadge';
import {
  ACHIEVEMENT_FILTERS, completedDateText, passesFilter, rewardText,
  type AchievementCategoryView, type AchievementFilter, type AchievementTile, type AchievementView,
} from '../achievementsModel';
import './collectionPh.css';
import './achievementsPh.css';

const CATEGORY_ICONS: Readonly<Record<AchievementCategory, string>> = {
  career: 'crown', ranked: 'shield', heroes: 'taunt', economy: 'ember', mechanics: 'gear', runes: 'anvil', set2: 'paw',
  combat: 'sword', milestones: 'clock', collection: 'gift',
};
/** The painted category medallions (owner 2026-11-01; Mechanics, Runes, Set 2 and Milestones 2026-11-06). A category
 *  without art keeps its flat glyph above. */
const CATEGORY_ART: Partial<Record<AchievementCategory, MenuMedalName>> = {
  career: 'career', ranked: 'leaderboard', heroes: 'heroes', economy: 'spend', mechanics: 'mechanics', runes: 'runes', set2: 'set2',
  combat: 'attacks', milestones: 'milestones', collection: 'collection',
};

/** A category's medallion (painted where the art exists, else its gold glyph). */
export function AchCategoryIcon({ category }: { category: AchievementCategory }): JSX.Element {
  const art = CATEGORY_ART[category];
  return art ? <MenuMedal name={art} /> : <Icon name={CATEGORY_ICONS[category]} />;
}

export interface AchievementsPhProps {
  view: AchievementView;
  own: boolean;
  ownerName: string;
  category: AchievementCategoryView;
  pickCategory: (c: AchievementCategory) => void;
  filter: AchievementFilter;
  setFilter: (f: AchievementFilter) => void;
  fadeIn?: boolean;
}

export function AchievementsPh({ view, own, ownerName, category, pickCategory, filter, setFilter, fadeIn }: AchievementsPhProps): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const counts = Object.fromEntries(ACHIEVEMENT_FILTERS.map((f) => [f.id, category.groups.reduce((n, g) => n + g.tiles.filter((t) => passesFilter(t, f.id)).length, 0)])) as Record<AchievementFilter, number>;
  const groups = category.groups.map((g) => ({ ...g, tiles: g.tiles.filter((t) => passesFilter(t, filter)) })).filter((g) => g.tiles.length > 0);
  // The picked tile, or the first one shown when the pick is not in this category / filter.
  const selected = groups.flatMap((g) => g.tiles).find((t) => t.def.id === selectedId) ?? groups[0]?.tiles[0] ?? null;
  const pick = useCallback((id: string) => { sfx.pulse(); setSelectedId(id); }, []);

  return (
    <div className={`pha phc-body${fadeIn ? ' fadein' : ''}`}>
      <aside className="phc-rail" aria-label="Achievement categories">
        <div className="phc-cats" role="list" aria-label="Categories">
          {view.categories.map((c) => (
            <PhRow
              key={c.id} dense className={`phc-cat pha-cat${c.done === c.total && c.total > 0 ? ' full' : ''}`} selected={c.id === category.id}
              lead={<span className="phc-cat-icon" aria-hidden><AchCategoryIcon category={c.id} /></span>}
              title={c.label}
              count={`${c.done} / ${c.total}`}
              progress={c.total > 0 ? c.done / c.total : undefined}
              label={`${c.label}, ${c.done} of ${c.total} completed${c.id === category.id ? ', selected' : ''}`}
              onClick={() => pickCategory(c.id)}
            />
          ))}
        </div>
      </aside>

      <main className="pha-main">
        <div className="phc-filters pha-titlerow">
          <PhTabs
            label="Show" value={filter} onChange={(f) => { sfx.pulse(); setFilter(f); }}
            tabs={ACHIEVEMENT_FILTERS.map((f) => ({ id: f.id, label: <>{f.label} <span className="phc-n">{counts[f.id]}</span></> }))}
          />
          <div className="pha-summary" aria-label="Achievements completed">
            <PhMeter className="phc-meter pha-meter" label="Completed" value={view.done} max={view.total} />
            <span className="pha-xp"><b>{view.xpEarned.toLocaleString('en-US')}</b>XP earned</span>
          </div>
        </div>

        <div className="phc-gridwrap pha-list" role="tabpanel" aria-label={category.label}>
          {groups.length === 0 ? (
            <PhEmpty
              title={filter === 'completed' ? 'Nothing completed here yet' : 'All done here'}
              sub={filter === 'completed'
                ? (own ? 'Complete one of these and it will show here with its date.' : `${ownerName} hasn’t completed one of these yet.`)
                : 'Every achievement in this category is complete.'}
            />
          ) : groups.map((g) => (
            <section key={g.id || 'all'} className="pha-group" aria-label={g.label ?? category.label}>
              {g.label && <div className="pha-grouphead">{g.label}</div>}
              <ul className="phc-grid pha-grid">
                {g.tiles.map((t) => <li key={t.def.id}><AchTilePh tile={t} selected={selected?.def.id === t.def.id} onPick={pick} /></li>)}
              </ul>
            </section>
          ))}
        </div>
      </main>

      <aside className="phc-side" aria-label="Details">
        {selected ? <AchDetail tile={selected} category={category} own={own} /> : (
          <section className="phc-detail pha-detail pha-detailempty">
            <PhEmpty title={category.label} sub="Pick an achievement to see it here." />
          </section>
        )}
      </aside>
    </div>
  );
}

/** One achievement in the album (memoized: primitive props + one stable callback). */
const AchTilePh = memo(function AchTilePh({ tile, selected, onPick }: { tile: AchievementTile; selected: boolean; onPick: (id: string) => void }): JSX.Element {
  const { def, completed, concealed, progress, legacy } = tile;
  if (concealed) {
    return (
      <button type="button" className={`phc-tile missing pha-tile concealed${selected ? ' sel' : ''}`} aria-pressed={selected} aria-label="Hidden achievement" onClick={() => onPick(def.id)}>
        <span className="phc-tile-text">
          <span className="phc-tile-name ach-blur" aria-hidden>Hidden achievement</span>
          <span className="phc-tile-rar">Hidden</span>
        </span>
      </button>
    );
  }
  const pct = progress === null ? null : Math.min(1, progress / def.target);
  return (
    <button
      type="button"
      className={`phc-tile pha-tile${completed ? ' owned done' : ' missing'}${selected ? ' sel' : ''}`}
      aria-pressed={selected}
      aria-label={`${def.name}${completed ? ', completed' : ''}`}
      onClick={() => onPick(def.id)}
    >
      <span className="phc-tile-text">
        <span className="phc-tile-name">{def.name}</span>
        {/* No bar: an empty slot the bar's height, so every name sits on one line (owner 2026-11-06). */}
        {pct !== null ? (
          <span className="pha-tile-prog" aria-hidden>
            <span className="phc-bar"><span style={{ transform: `scaleX(${pct})` }} /></span>
            <span className="pha-tile-num">{progress!.toLocaleString('en-US')} / {def.target.toLocaleString('en-US')}</span>
          </span>
        ) : <span className="pha-tile-prog empty" aria-hidden><span className="pha-tile-num">&nbsp;</span></span>}
        <span className="phc-tile-rar">
          {def.rewards.xp > 0 ? rewardText(def) : def.rewards.cosmeticId ? 'Unique reward' : def.rewards.titleId ? 'Title' : ''}
          {legacy && <span className="pha-legacy">Legacy</span>}
        </span>
      </span>
      {completed && <span className="phc-tile-eqband" aria-hidden>Completed</span>}
    </button>
  );
});

/** The picked achievement, large: everything about it. */
function AchDetail({ tile, category, own }: { tile: AchievementTile; category: AchievementCategoryView; own: boolean }): JSX.Element {
  const { def, completed, concealed, progress, legacy } = tile;
  const group = category.groups.find((g) => g.tiles.includes(tile))?.label ?? null;
  const kind = group ? `${category.label} · ${group}` : category.label;
  if (concealed) {
    return (
      <section className="phc-detail pha-detail missing" aria-label="Details">
        <div className="phc-name">
          <span className="phc-kindrow"><span className="phc-kind">{kind}</span></span>
          <h2>Hidden achievement</h2>
        </div>
        <section className="pha-objective" aria-label="Objective">
          <span className="pha-objlbl">Objective</span>
          <p className="pha-req">Complete it to reveal what it asks.</p>
        </section>
      </section>
    );
  }
  const pct = progress === null ? null : Math.min(1, progress / def.target);
  const facts: [string, React.ReactNode][] = [];
  if (def.rewards.xp > 0) facts.push(['Reward', <span key="xp" className="pha-xpval">{rewardText(def)}</span>]);
  if (def.rewards.titleId) facts.push(['Title', <TitleBadge key="t" id={def.rewards.titleId} className="ach-titlebadge" />]);
  if (def.rewards.cosmeticId) facts.push(['Unique reward', <span key="c" className="pha-secret">{UNIQUE_PLATE_REWARD_TEXT}</span>]);
  if (legacy) facts.push(['Legacy', 'From an earlier set. No longer earnable.']);

  return (
    <section className={`phc-detail pha-detail${completed ? ' done' : ' missing'}`} aria-label="Details">
      <div className="phc-name">
        <span className="phc-kindrow"><span className="phc-kind">{kind}</span></span>
        <h2>{def.name}</h2>
      </div>

      {/* What to do to complete it (owner 2026-11-06: "create a section for the OBJECTIVE"). The medallion box is gone. */}
      <section className="pha-objective" aria-label="Objective">
        <span className="pha-objlbl">Objective</span>
        <p className="pha-req">{def.requirement}</p>
      </section>

      <div className="pha-status">
        {completed ? (
          <span className="pha-done"><Icon name="star" />{completedDateText(tile.completedAt)}</span>
        ) : pct !== null ? (
          <div className="pha-prog" role="group" aria-label={`${progress} of ${def.target}`}>
            <span className="pha-proglbl">Progress</span>
            <span className="phc-bar" aria-hidden><span style={{ transform: `scaleX(${pct})` }} /></span>
            <span className="pha-prognum">{progress!.toLocaleString('en-US')} / {def.target.toLocaleString('en-US')}</span>
          </div>
        ) : (
          <span className="pha-open">{own || !legacy ? 'Not yet completed' : 'Not completed'}</span>
        )}
      </div>

      {facts.length > 0 && (
        <dl className="phc-facts">
          {facts.map(([k, val]) => <div key={k} className="phc-fact"><dt>{k}</dt><dd>{val}</dd></div>)}
        </dl>
      )}
    </section>
  );
}

/** A first read on the shell: the final layout with nothing in it, so nothing jumps when it lands. */
const GHOST_ROWS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const GHOST_TILES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
export function AchievementsPhGhost(): JSX.Element {
  return (
    <div className="pha pha-ghost phc-body" role="status" aria-busy="true" aria-label="Loading achievements">
      <aside className="phc-rail" aria-hidden><div className="phc-cats">{GHOST_ROWS.map((i) => <div key={i} className="phk-row dense phc-cat pha-ghostrow" />)}</div></aside>
      <main className="pha-main" aria-hidden>
        <div className="phc-filters pha-titlerow"><span className="pha-ghostbar" /></div>
        <div className="phc-gridwrap"><ul className="phc-grid">{GHOST_TILES.map((i) => <li key={i}><div className="phc-tile missing pha-tile" /></li>)}</ul></div>
      </main>
      <aside className="phc-side" aria-hidden><section className="phc-detail pha-detail" /></aside>
    </div>
  );
}
