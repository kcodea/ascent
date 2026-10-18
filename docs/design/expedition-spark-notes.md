# Expedition: the spark notes

**A 2-player co-op PvE adventure built on ASCENT.** You and a friend take one road together through three acts of
monsters and bosses, each building your own ASCENT board, and win or lose as a pair. About 50 minutes a run.

## The one-line pitch

ASCENT, but you and a friend versus a world of bosses, where your two boards slowly wire together into one big combo.

## How a turn plays

1. **You both shop at the same time**, on one clock, exactly like normal ASCENT. Same Shop, Gold, tiers, cards,
   keywords and triples.
2. **A Haul arrives.** It's 4 loot cards and you take 1 for free. Loot is the exciting part: it changes how your
   board works with your partner's.
3. **You both lock, and you both fight.** Each of you fights your own enemy, at the same time.
4. **If you win and your partner loses, your survivors Charge into their fight** and try to save them.
5. **Then you pick the next door on the map together.** Each door is a fight plus a type of reward.

Every step of the run is one ASCENT turn and one fight. If you know ASCENT, you already know 90% of it.

## What's new

- **Twins.** Your slot 1 and your partner's slot 1 are Twins, and the same goes for every slot. Effects that cross
  between boards always land on the Twin, so you can plan together ("put your carry in slot 1, my Shout buffs it").
- **Loot that links your boards.** Examples:
  - "The first Shout you play each turn also triggers its Twin's Shout."
  - "When your Echo minion dies, it drops onto your partner's board."
  - "Your next spell also lands on your partner's board."
- **The Handshake.** One loot card each turn is offered to both of you. If you both take it, it becomes twice as
  strong and works both ways. It's the turn's one shared decision.
- **The Shared Slot.** Slot 7 is one slot that sits on both boards. A minion there works for both of you. Put
  Drakko there and his Shout pays off on both boards.
- **Your hero is built during the run.** You start with no hero power. You find powers along the way (up to 3) and
  level them up, including co-op powers that help your partner.
- **Bespoke enemies.** Every enemy has its own art and its own design, separate from the minions you buy. They
  still use ASCENT keywords, so they read naturally.
- **Bosses that mess with your Shop.** For example, a boss eats cards from your Shop, taxes your Gold, or curses
  your minions. It's always shown a turn ahead, and you beat it together: your partner buys what you need and
  sends it over, pays your tax, or takes the curse off you.
- **Curses.** Some loot is risky ("big reward, take a Curse"). Curses can spread between boards, and your partner
  can take them, split them or burn them off. Some even flip into something good if you handle them right.
- **Boss drops.** Bosses and elites drop loot and runes, with a chance to drop **the boss itself as a playable
  card** with wild effects (a Gobbler King you can play that eats minions to grow).
- **Falling isn't the end.** If you die you become a Ghost. You keep shopping and helping, and your partner can
  bring you back.

## Why it's good for ASCENT

- **A real co-op mode.** Play with a friend instead of against them. That's great for new players and for groups.
- **It reuses what we've built.** It runs on the ASCENT engine, cards and keywords, plus the Versus rooms we
  already have (real time, reconnect, spectators, emotes).
- **Fresh every run.** A random map, a different Haul every turn and different bosses mean a new combo every time.
- **Big moments.** Saves, two-board combos, boss cards and beating a boss's curse together.
- **Every cross-board effect is clearly animated on both screens,** so you always see what your partner did for you.

## How we'd build it

1. **First Haul (offline, with a bot partner).** One act, one boss, 20 loot cards, two separate fights. This
   answers one question: is the co-op loot draft fun?
2. **Real pairs in a test room.** Does it create good teamwork and conversation?
3. **Online with live crossings mid-fight.** Charges and links landing in your partner's fight.
4. **The full mode.** All three acts, nine bosses and the finale.

The MVP needs 44 pieces of art (21 enemies, 2 boss cards, curses, a few UI pieces), and the prompts are already
written.

Full design: `docs/design/2026-10-17-coop-mode-scope-v3.md`.
