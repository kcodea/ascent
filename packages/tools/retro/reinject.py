import io, subprocess, sys

SIM = 'packages/core/src/combat/simulate.ts'
FAC = 'packages/core/src/effects/factories.ts'
RED = 'packages/sim/src/reducer.ts'

BUGS = [
  ('1176-avenge-arrival', SIM,
   'minion.avengeBaseline = deaths[side];',
   'minion.avengeBaseline = 0; // REINJECT: summoned Avenge counts the whole fight'),
  ('897-stag-multiplier', SIM if False else FAC,
   'const procs = (1 + (ctx.echoExtras?.(target) ?? 0)) * mul(self);',
   'const procs = mul(self); // REINJECT: Stag consults no Echo multiplier'),
  ('933-triple-temp-keywords', RED,
   'const tempOnly = (k: Keyword): boolean =>',
   "const tempOnly = (_k2: Keyword): boolean => false; // REINJECT
  const tempOnlyUnused = (k: Keyword): boolean =>"),
  ('941-aftershocks-per-watcher', SIM,
   "const ownEcho = effect.on === 'onDeath' && (payload as { minion?: Minion } | undefined)?.minion === minion;",
   "const ownEcho = effect.on === 'onDeath'; // REINJECT: every watcher wraps as an Echo trigger"),
  ('832-soulbind-uid', SIM,
   'const idOf = (m: Minion): string => m.sourceUid ?? m.uid;',
   'const idOf = (m: Minion): string => m.uid; // REINJECT: bond never matches combat clones'),
  ('1111-beefy-fizzle', FAC,
   "'spellBuffTargetAndNeighbours', 'spellBuffByTier', // Beefy + Lantern Light (2026-08-19)",
   '// REINJECT: Beefy + Lantern Light fizzle in combat'),
  ('932-undertow-uncapped', SIM,
   "undertowUsed[side] < (typeof undertow === 'number' ? undertow : 4)",
   'true /* REINJECT: unbounded Undertow */'),
  ('986-summon-order', SIM,
   'for (const w of [...boards[s]]) {',
   'for (const w of [...boards[s]].reverse()) { // REINJECT: augmenters right\u2192left'),
]

bug_id = sys.argv[1]
mode = sys.argv[2]  # apply | list
if mode == 'list':
    for b in BUGS: print(b[0])
    sys.exit(0)
for (bid, path, old, new) in BUGS:
    if bid != bug_id: continue
    s = io.open(path, encoding='utf-8').read()
    n = s.count(old)
    if n < 1:
        print(f'ANCHOR_MISS {bid} ({n} matches)'); sys.exit(2)
    io.open(path, 'w', encoding='utf-8', newline='\n').write(s.replace(old, new))
    print(f'APPLIED {bid}'); sys.exit(0)
print('UNKNOWN', bug_id); sys.exit(3)
