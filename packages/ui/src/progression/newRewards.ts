import { create } from 'zustand';
import { achievementOf, type CrateRow, type ProgressionResult } from '@game/progression';

/**
 * NEW REWARDS, shown in the Collection (owner ask 2026-09-28: "the end game screen here is full of stuff. can you
 * have the unlocks, achievements, and crates be a pop up when the player gets back to the collection? and just
 * highlight the collection's text in orange or have a "new" pill or something on it so players go there?").
 *
 * A settled run's achievements, first-time titles and crates are QUEUED here instead of being shown on the end
 * screen. The Collection opens a one-time pop-up summarising everything queued; dismissing it marks those rewards
 * seen. While anything is queued, every Collection entry point wears a NEW pill.
 *
 * Per account, in localStorage (`ascent.rewards.<userId>`), so it survives a reload. Never double-shown: every
 * reward id that was ever queued is remembered (capped), so a duplicate settlement answer, a replayed queue item or
 * a second tab queues nothing twice. Best-effort like every other local mirror: blocked storage just means the
 * pop-up lives for this session only.
 */

export interface QueuedAchievement { id: string; xp: number }
/** A level crate carries its level; a Gauntlet crate (2026-09-29) has `earnedLevel` null and a `source` instead
 *  (`crateLabel` names both). */
export interface QueuedCrate { crateId: string; earnedLevel: number | null; source?: string }
export interface UnseenRewards {
  achievements: QueuedAchievement[];
  titles: string[];
  crates: QueuedCrate[];
}

interface Stored extends UnseenRewards {
  /** Every reward key ever queued for this account (`a:<id>`, `t:<id>`, `c:<id>`): the never-twice guard. */
  known: string[];
}

const KEY_PREFIX = 'ascent.rewards.';
const KNOWN_CAP = 600;
const EMPTY: UnseenRewards = Object.freeze({ achievements: [], titles: [], crates: [] }) as UnseenRewards;

const blank = (): Stored => ({ achievements: [], titles: [], crates: [], known: [] });

function readCrate(c: QueuedCrate): QueuedCrate {
  const source = typeof c.source === 'string' ? c.source : undefined;
  const earnedLevel = typeof c.earnedLevel === 'number' ? c.earnedLevel : source ? null : 1;
  return source ? { crateId: c.crateId, earnedLevel, source } : { crateId: c.crateId, earnedLevel };
}

function load(userId: string): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY_PREFIX + userId) ?? 'null') as Partial<Stored> | null;
    if (!raw || typeof raw !== 'object') return blank();
    const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    return {
      achievements: Array.isArray(raw.achievements) ? raw.achievements.filter((a): a is QueuedAchievement => !!a && typeof a.id === 'string').map((a) => ({ id: a.id, xp: typeof a.xp === 'number' ? a.xp : 0 })) : [],
      titles: strs(raw.titles),
      crates: Array.isArray(raw.crates) ? raw.crates.filter((c): c is QueuedCrate => !!c && typeof c.crateId === 'string').map(readCrate) : [],
      known: strs(raw.known),
    };
  } catch {
    return blank();
  }
}

function save(userId: string, s: Stored): void {
  try { localStorage.setItem(KEY_PREFIX + userId, JSON.stringify(s)); } catch { /* best-effort */ }
}

const unseenOf = (s: Stored): UnseenRewards => ({ achievements: s.achievements, titles: s.titles, crates: s.crates });

export const useNewRewards = create<{ userId: string | null; unseen: UnseenRewards }>(() => ({ userId: null, unseen: EMPTY }));

/** Point the store at this account's queue (on identity change and on first read). */
export function syncNewRewards(userId: string | null): void {
  if (!userId) { useNewRewards.setState({ userId: null, unseen: EMPTY }); return; }
  if (useNewRewards.getState().userId === userId) return;
  useNewRewards.setState({ userId, unseen: unseenOf(load(userId)) });
}

/** Queue what a CONFIRMED settlement awarded: achievements (with their XP), first-time titles, crates. Idempotent. */
export function queueNewRewards(userId: string, result: Pick<ProgressionResult, 'achievements' | 'unlockedTitles' | 'crateIds' | 'after'>): void {
  const s = load(userId);
  const known = new Set(s.known);
  let changed = false;
  for (const id of result.achievements ?? []) {
    if (known.has(`a:${id}`)) continue;
    known.add(`a:${id}`); changed = true;
    s.achievements.push({ id, xp: achievementOf(id)?.rewards.xp ?? 0 });
  }
  for (const id of result.unlockedTitles ?? []) {
    if (known.has(`t:${id}`)) continue;
    known.add(`t:${id}`); changed = true;
    s.titles.push(id);
  }
  const ids = result.crateIds ?? [];
  ids.forEach((crateId, i) => {
    if (known.has(`c:${crateId}`)) return;
    known.add(`c:${crateId}`); changed = true;
    // Oldest first: one crate per new level, so the i-th of n was earned at level after - (n - 1 - i).
    s.crates.push({ crateId, earnedLevel: Math.max(1, (result.after?.level ?? 1) - (ids.length - 1 - i)) });
  });
  if (!changed) return;
  s.known = [...known].slice(-KNOWN_CAP);
  save(userId, s);
  if (useNewRewards.getState().userId === userId || useNewRewards.getState().userId === null) {
    useNewRewards.setState({ userId, unseen: unseenOf(s) });
  }
}

/**
 * Queue ONE crate the server granted outside a settlement (a first Gauntlet clear, 2026-09-29). Unlike
 * `queueNewRewards` it infers nothing: the crate's own level / source is stored as given. Idempotent.
 */
export function queueNewCrate(userId: string, crate: Pick<CrateRow, 'crateId' | 'earnedLevel' | 'source'>): void {
  const s = load(userId);
  const key = `c:${crate.crateId}`;
  if (s.known.includes(key)) return;
  s.crates.push(crate.source ? { crateId: crate.crateId, earnedLevel: crate.earnedLevel, source: crate.source } : { crateId: crate.crateId, earnedLevel: crate.earnedLevel });
  s.known = [...s.known, key].slice(-KNOWN_CAP);
  save(userId, s);
  if (useNewRewards.getState().userId === userId || useNewRewards.getState().userId === null) {
    useNewRewards.setState({ userId, unseen: unseenOf(s) });
  }
}

/** The pop-up was dismissed: everything queued is seen (and stays known, so it never comes back). */
export function markNewRewardsSeen(userId: string | null): void {
  if (!userId) return;
  const s = load(userId);
  s.achievements = []; s.titles = []; s.crates = [];
  save(userId, s);
  if (useNewRewards.getState().userId === userId) useNewRewards.setState({ unseen: EMPTY });
}

export const unseenCount = (u: UnseenRewards): number => u.achievements.length + u.titles.length + u.crates.length;
/** Selector: anything waiting in the Collection (the NEW pill). */
export const hasNewRewards = (s: { unseen: UnseenRewards }): boolean => unseenCount(s.unseen) > 0;

/** Tests: forget every account's queue. */
export function resetNewRewardsForTests(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(KEY_PREFIX)) localStorage.removeItem(k);
    }
  } catch { /* ignore */ }
  useNewRewards.setState({ userId: null, unseen: EMPTY });
}
