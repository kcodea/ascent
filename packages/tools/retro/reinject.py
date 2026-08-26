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
   'const tempOnly = (_k2: Keyword): boolean => false; // REINJECT' + chr(10) + '  const tempOnlyUnused = (k: Keyword): boolean =>'),
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
  # ── catalog growth wave 2 (2026-08-26): 2 predicted-CAUGHT confirmations, 4 predicted-MISS probes ──
  ('8f98da40-spellpower-fold', RED if False else 'packages/sim/src/recruit.ts',
   '''      attack += spellAttackBonus(ctx.state);
      health += spellHealthBonus(ctx.state);''',
   '      // REINJECT: stat spell stops folding spell power (#8f98da40 class)'),
  ('c8a214d7-alltypes-aura', SIM,
   "if (!m.dead && m.health > 0 && m !== minion && (m.tribe === 'mech' || m.tribe2 === 'mech' || !!m.universalTribe)) ctx.buff(m, minion.rallyMechAtk!, 0, 'Better Bot');",
   "if (!m.dead && m.health > 0 && m !== minion && (m.tribe === 'mech' || m.tribe2 === 'mech')) ctx.buff(m, minion.rallyMechAtk!, 0, 'Better Bot'); // REINJECT"),
  ('bf996507-tribe-gate', RED,
   'if (ptDef?.targetTribe && !isTribe(target, ptDef.targetTribe)) return state;',
   '// REINJECT: the reducer accepts whatever target uid it is handed (#849 class)'),
  ('69d6a8e5-fizzle-consumed', RED,
   '          if (spellFizzles(s, def)) return state;',
   '          // REINJECT: an unusable untargeted spell is consumed doing nothing (#847 class)'),
  ('7af61a35-maxgold-cap', RED,
   's.maxGoldBonus = (s.maxGoldBonus ?? 0) + reps;',
   's.maxEmbers += reps; // REINJECT: the lead evaporates at the cap (#642 class)'),
  ('f45525c9-chipper-random', 'packages/sim/src/recruit.ts',
   'if (params.self !== true) {',
   'if (true) { // REINJECT: Chipper feeds a random friendly instead of itself (#803 class)'),
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
