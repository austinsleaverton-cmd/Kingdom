// City Builder ground grid (docs/CITY_BUILDER.md). Pure logic, no Phaser imports.
// Tiles are (dx, dy) offsets from the Keep, each from -r to r. Everything is stored relative to the Keep,
// so growing the grid never moves anything.
import { PLOTS_BY_LEVEL, cityLevel } from './tile';
import type { Tile } from './tile';

// Grid side by city level 1..5 (Village 7x7, Town 9x9, City and up 11x11). Odd sizes keep the Keep dead center.
export const GRID_SIZES = [7, 9, 11, 11, 11];

// Plot i sits in world direction i (0 E, 1 NE, 2 NW, 3 W, 4 SW, 5 SE), one tile each
export const PLOT_TILES: readonly (readonly [number, number])[] = [[2, 0], [1, -2], [-1, -2], [-2, 0], [-1, 2], [1, 2]];

// Highest level the city has ever reached: the grid follows this, so it never shrinks when a city loses a level
export function gridLevel(city: Tile): number {
  return Math.max(city.gridLevel ?? 0, cityLevel(city));
}

// Remember the current level if it's a new high (called on every save)
export function syncGrid(city: Tile): void {
  if (city.city) city.gridLevel = gridLevel(city);
}

export function gridSize(city: Tile): number {
  return GRID_SIZES[Math.min(GRID_SIZES.length, gridLevel(city)) - 1];
}

export function gridRadius(city: Tile): number {
  return (gridSize(city) - 1) / 2;
}

// Which plot stands on tile (dx, dy), if any
export function plotAtTile(dx: number, dy: number): number | null {
  const i = PLOT_TILES.findIndex(([x, y]) => x === dx && y === dy);
  return i < 0 ? null : i;
}

// The Keep and the plots: nothing else can go there. Every other tile is open ground for decorations and
// the paths you paint yourself (task 5). There are no built-in roads.
export function reservedTile(dx: number, dy: number): boolean {
  if (dx === 0 && dy === 0) return true;
  return plotAtTile(dx, dy) !== null;
}

// The city level (index into LEVEL_NAMES) at which plot i opens
export function plotLevel(i: number): number {
  const k = PLOTS_BY_LEVEL.findIndex((n) => n > i);
  return k < 0 ? PLOTS_BY_LEVEL.length - 1 : k;
}

// ---------- coast ----------
// Coastal cities: the plots that face water on the map are part of the sea, and the water runs out from them
// to the edge of the town. Every other ground tile belongs to the plot direction it's closest to (with a little
// wobble so the shore isn't a ruler line), and is water when that plot faces water. The Keep, the ring of
// tiles right around it and the land plots always stay dry. Tiles are keyed "dx,dy".

const PLOT_ANGLE = PLOT_TILES.map(([x, y]) => Math.atan2(y, x));
const WOBBLE = 0.35; // radians the shore can lean either way (about 10 degrees)

export function tileKey(dx: number, dy: number): string {
  return `${dx},${dy}`;
}

export function waterTiles(city: Tile): Set<string> {
  const out = new Set<string>();
  const wet = PLOT_TILES.map((_, i) => city.plots?.[i] === 'water');
  if (!wet.some(Boolean)) return out;
  const r = gridRadius(city);
  const seed = city.col * 92821 + city.row * 68917;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const plot = plotAtTile(dx, dy);
      if (plot !== null) {
        if (wet[plot]) out.add(tileKey(dx, dy));
        continue;
      }
      if ((Math.abs(dx) <= 1 && Math.abs(dy) <= 1) || Math.hypot(dx, dy) < 2) continue; // dry ground around the Keep
      const a = Math.atan2(dy, dx) + (wobble(dx, dy, seed) - 0.5) * 2 * WOBBLE;
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < PLOT_ANGLE.length; i++) {
        const d = Math.abs(Math.atan2(Math.sin(a - PLOT_ANGLE[i]), Math.cos(a - PLOT_ANGLE[i])));
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (wet[best]) out.add(tileKey(dx, dy));
    }
  }
  return out;
}

// Same 0..1 number for the same tile of the same city every time
function wobble(dx: number, dy: number, seed: number): number {
  let h = Math.imul(dx + 101, 73856093) ^ Math.imul(dy + 211, 19349663) ^ Math.imul(41, 83492791) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
