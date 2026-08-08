/**
 * Editable FRONT-PAGE COPY (owner ask 2026-08-08: "add a dev tuner for the front page text so I can change it
 * myself and lock it in"). Every string on the title screen lives here, so the wordmark and the menu plaques
 * can be reworded from the DEV Title Text tuner — live, no code edit, no asking anyone to type it for you.
 *
 * NOT CSS. Unlike the other tuners (which push numbers into CSS custom properties), these are React strings:
 * `Title.tsx` reads them through `getTitleText()` and re-renders on change via `subscribeTitleText`.
 *
 * TO SHIP A WORDING: dial it in the tuner, hit Copy, and paste the values into `DEFAULTS` below. That is what
 * "locking it in" means — the tuner writes localStorage, which is per-browser and invisible to everyone else
 * (and to the packaged exe, which never runs the dev menu). Until the defaults are edited, a change is yours
 * alone; once they are, it ships for both of us.
 */
export interface TitleTextConfig {
  wordmark: string;
  continueLabel: string;
  continueNote: string; // the round line under Continue; `{round}` is substituted
  play: string;
  career: string;
  leaderboard: string;
  champions: string;
  settings: string;
  namePrompt: string; // shown on the name button before a name is set
}

/** The SHIPPED copy — what every player sees with no override. Edit here to change it for real. */
const DEFAULTS: TitleTextConfig = {
  wordmark: 'ASCENT',
  continueLabel: 'Continue',
  continueNote: 'Round {round}',
  play: 'Play',
  career: 'Career',
  leaderboard: 'Leaderboard',
  champions: 'Hall of Champions',
  settings: 'Settings',
  namePrompt: 'Set your name',
};
export { DEFAULTS as TITLE_TEXT_DEFAULTS };

const KEY = 'ascent.titletext';
let cfg: TitleTextConfig = (() => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<TitleTextConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

/** Subscribers (the Title screen) — a plain set rather than a store, since exactly one surface reads this. */
const listeners = new Set<() => void>();
export function subscribeTitleText(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getTitleText(): TitleTextConfig {
  return cfg;
}

/** Substitute the `{round}` placeholder in the Continue note. Unknown placeholders are left alone, so a typo
 *  shows up as literal text in the tuner rather than silently vanishing. */
export function titleContinueNote(round: number): string {
  return cfg.continueNote.replace('{round}', String(round));
}

export function setTitleTextValue(key: keyof TitleTextConfig, value: string): void {
  cfg = { ...cfg, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
  for (const fn of listeners) fn();
}

export function resetTitleTextConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  for (const fn of listeners) fn();
}
