# FX Library: "Save all edits", and why By-card edits never reached the file

**Owner ask (2026-09-25):** stop the FX Library's By-card view refreshing the page every time something is added;
put a big orange **Save all edits** button bottom-left, under the Set options.

- **What was actually refreshing:** importing a sound onto a card writes a new `sfx-<name>.json` into the globbed
  defs folder, and a new glob-matched file makes Vite force a page reload. Those defs are now parked
  (`fx/pendingDefs.ts`, registered for the session so they play at once, kept in localStorage across a reload) and
  written by Save.
- **What was silently failing:** every By-card edit POSTed the whole bindings table, and the dev server's
  `/__fx/bindings` whitelist (`BINDING_FAN_OUTS` in `apps/web/fxDefsPlugin.ts`) only knew `primary` / `damaged` /
  `selfBuffed`. Once `bindings.json` held a `struck` / `buffed` / `buffedOn` row (Karwind, Dragonflame, the Ales,
  Oona…), every save 400'd. By-card edits have lived only in the browser's session overlay (`ascent.fxBindings`)
  since. Fixed, and pinned by a test that runs the committed `bindings.json` through the endpoint and compares its
  fan-out list with the reader's (rule R-FXSAVE-02).
- **Now:** edits apply live; the button lights orange while `hasUnsavedBindings()` or a parked def says there is
  something to write; Save sends every write in parallel (any one of them triggers the reload), so the page reloads
  once per batch.
- **Heads-up for the first save:** an author's existing session overlay holds every edit that failed to save
  before this fix, so the button may be lit on first open, and saving writes those too.
