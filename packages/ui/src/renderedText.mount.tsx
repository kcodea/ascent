/**
 * Minimal React mount harness for the rendered-text reconciliation tests (`renderedText.test.tsx`).
 *
 * Deliberately tiny — no testing-library, no fake timers, no global setup file. A test file that uses this
 * must run under jsdom (per-file `@vitest-environment jsdom` docblock); the rest of the suite stays in the
 * default node environment. One shared root is reused across renders so sweeping ~60 cards doesn't pay a
 * fresh React root per subject.
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renameTerms } from './terms';

// React's act() refuses to run outside a test environment unless this flag is set.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Mounted {
  container: HTMLElement;
  /** Re-render the SAME root with a new tree (cheap per-subject sweep). */
  render(node: ReactNode): void;
  unmount(): void;
}

export function mount(node: ReactNode): Mounted {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const render = (n: ReactNode): void => { act(() => { root.render(n); }); };
  render(node);
  return {
    container,
    render,
    unmount: () => { act(() => { root.unmount(); }); container.remove(); },
  };
}

/**
 * What a rules string SHOULD read as once the Card has rendered it: the same sanctioned transforms the Card
 * applies (`mdBold` folds `renameTerms` then bolds; `descUp`/`descTemp`/`descRune`/`descBoth` turn the
 * `{{…}}`/`((…))`/`[[…]]`/`<<…>>` markers into styled spans), reduced to plain text. `textContent` of the rendered `.desc` must equal
 * this exactly — anything else means the DOM is showing something other than what the helper computed.
 */
export function plainOf(s: string): string {
  return normWs(
    renameTerms(s)
      .replace(/\*\*(.+?)\*\*/g, '$1') // <b> — textContent keeps the content
      .replace(/\{\{(.+?)\}\}/g, '$1') // green "modified value" span
      .replace(/\(\((.+?)\)\)/g, '($1)') // gold "temporary" span keeps visible parens
      .replace(/\[\[(.+?)\]\]/g, '$1') // blue "rune-granted" span
      .replace(/<<(.+?)>>/g, '$1'), // TRIBE-coloured (Both) span
  );
}

/** Collapse whitespace so layout-driven text-node splits can't fail an equality on content that matches. */
export function normWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** The rendered rules text of the (single) card inside `container` — '' when no text drawer rendered. */
export function descTextOf(container: HTMLElement): string {
  return normWs(container.querySelector('.desc')?.textContent ?? '');
}

/** The rendered attack/health badge digits of the (single) card inside `container`. */
export function badgeValuesOf(container: HTMLElement): { attack: string; health: string } {
  return {
    attack: normWs(container.querySelector('.badge.atk .value')?.textContent ?? ''),
    health: normWs(container.querySelector('.badge.hp .value')?.textContent ?? ''),
  };
}
