# City Builder: Spec (v1)

Run the kingdom on the map, then zoom into a city and build it out like a real town. Extends `docs/CITY_VIEW.md`: the rules there (6 plots, terrain, neighbors, facing, auto-place, scoring) stay exactly as they are. This adds a ground grid around them, free-placed decorations, real art and a zoom transition.

**Status:** spec approved. Tasks 3 (city screen), 4 (Kenney art) and 5 (decorate mode) are on dev.

## Goals

- The city looks like a town, not a diagram.
- Buildings stay snapped to plots, so placement, neighbor and facing bonuses keep working with zero rule changes.
- Decorations and paths are the creative part: put them anywhere open.
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

- **Reserved:** the Keep tile, the 6 plot tiles, and the 5 tiles the castle art covers ((-1..1, -1) and (±1, 0), `KEEP_TILES` in `src/world/deco.ts`). Nothing goes there; paths join up to them.
- **Yards (paths only):** the tile right of each plot (where its props stand) and the tile below a water plot.
- **No built-in roads.** A new city is the Keep and its plots on grass. Streets are paths the player paints (see Decorations).
- Plot neighbors stay index-based (`plotNeighbors(i)`: ring neighbors + Keep). The grid is visual; `src/world/city.ts` scoring does not change.
- Plot terrain shows as the plot tile's ground (water plot = part of the sea, hills = dirt/rock, sand, grass).
- **Facing hexes:** the map hex each plot faces is drawn as a small marker on the grid edge in that direction. Faint by default, green with a dotted line when it's paying a bonus, outlined when its plot is selected.
- Locked plots: faint outline, small lock icon and the level name.

### Coast

- Coastal towns: every plot that faces water on the map is open sea, and the water runs out from it to the edge of the town (`waterTiles` in `src/world/grid.ts`). Each ground tile belongs to the plot direction it's closest to (with a little wobble so the shore isn't a ruler line).
- The Keep, the ring of tiles right around it and the land plots always stay dry. A grass shore is drawn wherever water meets land; the Harbor stands in the water.
- No wild scenery grows on the water, and decorations and paths can't be placed, moved or painted onto it. Anything an old save already had on the water stays (erase it or drag it onto land).

## Decorations

### Placing

- **Decorate** button in the city header opens the tray in the side panel (bottom sheet on phones, rows scroll sideways). Tap one, then tap an open ground tile to place it. The tray item stays selected so you can place several in a row; tap it again or Esc to stop.
- **Drag** a placed decoration to move it. Drop on a blocked tile = it snaps back (red outline while it's over one).
- **Remove:** tap a placed decoration, then Remove, or use the Eraser (tap or drag). Removing never refunds gold (keeps it from being a gold bank).
- **Undo** (button or Ctrl/Cmd+Z) undoes the last action of this visit and gives back exactly what that action cost. **Clear all** asks for a second tap.
- One decoration per tile. Moving is always free.
- Instant: decorations don't use the city's project slot and don't take turns.
- Only in your own cities, on your turn (hot-seat safe: acts as `state.current`).
- The wild trees and flowers every town starts with stay on any tile you haven't used; placing or painting on a tile replaces them there.

### Paths (painted roads)

- Pick **Dirt path** or **Stone path** in the tray and **drag** across tiles to paint a line of path (a tap paints one tile). Start a drag (or tap) on the same kind of path to clear instead; the Eraser clears too.
- Paths only go on open ground (yards included), never on the Keep, a plot, the water or another decoration. Painting one kind over the other swaps it.
- **Auto-join:** each dirt path tile connects to the path tiles next to it, and to the castle and any plot it touches, so straights, corners, T's and crossroads draw themselves. Fences join the same way (to other fences).
- **Free on every difficulty** and **no beauty**: paths are for looks only, so a big road network never costs or earns anything.
- In decorate mode a faint tile grid shows (stronger while a path or the Eraser is picked).

### Palette (v1, task 5)

`DECO_ORDER` in `src/world/deco.ts`, art in `DECOR_ART` (`src/scenes/cityArt.ts`). Add/cut freely; new ones go on the end.

| Group | Decorations |
| --- | --- |
| Paths | Dirt path, Stone path |
| Nature | Tall tree, Autumn tree, Round tree, Fruit tree, Bush, Flower bed, Rock, Mossy rock, Mushrooms |
| Buildings and props | Fence, Well, Torch, Bench, Statue (Town+), Fountain (City+), Banner (player color), Cottage, Stone cottage, Signpost, Beehive, Hay bale, Barrel, Cart, Campfire |

### Cost (by difficulty)

| Mode | Cost |
| --- | --- |
| Easy | free |
| Free Play (`isFree`) | free |
| Normal | 2g each (Statue 6g, Fountain 10g) |
| Hard | 3g each (Statue 8g, Fountain 12g) |

Paths are free in every mode. Tray shows the price on each item. Not enough gold = item dimmed with the reason.

### Beauty (happiness)

- **Normal and up only.** On Easy and Free Play decorations are just for looks: no bonus, and the beauty line is hidden.
- `beauty = number of decorations in the city` (Statue counts 2, Fountain 3). **Paths and grass count 0.** (Per-decoration values are `beauty` in `DECOS`.)
- Bonus: **+1 happy per 8 beauty, max +2.** Shows in `happinessParts` as `Beautiful streets`.
- Decorate mode shows a beauty meter (e.g. `Beauty 11/16 · +1 happy, 5 more for +2`) and each item's beauty next to its price in the tray. Hidden on Easy and Free Play.
- Why 8, not 6 (paper check): a Temple gives +2 happy but costs 30-40g, takes turns and uses the project slot. At 1 per 6, +2 happy cost 24g on Normal, instant, no slot: too cheap next to a Temple. At 1 per 8 it's 32g on Normal / 48g on Hard (small decos), about Temple price with no slot, which feels like a fair trade for the clicking.
- Small on purpose: nice to have, never the reason you win.
- One function in `src/world/city.ts`: `beautyBonus(city, difficulty, free): number`. Retune after real playtests.

### Scope

- **Per city.** Decorations and paths belong to the city they're in and can't move between cities.
- Captured city: decorations and paths stay with the city (the new owner gets them and their beauty).

### AI

- **No AI decorates**, on any difficulty (cut 10/16). You never see inside AI cities, Hard AI already spends its spare gold on land (a win condition), and +2 happy max isn't worth the risk of slowing Hard down.
- AI cities still get the beauty bonus from decorations they capture.

## Saved data

On the city tile (`Tile`, city only):

```ts
gridLevel: number;            // highest city level ever reached (1-5), drives grid size
deco: [number, number, number][]; // [dx, dy, kind] relative to the Keep, kind = index into DECO_ORDER (paths included)
```

- `DECO_ORDER` in `src/world/deco.ts`: new decorations only ever go on the end, so old saves keep their meaning (same rule as `BUILDING_ORDER`).
- Path and fence joins aren't saved: they're worked out from the neighbors when drawing.
- Save: optional `deco` field next to `plots` in `save.ts` (city tile index -> flat `[dx, dy, kind, ...]`). Same key, `kingdom-save-v3`.
- **Old saves:** `gridLevel = cityLevel(city)`, `deco = []`. Nothing else to migrate: plots and buildings are untouched.
- On load, any decoration on a reserved, yard (non-path) or out-of-grid tile, with an unknown kind, or a second one on a tile, is dropped (`cleanDeco`, safety net, shouldn't happen). Decorations on the water are kept.

## Art (Kenney packs, already in `public/assets/`)

Main pack: **Tiny Town** (16px, top-down, matches the town look). Fill gaps from **Roguelike RPG** (16px, 1px spacing on its sheet).

| Thing | Pack | What to use |
| --- | --- | --- |
| Open ground | Tiny Town | grass (+ 1-2 grass variants scattered by a seeded hash so it doesn't look tiled) |
| Dirt path | Tiny Town | the dirt patch pieces (12-14, 24-26, 36-38) plus the inside corners (39-42), picked per neighbor |
| Stone path | Tiny Town | stepping stones (43) |
| Water plot / sea | RPG | pond tiles as a 9-slice (2-4, 59-61, 116-118): open water with a grass shore |
| Hills plot | RPG | dirt/rock ground |
| Sand plot | RPG | sand ground |
| Keep | Tiny Town | castle/stone wall pieces, wall level shown with extra wall segments |
| Temple, Market, Granary, Mill, Barracks, Workshop | Tiny Town | house/roof pieces, each a different roof color + a sign icon |
| Harbor | Tiny Town / RPG | house standing in the water plot |
| Park | Tiny Town | trees + flowers on grass |
| Arena | RPG | fenced sand ring |
| Trees, bushes, fences, well, cottages, props | Tiny Town | direct tiles (fence pieces 44-47, 56, 68, 70, 71, 80-82) |
| Rocks, flowers, fruit tree, torch, bench, statue, fountain pool, campfire | RPG | direct tiles |
| Banner | drawn | pole and flag in the owner's color |
| Construction | Tiny Town | scaffold/fence + existing pixel builders from `citySprites.ts` |

- Exact tile indices live in `src/scenes/cityArt.ts` (`BUILDING_ART`, `DECOR_ART`, `PATH_DIRT`, `FENCE`) and the sea 9-slice in `src/scenes/CityScene.ts` (`SEA`). Swapping art = editing those tables.
- Pixel people from `citySprites.ts` stay (they already match the 8-bit look).
- Licenses are CC0, nothing to credit, but keep the `License.txt` files.

## Zoom transition

- **In:** pinch / scroll zoom on the map past the max map zoom while centered on your own city, or the existing **Open city** button / double-tap / O key. Short (~350ms) zoom + fade: the map camera zooms toward the city hex, then the city fades in at the same screen spot and settles.
- **Out:** pinch out past the city's min zoom, the Back button, or Esc. Reverse animation, map returns exactly where you were (camera position and zoom saved before going in).
- Enemy / unexplored cities: zooming in just stops at max map zoom, like now.
- Inside the city: pan and pinch zoom within the grid bounds (clamped so you can't lose the town).
- `prefers-reduced-motion`: skip the animation, plain cut.

### Scene setup

- Phaser scene `src/scenes/CityScene.ts` draws the grid, buildings, decorations and people (Phaser handles sprite sheets, drag and pinch far better than the old SVG).
- `MapScene` sleeps while the city is open, wakes on the way out (same plan `CITY_VIEW.md` already had).
- The **side panel stays DOM** (`CityView.ts`): the build list, plot info and bonuses, and the decorate tray.
- World logic stays in `src/world`: `placeDeco`, `moveDeco`, `removeDeco`, `paintPath`, `clearDeco`, `restoreDeco` in `src/world/deco.ts`, all validated there (functions taking the `GameState`, so `game.ts` doesn't grow).

## Phones

- Max 11x11 = 121 ground tiles + up to ~100 decorations + 7 buildings: tiny for Phaser.
- Ground drawn once into a static layer (Phaser `TilemapLayer` or a cached render texture); only redrawn when the grid grows or a path changes.
- Decorations and buildings are plain sprites from one texture atlas per pack (2 textures total).
- Pixel art: `pixelArt: true` / nearest-neighbor scaling, integer zoom steps for crisp tiles.
- Tap targets at least 40px: default zoom fits the grid to the screen width, so a 7x7 tile is big and an 11x11 tile is still ~32px with zoom-in available.
- Drag starts after 8px of movement so panning and dragging don't fight. With a path or the Eraser picked, a one-finger drag paints instead of panning; two fingers still pan and zoom (right-drag pans on desktop).
- MapScene sleeps (not just hidden) so it isn't rendering underneath.
- Saves only on change (place/move/remove, end of a paint stroke), not every frame.

## Build order (matches the ClickUp City Builder list)

3. **City screen** (task 3): new `CityScene` with the ground grid, `gridLevel` (grows 7/9/11, never shrinks, old-save migration), Keep, 6 one-tile plots with buildings, facing markers, pan/pinch zoom. No built-in roads. Side panel and pixel people kept. Opens/closes the same ways (double-tap, O, Open city, Esc). Uses the current drawn art. Replaces the SVG drawing.
4. **Kenney art** (task 4): load the sheets, art tables for buildings, plot terrain and scenery, nearest-neighbor scaling, fallback if a sprite is missing, preview image.
5. **Decorate mode** (task 5): `deco`, `DECO_ORDER`, `placeDeco` / `moveDeco` / `removeDeco` / `paintPath`, path painting by dragging with auto-join, costs by difficulty (paths free), save + old-save migration, tray UI (tap to place, drag to move, remove), undo, clear all. Cosmetic only at this point.
6. **Zoom transition** (task 6): pinch/scroll in and out between map and city, animation, camera restore, reduced motion.
7. **Beauty bonus** (task 7): `beautyBonus` (1 per 8, max +2, Normal+, paths count 0), `Beautiful streets` line, beauty meter and per-item beauty in the tray, help section in `Help.ts`, grid-growth toast, tune from your playtest. No AI decorating.

Each step should pass `npx vite build` and the AI test games before moving on.

## Decided

- Grid grows with city level: 7x7, 9x9, 11x11 (cap). Never shrinks.
- 1-tile buildings, one per plot.
- 11x11 extra space is decorations only for v1.
- No built-in roads: players paint paths by dragging. Paths auto-join, are free everywhere and add no beauty.
- Beauty: +1 happy per 8 beauty, max +2, on Normal+ only. Off on Easy / Free Play.
- Cost: free on Easy / Free Play, a little gold on Normal+.
- Decorations are per city.
- Coastal towns show the sea on their water side; nothing can be placed on it.
- No AI decorates (cut 10/16).

## Still open (answer when you can see it)

1. **Palette:** add/cut once the decorations are on screen (task 5).
2. **Beauty numbers:** confirm or retune after your playtest (task 7).

## v2 (not now)

- Ring-2 plots on the bigger grid (from `CITY_VIEW.md` v2).
- Bigger 2x2 buildings.
- Rotate / flip decorations.
- Decoration themes per terrain (snowy, desert).
- Seasonal/animated decorations (smoking chimneys, swaying trees).
- Read-only peek at other kingdoms' cities with their decorations.
- Copy a layout from one city to another (doesn't break "per city": it's a template, not a move).
- Paths that do something (like a road bonus), only if the game ever needs it.
- Hard AI decorating, only if peeking at rival cities ever ships and they look bare.
