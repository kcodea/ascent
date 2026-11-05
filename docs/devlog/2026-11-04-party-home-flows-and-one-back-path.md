# Party home: end-to-end flows and one Back path

**Why:** seventeen critic rounds kept finding the same shape of bug. The owner asked for the UI to work end to end on one branch,
proved by a repeatable script.

**The flow suite:** `scripts/ph-flows/` drives the party home in a headless Playwright shell against a prod-like bundle with no
backend address (`apps/web/vite.flows.config.ts`, built to `apps/web/dist-flows`). Every context blocks anything but this machine.
`solo.mjs` (Practice, Saved game, Gauntlet, Ranked, Learn), `versus.mjs` (1v1, Group, Duos, Ranked Duos on the local Worker),
`pages.mjs` (pages from Home and over a game, reloads, guest and signed-in stubs), `layers.mjs` (Esc and Back). Each takes
`[desk|lap|phone|all] [filter]`. Needs `CHROME_PATH` set to the Playwright headless shell; `versus.mjs` needs
`wrangler dev --port 8797 --var DEV_AUTH:1` in `workers/versus`.

**The one Back path (R-PH-BACK-LAYERS-01):** `phHistory.ts` now keeps a stack of layers above the page. `usePhLayer(open, close)` puts
any pop-up, list, sheet or window on it. A capture-phase Esc listener runs ahead of every component's own, so the components' Esc
handlers only matter off the shell. Off the shell `phLayer` does nothing, so production is unchanged.

**Traps for the next session:**
- The Good Luck intro swallows Esc on purpose. A test that presses Esc in its first seconds sees nothing happen.
- A hero card pressed while the gate is still lifting is not a pick. A scripted pick must wait for the gate, or the 20 s clock runs out.
- Recent Games' hero list needs server data, so the flows cannot reach its More list offline.
