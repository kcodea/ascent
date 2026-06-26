// Build identity injected by apps/web's Vite config (`define`) — present in the bundled app + dev server.
// Declared here so the UI typechecks. Only reference these in app-only code (not in headless/test paths).
declare const __APP_VERSION__: string;
declare const __BUILD_SHA__: string;

// Vite env vars (apps/web/.env*) — the optional Supabase board backend (see remoteBoards.ts). Absent → the
// remote sync no-ops and the game runs fully offline off the committed pool.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
