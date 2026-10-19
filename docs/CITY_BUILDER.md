# City Builder: Territory Layout (v2)

Run the kingdom on the map, then zoom into a city and build on the territory that city actually owns. This replaces the fixed 7x7/9x9/11x11 ground grid and the six directional plots described in v1 and `docs/CITY_VIEW.md`. Those older plot and facing rules are historical, not the current implementation.

**Status:** territory rework implemented for dev review. Headless territory regressions, save migration, capture and AI soak games pass. Full Phaser/Vite build and desktop/phone playtests still need to be verified in an environment with the project's dependencies installed. Leave the implementation task open until Austin reviews it.

## Source of truth: the city's owned hexes

- `GameState.cityLand(city)` supplies the territory: map hexes whose `home` points to this city and whose owner matches it. The Keep's hex is included.
- City View shows those hexes in the same relative directions and shape as the world map. The terrain comes from the world map, not a generated town template. Mountains count as hills for amenity placement and detailed ground.
- Claims and culture growth add an entire patch of ground. Population growth unlocks amenity capacity, not a larger square grid.
- Other cities remain separate, even when they belong to the same kingdom. A dimmed ring outside the border shows neighboring territory, open land and sea. Unexplored neighboring hexes stay dark.
- The city's outline uses its owner's color. Faint interior dividers identify the world hexes; selecting one outlines the whole patch.

## Ground coordinates

`src/world/grid.ts` is pure layout logic, with no Phaser imports.

- Each map hex becomes a patch of **56 small ground cells**. Hex centers are spaced 8 cells horizontally and 7 cells vertically, with a half-width offset between rows (`HEX_W = 8`, `HEX_H = 7`). The patches are nearest-center regions, not rectangular 8x7 boxes.
- The world map uses odd-r hex coordinates. Convert to axial coordinates, subtract the city's axial coordinate, then place hex `(q, r)` at ground-cell center `(8*q + 4*r, 7*r)`.
- Ground cells are integer `(x, y)` offsets from the Keep. Every cell belongs to the nearest hex center, with deterministic tie-breaking. Patches tile without overlaps or gaps.
- The rendering scale stays one ground cell = 3x3 Kenney art tiles (48 world pixels). Saved decoration offsets retain their meaning.
- `cityLayout` builds the owned hexes, cell lookup maps, an outside ring and bounds. Layouts are cached per game and cleared by `GameState.invalidate()` when land, cities or terrain change.

## Amenities on owned hexes

One amenity per non-Keep hex. The amenity stands in the center ground cell; the cell immediately to its right is its props yard. Its world hex is stored as a map tile index, not a plot number.

| Amenity | Required hex |
| --- | --- |
| Harbor | Water |
| Workshop | Hills (mountains count as hills) |
| Mill | Grass |
| Temple, Market, Granary, Park, Arena, Barracks | Any land |

The city's normal population, cost and one-project-at-a-time requirements still apply. Starting construction reserves the hex. The hex is selected **before** setting the project, so the project does not consume the final capacity slot before auto-placement runs.

A farm, mine, pasture, forest, fishery or road on the same hex is not removed by an amenity. Existing improvement and worker production rules continue independently. The city screen shows an improvement/road badge on the patch.

### Capacity is deliberately unchanged

| City size | Amenities |
| --- | --- |
| Village | 2 |
| Town | 3 |
| City | 4 |
| Large City | 5 |
| Metropolis | 6 |

`AMENITY_SLOTS` and `MAX_AMENITIES` live in `tile.ts`. The Easy rules checkbox (`isSimple`) unlocks all six for human players. Difficulty Easy by itself is not the Easy rules checkbox. More territory gives more candidate locations, not unlimited amenities.

### Manual and automatic placement

- Open city, select a hex, then choose an amenity. The panel explains its terrain, nearby improvements, cost and placement bonuses. A star marks the best site.
- The map city panel's build buttons auto-place on the best available hex and explain where the amenity is going.
- `bestSite` scores the amenity's own bonus, bonuses it adds to neighbors, a small penalty for using specialized terrain, and distance from the Keep. Ties prefer nearer hexes.
- No terrain that can support an amenity means no candidate for that amenity. A city needs owned water to place a new Harbor, not merely unowned water beside the Keep.

## Placement bonuses

`src/world/city.ts` owns terrain, work and adjacency rules. The economy and HUD both call `cityBonus(state, city)`.

### Terrain

A Granary on grass gets +1 food.

### Real hex neighbors

Neighbor means the map hexes touch, not adjacent cells within one detailed patch.

| Amenity | Neighbor | Bonus |
| --- | --- | --- |
| Market | Harbor | +1 gold |
| Mill | Granary | +1 food |
| Park | Temple | +1 culture |
| Arena | Market | +1 gold |

### Work bonuses replace directional facing bonuses

An improvement or road on the amenity's hex **or any touching hex**, owned by the city owner, qualifies. It can belong to another of that owner's cities. Each rule counts once, regardless of the number of matching improvements. Existing rules check the improvement's presence, not whether a worker is assigned to it.

| Amenity | Improvement or road | Bonus |
| --- | --- | --- |
| Workshop | Mine | +1 stone |
| Mill | Farm | +1 food |
| Barracks | Pasture | +1 horse capacity |
| Harbor | Fishery | +1 food |
| Park | Forest | +1 culture |
| Market | Road | +1 gold |

Bonuses are live: pillaging/removing the improvement removes that bonus. Selecting an amenity draws dotted links to contributing neighboring hexes.

## Coasts and boats

Owned water is drawn as actual sea/lake patches in the same places as the map. Shore tiles appear along land edges; water continues into the outside ring where appropriate. Sand and rocky ground also follow each world hex.

`isCoastal` includes water next to the Keep or anywhere in the city's territory. A city whose only water is farther out launches boats at its Harbor water hex (or a free neighboring water hex). Ordinary coastal launch behavior remains unchanged. Water ownership still does not count toward the land-share win.

## Decorating the whole territory

Decorations and painted ground remain per city. Every owned land cell is eligible, except reserved building footprints.

- Keep footprint: `KEEP_TILES` stays clear.
- Every non-Keep hex's central amenity cell and right-hand yard stay clear of objects. Paths/grass are allowed there while the center is empty; an occupied amenity center stays clear of painted ground too.
- No decorations or paths on water or outside the city's territory.
- Two layers per cell: painted ground (dirt path, stone path or grass) plus one object. A bench can stand over a path; removing it leaves the path.
- Dirt paths auto-join neighboring paths and built footprints. Fences join neighboring fences. Joins are computed, never saved.
- Paths and grass are always free, with zero beauty. Objects are free on Easy difficulty and Free Play. Normal small objects cost 2g, Statues 6g, Fountains 10g; Hard prices are 3g, 8g and 12g.
- Place by tapping, move objects by dragging, paint paths/grass or erase by dragging. Two fingers pan/zoom; right-drag pans on desktop.
- Removing does not refund gold. Undo restores the previous placement and exactly the amount spent on that action. Clear all asks for a second tap and clears placed items only.
- Decorations replace seeded wild scenery on their cells. Forest improvements produce denser wild woods; farm patches stay mostly open; sand is sparse.
- AI never decorates. Captured decorations remain with the city.

The existing `DECO_ORDER` palette and `cityArt.ts` art tables are retained. Append new kinds only; never reorder saved kinds.

### Beauty

Normal and Hard only, unless Free Play is enabled for the player: most objects give 1 beauty, a Statue 2, a Fountain 3. Every 8 beauty gives +1 happiness, capped at +2. Paths and grass give none. Only placed objects count; stored items do not. The tray meter and `Beautiful streets` happiness line remain.

## Land changes: preserve the town

`settleCity` reconciles sites and decorations on load, when opening a city and at the start of the owner's turn. Founding on existing owned land reconciles the previous home city immediately.

### Amenities

- Valid existing sites stay where they are, including after terrain changes; terrain requirements apply to new placement.
- If an amenity loses its hex, use the best free compatible hex, then any free non-Keep hex as a grandfathered fallback.
- If there is no free hex, store site `-1`: the amenity waits and keeps its base effects, but has no placement bonus. It moves in when room becomes available.
- Construction also reserves/reacquires a valid hex. Finished amenities are never silently deleted for lack of territory.
- Settlers cannot found a city on a finished or reserved amenity hex.
- Capture transfers the territory, finished sites and decorations together. Existing rules still cancel a half-built amenity, half-built walls and lost-city training.

### Decorations and storage

- Keep valid cells unchanged.
- Move displaced objects to the nearest eligible unoccupied cell, with deterministic tie-breaking.
- If no cell is available, preserve their kinds in `decoStash`. Stored objects restore automatically when room is found during reconciliation.
- Do not scatter displaced paths around the town: their location is their design. Store their kinds instead. The tray reports them and offers a separate explicit Discard stored paths button. Stored paths do not auto-restore.
- Unknown decoration kinds are ignored as invalid data; known items are not silently dropped because the layout changed.

## Saved layout v2 and old saves

The browser save remains `version: 3` under the existing channel-specific key (`kingdom-save-v3-dev` for dev, `kingdom-save-v3` otherwise). `layout: 2` distinguishes the territory layout from legacy plots.

City state:

```ts
sites: Partial<Record<Building, number>>; // map tile index, or -1 waiting
projectSite: number | null;              // reserved hex, null when none
// [x, y, DECO_ORDER index], relative to the Keep
deco?: [number, number, number][];
decoStash?: number[];                    // preserved kinds waiting for room
```

Save payload maps are keyed by the city tile's index:

- `sites`: flat `[BUILDING_ORDER index, map tile index, ...]`.
- `projectSites`: reserved map tile index.
- `deco`: flat `[x, y, kind, ...]`.
- `decoStash`: stored kinds.

### Legacy migration

All map terrain, owners, homes, city building bits and projects load first. Homes are repaired before city layouts are built. For saves without `layout: 2`, old plot `i` moves its amenity to the owned neighboring map hex in direction `i` (E, NE, NW, W, SW, SE). If that hex is unavailable, normal site reconciliation finds a fallback or preserves it waiting. The same applies to construction reservations.

Decorations keep their Keep-relative cell coordinates where legal, then reconcile onto owned ground or into storage. The old square-grid level no longer drives geometry. The next save writes layout 2; old `plots` is read only for migration.

Map dimensions remain explicitly saved and restored using the existing map-size compatibility rules. This work does not regenerate an old map or change its dimensions.

## Scene and camera integration

- `CityScene.ts`: Phaser draws actual hex patches, terrain, coast, outside territory, buildings, people, decoration layers, selection and bonus links. Bounds and camera fit come from the current territory, not city level.
- `CityView.ts`: DOM header, site selection/building panel, tray, beauty meter, stored-item explanation and controls.
- `MapScene.ts`: map city panel, best-site previews, auto-placement announcements, hover amenity names and entry/return transitions.
- `Hud.ts`: city gold breakdown uses the state-aware bonus calculation.
- `Help.ts`: guide describes owned-hex placement, real neighbors, decorating the full territory and migration behavior.

Entry remains double-tap, O, Open city, or zoom beyond the map limit over your own city. The map sleeps while the city is open. Return by Back, Esc/O or zoom beyond the city's minimum. Reduced motion skips the animations. The map returns centered on that city and eases to the recorded prior zoom (capped by `BACK_ZOOM`), not an unrelated square-grid position.

Existing Kenney Tiny Town/Roguelike RPG sheets and pixel actors remain. Missing art still uses drawn/emoji fallbacks. No new art dependency.

## Verification

Run with dependencies installed:

```sh
npm run build
node scripts/test-city-territory.mjs
node scripts/test-map-sizes.mjs
```

The territory test checks patch tiling, city ownership/layout, terrain requirements, preserved improvements, capacity, auto-placement, work bonuses, two-layer decorations, claimed-ground growth, founding protection/reconciliation, capture, save round-trip and old plot migration. It also runs eight games of up to 80 rounds with three AI opponents across Easy/Normal/Hard, checks site/decoration invariants and reloads each game.

Headless tests do not prove rendering, touch behavior or frame rate. Playtest desktop and phone: open/close repeatedly, pan/pinch and wheel entry, decorate at borders and coasts, grow/claim territory, place each terrain-specific amenity, capture a decorated city and load an existing save. Watch large-territory rendering costs: a patch is 56 cells, each potentially nine art tiles, so performance assumptions from the old 121-cell maximum no longer apply.

## Not included

No additional amenity capacity, 2x2 buildings, rotation/flip, cross-city decoration transfer, rival-city inspection or AI decorating. Those are separate scope, not prerequisites for territory-based cities.
