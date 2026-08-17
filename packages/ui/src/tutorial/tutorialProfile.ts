/**
 * ── TUTORIAL PROFILE (first-use progress — blueprint §8.2.1) ───────────────────────────────────────────
 *
 * Tracks, per player, how far they have moved through the tutorial so a LATER course never reteaches a thing
 * already learned. It is the sibling of `identity.ts`: a `localStorage`-backed, versioned, defensively-parsed
 * store with an in-memory cache and a subscribe seam a React view can drive `useSyncExternalStore` off. When
 * accounts want to carry tutorial progress across devices, an authenticated backend wraps THIS module exactly
 * as the auth provider wraps identity — nothing downstream reads `localStorage` directly.
 *
 * Three shapes of state live here:
 *
 *  1. **Courses** — the scripted lessons (Learn Ascent, and later primers). Each records where the player got
 *     to (`status` + `lastStepId`) so a resumed course picks up mid-flight, and a `courseVersion` so a course
 *     that has been re-authored can decide to re-offer itself. A SKIP is a distinct status from a COMPLETION:
 *     the player who dismissed the tutorial must be distinguishable from the one who finished it (they get a
 *     different re-entry affordance), so we never collapse the two.
 *  2. **Lessons** — the universal interactions (`TUTORIAL_LESSON_KEYS`, owned by `@game/sim`). Each is a
 *     THREE-state flag (New → Introduced → Demonstrated), not a seen/unseen bit (blueprint §8.2.1):
 *     `introduced` = we showed the explanation but have not yet watched the player succeed at it;
 *     `demonstrated` = the player observed or performed it successfully. Only `demonstrated` is the durable
 *     "don't reteach" state — merely opening a glossary entry must NOT reach it. The upgrade is MONOTONIC:
 *     `markLessonDemonstrated` is terminal and never regresses, and `markLessonIntroduced` only lifts New.
 *  3. **Hints** — one-shot contextual coach marks, tracked as a flat seen-set so each fires at most once.
 *
 * Like identity, this module NEVER throws to its caller: every `localStorage`/`JSON` op is guarded, and on any
 * failure we operate on the in-memory cache and no-op the write (private-mode browsers throw on both parse and
 * access). A read that can't be trusted — corrupt JSON or a version we don't recognise — falls back to a fresh
 * empty profile rather than surfacing an error.
 */

import { TUTORIAL_LESSON_KEYS, type TutorialLessonKey } from '@game/sim';

/** Where a player stands on one scripted course. */
export type TutorialCourseStatus = 'not_started' | 'in_progress' | 'completed' | 'skipped';

/** Per-course progress. `skipped` is intentionally NOT `completed` — a dismissal and a finish differ. */
export interface TutorialCourseProgress {
  courseId: string;
  /** The authored version this progress was recorded against; lets a re-authored course re-offer itself. */
  courseVersion: number;
  status: TutorialCourseStatus;
  /** The last step reached, so a resumed course continues mid-flight. */
  lastStepId?: string;
  /** ISO timestamp stamped once, when the course first moved off `not_started`. */
  startedAt?: string;
  /** ISO timestamp stamped when the course reached `completed`. */
  completedAt?: string;
}

/**
 * A lesson flag's three states (blueprint §8.2.1). `introduced` = explanation shown but a successful example
 * not yet observed; `demonstrated` = the player observed/performed it successfully. Only `demonstrated` is the
 * durable "don't reteach" state.
 */
export type LessonState = 'new' | 'introduced' | 'demonstrated';

/** The full persisted profile. `lessons` is partial — an absent key reads as the `new` default. */
export interface TutorialProfile {
  version: number;
  courses: Record<string, TutorialCourseProgress>;
  lessons: Partial<Record<TutorialLessonKey, LessonState>>;
  hintsSeen: string[];
}

/** The core first-launch course; the one whose status decides whether the player has ever seen the tutorial. */
const CORE_COURSE_ID = 'learn-ascent';

/** Bump when the persisted SHAPE changes incompatibly; an unrecognised version falls back to a fresh profile. */
const CURRENT_VERSION = 1;

/** The `localStorage` slot. The `v1` suffix mirrors the version so a future format can migrate side-by-side. */
const STORAGE_KEY = 'ascent.tutorial.v1';

/** The valid lesson keys, as a set, so a corrupt persisted `lessons` map can be sanitised on load. */
const LESSON_KEY_SET: ReadonlySet<string> = new Set(TUTORIAL_LESSON_KEYS);

/** The valid course statuses, for the same defensive sanitising. */
const COURSE_STATUSES: ReadonlySet<string> = new Set<TutorialCourseStatus>([
  'not_started',
  'in_progress',
  'completed',
  'skipped',
]);

/** The valid lesson states, for the same defensive sanitising. */
const LESSON_STATES: ReadonlySet<string> = new Set<LessonState>(['new', 'introduced', 'demonstrated']);

/** The live profile, loaded once and thereafter mutated in place through the commit seam. `null` = not loaded. */
let cache: TutorialProfile | null = null;

/** Subscribers notified after every successful mutation (a React view drives `useSyncExternalStore` off this). */
const subscribers = new Set<() => void>();

/** A fresh, empty profile at the current version — the fallback for a first run or an untrusted read. */
function emptyProfile(): TutorialProfile {
  return { version: CURRENT_VERSION, courses: {}, lessons: {}, hintsSeen: [] };
}

/** Read the current ISO timestamp. UI code, so `Date` is fine (the `Math.random`/`Date.now` bans are engine-only;
 *  identity.ts likewise leans on wall-clock through the platform). */
function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Coerce an untrusted parsed value into a trustworthy `TutorialProfile`, dropping anything malformed. Returns
 * `null` when the payload can't be salvaged (not an object, or a version we don't recognise) so `load` can fall
 * back to a fresh profile.
 */
function sanitize(raw: unknown): TutorialProfile | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.version !== CURRENT_VERSION) return null;

  const out = emptyProfile();

  // Courses — keep only well-formed entries; a bad row is dropped, not fatal.
  if (typeof obj.courses === 'object' && obj.courses !== null) {
    for (const [id, value] of Object.entries(obj.courses as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) continue;
      const c = value as Record<string, unknown>;
      if (typeof c.status !== 'string' || !COURSE_STATUSES.has(c.status)) continue;
      const progress: TutorialCourseProgress = {
        courseId: typeof c.courseId === 'string' ? c.courseId : id,
        courseVersion: typeof c.courseVersion === 'number' ? c.courseVersion : 0,
        status: c.status as TutorialCourseStatus,
      };
      if (typeof c.lastStepId === 'string') progress.lastStepId = c.lastStepId;
      if (typeof c.startedAt === 'string') progress.startedAt = c.startedAt;
      if (typeof c.completedAt === 'string') progress.completedAt = c.completedAt;
      out.courses[id] = progress;
    }
  }

  // Lessons — keep only known keys with known states; anything else is discarded.
  if (typeof obj.lessons === 'object' && obj.lessons !== null) {
    for (const [key, value] of Object.entries(obj.lessons as Record<string, unknown>)) {
      if (!LESSON_KEY_SET.has(key)) continue;
      if (typeof value !== 'string' || !LESSON_STATES.has(value)) continue;
      out.lessons[key as TutorialLessonKey] = value as LessonState;
    }
  }

  // Hints — a flat set of string ids; de-duplicated, non-strings dropped.
  if (Array.isArray(obj.hintsSeen)) {
    out.hintsSeen = Array.from(new Set(obj.hintsSeen.filter((h): h is string => typeof h === 'string')));
  }

  return out;
}

/**
 * Load the profile once from `localStorage`. Every failure mode — no storage, throwing storage (private mode),
 * malformed JSON, an untrusted shape, a stale version — resolves to a fresh empty profile rather than throwing.
 */
function load(): TutorialProfile {
  if (cache) return cache;
  try {
    const rawStorage = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    if (rawStorage) {
      const parsed = sanitize(JSON.parse(rawStorage) as unknown);
      cache = parsed ?? emptyProfile();
      return cache;
    }
  } catch {
    // Corrupt JSON or an unreadable store — fall through to a fresh profile below.
  }
  cache = emptyProfile();
  return cache;
}

/** Write the cache back to `localStorage`. Guarded: a throwing store leaves the in-memory cache authoritative. */
function persist(): void {
  if (!cache) return;
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Quota, private mode, or no storage — the in-memory cache is still correct for this session.
  }
}

/** Fire every subscriber. Guarded so one throwing listener can't abort the rest. */
function notify(): void {
  for (const fn of subscribers) {
    try {
      fn();
    } catch {
      // A misbehaving subscriber must not break the notification fan-out.
    }
  }
}

/**
 * Replace the cache with a mutated copy, persist it, and notify. Mutations produce a NEW top-level object so a
 * `useSyncExternalStore` snapshot reference changes on every write (in-place mutation would go undetected).
 */
function commit(next: TutorialProfile): void {
  cache = next;
  persist();
  notify();
}

/** Shallow-clone the loaded profile so a mutation can build its `next` without touching the live snapshot. */
function draft(): TutorialProfile {
  const p = load();
  return { version: p.version, courses: { ...p.courses }, lessons: { ...p.lessons }, hintsSeen: p.hintsSeen };
}

// ── Public API — pure, synchronous, every path guarded ────────────────────────────────────────────────

/** The cached profile, loading it once on first access. This is the `useSyncExternalStore` getSnapshot source. */
export function getTutorialProfile(): TutorialProfile {
  return load();
}

/** One course's progress, or `null` if the player has never touched it. */
export function getCourseProgress(courseId: string): TutorialCourseProgress | null {
  return load().courses[courseId] ?? null;
}

/** Move a course to `in_progress`, stamping `startedAt` the first time it leaves `not_started`. */
export function startCourse(courseId: string, courseVersion: number): void {
  const next = draft();
  const prev = next.courses[courseId];
  next.courses[courseId] = {
    courseId,
    courseVersion,
    status: 'in_progress',
    lastStepId: prev?.lastStepId,
    startedAt: prev?.startedAt ?? nowIso(),
    completedAt: prev?.completedAt,
  };
  commit(next);
}

/** Record the last step reached, so a resumed course continues from here. Creates the row if absent. */
export function setCourseStep(courseId: string, stepId: string): void {
  const next = draft();
  const prev = next.courses[courseId];
  next.courses[courseId] = {
    courseId,
    courseVersion: prev?.courseVersion ?? 0,
    status: prev?.status ?? 'in_progress',
    lastStepId: stepId,
    startedAt: prev?.startedAt ?? nowIso(),
    completedAt: prev?.completedAt,
  };
  commit(next);
}

/** Mark a course finished, stamping `completedAt`. */
export function completeCourse(courseId: string): void {
  const next = draft();
  const prev = next.courses[courseId];
  next.courses[courseId] = {
    courseId,
    courseVersion: prev?.courseVersion ?? 0,
    status: 'completed',
    lastStepId: prev?.lastStepId,
    startedAt: prev?.startedAt ?? nowIso(),
    completedAt: nowIso(),
  };
  commit(next);
}

/** Mark a course SKIPPED — a distinct status from `completed`, so a dismissal never reads as a finish. */
export function skipCourse(courseId: string, courseVersion: number): void {
  const next = draft();
  const prev = next.courses[courseId];
  next.courses[courseId] = {
    courseId,
    courseVersion,
    status: 'skipped',
    lastStepId: prev?.lastStepId,
    startedAt: prev?.startedAt ?? nowIso(),
    completedAt: prev?.completedAt,
  };
  commit(next);
}

/** A lesson's state, defaulting to `new` for a key never touched. */
export function getLessonState(key: TutorialLessonKey): LessonState {
  return load().lessons[key] ?? 'new';
}

/** Lift a lesson from `new` to `introduced`. Never downgrades an already `introduced`/`demonstrated` lesson. */
export function markLessonIntroduced(key: TutorialLessonKey): void {
  if (getLessonState(key) !== 'new') return;
  const next = draft();
  next.lessons[key] = 'introduced';
  commit(next);
}

/** Set a lesson to `demonstrated` — the terminal, MONOTONIC state. A no-op once already demonstrated. */
export function markLessonDemonstrated(key: TutorialLessonKey): void {
  if (getLessonState(key) === 'demonstrated') return;
  const next = draft();
  next.lessons[key] = 'demonstrated';
  commit(next);
}

/** Whether a one-shot hint has already fired. */
export function hasSeenHint(id: string): boolean {
  return load().hintsSeen.includes(id);
}

/** Record a one-shot hint as fired, so it never shows again. Idempotent. */
export function markHintSeen(id: string): void {
  if (hasSeenHint(id)) return;
  const next = draft();
  next.hintsSeen = [...next.hintsSeen, id];
  commit(next);
}

/** Wipe all tutorial progress — the "replay the tutorial from scratch" affordance, and the test reset. */
export function resetTutorialProfile(): void {
  commit(emptyProfile());
}

/**
 * Subscribe to profile mutations; returns an unsubscribe. Pair with `getTutorialProfile` as the snapshot getter
 * to drive `useSyncExternalStore`. Mirrors identity's backend `onChange` seam.
 */
export function subscribeTutorialProfile(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/**
 * True when the player has never made the first-launch decision — the core course has no `in_progress`,
 * `completed`, or `skipped` status. Any of those three means the tutorial has been offered and answered, so
 * only a total absence (or a lingering `not_started`) counts as a first launch.
 */
export function isFirstLaunch(courseId: string = CORE_COURSE_ID): boolean {
  const progress = load().courses[courseId];
  if (!progress) return true;
  return progress.status === 'not_started';
}
