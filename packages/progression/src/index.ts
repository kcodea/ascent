/**
 * @game/progression: ACCOUNT PROGRESSION (Account Level, XP, crates, the cosmetic catalog). Pure, dependency-free
 * rules shared by the client (packages/ui), the run observer (packages/sim runDerive) and, as generated copies, the
 * Deno Edge Functions `submit-progression` and `progression-inventory`. See `rules.ts` and `cosmetics.ts`.
 */
export * from './rules';
export * from './cosmetics';
export { validateSubmitBody, handleSubmitProgression, settlementParity, SQL_ERROR_STATUS, type SettleRequest, type RpcCall, type HandlerResponse } from './server';
export { validateInventoryBody, handleInventory, openParity, INVENTORY_ERROR_STATUS, type InventoryRequest } from './inventory';
