/**
 * BALANCE BOT B5 — the one place the tools-side balance code names its engine imports, so the sim's public
 * surface (and the `@game/sim/balance/*` subpath the contract lives under) is crossed in exactly one file.
 */
export { CARD_INDEX, RUNE_INDEX, RUNES, EPIC_RUNES, SETS, poolFor } from '@game/content';
export { HEROES, playableHeroes } from '@game/sim';
export type {
  AcceptedActionEvent, BalanceRecorder, EffectEvent, ExperimentIdentity, ExperimentManifest, LobbyRecord, RoundRecord, RunRecord, SeatPilot,
} from '@game/sim/balance/types';
export { synthesizeJob, synthesizeLobby, syntheticIdentity, syntheticManifest, type SyntheticOptions } from '@game/sim/balance/fixtures/syntheticLobby';
// The RUNNER (B1) and RECORDER (B5), joined here by the integrator for `balance:run`.
export { runSelfPlayLobby } from '@game/sim/balance/selfPlayLobby';
export { createRecorder } from '@game/sim/balance/recorder';
export { pilotFor } from '@game/sim/balance/pilots';
