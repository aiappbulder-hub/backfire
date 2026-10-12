# Backfire — prototype 0.2

A compact pandemic strategy game where your most powerful weapon is humanity's
response, not the pathogen. The pathogen is weak on its own. Its power comes from
**traps** that only fire once the world reacts — treatment programmes, cure
research, cooperation between two hostile blocs.

A trap must be bought **before** its trigger exists. That is the whole game: you
are predicting what humanity will do, not optimising a spread curve.

## Run it

No dependencies. Two ways:

**From source** — the ES modules need to be served over HTTP, so opening
`index.html` from the filesystem will not work:

```bash
npm start          # python3 -m http.server 8080
# then open http://localhost:8080
```

Any static server works.

**As a single file** — bundles everything into one HTML file you can open
straight from disk, or email, or drop on any static host:

```bash
npm run build      # writes dist/backfire.html (~89KB)
```

`tools/build.js` concatenates the modules in dependency order and strips their
`import`/`export` syntax, which works because no two modules declare the same
name. It also writes `dist/embed.html`, the same page without the outer
`<!doctype>`/`<head>`/`<body>` tags, for hosts that supply their own skeleton.
`dist/` is generated and not committed — run the build to produce it.

## Tests

```bash
npm test           # 22 rule tests, node:test, no dependencies
```

These cover the rules that are easy to break: Drift never goes negative, traps
cannot be armed after their trigger exists, a trap never fires twice, meters stay
in bounds across a 60-turn run, the game ends once, restart fully resets, and the
same seed reproduces the same run.

## Balance harness

```bash
node tools/playtest.js 60    # 60 runs per strategy
```

Plays four scripted strategies headlessly and reports win rates. Current results
(60 runs each) show the designed regret — pure Spread loses, pure Influence
loses, and prediction plus timing wins:

| strategy       | win% | avg turns | typical loss      |
| -------------- | ---- | --------- | ----------------- |
| spread-heavy   | 0%   | 21.0      | cure completed    |
| trap-heavy     | 33%  | 21.2      | cure completed    |
| balanced       | 73%  | 25.7      | cure completed    |
| influence-only | 3%   | 29.9      | cure completed    |

A game runs ~20–27 turns, which is the 10–15 minute target.

## How a turn works

1. **Intelligence briefing** — region changes, bloc intentions, event odds with
   the reason each one shifted, cure forecast, summit countdown.
2. **Planning** — spend Drift on Spread, Traps or Influence. One pool, three
   competing tracks.
3. **World resolution** — spread, bloc decisions, a weighted event, trap checks,
   cure progress.
4. **Turn report** — what changed and why.

## Win and loss

- **Win:** Collapse reaches 100.
- **Lose:** cure research reaches 100; or Cooperation stays at 80+ for 6 turns;
  or the outbreak burns out entirely from over-lethality.

Collapse only accrues while global infection is above 25% — below that the world
rebuilds faster than you break it, and the bar falls back. Treatment is a real
counterforce: a well-resourced response pushes infection down. The **Backfire
Response** trap inverts exactly that term, which is why it has to be armed before
treatment reaches 40.

## Systems implemented

- A real world map: 12 named regions (North America through Oceania) drawn from
  lon/lat coastlines and projected at render time, with bloc membership,
  population, harsh-climate modifiers, connectivity, containment and clearance.
- A single transmission number driving both internal growth and border flow.
- Two blocs that react to detected infection: treatment, research, containment,
  clearance. The Red Bloc conceals case counts until its own outbreak passes 25%
  — that slows the joint cure, but your map data for its regions is unverified.
- Shared Drift economy across Spread / Traps / Influence, with escalating costs.
- Two traps (Backfire Response, Cure Cascade) with four states — available,
  armed, triggered, missed — and no retroactive arming.
- Six events with state-aware weighting, each showing why its odds moved.
- Cooperation, Tension, Public trust, Investigation (attribution), scheduled
  summits every 5 turns, and summit sabotage as counterplay.
- Cure forecast derived from the live research rate and labelled an estimate.
- End screen with a causal timeline of pivotal moments, and restart.

## Code layout

```
index.html           markup and the static UI shell
src/css/styles.css   dark strategy-console styling, responsive to 390px
src/js/data.js       tuning constants, regions, edges, actions, traps, events
src/js/worldgeo.js   coastlines as lon/lat rings, plus the map projection
src/js/rng.js        seedable RNG (mulberry32) — runs are reproducible
src/js/engine.js     all game rules; no DOM access
src/js/ui.js         all rendering; no game rules
src/js/main.js       wiring between the two
tests/               rule tests
tools/playtest.js    headless balance harness
```

Game logic and rendering are kept apart deliberately: `engine.js` runs under Node
with no browser, which is what makes the tests and the balance harness possible.

## Known gaps

- Only two of the four designed traps are implemented (Decoy Coat and Sleeper
  Reservoir are not). Prototype scope, per the brief.
- The coastlines are simplified by hand. Europe is the roughest of them, and
  the Atlantic islands are approximations rather than real geography.
- Tension is read by events and the cross-bloc border, but the player has no
  direct lever on military movement or refugee corridors.
- The distrust loop is a single Investigation meter rather than five stages.
- Forecasts are honest rather than imperfect — the cure estimate is exact given
  the current rate, where the design calls for degraded intelligence.
- No save/resume; a refresh starts a new game.
