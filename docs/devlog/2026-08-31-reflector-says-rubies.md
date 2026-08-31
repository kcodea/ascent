# Reflector reacts to Rubies, and now says so

**Player report 224af0ee (priority 2):** *"crest of the climb applied to reflector did not reflect to another
friendly unit. i'd guess other choose one targetable spells are likely compromised here too."*

## The reporter was right; the cause was not what they guessed

Choose One is not involved. Both resolution paths for a targeted Choose One spell were driven as tests — the
pinned-target order (play aimed, then pick) and the deferred-aim order (play, pick, then aim) — and **both
reflect correctly**.

The answer was in the captured state. The reported Reflector held:

```
n2_reflector  uid=b27  spellsOnThisTurn=1  rubiesOnThisTurn=2
```

Reflector carries **two** effects — `spellCastOnThis` and `onRubyPlayed` — and they share **one**
once-per-turn allowance; both factories guard on `spells + rubies !== 1`. Two Rubies had already landed on
that body during the turn, so the spell cast afterwards correctly did nothing.

**The engine was right. The card was not.** It read *"Spells cast on this also cast…"* and never mentioned
Rubies, so the player did exactly what the card promised and watched nothing happen, with nothing on screen
to explain it.

## Why the text is the defect rather than the behaviour

The Ruby reaction is deliberate — it is a second authored effect, and the shared allowance is what stops the
card paying out twice in a turn. What was wrong is that **a Ruby is not a Shop Spell**. The engine says so
outright, in `playRubyOn`: *"A Ruby is not a Shop Spell, so a 'your Shop Spells cast again' grant must not
multiply it."* The two are separate systems with separate counters, events and factories — so the word
"Spells" on a card never covered Rubies.

The sweep settled it. Of the three cards reacting to `onRubyPlayed`:

| card | names Rubies? |
|---|---|
| Ruby Broker | yes |
| Resonance Idol | yes |
| **Reflector** | **no** |

One outlier is a bug. The text now reads *"Spells and **Rubies** cast on this also cast…"*.

## The lane

`rubyReactorsSaySo`: every card carrying an `onRubyPlayed` effect must name Rubies in its **base** text.

Golden text is deliberately not accepted as satisfying it — and that came directly out of sabotage-checking.
The first version accepted any text surface, so reverting only the base text left `goldenText` still saying
"Rubies" and the lane passed the reverted card. A mention that only appears once a card is Gilded still reads
as spell-only to everyone who has not gilded it.
