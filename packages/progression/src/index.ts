/**
 * @game/progression: ACCOUNT PROGRESSION (Account Level, XP, crates, the cosmetic catalog). Pure, dependency-free
 * rules shared by the client (packages/ui), the run observer (packages/sim runDerive) and, as generated copies, the
 * Deno Edge Functions `submit-progression` and `progression-inventory`. See `rules.ts` and `cosmetics.ts`.
 */
export * from './rules';
export * from './cosmetics';
export * from './achievements';
export { validateSubmitBody, handleSubmitProgression, settlementParity, syncAchievementCatalogOnce, resetAchievementSyncForTests, ACHIEVEMENT_SYNC_RETRY_MS, SQL_ERROR_STATUS, type SettleRequest, type RpcCall, type HandlerResponse } from './server';
export { validateInventoryBody, handleInventory, openParity, syncCatalogOnce, resetCatalogSyncForTests, CATALOG_SYNC_RETRY_MS, INVENTORY_ERROR_STATUS, type InventoryRequest, type CatalogSyncOutcome } from './inventory';
