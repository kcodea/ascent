/**
 * @game/progression: ACCOUNT PROGRESSION (Account Level, XP, titles). Pure, dependency-free rules shared by the
 * client (packages/ui), the run observer (packages/sim runDerive) and, as a generated copy, the Deno Edge
 * Function `submit-progression`. See `rules.ts`.
 */
export * from './rules';
export { validateSubmitBody, handleSubmitProgression, settlementParity, SQL_ERROR_STATUS, type SettleRequest, type RpcCall, type HandlerResponse } from './server';
