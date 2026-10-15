# City View: Spec (v1)

Build your city on its own hex screen. Every amenity sits on a plot, plots have terrain, and neighbors give bonuses.

## Goals

- Make "where do I build it?" a real decision, not just "what do I build?"
- Never force it: auto-place handles everything for players who don't care.
- Tie the city to the world map: the land around a city shapes what fits inside it.
- One scoring function shared by auto-place, City View hints and the AI.

## Layout

- **Center: the Keep.** Walls, HP and shield live here (no change to how walls work). Not buildable.
- **Ring 1: 6 plots** around the Keep. v1 is ring 1 only.
- **Plot terrain** = terrain of the world hex in that same direction (`map.neighbors(city)[i]`), snapshotted when the city is founded or captured. Terraforming later does not change plots.
  - Off-map neighbor: grass.
  - Mountain plots count as hills.
- **Unlocks by city level:** Village 2, Town 3, City 4, Large City 5, Metropolis 6 plots. Locked plots show a lock and the level needed.
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
| Harbor | **water** | +1 gold, +1 food per fishery, builds boats | Needs a water plot (replaces the `coastal` check) |
| **Barracks** (new) | land | troops train 1 turn faster (min 1), new troops start +2 HP | No unit locks |
| **Workshop** (new) | **hills** | +1 stone | **Required to train catapults** |
| **Mill** (new) | **grass** | +1 food per worked farm on this city's land (max 3) | |

Suggested costs for new ones (tune in playtests): Barracks 35g / 3 turns / minPop 2, Workshop 40g / 3 turns / minPop 3, Mill 30g / 2 turns / minPop 2.

"land" = any non-water plot.

## Locks

- Only one new lock: **Catapult needs a Workshop in the training city.** Use the existing `needs` field on `UNIT_STATS`.
- Knights and archers stay gated by horses (pastures) and bows (forests). No Barracks lock: it would just be a tax every city pays first.

## Placement bonuses

### Terrain

- Granary on grass: +1 food.
- Workshop on hills: required (bonus is built in).
- Mill on grass: required.

### Adjacency

Plot neighbors are the 2 plots beside it on the ring + the Keep.

| Rule | Bonus |
| --- | --- |
| Temple next to the Keep | +1 happy |
| Market next to Harbor | +1 gold |
| Park next to Temple | +1 culture |
| Arena next to Market | +1 gold |
| Barracks next to the Keep | troops start +1 more HP |

Note: every ring-1 plot touches the Keep, so "next to the Keep" is always true in v1. Keep the rules anyway; they matter once ring 2 exists. If that feels like a freebie in testing, fold them into base stats.

Bonuses feed the existing sums: `grossIncome`, `foodMade`, `happinessParts` (show as "Temple by the Keep" etc.), `cultureRate`, `stoneIncome`.

## Building flow

Still **one project at a time per city**, shared with training and walls. Cost and turns unchanged.

### Auto-place (default)

- The city panel's build buttons keep working. The building goes to the highest-scoring open plot that fits.
- The target plot is reserved when the project starts (`city.projectPlot`), so it can't be taken twice.
- When it finishes, the toast/log says where and why: `Market → plot 3 (+1 gold next to Harbor)`.
- Build button disabled with a reason when no open plot fits: `No open water plot` / `Unlocks at Town`.

### Open the city (manual)

- City panel gets an **Open city** button. Double-tap on your own city also opens it.
- Tap an empty plot: list of buildings that fit, each showing cost, turns and the exact bonus it would get on *that* plot. Best plot for each building gets a star.
- Tap a built plot: what it gives and which bonuses are active.
- Back button / Esc returns to the map exactly where you were.
- Enemy or unexplored cities can't be opened. Allied/peace cities: v2 maybe (read-only).

## Scoring (shared)

```ts
plotFits(city, plot, building): boolean
plotBonus(city, plot, building): Bonus          // gold, food, happy, culture, stone, hp
plotScore(city, plot, building, weights): number
bestPlot(city, building): number | null
```

- Auto-place uses default weights.
- AI passes its own weights (food when starving, happy when unhappy, gold otherwise).
- Scoring also counts what a plot would be *worth to other buildings later* (lightly), so auto-place doesn't park a Market on the only water plot.
  - Simple version: penalty for using a water or hills plot with a building that doesn't need it.

## Data changes

### `tile.ts`

- `Building` adds `barracks | workshop | mill`, appended to `BUILDING_ORDER`.
- `BuildingInfo` adds `plot?: 'water' | 'hills' | 'grass'` and replaces `coastal`.
- `Tile` adds:
  - `plots: PlotTerrain[]` (length 6, city only)
  - `placed: (Building | null)[]` (length 6)
  - `projectPlot: number | null`
- Keep `buildings` as the derived list (or compute it from `placed`) so existing code keeps working.

### `game.ts`

- `foundCity` / `placeCapitals` / `captureCity` snapshot plots. Capture keeps placed buildings.
- `buildCheck` takes an optional plot; `startBuilding(city, b, plot?)` auto-picks when no plot is given.
- `advanceProjects` writes into `placed[projectPlot]`.
- Bonus math in the income/food/happy/culture/stone functions.
- Barracks in `recruit` (turns) and unit spawn (HP).

### `units.ts`

- Catapult `needs: 'workshop'`.

### `save.ts`

- Save `plots`, `placed`, `projectPlot`.
- **Old saves:** generate plots from the current neighbors, then auto-place existing buildings in `BUILDING_ORDER`. A Harbor with no water plot gets placed anyway (grandfathered).

### `ai.ts`

- Use `bestPlot` with AI weights.
- Build a Workshop before queuing catapults.
- Don't build Mill without farms.

## UI

- New `src/scenes/CityScene.ts`. `MapScene` sleeps, `CityScene` launches with the city index, and waking returns to the map.
- Big hex layout: Keep in the middle (shows wall level and HP), 6 plots colored by terrain, locked plots dimmed.
- Sprites for new buildings in `sprites.ts`, reusing the emoji-icon approach.
- World map: the city sprite shows up to 3 small building icons.
- `Hud.ts` city panel: **Open city** button, plus a plot count (`4/6 plots`).
- `Help.ts`: new City View section.

## Build order

1. **Rules + data**: plots, placed, bonuses, save migration, catapult lock. Unit-test bonus math.
2. **Auto-place + toast**: playable end-to-end with no new screen.
3. **CityScene**: plot view, filtered build menu, previews, open/close.
4. **AI + new buildings**: Barracks / Workshop / Mill in, AI scoring, run the 150-turn AI games and check nothing breaks or goes lopsided.
5. **Help + polish**: help section, world-map icons.

Each step should pass `npx vite build` and the AI test games before moving on.

## v2 (not now)

- Ring 2 (12 more plots, unlock past Metropolis or by culture).
- Moving a building (25% of its cost, takes the city's project slot for 1 turn).
- More buildings so ring 2 has real competition.
- Read-only peek into other kingdoms' cities.
