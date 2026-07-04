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

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/*.tsbuildinfo'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  banMathRandom,
);
