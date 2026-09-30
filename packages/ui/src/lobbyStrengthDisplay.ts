/**
 * LOBBY STRENGTH DISPLAY SWITCH — the one place that decides whether the "Lobby 47%" readout is printed on any
 * player-facing surface (Career match rows, Recent Games rows, the rules wiki answer).
 *
 * HIDDEN FOR NOW (owner 2026-09-30): "we can hide the lobby% number for now since it doesnt seem to be working too
 * well at the moment." Only the DISPLAY is off: the value is still computed at run end, stamped on the replay
 * result and the history row, uploaded, and still feeds the rank strength bonus exactly as before. Flip this to
 * `true` to bring the readout back everywhere at once.
 */
export const SHOW_LOBBY_STRENGTH: boolean = false;
