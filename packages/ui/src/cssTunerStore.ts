/**
 * A store for the three tuners that have NO config module — the card frames, the Compendium palette, and the
 * charge glyph.
 *
 * WHY THEY ARE DIFFERENT. The other forty-odd tuners each drive a config module that owns a `localStorage` key
 * and pushes its values onto `:root` as custom properties. These three instead COMPOSE CSS: a colour picker and
 * an opacity slider become one `drop-shadow(...)` string, a flat pick and a falloff become one
 * `linear-gradient(...)`. There is no single var per control to write, so each of them kept its values in React
 * state, built a stylesheet with `useMemo`, and wrote it into a specificity-bumped `<style>` element in the head
 * — the same fifty lines, three times, including the same easy-to-forget teardown on close.
 *
 * This gives them the accessor trio (`get` / `set` / `reset`) that a `TunerSpec` needs, and moves the composed
 * stylesheet, the `<style>` element and its removal here. The selectors stay DOUBLED (`.book.book`) so the
 * override beats the shipped rule whatever the source order — these panels are editing values that already have
 * a home in `styles.css`, and "Copy CSS" emits the undoubled version to paste back.
 *
 * Removing the element on close is load-bearing rather than tidiness: a left-behind override would keep the
 * board tinted with no visible cause, and the panel that caused it gone.
 */
export interface CssTunerStore<C extends object> {
  get(): C;
  /** Write one value. Numbers and strings both go through here — a composed look mixes them freely. */
  set(key: string, value: number | string): void;
  reset(): void;
  /** The doubled-selector stylesheet currently applied. */
  css(): string;
  /** Install the `<style>` element; the returned teardown removes it, restoring the shipped look. */
  mount(): () => void;
}

export function createCssTunerStore<C extends object>(opts: {
  /** `id` of the `<style>` element — one per panel, so two open panels cannot fight over it. */
  styleId: string;
  /** The shipped values. These MIRROR `styles.css`, so Reset returns you to what players see. */
  defaults: C;
  /** Compose the override stylesheet from the current values. Use doubled selectors. */
  css: (cfg: C) => string;
  /**
   * Optional `localStorage` key. Only the charge glyph persists: its look is dialled over long sessions against
   * a glyph that appears for twenty seconds at a time, so losing the values on reload was costly. The frame and
   * palette tuners are deliberately session-only — a saved tint that silently beat the shipped look is exactly
   * the trap this file's teardown exists to avoid.
   */
  storageKey?: string;
}): CssTunerStore<C> {
  const load = (): C => {
    if (!opts.storageKey) return { ...opts.defaults };
    try {
      const stored = JSON.parse(localStorage.getItem(opts.storageKey) || '{}') as Partial<C>;
      return { ...opts.defaults, ...stored };
    } catch {
      return { ...opts.defaults };
    }
  };

  let current: C = load();

  const save = (): void => {
    if (!opts.storageKey) return;
    try { localStorage.setItem(opts.storageKey, JSON.stringify(current)); } catch { /* ignore */ }
  };

  const apply = (): void => {
    const el = document.getElementById(opts.styleId);
    if (el) el.textContent = opts.css(current);
  };

  return {
    get: () => current,
    set(key, value) {
      current = { ...current, [key]: value };
      save();
      apply();
    },
    reset() {
      current = { ...opts.defaults };
      save();
      apply();
    },
    css: () => opts.css(current),
    mount() {
      let el = document.getElementById(opts.styleId) as HTMLStyleElement | null;
      if (!el) {
        el = document.createElement('style');
        el.id = opts.styleId;
        document.head.appendChild(el);
      }
      el.textContent = opts.css(current);
      return () => { document.getElementById(opts.styleId)?.remove(); };
    },
  };
}
