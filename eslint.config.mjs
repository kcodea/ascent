import tseslint from 'typescript-eslint';

/**
 * Day-one ban (handoff C.9): no `Math.random` in core/content/sim — and in tools,
 * since `npm run pool` (build-pool → synthesize) generates the COMMITTED opponent
 * pool: nondeterminism there means unreproducible pool builds. Determinism is the
 * foundation of the engine — all randomness must flow through the seeded Rng
 * (`makeRng`). The UI layer is exempt (cosmetic only).
 */
const banMathRandom = {
  files: ['packages/core/**/*.ts', 'packages/content/**/*.ts', 'packages/sim/**/*.ts', 'packages/tools/**/*.ts'],
  rules: {
    'no-restricted-properties': [
      'error',
      {
        object: 'Math',
        property: 'random',
        message:
          'Determinism: use the seeded Rng (makeRng) instead of Math.random in core/content/sim.',
      },
    ],
  },
};

/**
 * No native browser tooltips (owner 2026-09-24: "remove the window tooltips on these buttons (and every button)
 * they break immersion so badly"). A `title` attribute on a DOM element, an SVG `<title>` child, or an imperative
 * `el.title = …` / `setAttribute('title', …)` all paint the OS tooltip. Give screen readers `aria-label` /
 * `aria-description`, and put player-facing hover text in the game's own bubble (`className="gtip"
 * data-tip="…"`, styles.css). Component props that happen to be NAMED `title` (capitalised JSX tags) are fine.
 */
const TITLE_MSG =
  'No native title tooltips: use aria-label / aria-description, and the game bubble (className="gtip" data-tip="…") for hover text. See CLAUDE.md UI conventions.';
const banTitleTooltips = {
  files: ['packages/ui/**/*.{ts,tsx}', 'apps/web/**/*.{ts,tsx}'],
  ignores: ['**/*.test.{ts,tsx}'],
  rules: {
    'no-restricted-syntax': [
      'error',
      { selector: "JSXOpeningElement[name.type='JSXIdentifier'][name.name=/^[a-z]/] > JSXAttribute[name.name='title']", message: TITLE_MSG },
      { selector: "JSXOpeningElement[name.name='title']", message: TITLE_MSG },
      { selector: "AssignmentExpression > MemberExpression.left[property.name='title']:not([object.name='document'])", message: TITLE_MSG },
      { selector: "CallExpression[callee.property.name='setAttribute'][arguments.0.value='title']", message: TITLE_MSG },
    ],
  },
};

export default tseslint.config(
  // `apps/desktop/release/**` is packaged build output (a copy of main.cjs plus the whole Electron
  // runtime) — linting it reports the same findings twice and would fail on vendored code.
  // `.claude/**` is per-machine agent tooling: locally-installed plugins/skills and worktrees, all
  // gitignored. CI never sees it, so linting it only produces errors in OUR shells that no PR can fix
  // (and that drown out real findings) — a dev with a plugin installed would get a red `npm run lint`
  // on a clean tree.
  // `supabase/functions/**` is Deno (remote URL imports, Deno globals) — not part of the Node monorepo build.
  // `.local/**` is gitignored local state (pulled bug reports, and the throwaway worktree `npm run docbot:retro`
  // creates while it runs) — a lint that overlaps a retro run must not report the throwaway's files.
  { ignores: ['**/node_modules/**', '**/dist/**', '**/*.tsbuildinfo', 'apps/desktop/release/**', '.claude/**', '.local/**', 'supabase/**'] },
  ...tseslint.configs.recommended,
  {
    // Electron's main process is CommonJS: it is loaded by Electron itself, not bundled, so `require` is the
    // right (and only) way to reach `electron` and node builtins there.
    files: ['apps/desktop/**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  banMathRandom,
  banTitleTooltips,
);
