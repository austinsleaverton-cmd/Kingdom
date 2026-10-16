// City Builder ground grid (docs/CITY_BUILDER.md). Pure logic, no Phaser imports.
// Tiles are (dx, dy) offsets from the Keep, each from -r to r. Everything is stored relative to the Keep,
// so growing the grid never moves anything.
import { PLOTS_BY_LEVEL, cityLevel } from './tile';
import type { Tile } from './tile';

// Grid side by city level 1..5 (Village 7x7, Town 9x9, City and up 11x11). Odd sizes keep the Keep dead center.
export const GRID_SIZES = [7, 9, 11, 11, 11];

// Plot i sits in world direction i (0 E, 1 NE, 2 NW, 3 W, 4 SW, 5 SE), one tile each
export const PLOT_TILES: readonly (readonly [number, number])[] = [[2, 0], [1, -2], [-1, -2], [-2, 0], [-1, 2], [1, 2]];

// The 1-tile road from the Keep to plot i
export const ROAD_TILES: readonly (readonly [number, number])[] = [[1, 0], [1, -1], [-1, -1], [-1, 0], [-1, 1], [1, 1]];

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

// Keep, plots and their roads: nothing else can go there (decorations come in task 5)
export function reservedTile(dx: number, dy: number): boolean {
  if (dx === 0 && dy === 0) return true;
  if (plotAtTile(dx, dy) !== null) return true;
  return ROAD_TILES.some(([x, y]) => x === dx && y === dy);
}

// The city level (index into LEVEL_NAMES) at which plot i opens
export function plotLevel(i: number): number {
  const k = PLOTS_BY_LEVEL.findIndex((n) => n > i);
  return k < 0 ? PLOTS_BY_LEVEL.length - 1 : k;
}
