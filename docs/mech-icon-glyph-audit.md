# Mechanic-icon (`mechIcon` glyph) audit — 2026-08-19

**Branch:** `audit/mech-icon-glyph` · **Scope:** the glyph shown in a minion's medallion (the round badge
centred in the stat cluster, between Attack and Health). This audit covers **glyph resolution only** — which
symbol each card shows and why — not the medallion container or its combat pulses.

## Terminology

- **The medallion** — the round badge itself. In combat it also *pulses* (glow + energy ring) when the unit's
  effect fires (plain / red crit / yellow rally / light-blue watcher).
- **`mechIcon`** — the glyph drawn inside it: the card's "primary mechanic" symbol.

## How the glyph is resolved (`packages/ui/src/Card.tsx`)

```
mechIcon = trigger?.icon
        ?? (keywords[0] ? KW_ICON[keywords[0]] : TRIBE_ICON[tribe])
```

A three-tier priority: **trigger** (detected from the text prefix) → first **keyword** → **tribe** symbol.

- `triggerPill(text)` matches a **text prefix**: `battlecry` → `battlecry` glyph, `deathrattle` → `echo`
  (skull & crossbones), `avenge` → `skull`, `end of turn` → `sc` (lightning). Anything else → null.
- `KW_ICON` maps the 16 keyword codes to glyphs (`T→taunt`, `DS→shield`, `RL→sword`, `SC→fist`, …).
- `TRIBE_ICON` maps each tribe to a symbol (`demon→eye`, `undead→skull`, `dwarf→anvil`, `neutral→star`, …).

## Method

`ALL_CARDS` (445 cards) run through the **verbatim** resolution logic above (a throwaway generator replicated
`KW_ICON`/`TRIBE_ICON`/`triggerPill` and applied them to the real card data). Numbers below are computed, not
eyeballed. The full per-card resolution table is in the Appendix.

---

## Headline

**287 of 445 cards (64%) show the generic tribe symbol, not a mechanic glyph** — the medallion currently
reads as a *tribe* badge far more than a *mechanic* badge. **94** of those 287 name a real mechanic in their
text, so the glyph is not just generic but actively misleading. The single biggest cause is a rename desync.

## Finding 1 — ROOT CAUSE: trigger detection matches the pre-rename words (`Battlecry`/`Deathrattle`), but card text was renamed to `Shout`/`Echo`

`triggerPill` looks for the raw words `battlecry` and `deathrattle`. A large, growing share of card text has
been authored/migrated to the **player-facing** renames **`Shout`** and **`Echo`** — which the regex does not
match — so those cards fall straight through to the tribe symbol.

Counting cards whose text **opens** with each trigger word:

| opening word | cards | result |
|---|---|---|
| `Battlecry:` (old raw) | 15 | ✅ shows the Shout/megaphone glyph |
| `Shout:` (renamed) | **34** | ❌ no glyph → tribe fallback |
| `Deathrattle:` (old raw) | 17 | ✅ shows the Echo/skull-&-crossbones glyph |
| `Echo:` (renamed) | **17** | ❌ no glyph → tribe fallback |

**≥51 cards silently lose their trigger glyph purely because of the term used** — and the renamed form is now
the majority for Battlecry (34 vs 15). Two cards with the *same* mechanic show *different* things: `impking`
(`Deathrattle:`) shows the skull-&-crossbones; `burialimp` (`Echo:`, [demons.ts:207](packages/content/src/cards/set1/demons.ts#L207))
shows the Demon eye. Same for `havendrake` (`Battlecry:` → megaphone) vs `buddy` (`Shout:` → neutral star,
[neutral.ts:65](packages/content/src/cards/set1/neutral.ts#L65)).

This is the "Knocked" case from the report that kicked off the audit: its `Echo:` text isn't detected, so it
shows the Demon eye — which looks like a mechanic icon but is just the tribe.

## Finding 2 — Text-only mechanics that aren't keyword-tagged fall through too

Some mechanics live only in the text with **no corresponding keyword** on the card, so neither the trigger tier
nor the keyword tier fires. Most common: **Start of Combat** and **Slaughter** written in prose without the
`SC`/`SL` keyword. Examples (all showing their tribe symbol):

- `arenaheckler` — "**Start of Combat:** …" → `star`
- `packleader`, `mirrorrhino` — "**Start of Combat:** …" → `paw`
- `runescale`, `gravewarden` — "**Start of Combat:** …" → `flame` / `skull`

Compare `b2_quil`/`kennel`, which carry the `SC` keyword and correctly show the `fist`. The tagging is
inconsistent across the card pool.

## Finding 3 — Glyph collisions: one symbol, two meanings

Three glyphs are produced by semantically different sources, so the player cannot tell them apart:

| glyph | rendered as | claimed by |
|---|---|---|
| `eye` | an eye | keyword **ST** *and* tribe **demon** |
| `anvil` | an anvil | keyword **EG** *and* tribe **dwarf** |
| `skull` | a plain skull | tribe **undead** *and* trigger **Avenge** |

A Demon minion and an `ST` minion show the same eye; an Undead minion and any Avenge minion show the same
skull. (Also worth noting a near-collision: Avenge/undead use `skull` while Echo uses `echo` = skull &
crossbones — three skull-like glyphs in play.)

## Finding 4 — Keyword icons that never surface

Four keyword glyphs are defined but never actually render as a `mechIcon`, because those keywords are never the
card's `keywords[0]` (or are always trigger-overridden): **`CN`→consume, `IMM`→immune, `ST`→eye, `CR`→target**.
Dead entries in `KW_ICON` (and `ST`'s `eye` is half of collision #3 above without ever being seen).

## Finding 5 — Multi-keyword cards: `keywords[0]` alone decides

11 cards carry more than one keyword; the glyph is just whichever is listed first, which isn't always the most
salient. E.g. `tauntbreaker` (`DS,W,RL`) shows `shield`; `impala` (`W,DS,CR`) shows `windfury`. Low severity,
but the choice is arbitrary rather than designed. Full list in the Appendix (section C).

## Finding 6 — Priority question: a keyword can hide a same-card trigger

A card with a keyword **and** a trigger ability whose text doesn't *start* with the trigger shows the keyword.
E.g. `b2_armadiyo` ("**Taunt. Echo:** …") shows `taunt`, hiding the Echo. Whether Taunt or Echo should win is a
design call, not obviously a bug — flagging for a ruling.

---

## Recommendations (for a follow-up PR — not implemented here)

1. **Fix the rename desync (Finding 1) — highest impact.** Make trigger detection recognise both forms
   (`battlecry|shout`, `deathrattle|echo`), ideally by driving it from the same rename source the render layer
   uses (`terms.ts`) so detection and display can never drift again. Better still: detect a card's trigger from
   a **structured field**, not a text-prefix regex, so re-wording text can't silently break the glyph.
2. **Decide how text-only Start-of-Combat / Slaughter / Rally resolve (Finding 2):** either require the keyword
   tag on those cards (a content pass) or extend detection to the prose. Pick one so the pool is consistent.
3. **Resolve the glyph collisions (Finding 3):** give `ST`/`EG` (or `demon`/`dwarf`) distinct glyphs, or
   reconsider the tribe fallback entirely (next point).
4. **The big question — should the medallion fall back to the tribe at all?** With 64% of cards showing the
   tribe symbol, the medallion reads as a tribe badge. Options: (a) show a glyph only when there's a real
   mechanic and leave it empty otherwise; (b) keep the tribe fallback but make it visually distinct from a
   mechanic glyph; (c) accept it as a tribe indicator and stop calling it a mechanic icon. This is an
   owner/design decision the fixes above should be chosen to serve.
5. **Prune the dead `KW_ICON` entries (Finding 4)** once 1–2 are settled (some may start surfacing after a fix).

---

## Appendix: generated data

Sections A–E below are the raw generator output (collisions, the full 94-card gap list, multi-keyword cards,
unused icons, and the complete per-card resolution table).

## A. Glyph collisions (one symbol, multiple meanings)

| glyph | rendered as | claimed by |
|---|---|---|
| `eye` | eye | keyword:ST, tribe:demon |
| `anvil` | anvil | keyword:EG, tribe:dwarf |
| `skull` | plain skull | tribe:undead, trigger:Avenge |

## B. Misleading tribe-fallback gaps (94) — text names a mechanic but glyph shows the tribe symbol

| id | name | tribe | glyph shown | text starts |
|---|---|---|---|---|
| buddy | Buddy Buddy | neutral | `star` (star) | **Shout:** get a random **Tier 1** minion. |
| sylus | Sylus the Reaper | neutral | `star` (star) | **In combat,** your Deathrattles proc **1 more |
| chronos | Chronos | neutral | `star` (star) | Your **End of Turn** effects trigger **1 more* |
| arenaheckler | Arena Heckler | neutral | `star` (star) | **Start of Combat:** Give the minion **opposit |
| grim | Grim | beast | `paw` (paw) | **Echo:** give your Beasts **+8/+8** wherever  |
| mirrorrhino | Mirrorhide Rhino | beast | `paw` (paw) | **Start of Combat:** Summon a copy of this min |
| packleader | Pack Leader | beast | `paw` (paw) | **Start of Combat:** Give your **Beasts** **+3 |
| mossmemory_colossus | Mossmemory Colossus | beast | `paw` (paw) | **Echo:** resummon the first **3** other **Bea |
| cinder | Cinderwing Matron | dragon | `flame` (flame) | **Shout:** give your Shop spells **+1 Health** |
| karwind | Karwind | dragon | `flame` (flame) | Whenever a **Shout** triggers, give your Drago |
| bane | Bane | dragon | `flame` (flame) | After you trigger a **Shout**, give your Imps  |
| runescale | Runescale Drake | dragon | `flame` (flame) | **Start of Combat:** give your **Dragons** **+ |
| hoardwhelp | Hoard Whelp | dragon | `flame` (flame) | **Sell:** get **6 Gold**. **End of Turn:** get |
| gravebody | Grave Body | undead | `skull` (plain skull) | Copy your leftmost **Echo** when summoned. |
| gravewarden | Gravewarden | undead | `skull` (plain skull) | **Start of Combat:** Give a friendly **Undead* |
| reconfiguredcombinator | Reconfigured Combinator | mech | `gear` (gear) | Whenever you trigger a **Shout**, attach an At |
| beatboxer | Beatbot | mech | `gear` (gear) | Whenever a **Magnetic** attaches to another fr |
| feed | Soulfeeder | demon | `eye` (eye) | **Shout:** add a Fodder to your next shop. |
| chefraag | Chef Raag | demon | `eye` (eye) | **Echo:** give your minions **+1/+1**, equal t |
| burialimp | Burial Imp | demon | `eye` (eye) | **Echo:** summon an **Imp**. |
| impoverseer | Imp Overseer | demon | `eye` (eye) | **Shout:** Your Imps gain **+2/+1** this game. |
| bloodbinder | Bloodbinder | demon | `eye` (eye) | **Start of Combat — Bleed:** mark **2** random |
| helpwanted | Help Wanted | neutral | `star` (star) | **Discover** a Battlecry minion. |
| corpseboard | Corpse Board | neutral | `star` (star) | **Discover** a **Deathrattle** minion. |
| fleetingvigor | Fleeting Vigor | neutral | `star` (star) | **Start of combat:** give your minions **+2/+1 |
| resonance | Resonance | neutral | `star` (star) | Trigger a friendly **Battlecry** minion's Batt |
| chronostaff | Chrono Staff | neutral | `star` (star) | Your **End of Turn** effects trigger **1 more* |
| consume | Consume | neutral | `star` (star) | Choose a **Demon** — it consumes a **Fodder**. |
| rallyoffensive | Rallying Offensive | neutral | `star` (star) | Your **Rally** effects trigger **twice** next  |
| ossuaryrite | Ossuary Rite | undead | `skull` (plain skull) | Trigger a friendly minion's **Echo** (Deathrat |
| funeralonloan | Funeral on Loan | neutral | `star` (star) | **Discover** an **Echo** minion. If you play i |
| weaken | Weaken | neutral | `star` (star) | **Start of Combat:** set a random enemy's Heal |
| attachmentconductor | Attachment Conductor | mech | `gear` (gear) | Your **Magnetics** magnetize **twice**. |
| uron | Uron, Oathbringer | neutral | `star` (star) | Your **Rallies**, **End of Turns** and **Start |
| zyff | Zyff, the Betrayer | neutral | `star` (star) | Your **Battlecries** and **Deathrattles** trig |
| k_chipwick | Chipwick Prospector | kobold | `crown` (crown) | **Shout:** Get 2 Rubies. |
| k_deepvein | Deepvein Tender | kobold | `crown` (crown) | **Shout:** Your Rubies gain **+1 Health**. |
| k_faultline | Faultline Scrapper | kobold | `crown` (crown) | **Echo:** your Rubies gain **+1 Attack**. |
| k_frenzied | Frenzied Excavator | kobold | `crown` (crown) | **Shout:** play a Ruby on all of your minions. |
| k_gemheart | Gemheart Carver | kobold | `crown` (crown) | **Echo:** Summon a **1/1 Gemheart Golem**, plu |
| k_gemgorge | Gemgorge Fiend | kobold | `crown` (crown) | When you cast **3 spells**, Consume a minion i |
| k_kobabyboldies | Kobebes | kobold | `crown` (crown) | **Echo:** play **3 Rubies** on each of your ** |
| k_alchemist | Alchemist Brisbane | kobold | `crown` (crown) | **Shout and Echo:** Your Rubies gain **+1/+1** |
| k_stormchaser | Storm Chaser | kobold | `crown` (crown) | **Shout:** get a **Veinstorm**. |
| k_mineralmaster | Mineral Master | kobold | `crown` (crown) | When you trigger a **Rally**, play **2 Rubies* |
| dw_orin | Oathshield Orin | dwarf | `anvil` (anvil) | **Shout:** gain **Ward**. |
| dw_ironlung | Warhorn Captain | dwarf | `anvil` (anvil) | **Shout:** give your other **Dwarves +3 Attack |
| dw_wardkeeper | Wardkeeper | dwarf | `anvil` (anvil) | **Shout:** your **Shop spells** gain **+1 Atta |
| dw_dorrin | Baby Gastrid | dwarf | `anvil` (anvil) | **Shout:** give a friendly **Dwarf** **+2 Heal |
| dw_brewer | Doubletap Brewer | dwarf | `anvil` (anvil) | **Shout:** get a **Dwarven Ale**. **Echo:** ge |
| dw_runemaster | Auric Runemaster | dwarf | `anvil` (anvil) | **Shout: Gild** a target friendly minion. |
| dw_anvilshade | Anvilshade Smith | dwarf | `anvil` (anvil) | **Echo:** summon a **Charging Soldier** that g |
| dw_pimm | Paymaster Pimm | dwarf | `anvil` (anvil) | **Shout:** gain **1 Gold** next turn. |
| d2_embermouth | Embermouth Whelp | dragon | `flame` (flame) | After you trigger a **Shout**, gain **+1/+1**. |
| d2_scalefeather | Mushy | dragon | `flame` (flame) | **Shout and Echo:** get a **Growth**. |
| d2_chronicler | Scalefeather | dragon | `flame` (flame) | **Shout:** get a random **Tier 1** Spell. |
| d2_recaller | Recaller | dragon | `flame` (flame) | **Shout:** get a copy of the last **Shop spell |
| d2_blazingkeeper | Commander Warpath | dragon | `flame` (flame) | **Shout:** get a **Brood Whelp**. |
| d2_orivax | Orivax, the Spellchoir | dragon | `flame` (flame) | **Choose One:** your **Shouts** trigger an add |
| d2_broodfire | Broodfire | dragon | `flame` (flame) | **Shout:** give your **Dragons +2/+2**. |
| d2_flutterdrake | Flutterdrake | dragon | `flame` (flame) | **Shout:** get a **Flutter**. |
| b2_trex | T-Rex | beast | `paw` (paw) | **Echo:** summon a **T-Rex Baby** with **Taunt |
| b2_mammoth | Menagerie Mammoth | beast | `paw` (paw) | **Echo:** summon **3** random other **Beasts** |
| b2_bullseye | Bullseye | beast | `paw` (paw) | **Echo:** summon a random **Beast** and set it |
| b2_voidmother | Voidmother | beast | `paw` (paw) | **Echo:** summon a **Void Panther**. |
| b2_hawkus | Hawkus | beast | `paw` (paw) | When a **Rally** is triggered, trigger your ** |
| dm_butcher | Contract Butcher | demon | `eye` (eye) | **Shout:** give minions in the Shop **+2/+1**. |
| dm_agent | Appetite Agent | demon | `eye` (eye) | **Shout:** target a friendly **Demon**. It Con |
| dm_tormentor | Market Tormentor | demon | `eye` (eye) | **Shout:** give the **right-most Shop minion + |
| dm_shepherd | Legion Shepherd | demon | `eye` (eye) | **Echo:** your Imps gain **+5/+5** this game.  |
| dm_malphas | Malphas, Lord of Want | demon | `eye` (eye) | **Shout and Echo:** give minions in the Shop * |
| dm_hank | Right Hand Hank | demon | `eye` (eye) | **Echo:** give the **right-most Shop minion +3 |
| dm_knocked | Knocked | demon | `eye` (eye) | **Echo:** summon an **Imp**. |
| dm_jumbo | Enigma | demon | `eye` (eye) | When you **consume** a minion, give minions in |
| n2_lastlight | Lastlight | neutral | `star` (star) | **Echo:** give **2** friendly minions **Ward** |
| openthegates | Open the Gates | neutral | `star` (star) | **Start of combat:** summon an **Imp**, three  |
| cupcakes | Cupcakes | neutral | `star` (star) | Target a **Demon**. It **Consumes 4** minions  |
| sp_partingcry | Parting Cry | neutral | `star` (star) | Choose a friendly **Shout** minion. When it di |
| sp_closedcasket | Closed Casket | neutral | `star` (star) | Choose a minion. **Start of Combat:** destroy  |
| dw_exgalloper | Exgalloper | beast | `paw` (paw) | **Echo:** summon an exact copy of this **witho |
| dw_chickenbrawl | Chicken Brawl | dwarf | `anvil` (anvil) | **Echo:** summon a **Charging Soldier** that a |
| dw_sharpshooter | Dwarven Sharpshooter | dwarf | `anvil` (anvil) | **Shout:** get a **Deep Delve Writ**. |
| c3_courier | Horizon Courier | celestial | `clock` (clock) | **Shout — Dawn:** get a random Tier 1 minion.  |
| c3_twilight | Twilight Sentinel | celestial | `clock` (clock) | **Start of Combat — Dawn:** gain **Flurry**. * |
| c3_relay | Astral Relay | celestial | `clock` (clock) | **Shout — Dawn:** trigger adjacent **Orbits**. |
| b2_magepup | Mage-Pup | beast | `paw` (paw) | **Shout:** cast the Shop spell this was taught |
| d2_broodwhelp | Brood Whelp | dragon | `flame` (flame) | **Shout:** give a friendly **Dragon +5 Attack* |
| b2_scavenger | Scavvers | beast | `paw` (paw) | **Echo:** trigger an adjacent **Rally**. |
| c3_herald | Herald of the Divide | neutral | `star` (star) | **Dawn Shout:** gain **2 Gold** next turn. **D |
| c3_sentinel | Horizon Sentinel | neutral | `star` (star) | **Dawn:** Start of Combat — deal **3** to the  |
| c3_acolyte | Daybreak Acolyte | neutral | `star` (star) | Start of Combat — **Dawn:** gain **+2 Attack** |
| dm_clerk | Cinder Clerk | demon | `eye` (eye) | **Shout:** Consume a minion in the Shop. |
| dm_wrangler | Imp Wrangler | demon | `eye` (eye) | **Start of Combat:** summon an **Imp**. |
| d2_matriarch | Bathing Matriarch | dragon | `flame` (flame) | Whenever a **Shout** triggers, give your Drago |

## C. Multi-keyword cards (11) — keywords[0] alone decides the glyph

| id | name | keywords | glyph (from kw[0]) |
|---|---|---|---|
| trainingdummy | Training Dummy | T,DS | `taunt` |
| tauntbreaker | Tauntbreaker | DS,W,RL | `shield` |
| bronzewarden | Guardian Drake | DS,CR | `shield` |
| karthus | Karthus | DS,SL | `shield` |
| speedy | Speedy | W,M | `windfury` |
| betterbot | Better Bot | M,RL | `magnetic` |
| jouster | Mechanical Jouster | RL,DS | `sword` |
| impala | Commander Impala | W,DS,CR | `windfury` |
| k_blazer | Blazer | W,RL | `windfury` |
| symbioticattachment | Chaos Attachment | M,R | `magnetic` |
| perfectcore | Perfect Core | DS,RL,M | `shield` |

## D. Keyword icons that never surface as a glyph

- `CN` → `consume`
- `IMM` → `immune`
- `ST` → `eye`
- `CR` → `target`

## E. Full per-card resolution

| id | name | tribe | keywords | source | glyph | text starts |
|---|---|---|---|---|---|---|
| b2_armadiyo | Armadiyo | beast | T | keyword | `taunt` | **Taunt. Echo:** give your Beasts **+2/+4** wh |
| b2_dawnclaw | Dawnclaw | beast | T | keyword | `taunt` | **Taunt. Echo:** trigger an adjacent minion's  |
| b2_echohorn | Echohorn | beast | RL | keyword | `sword` | **Rally:** trigger your left-most **Echo**. |
| b2_packstrider | Packstrider | beast | RL | keyword | `sword` | **Rally:** gain **+1 Attack** for every Beast  |
| b2_quil | Quil | beast | SC | keyword | `fist` | **Start of Combat:** cast the left-most spell  |
| b2_runebloom | Runebloom Matriarch | beast | SC | keyword | `fist` | Your **Shop Spells** cast an extra time in com |
| b2_spots | Spots | beast | SC | keyword | `fist` | **Start of Combat:** trigger your **2 left-mos |
| b2_sunmane | Sunmane Herald | beast | RL | keyword | `sword` | **Rally:** give your Beasts **+3 Attack** and  |
| b2_wolvie | Wolvie | beast | T | keyword | `taunt` | **Taunt. Echo:** give the next **Beast** you s |
| babycub | Baby Cub | beast | C | keyword | `cleave` | Cleave |
| badgington | Badgington | beast | RL | keyword | `sword` | **Rally:** get a random **Shop Spell**. |
| gnash | Gnasher, the Overrun | beast | SL | keyword | `slaughter` | **Slaughter:** your Shop spells permanently ga |
| gryphon | Gryphon | beast | T | keyword | `taunt` | **Taunt.** Each time this takes damage, gain a |
| kennel | Kennelmaster | beast | SC | keyword | `fist` | **Start of Combat:** give your Beasts **+1 Att |
| philippe | Philippe | beast | RL | keyword | `sword` | **Rally:** also deal its **Attack** to a rando |
| sabercub | Void Cub | beast | T | keyword | `taunt` | A 0/2 Beast with **Taunt**. |
| sporebat | Sporebat | beast | T | keyword | `taunt` | **Taunt.** Store the last spell you cast. **Ec |
| thundeer | Thundeer | beast | EG | keyword | `anvil` | When your Beasts attack, gain **+10/+10** perm |
| trophystalker | Trophy Stalker | beast | RL | keyword | `sword` | **Rally:** give your Beasts **+5/+5** wherever |
| abhorrenthorror | Abhorrent Horror | demon | SC | keyword | `fist` | **Start of Combat:** Gain +Attack/+Health equa |
| dm_errand | Errand Fiend | demon | RL | keyword | `sword` | **Rally:** summon an **Imp** and give your **I |
| dm_felspikes | Fel Spikes | demon | T | keyword | `taunt` | **Taunt.** **Echo:** deal **4 damage** to all  |
| dm_glutton | Chipper | demon | T | keyword | `taunt` | **Taunt.** Whenever you play a **Demon**, this |
| dm_hungerling | Demon Horse | demon | RL | keyword | `sword` | **Rally:** give minions in the Shop **+1/+2**. |
| dm_velvet | Big Huggies | demon | T | keyword | `taunt` | **Taunt.** **Echo:** get a **Staff of Guel**. |
| fred | Fred | demon | FD | keyword | `fodder` | A 1/1 Demon **Fodder** — your Demons devour it |
| heckbinder | Heckbinder | demon | M | keyword | `magnetic` | Magnetize onto a friendly **Mech** or **Demon* |
| heraldapoc | Herald of the Apocalypse | demon | RL | keyword | `sword` | **Shout:** all of your Demons **Consume** a Fo |
| impala | Commander Impala | demon | W,DS,CR | keyword | `windfury` | **Flurry. Ward. Critical Strike (50%).** |
| runmaw | Speed Demon | demon | SC | keyword | `fist` | **Start of Combat:** give your other minions * |
| swordbored | Sword and Bored | demon | SL | keyword | `slaughter` | **Slaughter:** give your **Fodder** **+1/+1**. |
| bronzewarden | Guardian Drake | dragon | DS,CR | keyword | `shield` |  |
| chimerus | Chimerus | dragon | RL | keyword | `sword` | **Rally:** give this minion's Health to 2 frie |
| d2_broodlord | Ashen Broodlord | dragon | RL | keyword | `sword` | **Rally:** cast a **Staff of Guel**. |
| d2_chorus | Chorus Drake | dragon | RL | keyword | `sword` | **Rally:** your **Shop Spells** gain **+1 Heal |
| d2_cinderchef | Cinderchef | dragon | RL | keyword | `sword` | **Rally:** gain **+1/+1**. |
| d2_embercrest | Embercrest | dragon | RL | keyword | `sword` | **Rally:** trigger your **Dragon** Shouts. |
| d2_flamebeat | Flamebeat Drake | dragon | RL | keyword | `sword` | **Rally:** cast **Dragonflame**. |
| d2_roarcollector | Roarcollector | dragon | RL | keyword | `sword` | **Rally:** get a random **Shout** minion. |
| d2_sovereign | Thunderous Sovereign | dragon | SC | keyword | `fist` | **Start of Combat:** give your Dragons **+1/+1 |
| d2_transcendence | Transcendant | dragon | DS | keyword | `shield` | **Ward.** Adjacent **Dragons** are **Engraved* |
| emissary | Twilight Emissary | dragon | T | keyword | `taunt` | **Taunt.** **Battlecry:** give a friendly **Dr |
| hoardbreaker | Hoardbreaker Drake | dragon | RL | keyword | `sword` | **Rally:** Cast **Growth**. |
| supporter | Supporter | dragon | RL | keyword | `sword` | **Rally:** give 2 friendly Dragons **+1/+2**. |
| tara | Tara | dragon | EG | keyword | `anvil` | **Engraved**. Grant stats **15 times** in comb |
| taragosa | Taragosa | dragon | EG | keyword | `anvil` | All stats are **Engraved**. When a minion atta |
| taragosaheir | Taragosa's Heir | dragon | EG | keyword | `anvil` | Gains **2× stats** from all sources. **Engrave |
| dw_bladethrower | Blade Thrower | dwarf | RL | keyword | `sword` | **Rally:** get a **Dwarven Ale**. |
| dw_brakka | Broad-Axe Brakka | dwarf | C | keyword | `cleave` | **Cleave**. |
| dw_brunni | Brunni | dwarf | T | keyword | `taunt` | **Taunt.** **End of Turn:** get a **Dwarven Al |
| dw_bucky | Bucky | dwarf | SC | keyword | `fist` | **Start of Combat:** give your Dwarves **+5/+5 |
| dw_oaf | Drunken Oaf | dwarf | SC | keyword | `fist` | **Start of Combat:** give a **Dwarf +3/+3**. R |
| dw_thane | Lieutenant Thane | dwarf | RL | keyword | `sword` | **Rally:** give this minion's **Attack** to ** |
| k_blazer | Blazer | kobold | W,RL | keyword | `windfury` | **Flurry.** **Rally:** play a **Ruby** on your |
| k_boulderdash | Boulderdash | kobold | RL | keyword | `sword` | **Rally:** play **3 permanent Rubies** on this |
| k_candleback | Candleback Bulwark | kobold | T | keyword | `taunt` | Taunt. Get a Ruby when this takes damage. (2 t |
| k_crownvein | Crownvein Vanguard | kobold | RL | keyword | `sword` | **Rally:** give your Rubies **+1/+1**. |
| k_geode | Geode Guardian | kobold | T | keyword | `taunt` | **Taunt.** **Echo:** summon **two** 1/1 **Gemh |
| k_kobe | Kobe | kobold | SC | keyword | `fist` | **Start of Combat:** play **2 permanent Rubies |
| k_resonance | Resonance Idol | kobold | DS | keyword | `shield` | **Ward.** Rubies cast on this minion bounce to |
| k_tunnelcharger | Tunnelcharger Rikk | kobold | RL | keyword | `sword` | **Rally:** Get **3 Rubies**. |
| betterbot | Better Bot | mech | M,RL | keyword | `magnetic` | **Rally:** give your other Mechs **+5 Attack** |
| bountybot | Bounty Bot | mech | SL | keyword | `slaughter` | Immune while attacking (first **2** attacks ea |
| chorusengine | Chorus Engine | mech | RL | keyword | `sword` | **Rally:** improve your **Attachments** by **+ |
| cling | Cling Drone | mech | M | keyword | `magnetic` | Each time a Cling Drone is magnetized, your Cl |
| drone | Warding Drone | mech | DS | keyword | `shield` |  |
| jouster | Mechanical Jouster | mech | RL,DS | keyword | `sword` | **Rally:** get a random **Magnetic** Mech. |
| moe | Moe | mech | SL | keyword | `slaughter` | **Slaughter:** gain **1 free refresh** next tu |
| moneybot | Money Bot | mech | M | keyword | `magnetic` | While on your board, you have **+1 max Gold**  |
| speedy | Speedy | mech | W,M | keyword | `windfury` |  |
| c3_equinox | Equinox Duelist | neutral | RL | keyword | `sword` | **Dawn — Rally:** give your Celestials **+2 At |
| n2_standardbearer | Standard Bearer | neutral | RL | keyword | `sword` | Counts as all tribes. **Rally:** give a minion |
| perfectcore | Perfect Core | neutral | DS,RL,M | keyword | `shield` | Counts as all tribes. **Ward**, **Magnetic** ( |
| sandbag | Target Dummy | neutral | T | keyword | `taunt` | **Taunt.** When this takes damage, it gains ** |
| symbioticattachment | Chaos Attachment | neutral | M,R | keyword | `magnetic` | **Magnetic**, **Reborn**. Counts as all tribes |
| tauntbreaker | Tauntbreaker | neutral | DS,W,RL | keyword | `shield` | **Rally:** Remove **Taunt** and **Rise** from  |
| taurus | Taurus | neutral | SC | keyword | `fist` | **Start of Combat:** adjacent units are **Engr |
| taurustruth | Taurus the Truth Bringer | neutral | SC | keyword | `fist` | **Start of Combat:** all your minions are **En |
| trainingdummy | Training Dummy | neutral | T,DS | keyword | `taunt` | **Taunt.** **Ward.** |
| venom | Venom | neutral | V | keyword | `execute` |  |
| deathsayer | Deathsayer | undead | RL | keyword | `sword` | **Rally:** before this attacks, trigger your l |
| footman | Footman | undead | R | keyword | `rise` | **Reborn.** |
| karthus | Karthus | undead | DS,SL | keyword | `shield` | **Slaughter:** give your Undead **+3 Attack**  |
| watcher | Watcher | undead | RL | keyword | `sword` | **Rally:** cast **Lantern of Souls** — your Un |
| b2_beardsley | Beardsley | beast | — | tribe | `paw` | Whenever you summon a **Beast**, give it **+3/ |
| b2_bullseye | Bullseye | beast | — | tribe | `paw` | **Echo:** summon a random **Beast** and set it |
| b2_elderhorn | Elderhorn | beast | — | tribe | `paw` | **Choose One:** your Beast **Rallies**, or you |
| b2_groveweaver | Groveweaver | beast | — | tribe | `paw` | When you summon a Beast, give it **+3/+3**. Im |
| b2_hawkus | Hawkus | beast | — | tribe | `paw` | When a **Rally** is triggered, trigger your ** |
| b2_magepup | Mage-Pup | beast | — | tribe | `paw` | **Shout:** cast the Shop spell this was taught |
| b2_mammoth | Menagerie Mammoth | beast | — | tribe | `paw` | **Echo:** summon **3** random other **Beasts** |
| b2_moonhowl | Moonhowl Mentor | beast | — | tribe | `paw` | Once per turn, when you buy a Shop spell, get  |
| b2_ninjapal | Ninja Pal | beast | — | tribe | `paw` | A 4/1 Beast that attacks immediately when summ |
| b2_oona | King Oona | beast | — | tribe | `paw` | When you summon a Beast in combat, **double**  |
| b2_scavenger | Scavvers | beast | — | tribe | `paw` | **Echo:** trigger an adjacent **Rally**. |
| b2_trex | T-Rex | beast | — | tribe | `paw` | **Echo:** summon a **T-Rex Baby** with **Taunt |
| b2_trexbaby | T-Rex Baby | beast | — | tribe | `paw` | A 2/2 Beast token. |
| b2_voidmother | Voidmother | beast | — | tribe | `paw` | **Echo:** summon a **Void Panther**. |
| beetle | Runic Beetle | beast | — | tribe | `paw` | **Choose One:** give a friendly Beast **Rise** |
| dw_exgalloper | Exgalloper | beast | — | tribe | `paw` | **Echo:** summon an exact copy of this **witho |
| grim | Grim | beast | — | tribe | `paw` | **Echo:** give your Beasts **+8/+8** wherever  |
| mamabear | Den Mother | beast | — | tribe | `paw` | When you play a **Beast**, give it **+2/+2** — |
| mirrorrhino | Mirrorhide Rhino | beast | — | tribe | `paw` | **Start of Combat:** Summon a copy of this min |
| mossmemory_colossus | Mossmemory Colossus | beast | — | tribe | `paw` | **Echo:** resummon the first **3** other **Bea |
| packleader | Pack Leader | beast | — | tribe | `paw` | **Start of Combat:** Give your **Beasts** **+3 |
| pup | Pup | beast | — | tribe | `paw` | A 1/1 Beast token. |
| raptor | Raptor | beast | — | tribe | `paw` | When a friendly **Beast** attacks, give it **+ |
| runesnout_archivist | Runesnout Archivist | beast | — | tribe | `paw` | Remember the first **Shop spell** you cast eac |
| shaper | Wildwood Shaper | beast | — | tribe | `paw` | **Choose One:** Give your Beasts **+1/+3**, or |
| spiritpup | Spirit Pup | beast | — | tribe | `paw` | Cast **10 Shop spells** to ascend. |
| spiritworgen | Spirit Worgen | beast | — | tribe | `paw` | When you play a **Beast** or **Dragon**, gain  |
| stray | Stray | beast | — | tribe | `paw` | A 1/1 Beast token. |
| trailforager | Trail Forager | beast | — | tribe | `paw` | Sells for **3g**, plus **1g** for every Beast  |
| c3_binary | Binary Star | celestial | — | tribe | `clock` | **Adjacent Orbit** effects trigger an **additi |
| c3_broker | Constellation Broker | celestial | — | tribe | `clock` | Orbit: **destroy** the played minion and give  |
| c3_cartographer | Star Cartographer | celestial | — | tribe | `clock` | **Orbit (4) — Dawn:** improve your **Shop spel |
| c3_channeler | Equinox Channeler | celestial | — | tribe | `clock` | **Orbit — Dawn:** give your **lowest-Attack**  |
| c3_collector | Horizon Collector | celestial | — | tribe | `clock` | **Orbit:** gain the played minion's **bonus st |
| c3_courier | Horizon Courier | celestial | — | tribe | `clock` | **Shout — Dawn:** get a random Tier 1 minion.  |
| c3_crucible | Celestial Crucible | celestial | — | tribe | `clock` | Orbit: give your **Celestials +1/+1** for each |
| c3_familiar | Orbiting Familiar | celestial | — | tribe | `clock` | **Orbit — Dawn:** give a random friendly minio |
| c3_gardener | Worldseed Gardener | celestial | — | tribe | `clock` | **Orbit (3) — Dawn:** cast **Sprout**. **Dusk: |
| c3_orrery | Orrery, World Devourer | celestial | — | tribe | `clock` | Whenever **another Orbit** triggers, give mini |
| c3_relay | Astral Relay | celestial | — | tribe | `clock` | **Shout — Dawn:** trigger adjacent **Orbits**. |
| c3_shopkeeper | Astral Shopkeeper | celestial | — | tribe | `clock` | After **3** of your **Orbits** trigger, give t |
| c3_tender | Constellation Tender | celestial | — | tribe | `clock` | **Orbit — Dawn:** give your **Dawn Celestials  |
| c3_twilight | Twilight Sentinel | celestial | — | tribe | `clock` | **Start of Combat — Dawn:** gain **Flurry**. * |
| c3_vendor | Starpath Vendor | celestial | — | tribe | `clock` | **Orbit — Dawn:** gain **+1 sell value**, up t |
| c3_weaver | Worldline Weaver | celestial | — | tribe | `clock` | Whenever an **Orbit** triggers, **Dawn:** give |
| acid | Korok, the Hungerer | demon | — | tribe | `eye` | When you buy **4 cards**, give your Fodder **+ |
| ashen_heir | Ashen Heir | demon | — | tribe | `eye` | Whenever an **Imp** dies, another friendly Imp |
| bloodbinder | Bloodbinder | demon | — | tribe | `eye` | **Start of Combat — Bleed:** mark **2** random |
| brood | Brood Matron | demon | — | tribe | `eye` | Each time a friend dies, summon an **Imp** (ma |
| burialimp | Burial Imp | demon | — | tribe | `eye` | **Echo:** summon an **Imp**. |
| chefraag | Chef Raag | demon | — | tribe | `eye` | **Echo:** give your minions **+1/+1**, equal t |
| contractimp | Contract Imp | demon | — | tribe | `eye` | **Choose One:** Give your **Fodder** **+2/+2** |
| dm_agent | Appetite Agent | demon | — | tribe | `eye` | **Shout:** target a friendly **Demon**. It Con |
| dm_avarice | Avarice Incarnate | demon | — | tribe | `eye` | The **first time** another friendly **Demon**  |
| dm_broodwright | Broodwright | demon | — | tribe | `eye` | Whenever you summon an **Imp**, give it **+2/+ |
| dm_butcher | Contract Butcher | demon | — | tribe | `eye` | **Shout:** give minions in the Shop **+2/+1**. |
| dm_chancellor | Rouge Rogue | demon | — | tribe | `eye` | Whenever an **Imp** attacks, give your Imps ** |
| dm_chosenfiend | Axeman | demon | — | tribe | `eye` | When a friendly **Demon** deals damage, gain * |
| dm_clerk | Cinder Clerk | demon | — | tribe | `eye` | **Shout:** Consume a minion in the Shop. |
| dm_grevlin | Grevlin & Co. | demon | — | tribe | `eye` | When you **sell 3 minions**, a **Demon** consu |
| dm_hank | Right Hand Hank | demon | — | tribe | `eye` | **Echo:** give the **right-most Shop minion +3 |
| dm_jumbo | Enigma | demon | — | tribe | `eye` | When you **consume** a minion, give minions in |
| dm_knocked | Knocked | demon | — | tribe | `eye` | **Echo:** summon an **Imp**. |
| dm_leech | Leech | demon | — | tribe | `eye` | When a friendly **Demon** deals damage, gain * |
| dm_malphas | Malphas, Lord of Want | demon | — | tribe | `eye` | **Shout and Echo:** give minions in the Shop * |
| dm_maw | Hellrider | demon | — | tribe | `eye` | Every **4 refreshes**, gain the **right-most** |
| dm_shepherd | Legion Shepherd | demon | — | tribe | `eye` | **Echo:** your Imps gain **+5/+5** this game.  |
| dm_todd | Impossible Todd | demon | — | tribe | `eye` | When a friendly **Demon** deals damage, gain * |
| dm_tormentor | Market Tormentor | demon | — | tribe | `eye` | **Shout:** give the **right-most Shop minion + |
| dm_vhal | Feastmaster Vhal | demon | — | tribe | `eye` | When you spend **10 Gold**, give the **right-m |
| dm_wrangler | Imp Wrangler | demon | — | tribe | `eye` | **Start of Combat:** summon an **Imp**. |
| feed | Soulfeeder | demon | — | tribe | `eye` | **Shout:** add a Fodder to your next shop. |
| godfodder | The Godfodder | demon | — | tribe | `eye` | **Choose One:** give your **Imps** **+2/+2**,  |
| implosion | Implosion | demon | — | tribe | `eye` | Give your **Imps** **+2/+2**, recast for every |
| impoverseer | Imp Overseer | demon | — | tribe | `eye` | **Shout:** Your Imps gain **+2/+1** this game. |
| impscrap | Imp | demon | — | tribe | `eye` |  |
| bane | Bane | dragon | — | tribe | `flame` | After you trigger a **Shout**, give your Imps  |
| cinder | Cinderwing Matron | dragon | — | tribe | `flame` | **Shout:** give your Shop spells **+1 Health** |
| cryptdrake | Crypt Drake | dragon | — | tribe | `flame` | Every **2** ally attacks, give your minions ** |
| d2_archivist | Runic Archivist | dragon | — | tribe | `flame` | After you sell **5 minions**, get a **Shop spe |
| d2_ashscribe | Ashscribe | dragon | — | tribe | `flame` | The first time you cast a **Shop spell** each  |
| d2_blazingkeeper | Commander Warpath | dragon | — | tribe | `flame` | **Shout:** get a **Brood Whelp**. |
| d2_broodfire | Broodfire | dragon | — | tribe | `flame` | **Shout:** give your **Dragons +2/+2**. |
| d2_broodwhelp | Brood Whelp | dragon | — | tribe | `flame` | **Shout:** give a friendly **Dragon +5 Attack* |
| d2_chronicler | Scalefeather | dragon | — | tribe | `flame` | **Shout:** get a random **Tier 1** Spell. |
| d2_embermouth | Embermouth Whelp | dragon | — | tribe | `flame` | After you trigger a **Shout**, gain **+1/+1**. |
| d2_felconjurer | Fel Conjurer | dragon | — | tribe | `flame` | **Start of Turn:** get a **Quick Study**. |
| d2_flutterdrake | Flutterdrake | dragon | — | tribe | `flame` | **Shout:** get a **Flutter**. |
| d2_grimoire | Living Grimoire | dragon | — | tribe | `flame` | The first spell you cast each turn **casts twi |
| d2_herzog | Vaultkeeper | dragon | — | tribe | `flame` | Gain **+2/+2** whenever you play a **Dragon**. |
| d2_matriarch | Bathing Matriarch | dragon | — | tribe | `flame` | Whenever a **Shout** triggers, give your Drago |
| d2_mirrorwing | Mirrorwing | dragon | — | tribe | `flame` | The first **Shop spell** you cast on this each |
| d2_orivax | Orivax, the Spellchoir | dragon | — | tribe | `flame` | **Choose One:** your **Shouts** trigger an add |
| d2_recaller | Recaller | dragon | — | tribe | `flame` | **Shout:** get a copy of the last **Shop spell |
| d2_riverdrake | River Drake | dragon | — | tribe | `flame` | When you **sell** this, get a **random Spell** |
| d2_scalechanter | Earthbreaker | dragon | — | tribe | `flame` | Whenever you cast a **Shop spell**, give your  |
| d2_scalefeather | Mushy | dragon | — | tribe | `flame` | **Shout and Echo:** get a **Growth**. |
| d2_skald | Traveling Skald | dragon | — | tribe | `flame` | When **another** friendly **Dragon** attacks,  |
| d2_spellkeeper | Spell Warden | dragon | — | tribe | `flame` | After you cast your **second Shop spell** each |
| d2_voicekeeper | Voicekeeper | dragon | — | tribe | `flame` | Get a **plain copy** of the first Dragon you s |
| d2_warflame | Warflame | dragon | — | tribe | `flame` | When a friendly **Dragon** attacks, cast **Dra |
| frontdrake | Bard | dragon | — | tribe | `flame` | **Every 3 turns,** get a random Dragon. |
| hoardwhelp | Hoard Whelp | dragon | — | tribe | `flame` | **Sell:** get **6 Gold**. **End of Turn:** get |
| hunter | Hunter | dragon | — | tribe | `flame` | When this gains Attack, give your minions **+1 |
| karwind | Karwind | dragon | — | tribe | `flame` | Whenever a **Shout** triggers, give your Drago |
| mauron | Mauron | dragon | — | tribe | `flame` | Immune while attacking. Damages an **adjacent* |
| runescale | Runescale Drake | dragon | — | tribe | `flame` | **Start of Combat:** give your **Dragons** **+ |
| whelpling | Whelp | dragon | — | tribe | `flame` | A 3/2 Dragon that attacks immediately when sum |
| dw_anvilshade | Anvilshade Smith | dwarf | — | tribe | `anvil` | **Echo:** summon a **Charging Soldier** that g |
| dw_baal | Baal | dwarf | — | tribe | `anvil` | Whenever you cast **2 Shop spells**, a friendl |
| dw_billings | Billings | dwarf | — | tribe | `anvil` | When you spend **5 Gold**, give **2 random** f |
| dw_brewer | Doubletap Brewer | dwarf | — | tribe | `anvil` | **Shout:** get a **Dwarven Ale**. **Echo:** ge |
| dw_brill | Dwarf King, Brill | dwarf | — | tribe | `anvil` | When you spend **10 Gold**, get a random **Dwa |
| dw_brisbane | High King Mykel | dwarf | — | tribe | `anvil` | When you cast **8 Shop spells**, trigger an ** |
| dw_chef | Chef Gary Toast | dwarf | — | tribe | `anvil` | When you play a **Dwarf**, give your **Dwarves |
| dw_chickenbrawl | Chicken Brawl | dwarf | — | tribe | `anvil` | **Echo:** summon a **Charging Soldier** that a |
| dw_chirurgeon | Ayves | dwarf | — | tribe | `anvil` | Every **3 cards** you buy, get a random **Shop |
| dw_coinfire | Coinfire Forewoman | dwarf | — | tribe | `anvil` | When you spend **5 Gold**, give your **Dwarves |
| dw_dorrin | Baby Gastrid | dwarf | — | tribe | `anvil` | **Shout:** give a friendly **Dwarf** **+2 Heal |
| dw_edward | Edward Keg-hands | dwarf | — | tribe | `anvil` | Your **Dwarven Ales** trigger **twice**. |
| dw_gangplank | Gangplank | dwarf | — | tribe | `anvil` | When a card is added to your hand, give a frie |
| dw_ironlung | Warhorn Captain | dwarf | — | tribe | `anvil` | **Shout:** give your other **Dwarves +3 Attack |
| dw_mountainbond | Mountainbond | dwarf | — | tribe | `anvil` | When you spend **8 Gold**, play a **Ruby** on  |
| dw_orin | Oathshield Orin | dwarf | — | tribe | `anvil` | **Shout:** gain **Ward**. |
| dw_pimm | Paymaster Pimm | dwarf | — | tribe | `anvil` | **Shout:** gain **1 Gold** next turn. |
| dw_runekeg | Runekeg | dwarf | — | tribe | `anvil` | When you cast a **Shop spell**, give **2 rando |
| dw_runemaster | Auric Runemaster | dwarf | — | tribe | `anvil` | **Shout: Gild** a target friendly minion. |
| dw_sharpshooter | Dwarven Sharpshooter | dwarf | — | tribe | `anvil` | **Shout:** get a **Deep Delve Writ**. |
| dw_soldier | Charging Soldier | dwarf | — | tribe | `anvil` | A 3/1 Dwarf that attacks immediately when summ |
| dw_tapkeeper | Tapkeeper | dwarf | — | tribe | `anvil` | When you spend **10 Gold**, get a **Dwarven Al |
| dw_wardkeeper | Wardkeeper | dwarf | — | tribe | `anvil` | **Shout:** your **Shop spells** gain **+1 Atta |
| gemheart-shard | Gemheart Golem | kobold | — | tribe | `crown` | A living shard of gemstone. |
| k_alchemist | Alchemist Brisbane | kobold | — | tribe | `crown` | **Shout and Echo:** Your Rubies gain **+1/+1** |
| k_beggy | Beggy | kobold | — | tribe | `crown` | When you **sell** this, get **2 Rubies**. |
| k_candleconduit | Candle Conduit | kobold | — | tribe | `crown` | When you get a **Ruby**, cast a **Ruby** on a  |
| k_chipwick | Chipwick Prospector | kobold | — | tribe | `crown` | **Shout:** Get 2 Rubies. |
| k_deepdelve | Deepdelve Paragon | kobold | — | tribe | `crown` | Rubies applied **in combat** give **2× stats** |
| k_deepvein | Deepvein Tender | kobold | — | tribe | `crown` | **Shout:** Your Rubies gain **+1 Health**. |
| k_faultline | Faultline Scrapper | kobold | — | tribe | `crown` | **Echo:** your Rubies gain **+1 Attack**. |
| k_frenzied | Frenzied Excavator | kobold | — | tribe | `crown` | **Shout:** play a Ruby on all of your minions. |
| k_gemgorge | Gemgorge Fiend | kobold | — | tribe | `crown` | When you cast **3 spells**, Consume a minion i |
| k_gemheart | Gemheart Carver | kobold | — | tribe | `crown` | **Echo:** Summon a **1/1 Gemheart Golem**, plu |
| k_gemline | Gemline Martyr | kobold | — | tribe | `crown` | **Start of Turn:** get a **Veinstorm** and imp |
| k_kobabyboldies | Kobebes | kobold | — | tribe | `crown` | **Echo:** play **3 Rubies** on each of your ** |
| k_mineralmaster | Mineral Master | kobold | — | tribe | `crown` | When you trigger a **Rally**, play **2 Rubies* |
| k_prismcaster | Prismcaster | kobold | — | tribe | `crown` | Rubies played from hand cast an extra time. |
| k_rubybroker | Ruby Broker | kobold | — | tribe | `crown` | Rubies played on this minion give you **2 Gold |
| k_stormchaser | Storm Chaser | kobold | — | tribe | `crown` | **Shout:** get a **Veinstorm**. |
| k_veinbreaker | Veinbreaker | kobold | — | tribe | `crown` | **Choose One:** give your Rubies **+1/+1**, or |
| anomalyreactor | Anomaly Reactor | mech | — | tribe | `gear` | Give a friendly minion **All** types — it coun |
| attachmentconductor | Attachment Conductor | mech | — | tribe | `gear` | Your **Magnetics** magnetize **twice**. |
| banksly | Banksly | mech | — | tribe | `gear` | When you buy **4 cards**, magnetize a random * |
| beatboxer | Beatbot | mech | — | tribe | `gear` | Whenever a **Magnetic** attaches to another fr |
| moneymaker | Money Maker | mech | — | tribe | `gear` | **Every 2 turns:** get a **Gold Pouch**. |
| nanobot | Nanobot | mech | — | tribe | `gear` | A 1/1 Mech. |
| reconfiguredcombinator | Reconfigured Combinator | mech | — | tribe | `gear` | Whenever you trigger a **Shout**, attach an At |
| apples | Apples | neutral | — | tribe | `star` | **Choose One:** Give **this shop +1/+3**, or t |
| arenaheckler | Arena Heckler | neutral | — | tribe | `star` | **Start of Combat:** Give the minion **opposit |
| aresmar | Eyes of Aresmar | neutral | — | tribe | `star` | Make a **Tier 4 or lower** minion **Golden**. |
| beyondsummit | Beyond the Summit | neutral | — | tribe | `star` | **Discover** a minion from **one tier higher** |
| bloodlust | Bloodlust | neutral | — | tribe | `star` | Choose a friendly minion. It attacks immediate |
| broker | Brightwing Broker | neutral | — | tribe | `star` | When you buy a minion, give your minions **+1/ |
| buddy | Buddy Buddy | neutral | — | tribe | `star` | **Shout:** get a random **Tier 1** minion. |
| bulwark | Bulwark | neutral | — | tribe | `star` | Give a minion **+0/+1** and **Taunt**. |
| c3_acolyte | Daybreak Acolyte | neutral | — | tribe | `star` | Start of Combat — **Dawn:** gain **+2 Attack** |
| c3_herald | Herald of the Divide | neutral | — | tribe | `star` | **Dawn Shout:** gain **2 Gold** next turn. **D |
| c3_orbiter | Twinlight Orbiter | neutral | — | tribe | `star` | **Dawn Orbit:** give the minion **+2/+2**. **D |
| c3_sentinel | Horizon Sentinel | neutral | — | tribe | `star` | **Dawn:** Start of Combat — deal **3** to the  |
| c3_starweft | Starweft Familiar | neutral | — | tribe | `star` | **Orbit:** give the played card **+1/+1**. |
| carnivalcoin | Carnival Coin | neutral | — | tribe | `star` | Gain **1 Gold**. Give your minions **+1/+1**. |
| chronos | Chronos | neutral | — | tribe | `star` | Your **End of Turn** effects trigger **1 more* |
| chronostaff | Chrono Staff | neutral | — | tribe | `star` | Your **End of Turn** effects trigger **1 more* |
| commonground | Common Ground | neutral | — | tribe | `star` | Choose two friendly minions. **Average** their |
| consume | Consume | neutral | — | tribe | `star` | Choose a **Demon** — it consumes a **Fodder**. |
| copycat | Copycat | neutral | — | tribe | `star` | Copy a friendly minion **exactly** — stats, bu |
| corpseboard | Corpse Board | neutral | — | tribe | `star` | **Discover** a **Deathrattle** minion. |
| crestclimb | Crest of the Climb | neutral | — | tribe | `star` | **Choose One:** give a minion **+4 Attack**, o |
| cupcakes | Cupcakes | neutral | — | tribe | `star` | Target a **Demon**. It **Consumes 4** minions  |
| decoysigil | Decoy Sigil | neutral | — | tribe | `star` | Next combat, when you first have room, summon  |
| deepdelvewrit | Deep Delve Writ | neutral | — | tribe | `star` | Steal a random **Dwarf** from the Shop. |
| depositbox | Safety Deposit Box | neutral | — | tribe | `star` | Gain **2 Gold** next turn. |
| devour | Channeling the Devourer | neutral | — | tribe | `star` | Devour a friendly minion and spit its stats on |
| discoverspell | Triple Reward | neutral | — | tribe | `star` | **Discover** a minion from one Tier up. |
| displacement | Displacement | neutral | — | tribe | `star` | Swap a friendly minion with a random minion in |
| drummer | Drakko the Drummer | neutral | — | tribe | `star` | Your **Battlecries** fire **1 more** time. |
| echowarden | Echo Warden | neutral | — | tribe | `star` | Your summons trigger **one more time**. |
| elevationritual | Elevation Ritual | neutral | — | tribe | `star` | Upgrade each minion in the Shop to a random mi |
| emberpouch | Gold Pouch | neutral | — | tribe | `star` | Gain **1 Gold**. |
| executionersedge | Executioner's Edge | neutral | — | tribe | `star` | Give a minion **Critical Strike (50%)** for th |
| facetwright | Facetwright's Choice | neutral | — | tribe | `star` | **Choose One:** your Rubies gain **+1 Attack** |
| farseersreport | Farseer's Report | neutral | — | tribe | `star` | **Scout** 3 random minions from your next oppo |
| feedalpha | Feed the Alpha | neutral | — | tribe | `star` | Sell a friendly minion and give its stats to y |
| fieldmaneuvers | Field Maneuvers | neutral | — | tribe | `star` | **Choose One:** give a minion **Ward** or **Fl |
| fleetingvigor | Fleeting Vigor | neutral | — | tribe | `star` | **Start of combat:** give your minions **+2/+1 |
| foddertreatment | Fodder Treatment | neutral | — | tribe | `star` | Sell a friendly minion and give its stats to y |
| fronttoback | Front to Back | neutral | — | tribe | `star` | Give a minion **+2/+2**. Improve this by **+2/ |
| funeralonloan | Funeral on Loan | neutral | — | tribe | `star` | **Discover** an **Echo** minion. If you play i |
| goldcrafter | Goldcrafter | neutral | — | tribe | `star` | Make a friendly minion **golden**. |
| goldentouch | Golden Touch | neutral | — | tribe | `star` | Make a random minion in the tavern **Golden**. |
| growth | Growth | neutral | — | tribe | `star` | Give your minions **+1/+1**. |
| guel | Archmagus Guel | neutral | — | tribe | `star` | After **a Shop spell is cast** (shop or combat |
| helpwanted | Help Wanted | neutral | — | tribe | `star` | **Discover** a Battlecry minion. |
| hm_test_squire | Test Squire | neutral | — | tribe | `star` | **Henchman.** Placeholder body — the real rost |
| hoardflame | Hoardflame | neutral | — | tribe | `star` | Give a minion **+4/+4**, plus **+1/+1** for ea |
| hourglassreserve | Hourglass Reserve | neutral | — | tribe | `star` | **Discover** a minion from your tier. You **ca |
| insurancepolicy | Insurance Policy | neutral | — | tribe | `star` | If you **lost** your last combat, gain **5 Gol |
| invitationabove | Invitation Above | neutral | — | tribe | `star` | **Discover** a **Tier 6** minion. |
| ironcladreq | Ironclad Requisition | neutral | — | tribe | `star` | Steal a random card from the Shop for each **D |
| k_pouchpincher | Cheap Date | neutral | — | tribe | `star` | When you **sell** this, get a random **Tier 1* |
| keyfindings | Key Findings | neutral | — | tribe | `star` | Discover a minion from your tier. |
| lanternlight | Lantern Light | neutral | — | tribe | `star` | Give a minion **+1/+1** for each **Tavern Tier |
| lanternofsouls | Lantern of Souls | neutral | — | tribe | `star` | Your **Undead** get **+3 Attack** everywhere — |
| lasso | Lasso | neutral | — | tribe | `star` | Steal a random minion from the tavern. |
| laststand | Last Stand | neutral | — | tribe | `star` | Give a minion **Rise** for the next combat. |
| layaway | Layaway | neutral | — | tribe | `star` | Choose a minion in the Shop. **Keep it** throu |
| lazarus | Lazarus | neutral | — | tribe | `star` | While on your board, **shop spells cost 1 less |
| manafont | Gold Font | neutral | — | tribe | `star` | Gain **+1 max Gold** permanently. |
| markedtarget | Marked Target | neutral | — | tribe | `star` | At the start of next combat, give the enemy's  |
| mend | Mend | neutral | — | tribe | `star` | Set your **Armor** to **5**. |
| monk | Flowing Monk | neutral | — | tribe | `star` | When you summon a minion that doesn't fit, Eng |
| n2_bellringer | Bellringer Voss | neutral | — | tribe | `star` | **Every 2 turns:** get a plain copy of the min |
| n2_fatecarver | Fatecarver | neutral | — | tribe | `star` | **Choose One:** when you cast a **Shop spell** |
| n2_lastlight | Lastlight | neutral | — | tribe | `star` | **Echo:** give **2** friendly minions **Ward** |
| n2_paragon | Paragon | neutral | — | tribe | `star` | Counts as all tribes. Whenever you trigger a * |
| n2_reflector | Reflector | neutral | — | tribe | `star` | Spells cast on this **also cast** on a random  |
| n2_spellsword | Coppercoat Spellsword | neutral | — | tribe | `star` | **Choose One:** give your Shop spells **+1 Att |
| omen | Omen Minion | neutral | — | tribe | `star` |  |
| onthehouse | On the House | neutral | — | tribe | `star` | Get **3 random Dwarven Ales**. |
| openthegates | Open the Gates | neutral | — | tribe | `star` | **Start of combat:** summon an **Imp**, three  |
| patchjob | Patch Job | neutral | — | tribe | `star` | Give a minion **+1/+1**, plus **+2/+2** for ev |
| perfectvision | Perfect Vision | neutral | — | tribe | `star` | Set a minion's stats to **20/20**. |
| preemptive | Pre-emptive Assault | neutral | — | tribe | `star` | You attack **first** next fight. |
| quicksale | Quick Sale | neutral | — | tribe | `star` | The next minion you **sell** this turn sells f |
| quickstudy | Quick Study | neutral | — | tribe | `star` | Give your **Shop spells +1/+1**. |
| rallyoffensive | Rallying Offensive | neutral | — | tribe | `star` | Your **Rally** effects trigger **twice** next  |
| refreshtexts | Refreshing Texts | neutral | — | tribe | `star` | Gain **2 free rerolls**. |
| resonance | Resonance | neutral | — | tribe | `star` | Trigger a friendly **Battlecry** minion's Batt |
| riftsunkcodex | Rift-Sunk Codex | neutral | — | tribe | `star` | **Discover** a Shop spell. |
| rivalsreflection | Rival's Reflection | neutral | — | tribe | `star` | **Discover** a plain copy of a minion from you |
| ruby | Ruby | neutral | — | tribe | `star` | Give a minion **+1/+1**. |
| rubyexcavation | Ruby Excavation | neutral | — | tribe | `star` | Play **2 Rubies** on all of your minions. |
| rubyshipment | Ruby Shipment | neutral | — | tribe | `star` | Get **2 Rubies**. |
| rubytransfer | Ruby Transfer | neutral | — | tribe | `star` | Play **2 Rubies** on a minion. It **steals all |
| salvatore | Salvatore McKlusky | neutral | — | tribe | `star` | When you sell this, **Discover** 2 Tier 6 mini |
| seconddraft | Second Draft | neutral | — | tribe | `star` | Return a friendly **non-Gilded** minion to you |
| shatter | Shatter | neutral | — | tribe | `star` | Give a minion **+2/+4** and **Taunt**. If it a |
| sigilkinship | Sigil of Kinship | neutral | — | tribe | `star` | Choose a minion. Refresh the Shop with minions |
| sp_beefy | Beefy | neutral | — | tribe | `star` | Give a minion and its neighbours **+8/+8**. |
| sp_blessing | Blessing | neutral | — | tribe | `star` | Give a minion **+3/+4** twice. |
| sp_closedcasket | Closed Casket | neutral | — | tribe | `star` | Choose a minion. **Start of Combat:** destroy  |
| sp_containmentrune | Containment Rune | neutral | — | tribe | `star` | Set the first enemy minion summoned next comba |
| sp_dragonflame | Dragonflame | neutral | — | tribe | `star` | Give a friendly minion **+4/+4**. Repeat for e |
| sp_flutter | Flutter | neutral | — | tribe | `star` | Give a minion **+10 Health**. If it is a **Dra |
| sp_gamble | Gamble | neutral | — | tribe | `star` | Roll a die. Get a random minion or spell of th |
| sp_partingcry | Parting Cry | neutral | — | tribe | `star` | Choose a friendly **Shout** minion. When it di |
| sp_solidground | Solid Ground | neutral | — | tribe | `star` | The first **3** minions you summon next combat |
| sp_stoleninitiative | Stolen Initiative | neutral | — | tribe | `star` | Your **right-most** minion attacks immediately |
| sparkplug | Waking Rift | neutral | — | tribe | `star` | Give your entire board **+5/+5** twice. |
| spellcart | Spell Cart | neutral | — | tribe | `star` | Refresh the tavern — fill it with **Shop spell |
| spiritfire | Spirit Fire | neutral | — | tribe | `star` | Give a minion **+2/+3**. |
| sprout | Sprout | neutral | — | tribe | `star` | **Discover** a Tier 1 minion. |
| staffofguel | Staff of Guel | neutral | — | tribe | `star` | Every minion you **buy** gets **+2/+2** for th |
| strangerevision | Strange Revision | neutral | — | tribe | `star` | Transform a friendly or **Shop** minion into a |
| summonstone | Summon Stone | neutral | — | tribe | `star` | Get a random **Tier 1** minion. |
| sylus | Sylus the Reaper | neutral | — | tribe | `star` | **In combat,** your Deathrattles proc **1 more |
| tribeportal | Tribe Portal | neutral | — | tribe | `star` | **Discover** a minion from your most common ty |
| tribeschoice | Tribes Choice | neutral | — | tribe | `star` | Get a random minion of the targeted minion's t |
| turnabout | Turnabout | neutral | — | tribe | `star` | Swap a minion's **Attack and Health**. |
| undeadarmy | Undead Army | neutral | — | tribe | `star` | Get **2 copies** of a random **Undead**. |
| uron | Uron, Oathbringer | neutral | — | tribe | `star` | Your **Rallies**, **End of Turns** and **Start |
| veinstorm | Veinstorm | neutral | — | tribe | `star` | Your Shop minions **permanently** get stats eq |
| warding-ruby | Warding Ruby | neutral | — | tribe | `star` | Give a minion **+1/+1**. Also give it **Ward** |
| weaken | Weaken | neutral | — | tribe | `star` | **Start of Combat:** set a random enemy's Heal |
| wo_attack | Bloody Ale | neutral | — | tribe | `star` | Give **3 random** friendly minions **+4 Attack |
| wo_champion | Champion's Ale | neutral | — | tribe | `star` | Give your **left-most** minion **+6/+6**. |
| wo_health | Defensive Ale | neutral | — | tribe | `star` | Give **3 random** friendly minions **+4 Health |
| wo_mine | Golden Ale | neutral | — | tribe | `star` | Gain **2 Gold**. |
| wo_reinforcement | Reinforcing Ale | neutral | — | tribe | `star` | Get a minion of your **most common type**. |
| yazzus | Yazzus | neutral | — | tribe | `star` | Your **targeted** Shop spells cast **twice**. |
| zyff | Zyff, the Betrayer | neutral | — | tribe | `star` | Your **Battlecries** and **Deathrattles** trig |
| cryptwolf | Crypt Wolf | undead | — | tribe | `skull` | A 1/1 Undead Beast. |
| forsakenweaver | Forsaken Mage | undead | — | tribe | `skull` | When you cast a Shop spell, give your Undead * |
| gravebody | Grave Body | undead | — | tribe | `skull` | Copy your leftmost **Echo** when summoned. |
| gravewarden | Gravewarden | undead | — | tribe | `skull` | **Start of Combat:** Give a friendly **Undead* |
| knit | Spear Warden | undead | — | tribe | `skull` | When a **Spear Warden** dies in combat, all Sp |
| ossuaryrite | Ossuary Rite | undead | — | tribe | `skull` | Trigger a friendly minion's **Echo** (Deathrat |
| thunderingabomination | Cratering Hulk | undead | — | tribe | `skull` | Gain **+3/+3** when a minion is summoned in co |
| alley | Pennycat | beast | — | trigger | `battlecry` | **Battlecry:** summon a 1/1 Stray next to it. |
| b2_dunkey | Dunkey | beast | — | trigger | `skull` | **Avenge (4):** summon an **Armadiyo**. |
| b2_moira | Moira | beast | — | trigger | `sc` | **End of Turn:** trigger adjacent **Shouts**. |
| b2_solaris | Solaris | beast | — | trigger | `skull` | **Avenge (4):** gain **Ward** and attack immed |
| manasaber | Void Panther | beast | — | trigger | `echo` | **Deathrattle:** summon two 0/2 Void Cubs with |
| pack | Mama Pup | beast | — | trigger | `echo` | **Deathrattle:** summon two 1/1 Pups. |
| seaurchin | Sea Urchin | beast | — | trigger | `battlecry` | **Battlecry:** Discover a Beast. |
| solaris | Solaris Fang | beast | — | trigger | `skull` | **Avenge (5):** gain **Ward** and attack immed |
| squirlscout | Squirl Scout | beast | — | trigger | `battlecry` | **Battlecry:** Give a friendly minion **+1/+1* |
| abyssalfeeder | Abyssal Feeder | demon | — | trigger | `sc` | **End of Turn:** adjacent minions each **Consu |
| amunrab | Amun Rab | demon | — | trigger | `echo` | **Deathrattle:** Summon **7** Imps and give yo |
| dm_curator | Soul Defiler | demon | — | trigger | `sc` | **End of Turn:** give minions in the Shop **+1 |
| dm_gourmand | Bob Blart | demon | — | trigger | `sc` | **End of Turn:** Consume the **right-most** mi |
| dm_grobbus | Grobbus | demon | — | trigger | `skull` | **Avenge (3):** get a random **Demon**. |
| dm_overseer | Endless Overseer | demon | — | trigger | `skull` | **Avenge (4):** summon an **Imp** with **Taunt |
| dm_tallymonger | Void Curator | demon | — | trigger | `sc` | **End of Turn:** give your **Shop Spells +1/+1 |
| feastingbogrot | Feasting Bogrot | demon | — | trigger | `sc` | **End of Turn:** **Consume** a Fodder and also |
| impking | Imp King | demon | — | trigger | `echo` | **Deathrattle:** Summon 2 **Imps** and give yo |
| maw | Maw of the Pit | demon | T | trigger | `sc` | **End of Turn:** give your Fodder **+1/+1** an |
| pitsupplier | Pit Supplier | demon | — | trigger | `skull` | **Avenge (3):** add **1 Fodder** to your next  |
| ritualist | Ritualist | demon | — | trigger | `sc` | **End of Turn:** give your Imps and Fodder **+ |
| trickster | Trickster | demon | — | trigger | `echo` | **Deathrattle:** give **2** random friendly mi |
| broodmother | Violet Whelpmother | dragon | — | trigger | `echo` | **Deathrattle:** summon 2 **Violet Whelps** wi |
| cleric | Hoard Cleric | dragon | — | trigger | `battlecry` | **Battlecry:** give your **other** Dragons **+ |
| d2_curator | Water Dragon | dragon | — | trigger | `skull` | **Avenge (3):** get a copy of the **left-most  |
| d2_runefire | Runefire | dragon | — | trigger | `sc` | **End of Turn:** cast the last **Shop spell**  |
| d2_spellvault | Spellvault Drake | dragon | — | trigger | `sc` | **End of Turn:** get a copy of the first **Sho |
| havendrake | Haven Drake | dragon | — | trigger | `battlecry` | **Battlecry:** get a random **Dragon**. |
| skybound | Skybound Archivist | dragon | — | trigger | `sc` | **End of Turn:** your weakest Dragon gains sta |
| stuntdrake | Obsidian Drake | dragon | — | trigger | `skull` | **Avenge (3):** give this minion's Attack to 2 |
| twilightwhelp | Violet Whelp | dragon | — | trigger | `echo` | **Deathrattle:** summon a 3/2 Whelp that attac |
| weaver | Arcane Weaver | dragon | — | trigger | `skull` | **Avenge (2):** add a copy of **Spirit Fire**  |
| dw_foreman | Kringle | dwarf | — | trigger | `sc` | **End of Turn:** give your **left-most Dwarf + |
| k_gemstorm | Gemstorm Instigator | kobold | — | trigger | `skull` | **Avenge (2):** Play **2 Rubies** on your **Ko |
| k_portsmith | Gem Portsmith | kobold | — | trigger | `skull` | **Avenge (3):** improve your Rubies **+1/+1**  |
| k_wardstone | Wardstone Jeweler | kobold | — | trigger | `sc` | **End of Turn:** Get a **Warding Ruby**. |
| aeonguard | Aeon Guard | mech | — | trigger | `sc` | **End of Turn:** give your Shop spells **+1/+1 |
| combinator | Combinator | mech | — | trigger | `sc` | **End of Turn:** magnetize a random **Magnetic |
| fieldmechanic | Field Mechanic | mech | — | trigger | `battlecry` | **Battlecry:** add a **Patch Job** to your han |
| junk | Junkyard Titan | mech | — | trigger | `echo` | **Deathrattle:** Add a random Magnetic minion  |
| nanon | Nanon | mech | — | trigger | `echo` | **Deathrattle:** summon 5 Nanobots. For each o |
| scrapherald | Attachment Mechanic | mech | — | trigger | `battlecry` | **Battlecry:** Give your **Attachments** **+2/ |
| scrapvendor | Scrap Vendor | mech | — | trigger | `sc` | **End of Turn:** get **1 Gold** next shop. **D |
| selfless | Selfless Sentinel | mech | — | trigger | `echo` | **Deathrattle:** give a friend a **Divine Shie |
| sparkcapacitor | Spark Capacitor | mech | — | trigger | `skull` | **Avenge (3):** add a **Waking Rift** to your  |
| blackbelt | Black Belt Brian | neutral | — | trigger | `battlecry` | **Battlecry:** Discover a Shop spell. |
| blaster | Blaster | neutral | T | trigger | `echo` | **Deathrattle:** deal **3** damage to ALL mini |
| c3_nym | Starbroker Nym | neutral | — | trigger | `sc` | End of Turn — **Dawn:** gain **2 Gold** next t |
| hoarder | Hoarder | neutral | — | trigger | `battlecry` | **Battlecry:** get **1** extra Gold next turn. |
| jenkins | Jensen & Fi | neutral | — | trigger | `echo` | **Deathrattle:** destroy the minion that kille |
| joker | Mysterious Joker | neutral | — | trigger | `battlecry` | **Battlecry:** Discover a **Tier 5** minion. |
| labexperiment | Lab Experiment | neutral | V | trigger | `battlecry` | **Battlecry:** get a Tier 6 minion. **Deathrat |
| nimbus | Nimbus | neutral | — | trigger | `battlecry` | **Battlecry:** your next Shop spell casts an * |
| ropewrangler | Rope Wrangler | neutral | — | trigger | `sc` | **End of Turn:** Cast **Lasso**. Casts an addi |
| spellappraiser | Spell Appraiser | neutral | — | trigger | `skull` | **Avenge (3):** your Shop spells have **+1 Att |
| stewardofspells | Steward of Spells | neutral | — | trigger | `sc` | **End of Turn:** get a copy of the most recent |
| wayfinder | Wayfinder | neutral | — | trigger | `battlecry` | **Battlecry:** Discover a minion from a tribe  |
| anubis | Anubis | undead | R | trigger | `echo` | **Deathrattle:** Give your minions **Reborn**. |
| bonetaxer | Bone Taxer | undead | — | trigger | `skull` | **Avenge (4):** get **2 Gold** next shop. **De |
| cryptbroker | Crypt Broker | undead | — | trigger | `battlecry` | **Battlecry:** get a random **Echo** minion an |
| cryptscribe | Crypt Scribe | undead | — | trigger | `sc` | **End of Turn:** Get **2 random Shop spells**. |
| deathlesshand | Footman Captain | undead | — | trigger | `echo` | **Deathrattle:** Summon a **Footman**. |
| deathswarmer | Deathswarmer | undead | — | trigger | `battlecry` | **Battlecry:** Give your Undead **+1 Attack**  |
| graverobber | Graverobber | undead | — | trigger | `battlecry` | **Battlecry:** Destroy a friendly minion (proc |
| gravetwin | Gravetwin | undead | — | trigger | `battlecry` | **Battlecry:** copy a friendly **Echo** minion |
| mumi | Mumi | undead | — | trigger | `echo` | **Deathrattle:** give a friendly **Undead** ** |
| pillager | Pillager | undead | — | trigger | `echo` | **Deathrattle:** Get a **Gold Pouch**. |
| profgreg | Professor Greg | undead | — | trigger | `skull` | **Avenge (3):** get a random Shop spell. |
| ryme | Ryme | undead | T | trigger | `echo` | **Deathrattle:** Trigger adjacent minions' **B |
| sergeant | Sergeant | undead | — | trigger | `echo` | **Deathrattle:** Give your minions **+2 Health |
| soulsman | Soulsman | undead | — | trigger | `skull` | **Avenge (4):** raise your maximum Gold by **1 |
| spore | Sporeling | undead | — | trigger | `echo` | **Deathrattle:** Give your minions **+1/+1**.  |
| steadfast | Steadfast Champion | undead | — | trigger | `skull` | **Avenge (4):** summon a **Spear Warden**. It  |
| wolvesden | Wolves Den | undead | — | trigger | `echo` | **Deathrattle:** Summon 3 **Crypt Wolves**. |