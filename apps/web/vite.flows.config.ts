/**
 * THE END-TO-END FLOWS BUNDLE (scripts/ph-flows): a production bundle with the party home switched on, the bench handles, and NO
 * backend address, so a scripted game can never reach the live service.
 */
import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

process.env.VITE_PERF_BENCH = '1';
const cfg = typeof base === 'function' ? (base as (e: unknown) => object)({ command: 'build', mode: 'production' }) : base;
export default mergeConfig(cfg as object, defineConfig({
  define: { 'import.meta.env.DEV': 'true', 'import.meta.env.VITE_SUPABASE_URL': '""', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '""' },
  build: { outDir: 'dist-flows', emptyOutDir: true },
}));
