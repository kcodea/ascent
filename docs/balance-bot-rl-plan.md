# A balance bot we can trust: the self-play RL plan (2026-09-15)

**Owner's requirement:** an instrument that gives *legitimate* balance insights for future sets, because the
player base is too small to balance from live data alone — and, as a by-product, bots that can actually play
(better Practice opponents). **Owner's bar:** mean placement < 4.0 over 100 pinned lobbies against real recorded
players (< 3.0 strong, < 2.0 phenomenal).

**Where the hand-built pilot stopped:** 6.3–6.4. Six independent levers on 2026-09-15 (line prior, engine-growth
probe, two-turn horizon, imitation-from-recordings, hand-scripted expert lines, engine-combo macros) each moved it
by < 0.2 (`docs/balance-bot.md`, trust ledger). The pattern — every hand-designed evaluator plateaus at the same
place — is the classic signal that the game's value function is too deep to write by hand. That is precisely the
problem the industry solved with **self-play reinforcement learning**.

## What other studios actually do

| Who | Game / goal | Method | Outcome | Source |
|---|---|---|---|---|
| **Riot Games** (Ben Kasper, applied AI research) | *Legends of Runeterra* — predict OP/UP cards and decks **before release**, on a small internal player base | **Self-play deep RL** (Ray / RLlib), distributed game-playing at scale; started with 1 deck, scaled to 10; a recipe that "explicitly considered future variations in gameplay" | Agent reached **48 % win rate vs top human players**; RL metrics "consistently matched design intuition, correctly predicted the strongest deck, and showed directional congruence with live data"; productionised as API + app + dashboard; the RL **balance scores became designer KPIs** | [Anyscale: Riot Games and deep RL](https://www.anyscale.com/blog/riot-games-and-deep-reinforcement-learning-in-gaming), [talk](https://www.anyscale.com/events/2022/03/29/deep-reinforcement-learning-at-riot-games) |
| **King** (Candy Crush) | Level difficulty prediction for 13,000+ levels | Bots trained to **imitate humans** (choose the move a human would), not to be superhuman; validated against live player data; a designer co-pilot that auto-tweaks | ~95 % reduction in manual fixes; difficulty predictions used in level design | [GDC: How King uses AI](https://gdcvault.com/play/1023858/How-King-Uses-AI-in), [Mobilegamer](https://mobilegamer.biz/how-king-balances-human-and-ai-powered-design-in-candy-crush-saga/), [InfoQ](https://www.infoq.com/articles/candy-crush-QA-AI-saga) |
| **EA SEED** | Battlefield / Dead Space test coverage, exploits, "balanced and solvable" | RL agents added to a scripted-bot harness | Coverage + exploit discovery; balance named as the next use | [EA SEED](https://www.ea.com/seed/news/automated-game-testing-deep-reinforcement-learning), [CoG 2023 challenges paper](https://arxiv.org/pdf/2307.11105) |
| **Ubisoft** | Far Cry / Rainbow Six / Roller Champions | RL bots in production test pipelines | Coverage; Roller Champions RL agents as opponents | [Roller Champions RL](https://arxiv.org/pdf/2012.06031) |
| **Riot** (TFT live balance) | The closest genre | Not bots — **three pillars: data, designer intent, player perception** from millions of live games; a "baseline comp" method | Works only with a huge player base — exactly what we lack | [Set 12 approach](https://tfthub.com/2024/08/05/set-12-the-tft-teams-approach-to-balancing/), [GAT](https://teamfighttactics.leagueoflegends.com/en-us/news/dev/talking-tactics-game-analysis-team-gat/) |
| **Academic** | Card game (LOCM) battling; Generals.io; Pokémon | Self-play **PPO**; Generals.io: policy-gradient self-play on a **10,000× faster simulator** (4×H200, 4 days) → #1 on a 5,000-player ladder; Pokémon: offline RL on human replays + transformer | Self-play PPO is the standard recipe; **simulator throughput is the bottleneck every time** | [LOCM PPO](https://homepages.dcc.ufmg.br/~ronaldo.vieira/assets/pdf/sbgames-2022.pdf), [Generals.io](https://arxiv.org/abs/2606.23348), [Pokémon](https://arxiv.org/pdf/2504.04395), [Big 2 self-play](https://arxiv.org/pdf/2605.28863) |

The tried-and-true method for *our* problem (small player base, need pre-release balance reads) is Riot's LoR
recipe: **self-play RL on the real engine, validated against human data, then balance metrics read off the trained
population.** Nobody with a small player base got there with hand-written evaluators; nobody got there by imitating
a few dozen human runs either (King imitates from *millions*).

## Why it will work here when the hand pilot didn't

- **The engine is already the right shape.** Deterministic, pure, seeded, decoupled from UI, `reduce` as the
  single legal-action gate, `legalActions` already exists. That is the hard part of an RL environment and it is
  done.
- **It is fast enough.** Measured 2026-09-15: a full 8-seat self-play lobby with a cheap pilot runs in
  **~200 ms** (30–46 rounds) — ~25 ms per run, ~1,500 decisions. On this 16-core machine that is ~80 lobbies/s,
  **~7 M lobbies / 55 M runs per day**. Riot and the Generals.io team had to engineer their throughput; ours is a
  worker pool away.
- **The benchmark exists.** The pinned lobby vs real recordings (`balance:run` in `pinnedLobby` mode, audited
  fair in B10) is the held-out test Riot validated against live data with. We already have the ruler; we lack
  the player.
- **The balance instrument exists.** `balance:matrix`, `balance:findings`, `balance:compare` (paired seeds,
  bootstrap CIs, BH-FDR) only need a pilot that plays well to produce trustworthy numbers.

## The plan

### Phase 0 — the environment (1 week)
1. `packages/sim/src/rl/env.ts`: a gym-style wrapper over one seat — `reset(seed, hero, set)`, `observe()`,
   `legalMask()`, `step(actionIndex)`; every step goes through `reduce`; fights through the existing seat runner.
   Discrete action space (~120 with masking): buy slot *i*, sell *i*, play hand *i* → board pos *j*, move *i* → *j*,
   refresh, tier up, cast spell → target, hero power (+ target), discover pick, Runeforge pick / reroll / skip, quest
   pick, end turn. Prompts are just masked actions.
2. Observation: the existing `BotVisibleState` (player-legal info only) flattened — per-card token (id embedding,
   attack, health, tier, tribe, keywords, golden, buffs), slots for board/hand/shop/spell, scalars (gold, tier,
   resolve, armor, wave, upgrade cost, runes, hero, quest), plus the scouted opponent and the lobby table (alive
   seats' last-known power). No hidden info.
3. Eight-seat **self-play lobby env**: eight policies (current + sampled past checkpoints) in the real
   `selfPlayLobby`, reward = placement mapped to [−1, +1] at the end (plus optional small per-round shaping:
   damage dealt − taken, normalised; drop it once the sparse reward trains).
4. Throughput: a Node worker pool stepping 512+ envs, batched observations over shared memory to the trainer.
   Target ≥ 50 lobbies/s sustained. Measure and record.

### Phase 1 — the policy (2–3 weeks)
5. Trainer in Python/PyTorch (the standard stack — or CleanRL-style PPO; RLlib if we want Riot's exact tooling).
   Network: a small transformer / set-encoder over card tokens + scalar MLP → policy logits (masked) + value head.
   Card-id embeddings are shared across sets, so a **new set only adds rows** — the bot transfers.
6. **PPO self-play with a league** (AlphaStar-style, small): the learner plays against a pool of past checkpoints
   sampled by win rate, so it cannot cycle or overfit to one meta — this is the "future variations in gameplay"
   piece of Riot's recipe, and it is also what gives *line diversity* (the population plays many lines, not one).
7. Curriculum: seat 0 of a lobby of recordings first (the pinned env — dense signal, real opponents), then full
   self-play, then mixed. Hero rotated per episode; tribe set rotated so every package is learned.
8. Milestones on the held-out pinned benchmark (100 lobbies, seeds 1–100): 5.0 (beats the hand pilot), **4.0
   (the bar)**, 3.0. Riot's LoR agent stopped at 48 % vs top humans — i.e. roughly a strong-human level; expect
   the same ceiling here, which is enough.

### Phase 2 — the balance instrument on top (1 week, mostly exists)
9. Freeze a checkpoint as the **reference population**. Balance reads, all paired-seed and CI'd (existing tools):
   - **Hero**: mean placement per hero over ≥ 300 lobbies with the population rotating lines (`balance:matrix`).
   - **Card / rune**: placement of runs that acquired X vs not (findings), *plus* the counterfactual Riot used —
     **remove or nerf X via an overlay and re-run** (`balance:compare`); the delta with CI is the balance score.
   - **Meta**: line pick rates, tier curve, goldens, stat curve vs the human corpus (`balance:gap`).
10. **Validation gate before trusting any number** (Riot's "directional congruence"): the bot's hero / card ranking
    must agree in direction with the survival tables from the human corpus (`docs/balance-bot-player-study.md`)
    where the corpus has support. Disagreements are investigated, not averaged away.
11. **New set workflow**: add the set's cards → fine-tune the checkpoint (embedding rows + a few hours of self-play)
    → matrix + findings → designer reads the outliers before release. This is the "requirement for future sets".

### Phase 3 — better bots (by-product)
12. Practice opponents from checkpoints at different training stages = a real difficulty ladder (early checkpoint
    = easy, final = hard), and the bot can run inside the client's existing `productionBots` seam. Sampling
    temperature gives personality without hand-writing lines.

## Costs, honestly

- **Compute**: CPU-bound on the simulator; this 16-core machine is enough for a first policy (millions of lobbies
  per day). A single consumer GPU makes the trainer a non-issue. A cloud burst (e.g. 64–128 cores for a few days)
  shortens Phase 1 from weeks to days if we want it.
- **Engineering**: ~4–6 weeks of one focused person (or agent-driven with owner review at each milestone) to the
  4.0 milestone; the environment and league are the real work, the trainer is off-the-shelf.
- **Risks**: (a) the recruit phase's long action sequences per turn (10–20 decisions) make credit assignment
  harder than LoR's — mitigated by the curriculum and value bootstrapping; (b) self-play metas can drift from
  human metas — mitigated by the league + the pinned validation gate; (c) it learns exploits — which is a
  *feature* for balance (Riot's "captured patterns in game states that unbalanced the game").

## What to keep from today, and what this replaces

Keep: the instrument (`balance:*`), the pinned benchmark and its fairness audit, the human corpus + player study,
the manifests / identity / overlay discipline. Replace: the hand-written evaluator and search as the *policy*
(they stay as a baseline and as a sanity check — a learned policy that loses to them is broken).

## Decision needed from the owner

1. Go / no-go on Phase 0–1 (the environment + PPO self-play league).
2. Compute: local 16 cores only, or a cloud burst allowed.
3. Training stack: Python + PyTorch (recommended; standard, most examples) vs staying all-TypeScript.
