# 2026-11-20: Settings gets Cosmetics + Keybindings tabs

Owner ask: per-cosmetic show/hide switches that also work while spectating, and a keybindings area.

- **Cosmetics** (`packages/ui/src/cosmetics/cosmeticVisibility.ts`, R-SETTINGS-COSMETICS-01): one switch per drawn
  category (minion skins, card plates, hero skins, portrait frames, hero attacks, titles, player emotes, announcer
  pack). Default on. Applies to EVERYONE (you included) and is enforced at the one UI resolver per category
  (`heroPortrait`, `minionSkinMap`, `cardPlateLookOf`, `TitleBadge`, `usePortraitFrame`, `attackerCosmeticOf`,
  `equippedAnnouncerPack`, `showEmoteBubble`), so spectating, replays and the lobby honour it with no per-surface code.
  Purely presentational: no snapshot or server change. Re-render path: `useSkinEpoch` folds in the switch epoch, and the
  ~25 `showOpponentSkins` readers now go through `useShowOpponentCosmetics()` which subscribes to it. Collection /
  reward previews pass `TitleBadge item` so they are never hidden. Boards and Music get no switch (catalog-disabled).
  Mine-vs-others split per category was NOT built: the resolvers do not know the owner, and the existing "Show opponent
  cosmetics" switch already covers "hide only other people's".
- **Keybindings** (`packages/ui/src/keybinds/keybinds.ts`, R-SETTINGS-KEYBINDS-01): one registry, up to two keys per
  action, `matchesAction(id, e)` at every handler (Compendium, Duos peek, lobby chat, spectator seats 1-4 + NEW Next E /
  Previous Q, replay transport). Conflicts swap. Esc, Ctrl+B, F11 fixed. A waiting key button sets `keyCaptureActive()`
  so the Esc handlers (Game, phHistory) stand down and Esc only cancels.
- **Extras**: Hover sounds switch (Audio), Show FPS counter (Video, `FpsCounter.tsx`, own rAF only while on).
- `SettingsPanel` (old, DEV-only) was not extended; the parity test now checks the shell carries every old control.
