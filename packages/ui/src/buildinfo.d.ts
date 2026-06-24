// Build identity injected by apps/web's Vite config (`define`) — present in the bundled app + dev server.
// Declared here so the UI typechecks. Only reference these in app-only code (not in headless/test paths).
declare const __APP_VERSION__: string;
declare const __BUILD_SHA__: string;
