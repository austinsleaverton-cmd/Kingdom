# City View: Spec (v1)

Build your city on its own hex screen. Every amenity sits on a plot, plots have terrain, and neighbors give bonuses.

**Status:** Step 1 (rules + data) is done: `src/world/city.ts` plus changes in `tile.ts`, `game.ts`, `units.ts`, `ai.ts`, `save.ts`.

## Goals

- Make "where do I build it?" a real decision, not just "what do I build?"
- Never force it: auto-place handles everything for players who don't care.
- Tie the city to the world map: the land around a city shapes what fits inside it.
- One scoring function shared by auto-place, City View hints and the AI.

## Layout

- **Center: the Keep.** Walls, HP and shield live here (no change to how walls work). Not buildable.
- **Ring 1: 6 plots** around the Keep. v1 is ring 1 only.
- **Plot terrain** = terrain of the world hex in that same direction (`map.neighborAt(city, i)`), snapshotted when the city is founded. Terraforming later does not change plots. Captured cities keep their plots and buildings.
  - Off-map neighbor: grass.
  - Mountain plots count as hills.
- **Unlocks by city level:** Village 2, Town 3, City 4, Large City 5, Metropolis 6 plots (`PLOTS_BY_LEVEL`). Locked plots show a lock and the level needed.
  - Simple mode: all 6 open.

## Buildings

Existing six stay as they are (cost, turns, base stats). Three new ones are added at the end of `BUILDING_ORDER` so saves stay valid.

| Building | Plot | Base | Notes |
| --- | --- | --- | --- |
| Temple | land | +2 happy, +1 culture | |
| Market | land | +2 gold, +1 happy | |
| Granary | land | +2 food | |
| Park | land | +1 happy, +2 culture | |
| Arena | land | +3 happy, +1 culture | |
| Harbor | **water** | +1 gold, +1 food per fishery, builds boats | Needs a water plot (plus the old coastal check) |
| **Barracks** (new) | land | troops train 1 turn faster (min 1, stacks with Metropolis) | No unit locks |
| **Workshop** (new) | **hills** | +1 stone | **Required to train catapults** |
| **Mill** (new) | **grass** | +1 food per worked farm on this city's land (max 3) | |

Costs for new ones (tune in playtests): Barracks 35g / 3 turns / minPop 2, Workshop 40g / 3 turns / minPop 3, Mill 30g / 2 turns / minPop 2.

"land" = any non-water plot.

Dropped from the first draft: Barracks "+2 HP on new troops". Units heal up to their normal max, so the extra HP would vanish the first time they healed.

## Locks

- Only one new lock: **Catapult needs a Workshop in the training city** (`needs: 'workshop'` on `UNIT_STATS.catapult`).
- Knights and archers stay gated by horses (pastures) and bows (forests). No Barracks lock: it would just be a tax every city pays first.

## Placement bonuses

### Terrain

- Granary on grass: +1 food.
- Workshop on hills: required (bonus is built in).
- Mill on grass: required.

### Adjacency

Plot neighbors are the 2 plots beside it on the ring + the Keep. The bonus goes to the first building in each rule.

| Rule | Bonus |
| --- | --- |
| Temple next to the Keep | +1 happy |
| Market next to Harbor | +1 gold |
| Park next to Temple | +1 culture |
| Arena next to Market | +1 gold |

Note: every ring-1 plot touches the Keep, so "next to the Keep" is always true in v1. Kept anyway; it matters once ring 2 exists. If it feels like a freebie in testing, fold it into base stats.

Bonuses feed the existing sums: `grossIncome`, `foodMade`, `happinessParts` (shows as "Temple by the Keep"), `cultureRate`. Workshop stone goes into `stoneIncome`, Mill food into `foodMade`.

Rules live in `TERRAIN_BONUS` and `ADJACENCY` in `src/world/city.ts`: add a row to add a bonus.

## Building flow

Still **one project at a time per city**, shared with training and walls. Cost and turns unchanged.

### Auto-place (default, done)

- The city panel's build buttons keep working. The building goes to the highest-scoring open plot that fits (`GameState.autoPlot`).
- The target plot is reserved when the project starts (`city.projectPlot`), so it can't be taken twice.
- When it finishes, the log says where and why: `Market on plot 3 (+1 gold: Market next to the Harbor)`.
- Build button disabled with a reason when no plot fits: `Needs a free water plot` / `No free plot: more at Town`.

### Open the city (manual, step 3)

- City panel gets an **Open city** button. Double-tap on your own city also opens it.
- Tap an empty plot: list of buildings that fit, each showing cost, turns and the exact bonus it would get on *that* plot. Best plot for each building gets a star.
- Tap a built plot: what it gives and which bonuses are active.
- Back button / Esc returns to the map exactly where you were.
- Enemy or unexplored cities can't be opened.
- Rules side is ready: `buildCheck(city, b, p, plot)` and `startBuilding(city, b, p, plot)` take a plot.

## Scoring (shared, done)

In `src/world/city.ts`:

```ts
plotFits(city, i, b, simple): boolean
plotBonus(city, i, b, layout?): PlotBonus   // gold, food, happy, culture + notes
plotScore(city, i, b): number
bestPlot(city, b, simple): number | null
cityBonus(city): PlotBonus                  // everything placed, summed
```

- Score = the building's own bonus + what it adds to its neighbors, minus a small penalty for using a hills or grass plot that a Workshop / Mill might need.
- The AI uses the same auto-place through `startBuilding`. AI build orders include the new buildings (Workshop and Barracks first when at war, no Mill without farms).

## Data (done)

- `Tile`: `plots: PlotTerrain[]`, `placed: (Building | null)[]`, `projectPlot: number | null` (city only).
- `buildings` stays the list of what's built; `placed` says where.
- Saves: new optional `plots` field (tile index -> terrain letters, placed building indexes, reserved plot).
- **Old saves:** plots come from the land around each city, and existing buildings are auto-placed. A building with no matching plot still gets one (grandfathered).

## UI (steps 2-3)

- New `src/scenes/CityScene.ts`. `MapScene` sleeps, `CityScene` launches with the city index, and waking returns to the map.
- Big hex layout: Keep in the middle (wall level and HP), 6 plots colored by terrain, locked plots dimmed.
- Sprites for new buildings in `sprites.ts`.
- World map: city sprite shows up to 3 small building icons.
- `Hud.ts` / city panel: **Open city** button, plot count (`4/6 plots`), and the build button hint shows where auto-place will put it.
- `Help.ts`: City View section (the Amenities table already lists the new buildings).

## Build order

1. ~~**Rules + data**: plots, placed, bonuses, save migration, catapult lock, new buildings, AI.~~ Done. Tested with 18 all-AI games (150 turns each, every difficulty), save/load and old-save migration.
2. **Auto-place polish**: toast instead of just the log, build hint shows the target plot and bonus.
3. **CityScene**: plot view, filtered build menu, previews, open/close.
4. **Balance pass**: run AI games, check nothing goes lopsided (Barracks is very popular with the AI right now).
5. **Help + polish**: help section, world-map icons.

Each step should pass `npx vite build` and the AI test games before moving on.

## v2 (not now)

- Ring 2 (12 more plots, unlock past Metropolis or by culture).
- Moving a building (25% of its cost, takes the city's project slot for 1 turn).
- More buildings so ring 2 has real competition.
- Read-only peek into other kingdoms' cities.
