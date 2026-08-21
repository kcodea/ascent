# 2026-08-20 — first hero-select voiceover: Lord of the Risen

The hero-select voiceover pipeline was already fully wired (`sfx.heroSelect(heroId)` →
`playSample('heroes/<id>', 'heroSelect')`, routed through the `hero` bus, layered over the generic pick
pulse) but had never fired with a real clip — no `audio/heroes/` file had ever existed. This ships the
first one.

**What changed.** Dropped `packages/ui/src/audio/heroes/risen.mp3` (Lord of the Risen's select line, hero
id `risen`). No code changed — the file is picked up by the existing
`import.meta.glob('./audio/heroes/*.mp3')` in `sfx.ts`, so it plays automatically when the hero is chosen in
both Ascent and Practice (identical `onClick` handlers in `HeroSelect.tsx`).

**How it got in.** Via `npm run sfx:import -- --keep --inbox "<Cubase Hero Select export>"`. The importer's
`parseName` splits `"Lord of the Risen - Select.mp3"` into variant `select` + name-slug `lordoftherisen`,
resolves that to hero `risen`, and copies it to `heroes/risen.mp3` (`--keep` leaves the Cubase source
in place). It also regenerated `docs/audio/sfx-manifest.md` + `sfx-guide.html`, flipping the "Lord of the
Risen selected" row from to-record to recorded.

**Verified.** File is a valid MPEG-III mono clip (2.93s) that `decodeAudioData` accepts — confirmed by
decoding the exact shipped file in a browser. Vite serves it at the `/@fs/` URL the glob resolves to
(`audio/mpeg`, 63466 bytes). Owner confirmed it plays in-game from Practice. `npm run build:web` bundles it
clean. (An initial "no sound" report was a stale tab pointed at another session's dev server that lacked the
file, not a code issue.)

**Follow-ups.** Same one-command flow imports every future hero the moment its `"<Hero Name> - Select.mp3"`
lands in that folder — the name→id resolution is automatic. `heroSelect` category gain is 0.5 on the `hero`
bus; retune in `packages/ui/src/audio/config.ts` if the mix wants it.
