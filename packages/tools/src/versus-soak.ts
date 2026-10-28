/**
 * `npm run versus:soak` — STUB. The live-backend soak test for Versus (planned; NOT implemented, never run yet).
 *
 * The deterministic chaos harness (`packages/ui/src/versus/chaos/`, `CHAOS_FULL=1 npx vitest run versusChaos`) proves
 * the Versus flow against PGlite + the real store + the real resolver handlers. What it cannot prove is the real
 * network: Supabase Realtime, PostgREST, the deployed `versus-resolve` Edge Function and real browser throttling. This
 * script is where a soak against the LIVE project would go: N headless Playwright clients, each its own anonymous
 * account, playing full matches in quiet hours and reporting the same invariants the harness checks.
 *
 * HARD CAPS (owner rules; a future implementation must keep every one):
 *   - at most 4 bot clients per run (one Versus room: 1v1, Group of 3-4, Duos or Ranked Duos);
 *   - every identity is named Claudebot1, Claudebot2, ... (never a person's name);
 *   - every room the soak opens is LEFT AND CLOSED when it ends, on success, failure or Ctrl-C;
 *   - quiet hours only, short runs (Supabase egress is metered: at most a few matches per run);
 *   - headless Playwright with its own throwaway `--user-data-dir`, closed after each run; never the owner's browser;
 *   - never the dev server on port 5173.
 *
 * Today it only validates the requested plan and prints it (`--dry-run`, the default). `--live` refuses.
 *
 *   npm run versus:soak -- --mode duel --bots 2 --matches 1
 */
const MODES = ['duel', 'group', 'duos', 'ranked_duos'] as const;
type Mode = (typeof MODES)[number];
const MAX_BOTS = 4;
const MAX_MATCHES = 3;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const mode = (arg('mode') ?? 'duel') as Mode;
const bots = Number(arg('bots') ?? (mode === 'duel' || mode === 'ranked_duos' ? 2 : 4));
const matches = Number(arg('matches') ?? 1);
const live = process.argv.includes('--live');

const problems: string[] = [];
if (!MODES.includes(mode)) problems.push(`--mode must be one of ${MODES.join(', ')}`);
if (!Number.isInteger(bots) || bots < 2 || bots > MAX_BOTS) problems.push(`--bots must be 2..${MAX_BOTS} (cap)`);
if ((mode === 'duel' || mode === 'ranked_duos') && bots !== 2) problems.push(`${mode} seats exactly 2 live players`);
if (mode === 'duos' && bots !== 4) problems.push('duos seats exactly 4 players');
if (mode === 'group' && bots < 3) problems.push('group seats 3 or 4 players');
if (!Number.isInteger(matches) || matches < 1 || matches > MAX_MATCHES) problems.push(`--matches must be 1..${MAX_MATCHES} (egress cap)`);
if (problems.length) {
  console.error(`versus:soak: ${problems.join('; ')}`);
  process.exit(2);
}

const names = Array.from({ length: bots }, (_, i) => `Claudebot${i + 1}`);
console.log('versus:soak plan (STUB, nothing is sent):');
console.log(`  mode ${mode}, ${bots} clients (${names.join(', ')}), ${matches} match(es)`);
console.log('  each client: headless Playwright, own --user-data-dir, anonymous session, closed after the run');
console.log('  chaos per match: one network drop + restore, one 15 s background, realtime blip (as the harness scenarios)');
console.log('  invariants: the harness set (close, resolve, oneCall, stuck, falsePause, pauseLift, vitals, fights, final)');
console.log('  teardown: every client leaves; the host closes the room; browsers closed');
if (live) {
  console.error('versus:soak: --live is not implemented yet. Run the deterministic harness instead: CHAOS_FULL=1 npx vitest run versusChaos');
  process.exit(1);
}
