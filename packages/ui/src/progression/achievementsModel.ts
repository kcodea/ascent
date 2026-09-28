import {
  ACHIEVEMENTS, ACHIEVEMENT_CATEGORIES, ACHIEVEMENT_CATEGORY_LABELS, ACHIEVEMENT_GROUP_LABELS, ACHIEVEMENT_HEROES, SET2_GROUPS,
  type AchievementCategory, type AchievementDef,
} from '@game/progression';

/**
 * THE CAREER ACHIEVEMENTS TAB, as pure data (achievements batch 1, 2026-09-28). Kept out of the component so the
 * visibility rules are unit-tested without a DOM:
 *
 *  - Every achievement shows with its reward (owner 2026-09-28: "most should show, with their reward"), except a
 *    HIDDEN one, which is a blurred "Hidden" tile with no name, requirement or reward until it is completed (owner:
 *    "the hidden ones will be blurred or say "Hidden""). No hidden achievement ships in batch 1; the rule is ready.
 *  - Completions are PUBLIC (anyone's Career lists them, with the date); in-progress values are the OWNER's only
 *    (handoff §9.2 default), so another player's page shows no progress bars.
 *  - An achievement the server has retired is left out unless it was already completed (a completion is history).
 *  - A set-scoped achievement for a set that is not the active one reads "Legacy": still shown, no longer earnable
 *    (owner default 4, 2026-09-28).
 */

export type AchievementFilter = 'all' | 'completed' | 'progress';
export const ACHIEVEMENT_FILTERS: ReadonlyArray<{ id: AchievementFilter; label: string }> = [
  { id: 'all', label: 'All' }, { id: 'completed', label: 'Completed' }, { id: 'progress', label: 'In progress' },
];

export interface AchievementTile {
  def: AchievementDef;
  completed: boolean;
  /** ISO time of completion (null when not completed or unknown). */
  completedAt: string | null;
  /** A hidden achievement not yet completed: nothing about it may be shown. */
  concealed: boolean;
  /** 0..target, only on the owner's own page and only for a counting achievement not yet completed. */
  progress: number | null;
  /** Its set is no longer the active one: shown, but no longer earnable. */
  legacy: boolean;
}

export interface AchievementGroup { id: string; label: string | null; tiles: AchievementTile[] }
export interface AchievementCategoryView {
  id: AchievementCategory;
  label: string;
  done: number;
  total: number;
  groups: AchievementGroup[];
}

export interface AchievementViewInput {
  completions: ReadonlyArray<{ id: string; completedAt: string | null }>;
  /** The owner's progress by id (null on another player's page, or before it is read). */
  progress: Readonly<Record<string, number>> | null;
  /** Ids the server switched off. */
  retired: readonly string[];
  activeSetId: string;
  defs?: readonly AchievementDef[];
}

export interface AchievementView {
  categories: AchievementCategoryView[];
  done: number;
  total: number;
  /** XP earned from completed achievements shown here. */
  xpEarned: number;
}

const HERO_NAMES: Readonly<Record<string, string>> = Object.fromEntries(ACHIEVEMENT_HEROES.map((h) => [h.id, h.name]));

function groupLabel(def: AchievementDef): string | null {
  if (!def.group) return null;
  if (def.category === 'heroes') return HERO_NAMES[def.group] ?? def.group;
  return ACHIEVEMENT_GROUP_LABELS[def.group] ?? def.group;
}

export function achievementView(input: AchievementViewInput): AchievementView {
  const defs = input.defs ?? ACHIEVEMENTS;
  const done = new Map(input.completions.map((c) => [c.id, c.completedAt]));
  const retired = new Set(input.retired);
  const tiles: AchievementTile[] = [];
  for (const def of defs) {
    const completed = done.has(def.id);
    if (retired.has(def.id) && !completed) continue;
    const raw = input.progress?.[def.id];
    tiles.push({
      def,
      completed,
      completedAt: completed ? done.get(def.id) ?? null : null,
      concealed: def.hidden && !completed,
      progress: !completed && !def.hidden && def.showProgress && input.progress ? Math.max(0, Math.min(def.target, raw ?? 0)) : null,
      legacy: def.setId !== null && def.setId !== input.activeSetId,
    });
  }
  const categories = ACHIEVEMENT_CATEGORIES.map((id): AchievementCategoryView => {
    const mine = tiles.filter((t) => t.def.category === id);
    const order = id === 'set2' ? [...SET2_GROUPS] : id === 'heroes' ? ACHIEVEMENT_HEROES.map((h) => h.id) : [];
    const groups: AchievementGroup[] = [];
    for (const t of mine) {
      const gid = t.def.group ?? '';
      let g = groups.find((x) => x.id === gid);
      if (!g) { g = { id: gid, label: groupLabel(t.def), tiles: [] }; groups.push(g); }
      g.tiles.push(t);
    }
    if (order.length) groups.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    return { id, label: ACHIEVEMENT_CATEGORY_LABELS[id], done: mine.filter((t) => t.completed).length, total: mine.length, groups };
  });
  return {
    categories,
    done: tiles.filter((t) => t.completed).length,
    total: tiles.length,
    xpEarned: tiles.filter((t) => t.completed).reduce((n, t) => n + t.def.rewards.xp, 0),
  };
}

/** Does a tile pass the filter? "In progress" = not completed yet. */
export const passesFilter = (t: AchievementTile, f: AchievementFilter): boolean => (f === 'all' ? true : f === 'completed' ? t.completed : !t.completed);

/** "Sep 28, 2026" (a fixed English format: the rest of the game's text is English). */
export function completedDateText(iso: string | null): string {
  if (!iso) return 'Completed';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Completed';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `Completed ${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export const rewardText = (def: AchievementDef): string => `+${def.rewards.xp} XP`;
