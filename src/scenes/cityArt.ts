// Kenney art for the city screen (docs/CITY_BUILDER.md, task 4). Two CC0 tilesheets from public/assets:
// Tiny Town (houses, castle, trees, props) and the Roguelike RPG pack (water, sand, flowers, rocks, extras).
// Tiles are 16px and drawn 1:1 in world px, so one city tile (48px) is 3x3 art tiles. Nearest-neighbor
// filtering keeps the pixels crisp at any zoom. Every lookup can fail (a sheet didn't load, a frame is
// missing): the city screen checks with canDraw() and falls back to the old drawn art when it does.
import Phaser from 'phaser';
import type { Building, PlotTerrain } from '../world/tile';

export const ART = 16; // art tile size in px (and world px)
export const TINY = 'kenney-tiny-town';
export const RPG = 'kenney-rpg';
export type Sheet = 't' | 'r'; // t = Tiny Town, r = Roguelike RPG
export const SHEET_KEY: Record<Sheet, string> = { t: TINY, r: RPG };

// Frame numbers: Tiny Town is 12 tiles wide (frame = row * 12 + col), packed with no gaps.
// The RPG sheet is 57 tiles wide (frame = row * 57 + col) with 1px between tiles.
const TINY_URL = 'assets/kenney_tiny-town/Tilemap/tilemap_packed.png';
const RPG_URL = 'assets/kenney_roguelike-rpg-pack/Spritesheet/roguelikeSheet_transparent.png';

// One art tile in a picture: sheet, frame, and its spot in art tiles from the picture's top-left
export interface Cell {
  s: Sheet;
  f: number;
  x: number;
  y: number;
}

export interface Pic {
  cells: Cell[];
  w: number; // size in art tiles (for centering)
  h: number;
  prop?: Cell; // a small prop standing next to the building (x/y unused)
}

// Rows of frames from one sheet as cells (null = leave empty)
function rows(s: Sheet, r: (number | null)[][]): Cell[] {
  const out: Cell[] = [];
  r.forEach((row, y) => row.forEach((f, x) => {
    if (f !== null) out.push({ s, f, x, y });
  }));
  return out;
}

const c = (s: Sheet, f: number, x = 0, y = 0): Cell => ({ s, f, x, y });

// ---------- loading ----------

// Queue both sheets (called from the city screen's preload). A failed download just leaves the sheet out.
export function loadCityArt(scene: Phaser.Scene): void {
  if (!scene.textures.exists(TINY)) scene.load.spritesheet(TINY, TINY_URL, { frameWidth: ART, frameHeight: ART });
  if (!scene.textures.exists(RPG)) scene.load.spritesheet(RPG, RPG_URL, { frameWidth: ART, frameHeight: ART, spacing: 1 });
}

// Crisp pixels when zoomed (the rest of the game draws smooth vector art, so this is per texture)
export function crispCityArt(scene: Phaser.Scene): void {
  for (const key of [TINY, RPG]) {
    if (scene.textures.exists(key)) scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
  }
}

export function hasFrame(scene: Phaser.Scene, s: Sheet, f: number): boolean {
  const key = SHEET_KEY[s];
  return scene.textures.exists(key) && scene.textures.get(key).has(String(f));
}

// True when every cell of a picture is available
export function canDraw(scene: Phaser.Scene, cells: readonly Cell[]): boolean {
  return cells.every((k) => hasFrame(scene, k.s, k.f));
}

// ---------- ground ----------

// Open grass: plain, tufts, and (rarely) the two little flowers
export const GRASS = { plain: 0, tufts: 1, flowers: 2 };

// Each plot's own ground, 3x3 art tiles (row by row). Grass plots are a dirt building lot, water a pond.
export const PLOT_GROUND: Record<PlotTerrain, Cell[]> = {
  grass: rows('t', [[12, 13, 14], [24, 25, 26], [36, 37, 38]]),
  sand: rows('r', [[8, 8, 8], [8, 8, 8], [8, 8, 8]]),
  hills: rows('r', [[6, 6, 6], [6, 6, 6], [6, 6, 6]]),
  water: rows('r', [[2, 3, 4], [59, 60, 61], [116, 117, 118]]),
};
export const HILL_ROCK = c('r', 614); // pebbles in the corner of a hills plot

// ---------- buildings ----------

// The Keep: castle wall with battlements over the portcullis gate
export const KEEP_ART: Pic = { cells: rows('t', [[96, 98], [111, 112]]), w: 2, h: 2 };

// Roofs: blue 60/62, red 64/66 (67 = red gable). Walls: wood 84 window + 87 door, 85 door, 72/75 plain,
// stone 88 window + 91 door, 90 door.
export const BUILDING_ART: Record<Building, Pic> = {
  barracks: { cells: rows('t', [[60, 62], [88, 91]]), w: 2, h: 2, prop: c('t', 95) }, // archery target
  workshop: { cells: rows('t', [[60, 62], [84, 87]]), w: 2, h: 2, prop: c('t', 128) }, // anvil
  mill: { cells: rows('t', [[64, 66], [84, 87]]), w: 2, h: 2, prop: c('t', 116) }, // pitchfork
  granary: { cells: rows('t', [[64, 66], [72, 75]]), w: 2, h: 2, prop: c('t', 93) }, // hay bale
  market: { cells: rows('t', [[64, 66], [88, 91]]), w: 2, h: 2, prop: c('t', 130) }, // barrel
  harbor: { cells: rows('t', [[60, 62], [85, 87]]), w: 2, h: 2, prop: c('t', 131) }, // water barrel
  temple: { cells: rows('t', [[64, 67, 66], [88, 90, 91]]), w: 3, h: 2 }, // stone hall with a gable
  park: {
    cells: [c('t', 16, 0, 0), c('t', 4, 1.1, -0.15), c('t', 5, -0.15, 0.95), c('r', 542, 0.6, 1.05), c('t', 28, 1.35, 0.95)],
    w: 2,
    h: 2,
  },
  arena: { cells: [...rows('t', [[96, 98], [120, 122]]), c('t', 95, 0.5, 0.45)], w: 2, h: 2 }, // walled yard + target
};

// ---------- scenery (just for looks until decorate mode, task 5) ----------

export const SCENERY = {
  tallTop: 4, // green tree: top over bottom
  tallBottom: 16,
  autumnTop: 3,
  autumnBottom: 15,
  small: 28,
  smallAutumn: 27,
  bush: 5,
  rock: c('r', 614),
  flowers: [541, 542, 543, 544].map((f) => c('r', f)), // blue, red, purple, white
};

// ---------- decoration palette for decorate mode (task 5) ----------
// Not used yet. Fence pieces (connect to neighbors): 44-47, 56-59, 68-71, 80-82 in Tiny Town.
// No fountain in either pack: the fountain keeps a drawn fallback unless you pick a tile.
export const DECOR_ART: Record<string, Cell[]> = {
  tree: [c('t', 4, 0, -1), c('t', 16)],
  bush: [c('t', 5)],
  flowers: [c('r', 542)],
  rock: [c('r', 614)],
  path: [c('t', 43)],
  well: [c('t', 104)],
  lamp: [c('r', 415)],
  bench: [c('r', 303)],
  statue: [c('r', 620, 0, -1), c('r', 677)],
  banner: [c('r', 49, 0, -1), c('r', 106)],
};
