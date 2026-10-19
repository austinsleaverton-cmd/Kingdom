// Kenney art for the city screen and the map (docs/CITY_BUILDER.md, task 4). Two CC0 tilesheets from public/assets:
// Tiny Town (houses, castle, trees, props) and the Roguelike RPG pack (water, sand, flowers, rocks, extras).
// Tiles are 16px and drawn 1:1 in world px, so one city tile (48px) is 3x3 art tiles. Nearest-neighbor
// filtering keeps the pixels crisp at any zoom. Every lookup can fail (a sheet didn't load, a frame is
// missing): callers check with canDraw() and fall back to the old drawn art when it does.
// The look follows Kenney's Tiny Town sample: full houses on the grass, a towered castle, tree clumps.
import Phaser from 'phaser';
import type { DecoId } from '../world/deco';
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

// Sheet layout, for the DOM tray thumbnails (CSS background crops of the same PNGs)
export const SHEET_INFO: Record<Sheet, { url: string; w: number; h: number; cols: number; step: number }> = {
  t: { url: TINY_URL, w: 192, h: 176, cols: 12, step: 16 },
  r: { url: RPG_URL, w: 968, h: 526, cols: 57, step: 17 },
};

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
}

// Rows of frames from one sheet as cells (null = leave empty), shifted by (ox, oy) art tiles
function rows(s: Sheet, r: (number | null)[][], ox = 0, oy = 0): Cell[] {
  const out: Cell[] = [];
  r.forEach((row, y) => row.forEach((f, x) => {
    if (f !== null) out.push({ s, f, x: x + ox, y: y + oy });
  }));
  return out;
}

const c = (s: Sheet, f: number, x = 0, y = 0): Cell => ({ s, f, x, y });

// ---------- loading ----------

// Queue both sheets (called from a scene's preload). A failed download just leaves the sheet out.
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

// An empty plot's ground, 3x3 art tiles (row by row): a dirt building lot, a pond, sand or rocky hills.
// Hills cover entire hexes: repeat Tiny Town's borderless dirt center, not RPG frame 6, whose dark
// edges turn the landscape into a dense grid. CityScene adds scattered rocks separately; selection
// outlines, territory borders and the decorate-mode grid remain independent of the terrain art.
export const PLOT_GROUND: Record<PlotTerrain, Cell[]> = {
  grass: rows('t', [[12, 13, 14], [24, 25, 26], [36, 37, 38]]),
  sand: rows('r', [[8, 8, 8], [8, 8, 8], [8, 8, 8]]),
  hills: rows('t', [[25, 25, 25], [25, 25, 25], [25, 25, 25]]),
  water: rows('r', [[2, 3, 4], [59, 60, 61], [116, 117, 118]]),
};
export const HILL_ROCK = c('r', 614); // pebbles

// Under a finished building the plot is grass, with a hint of what it stands on (in art tiles from the plot's
// top-left; it can spill into the free tiles around the plot)
export const BUILT_GROUND: Record<PlotTerrain, Cell[]> = {
  grass: [],
  sand: [],
  hills: [c('r', 614, -0.9, 2.1), c('r', 614, 3.1, 2.4)],
  water: rows('r', [[2, 3, 3, 4], [116, 117, 117, 118]], -0.5, 2.5), // a pond in front of the Harbor
};
export const WATER_LIFT = 10; // px a Harbor sits higher, so the pond shows in front

// ---------- buildings ----------

// The Keep on the map: castle wall with battlements over the portcullis gate (2x2)
export const KEEP_ART: Pic = { cells: rows('t', [[96, 98], [111, 112]]), w: 2, h: 2 };

// The Keep in the city: two towers with ladder windows, side walls and the gate (6x4, about 2 city tiles wide)
export const CASTLE_ART: Pic = {
  cells: rows('t', [
    [null, 102, null, null, 102, null],
    [96, 126, 103, 103, 126, 98],
    [108, 126, 99, 101, 126, 110],
    [120, 126, 111, 112, 126, 122],
  ]),
  w: 6,
  h: 4,
};

// Each building fills its plot (3x3 art tiles from the plot's top-left), plus props on the right that spill
// into the free ground next to it. Roofs: blue 48-50 / 60-62, red 52-54 / 64-66, gables 63 / 67, chimneys 51 / 55.
// Walls: wood 84 window, 86 door, 87 door; plain wood 72 / 75; stone 88 window, 90 / 91 double door.
export interface BuildingPic {
  cells: Cell[];
  props: Cell[];
}

export const BUILDING_ART: Record<Building, BuildingPic> = {
  barracks: { cells: rows('t', [[48, 49, 50], [60, 61, 62], [88, 90, 91]]), props: [c('t', 95, 3.1, 1), c('t', 95, 3.1, 2)] }, // targets
  workshop: { cells: rows('t', [[48, 51, 50], [60, 63, 62], [84, 86, 87]]), props: [c('t', 115, 3.1, 1), c('t', 128, 3.1, 2)] }, // pick, anvil
  mill: { cells: rows('t', [[52, 53, 54], [64, 65, 66], [84, 86, 87]]), props: [c('t', 93, 3.1, 1), c('t', 116, 3.1, 2)] }, // hay, pitchfork
  granary: { cells: rows('t', [[52, 53, 54], [64, 67, 66], [72, 86, 75]]), props: [c('t', 94, 3.1, 1), c('t', 94, 3.1, 2)] }, // beehives
  market: { cells: rows('t', [[52, 55, 54], [64, 65, 66], [88, 90, 91]]), props: [c('t', 130, 3.1, 1), c('t', 57, 3.1, 2)] }, // barrel, cart
  harbor: { cells: rows('t', [[48, 49, 50], [60, 63, 62], [72, 86, 87]]), props: [c('t', 131, 3.1, 2)] }, // water barrel
  temple: { cells: rows('t', [[52, 53, 54], [64, 67, 66], [88, 90, 91]]), props: [c('r', 544, 3.3, 1.5), c('r', 542, 3.1, 2.2)] }, // flowers
  park: {
    cells: [
      c('t', 4, 0, -0.8), c('t', 16, 0, 0.2), c('t', 4, 1.6, -0.6), c('t', 16, 1.6, 0.4),
      c('t', 28, 0.9, 1.2), c('t', 5, 2.1, 1.6), c('r', 542, 0.3, 1.9), c('r', 544, 1.2, 2),
    ],
    props: [],
  },
  arena: { cells: [...rows('t', [[96, 97, 98], [108, 109, 110], [120, 121, 122]]), c('t', 95, 1, 1)], props: [] }, // walled yard
};

// ---------- scenery (the wild trees and flowers every town starts with) ----------

export const SCENERY = {
  tallTop: 4, // green tree: top over bottom
  tallBottom: 16,
  autumnTop: 3,
  autumnBottom: 15,
  small: 28, // round tree, also packed into the tree clumps along the edge
  smallAutumn: 27,
  bush: 5,
  sprout: 17,
  mushrooms: 29,
  dirt: rows('t', [[12, 14], [36, 38]]), // a small bare patch
  rock: c('r', 614),
  flowers: [541, 542, 543, 544].map((f) => c('r', f)), // blue, red, purple, white
};

// ---------- decorate mode (task 5) ----------
// Each decoration in art tiles from its city tile's top-left (a city tile is 3x3 art tiles; (1, 1) is the middle).
// Paths and fences are worked out from their neighbors (PATH_DIRT, FENCE below); the banner is drawn in the
// owner's color. The fountain is the RPG pack's stone pool with the glass orb in the middle.
// Tall pictures (trees, well, statue, fruit tree) are a top tile over a bottom tile.
// Grass draws nothing: the grass ground is already there, it just keeps the wild scenery off that tile.
export const DECOR_ART: Record<DecoId, Cell[]> = {
  tree: [c('t', 4, 1, 0.1), c('t', 16, 1, 1.1)],
  autumn: [c('t', 3, 1, 0.1), c('t', 15, 1, 1.1)],
  round: [c('t', 28, 1, 1)],
  fruit: [c('r', 593, 1, 0.1), c('r', 650, 1, 1.1)],
  bush: [c('t', 5, 1, 1)],
  flowers: [c('r', 542, 0.4, 0.6), c('r', 543, 1.5, 0.8), c('r', 544, 0.8, 1.5), c('r', 541, 1.7, 1.7)],
  rock: [c('r', 1251, 1, 1)],
  mossy: [c('r', 1308, 1, 1)],
  mushrooms: [c('t', 29, 1, 1)],
  path: [c('t', 25, 1, 1)],
  stones: [c('t', 43, 1, 1)],
  fence: [c('t', 45, 1, 1)],
  well: [c('t', 92, 1, 0.2), c('t', 104, 1, 1.2)],
  torch: [c('r', 416, 1, 1)],
  bench: [c('r', 303, 1, 1.2)],
  statue: [c('r', 620, 1, 0.2), c('r', 677, 1, 1.2)],
  fountain: [...rows('r', [[409, 410, 411], [466, 467, 468], [523, 524, 525]]), c('r', 563, 1, 0.9)],
  banner: [c('r', 49, 1, 0.2), c('r', 106, 1, 1.2)],
  cottage: rows('t', [[48, 50], [60, 62], [84, 87]], 0.5, 0),
  cottageStone: rows('t', [[52, 54], [64, 66], [88, 91]], 0.5, 0),
  sign: [c('t', 83, 1, 1)],
  beehive: [c('t', 94, 1, 1)],
  hay: [c('t', 93, 1, 1)],
  barrel: [c('t', 130, 1, 1)],
  cart: [c('t', 57, 3.1, 2)],
  campfire: [c('r', 470, 1, 1)],
  grass: [],
};

// The fountain's pool lies flat on the ground; only the orb stands up
export const FOUNTAIN_POOL = 9; // first 9 cells of DECOR_ART.fountain

// Tray thumbnails where the in-game picture doesn't read well small
export const DECOR_THUMB: Partial<Record<DecoId, Cell[]>> = {
  path: rows('t', [[12, 14], [36, 38]]),
  stones: [c('t', 43)],
  fence: [c('t', 80), c('t', 82, 1)],
  fountain: rows('r', [[409, 411], [523, 525]]),
  grass: rows('t', [[1, 0], [0, 1]]),
};

// Dirt path, Tiny Town's dirt patch: outer corners, edges, middle, and the four inside corners
// (dirt with a speck of grass in one corner) for where two joined sides meet
export const PATH_DIRT = {
  tl: 12, t: 13, tr: 14,
  l: 24, mid: 25, r: 26,
  bl: 36, b: 37, br: 38,
  inTL: 39, inTR: 40, inBR: 41, inBL: 42,
};
export const PATH_STONES = 43; // stepping stones, tile across the whole city tile

// Fence pieces: posts with rails out to each side. Corners are layered to make T's and crossings.
export const FENCE = {
  post: 47, // on its own
  ew: 45, // rails both ways
  e: 80, // rail to the right only
  w: 82, // rail to the left only
  ns: 56, // up and down
  n: 71, // the bottom end of a line going up
  se: 44, sw: 46, ne: 68, nw: 70, // corners
  rail: 81, // rail with no post (between two fence tiles)
};
