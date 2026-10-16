# City Builder: Spec (v1)

Run the kingdom on the map, then zoom into a city and build it out like a real town. Extends `docs/CITY_VIEW.md`: the rules there (6 plots, terrain, neighbors, facing, auto-place, scoring) stay exactly as they are. This adds a ground grid around them, free-placed decorations, real art and a zoom transition.

**Status:** spec only. Nothing built yet.

## Goals

- The city looks like a town, not a diagram.
- Buildings stay snapped to plots, so placement, neighbor and facing bonuses keep working with zero rule changes.
- Decorations are the creative part: put them anywhere open.
- Never forced: a player who never opens a city loses nothing on Easy / Free Play, and only a small beauty bonus on Normal+.

## Ground grid

Square tile grid (Kenney packs are square 16px tiles), Keep dead center. Odd sizes so the Keep is always the exact middle. Grows with the city.

| City level | Grid | New ground |
| --- | --- | --- |
| 1 Village | 7x7 | start |
| 2 Town | 9x9 | +1 ring (32 tiles) |
| 3+ City, Large City, Metropolis | 11x11 | +1 ring (40 tiles), cap |

- Grid size comes from the **highest level the city has ever reached** (`city.gridLevel`), not the current level. Capture drops a level, but the grid never shrinks, so decorations are never stranded or deleted.
- New rings arrive as open ground (grass, see Art). Log/toast: `Riverton grew: more room to build (9x9)`.
- Simple mode: same growth as everyone else (plots are already all open there; the grid is just space).
- 11x11 is the cap for v1. The extra space is for decorations only (no ring-2 plots yet).

### Coordinates

- Tiles are addressed as offsets from the Keep: `(dx, dy)`, each from `-r` to `r` where `r = (size - 1) / 2` (3, 4, 5).
- Because everything is stored relative to the Keep, growing the grid needs no remapping.

### Where the Keep and the 6 plots sit

The Keep is the center tile. Each building is **one tile** (one plot = one tile, keep it simple). Plots are laid out to match their world direction so the city still "faces" the map like City View does today:

| Plot | Direction | Tile (dx, dy) |
| --- | --- | --- |
| 0 | E | (2, 0) |
| 1 | NE | (1, -2) |
| 2 | NW | (-1, -2) |
| 3 | W | (-2, 0) |
| 4 | SW | (-1, 2) |
| 5 | SE | (1, 2) |

- Plot tiles, the Keep tile and a 1-tile road from the Keep to each plot are **reserved**: no decorations there. Everything else is open ground.
- Plot neighbors stay index-based (`plotNeighbors(i)`: ring neighbors + Keep). The grid is visual; `src/world/city.ts` scoring does not change.
- Plot terrain shows as the plot tile's ground (water plot = water tile, hills = dirt/rock, sand, grass).
- **Facing hexes:** the map hex each plot faces is drawn as a small marker on the grid edge in that direction (same info and green "paying" outline as City View today).
- Locked plots: lock icon on the tile + the level name, like now.

## Decorations

### Placing

- Bottom tray of decorations (scrolls sideways). Tap one, then tap an open ground tile to place it. The tray item stays selected so you can place several in a row; tap it again or Esc to stop.
- **Drag** a placed decoration to move it. Drop on a blocked tile = it snaps back.
- **Remove:** tap a placed decoration, then the trash button (or drag it onto the trash). Removing never refunds gold (keeps it from being a gold bank).
- One decoration per tile. Moving is always free.
- Instant: decorations don't use the city's project slot and don't take turns.
- Only in your own cities, on your turn (hot-seat safe: acts as `state.current`).

### Starter set (v1)

Starting list, judged once it's on screen (add/cut freely in step 5).

| Decoration | Kind | Notes |
| --- | --- | --- |
| Tree | nature | 2-3 variants |
| Bush | nature | |
| Flower bed | nature | |
| Rock | nature | |
| Path tile | path | paints ground, counts as a decoration |
| Fence | build | auto-joins to neighbor fences |
| Well | build | |
| Lamp post | build | |
| Bench | build | |
| Statue | build | Town+ |
| Fountain | build | City+ |
| Banner | build | in the player's color |

### Cost (by difficulty)

| Mode | Cost |
| --- | --- |
| Easy | free |
| Free Play (`isFree`) | free |
| Normal | 2g each (Statue 6g, Fountain 10g) |
| Hard | 3g each (Statue 8g, Fountain 12g) |

Tray shows the price on each item. Not enough gold = item dimmed with the reason.

### Beauty (happiness)

- **Normal and up only.** On Easy and Free Play decorations are just for looks: no bonus, and the beauty line is hidden.
- `beauty = number of decorations in the city` (Statue counts 2, Fountain 3).
- Bonus: **+1 happy per 8 beauty, max +2.** Shows in `happinessParts` as `Beautiful streets`.
- Why 8, not 6 (paper check): a Temple gives +2 happy but costs 30-40g, takes turns and uses the project slot. At 1 per 6, +2 happy cost 24g on Normal, instant, no slot: too cheap next to a Temple. At 1 per 8 it's 32g on Normal / 48g on Hard (small decos), about Temple price with no slot, which feels like a fair trade for the clicking. Path tiles count, so to stop path spam from being the cheapest route, a city's paths count at most 4 beauty.
- Small on purpose: nice to have, never the reason you win.
- One function in `src/world/city.ts`: `beautyBonus(city, difficulty, free): number`. Retune after real playtests and the AI test games.

### Scope

- **Per city.** Decorations belong to the city they're in and can't move between cities.
- Captured city: decorations stay with the city (the new owner gets them and their beauty).

### AI

- **Easy / Normal AI:** no decorations.
- **Hard AI decorates**, so it has a real gold sink:
  - Only with spare gold after its normal build/train decision for the turn (never instead of troops, walls or buildings).
  - Not while at war or with enemy troops within 2 hexes of the city.
  - Keeps a reserve (doesn't drop below 40g) so it can still react.
  - Stops at the cap (16 beauty, where the bonus maxes out). Paths count at most 4 like for players.
  - Places on random open tiles, skipping the Keep's roads, using `GameState.placeDeco` (same rules as people).
- Check in the AI test games that Hard doesn't get noticeably weaker from it.

## Saved data

On the city tile (`Tile`, city only):

```ts
gridLevel: number;            // highest city level ever reached (1-5), drives grid size
deco: [number, number, number][]; // [dx, dy, kind] relative to the Keep, kind = index into DECO_ORDER
```

- `DECO_ORDER` in `src/world/city.ts`: new decorations only ever go on the end, so old saves keep their meaning (same rule as `BUILDING_ORDER`).
- Save: new optional `deco` field next to `plots` in `save.ts` (tile index -> `gridLevel`, flat deco list). Same key, `kingdom-save-v3`.
- **Old saves:** `gridLevel = cityLevel(city)`, `deco = []`. Nothing else to migrate: plots and buildings are untouched.
- On load, any decoration on a reserved or out-of-grid tile is dropped (safety net, shouldn't happen).

## Art (Kenney packs, already in `public/assets/`)

Main pack: **Tiny Town** (16px, top-down, matches the town look). Fill gaps from **Roguelike RPG** (16px, 1px spacing on its sheet).

| Thing | Pack | What to use |
| --- | --- | --- |
| Open ground | Tiny Town | grass (+ 1-2 grass variants scattered by a seeded hash so it doesn't look tiled) |
| Road / path | Tiny Town | dirt path tiles |
| Water plot | Tiny Town / RPG | water tile with edge pieces |
| Hills plot | RPG | dirt/rock ground |
| Sand plot | RPG | sand ground |
| Keep | Tiny Town | castle/stone wall pieces, wall level shown with extra wall segments |
| Temple, Market, Granary, Mill, Barracks, Workshop | Tiny Town | house/roof pieces, each a different roof color + a sign icon |
| Harbor | Tiny Town / RPG | dock planks on the water plot |
| Park | Tiny Town | trees + flowers on grass |
| Arena | RPG | fenced sand ring |
| Trees, bushes, flowers, rocks, fences, well, lamp, bench | Tiny Town | direct tiles |
| Statue, fountain, banner | RPG | direct tiles (banner tinted to player color) |
| Construction | Tiny Town | scaffold/fence + existing pixel builders from `citySprites.ts` |

- Exact tile indices live in one table, `CITY_ART` in `src/scenes/cityArt.ts`, picked in build step 1 by checking the sheets. Swapping art = editing that table.
- Pixel people from `citySprites.ts` stay (they already match the 8-bit look).
- Licenses are CC0, nothing to credit, but keep the `License.txt` files.

## Zoom transition

- **In:** pinch / scroll zoom on the map past the max map zoom while centered on your own city, or the existing **Open city** button / double-tap. Short (~350ms) zoom + fade: the map camera zooms toward the city hex, then the city fades in at the same screen spot and settles.
- **Out:** pinch out past the city's min zoom, the Back button, or Esc. Reverse animation, map returns exactly where you were (camera position and zoom saved before going in).
- Enemy / unexplored cities: zooming in just stops at max map zoom, like now.
- Inside the city: pan and pinch zoom within the grid bounds (clamped so you can't lose the town).
- `prefers-reduced-motion`: skip the animation, plain cut.

### Scene setup

- New Phaser scene `src/scenes/CityScene.ts` draws the grid, buildings, decorations and people from the Kenney sheets (Phaser handles sprite sheets, drag and pinch far better than the current SVG).
- `MapScene` sleeps while the city is open, wakes on the way out (same plan `CITY_VIEW.md` already had).
- The **side panel stays DOM**: the build list, plot info and bonuses from `CityView.ts` are reused as a panel; the SVG drawing is retired.
- World logic stays in `src/world` (`placeDeco`, `moveDeco`, `removeDeco` on `GameState`, all validated there).

## Phones

- Max 11x11 = 121 ground tiles + up to ~100 decorations + 7 buildings: tiny for Phaser.
- Ground drawn once into a static layer (Phaser `TilemapLayer` or a cached render texture); only redrawn when the grid grows or a path tile changes.
- Decorations and buildings are plain sprites from one texture atlas per pack (2 textures total, preloaded in `BootScene`).
- Pixel art: `pixelArt: true` / nearest-neighbor scaling, integer zoom steps for crisp tiles.
- Tap targets at least 40px: default zoom fits the grid to the screen width, so a 7x7 tile is big and an 11x11 tile is still ~32px with zoom-in available.
- Drag starts after a short hold (150ms) or 8px of movement so panning and dragging don't fight.
- MapScene sleeps (not just hidden) so it isn't rendering underneath.
- Saves only on change (place/move/remove), not every frame.

## Build order

1. **Data + rules:** `gridLevel`, `deco`, `DECO_ORDER`, place/move/remove, costs, beauty bonus, Hard AI decorating, save + old-save migration. Pick `CITY_ART` tile ids. Run the AI test games (Hard with and without decorating) to sanity-check beauty and gold use.
2. **CityScene grid:** ground, roads, Keep, 6 plots with buildings, facing markers, pan/zoom. Side panel wired up. Replaces the SVG drawing.
3. **Decorations UI:** tray, tap to place, drag to move, remove, prices, beauty line.
4. **Zoom transition:** pinch in/out from the map, animation, camera restore.
5. **Polish + balance:** grid growth toast, help section in `Help.ts`, phone testing, review the starter set on screen, beauty tuning from your playtest.

Each step should pass `npx vite build` and the AI test games before moving on.

## Decided

- Grid grows with city level: 7x7, 9x9, 11x11 (cap). Never shrinks.
- 1-tile buildings, one per plot.
- 11x11 extra space is decorations only for v1.
- Beauty: +1 happy per 8 beauty, max +2, on Normal+ only. Off on Easy / Free Play.
- Cost: free on Easy / Free Play, a little gold on Normal+.
- Decorations are per city.
- Hard AI decorates with spare gold; Easy / Normal AI don't.

## Still open (answer when you can see it)

1. **Starter set:** add/cut once the decorations are on screen (step 3).
2. **Beauty numbers:** confirm or retune after your playtest.

## v2 (not now)

- Ring-2 plots on the bigger grid (from `CITY_VIEW.md` v2).
- Bigger 2x2 buildings.
- Decoration themes per terrain (snowy, desert).
- Seasonal/animated decorations (smoking chimneys, swaying trees).
- Read-only peek at other kingdoms' cities with their decorations.
- Copy a layout from one city to another (doesn't break "per city": it's a template, not a move).
