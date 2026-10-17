// Tile data and terrain rules. No Phaser imports in src/world.

export type Terrain = 'water' | 'sand' | 'grass' | 'hills' | 'mountain';
export type PlayerId = number; // 0 is always the human player
export type Improvement = 'farm' | 'mine' | 'pasture' | 'forest' | 'fishery';
export type Building = 'market' | 'temple' | 'granary' | 'park' | 'arena' | 'harbor' | 'barracks' | 'workshop' | 'mill';
// City View: what a plot around the Keep is like (mountains count as hills)
export type PlotTerrain = 'water' | 'sand' | 'grass' | 'hills';

export interface Tile {
  col: number;
  row: number;
  height: number; // 0-5
  terrain: Terrain;
  owner: PlayerId | null;
  city: boolean;
  capital: boolean;
  improvement: Improvement | null;
  road: boolean;
  home: number | null; // owned land: index (row * width + col) of the city tile it belongs to
  // City only (0 elsewhere)
  hp: number;
  walls: number; // wall level 0-3
  shield: number; // current wall HP, absorbs damage before hp
  level: number; // city size 1-5 (0 for non-cities)
  growth: number; // progress toward the next level
  wallTurns: number; // walls under construction: turns until the next level is up (0 = none)
  pop: number; // people living in the city (its level comes from this)
  culture: number; // fills up to grab a free tile for the city's land
  borders: number; // tiles this city has grabbed with culture (each one makes the next slower)
  buildings: Building[]; // amenities already built
  project: Building | null; // amenity under construction
  projectTurns: number; // turns until it's done
  palisade?: number; // palisade HP on this tile (missing or 0 = none). Blocks the owner's enemies
  // City View (city only, empty elsewhere). Plot i faces world direction i (0 E, 1 NE, 2 NW, 3 W, 4 SW, 5 SE).
  plots: PlotTerrain[]; // terrain of each plot, snapshotted when the city is founded
  placed: (Building | null)[]; // the amenity standing on each plot
  projectPlot: number | null; // plot reserved for the amenity under construction
  // City Builder (city only): highest level ever reached, drives the ground grid size (see world/grid.ts)
  gridLevel?: number;
  // City Builder decorations and painted paths: [dx, dy, kind] relative to the Keep, kind = index into
  // DECO_ORDER (see world/deco.ts). They stay with the city, even when it's captured.
  deco?: [number, number, number][];
}

export const MAX_HEIGHT = 5;
export const CITY_HP = 100;
export const CAPITAL_HP = 150;
export const WALL_SHIELD = 40; // shield per wall level
export const MAX_WALLS = 3;
export const WALL_STONE = [10, 20, 30]; // stone for wall level 1, 2, 3
export const WALL_TURNS = [2, 3, 4]; // turns to build wall level 1, 2, 3
export const CITY_REGEN = 10; // hp and shield regained per turn

// City growth: spare food fills a bar, a full bar is a new level
export const MAX_LEVEL = 5;
export const LEVEL_NAMES = ['Village', 'Town', 'City', 'Large City', 'Metropolis'];
export const LEVEL_HP = 10; // extra max hp per level above 1

// Population: a city's level (Village ... Metropolis) comes from how many people live there
export const LEVEL_POP = [1, 3, 5, 8, 12]; // people needed for level 1..5

// City View: 6 plots around the Keep, opened as the city grows (Village ... Metropolis)
export const PLOT_COUNT = 6;
export const PLOTS_BY_LEVEL = [2, 3, 4, 5, 6];

export function levelFromPop(pop: number): number {
  let lvl = 1;
  for (let i = 0; i < LEVEL_POP.length; i++) if (pop >= LEVEL_POP[i]) lvl = i + 1;
  return lvl;
}

// Growth needed for the next person
export function popNeed(pop: number): number {
  return 4 + 2 * pop;
}

export function cityLevel(tile: Tile): number {
  return Math.max(1, tile.level);
}

// Amenities: built in a city over a few turns (one project at a time, shared with training troops)
export interface BuildingInfo {
  name: string;
  icon: string;
  cost: number;
  turns: number;
  happy: number;
  gold: number;
  food: number;
  culture: number;
  minPop: number;
  coastal?: boolean; // only cities next to water can build it
  plot?: 'water' | 'hills' | 'grass'; // needs a plot of this kind (no value = any land plot)
  stone?: number; // stone per turn
  note: string;
}

export const MILL_FARMS = 3; // a Mill adds 1 food for each worked farm of its city, up to this many
export const BARRACKS_SPEED = 1; // troops train this many turns faster in a city with a Barracks

export const BUILDINGS: Record<Building, BuildingInfo> = {
  temple: { name: 'Temple', icon: '\u26EA', cost: 30, turns: 3, happy: 2, gold: 0, food: 0, culture: 1, minPop: 1, note: '+2 happy, +1 culture' },
  market: { name: 'Market', icon: '\u{1F3EA}', cost: 40, turns: 3, happy: 1, gold: 2, food: 0, culture: 0, minPop: 2, note: '+2 gold, +1 happy' },
  granary: { name: 'Granary', icon: '\u{1F33E}', cost: 35, turns: 3, happy: 0, gold: 0, food: 2, culture: 0, minPop: 2, note: '+2 food' },
  park: { name: 'Park', icon: '\u{1F333}', cost: 25, turns: 2, happy: 1, gold: 0, food: 0, culture: 2, minPop: 3, note: '+1 happy, +2 culture' },
  arena: { name: 'Arena', icon: '\u{1F3DF}', cost: 70, turns: 5, happy: 3, gold: 0, food: 0, culture: 1, minPop: 5, note: '+3 happy, +1 culture' },
  harbor: {
    name: 'Harbor', icon: '\u2693', cost: 40, turns: 3, happy: 0, gold: 1, food: 0, culture: 0, minPop: 2, coastal: true, plot: 'water',
    note: 'builds boats, +1 food per fishery, +1 gold (water plot)',
  },
  barracks: {
    name: 'Barracks', icon: '\u2694\uFE0F', cost: 35, turns: 3, happy: 0, gold: 0, food: 0, culture: 0, minPop: 2,
    note: `troops train ${BARRACKS_SPEED} turn faster`,
  },
  workshop: {
    name: 'Workshop', icon: '\u{1F528}', cost: 40, turns: 3, happy: 0, gold: 0, food: 0, culture: 0, minPop: 3, plot: 'hills', stone: 1,
    note: '+1 stone, builds catapults (hills plot)',
  },
  mill: {
    name: 'Mill', icon: '\u2699\uFE0F', cost: 30, turns: 2, happy: 0, gold: 0, food: 0, culture: 0, minPop: 2, plot: 'grass',
    note: `+1 food per worked farm, up to ${MILL_FARMS} (grass plot)`,
  },
};

// New amenities go at the end: saves store built amenities as bits in this order
export const BUILDING_ORDER: Building[] = ['temple', 'market', 'granary', 'park', 'arena', 'harbor', 'barracks', 'workshop', 'mill'];

export function cityMaxHp(tile: Tile): number {
  return (tile.capital ? CAPITAL_HP : CITY_HP) + (cityLevel(tile) - 1) * LEVEL_HP;
}

export function shieldMax(tile: Tile): number {
  return tile.walls * WALL_SHIELD;
}

// Height 0-5: 0 water, 1 sand, 2-3 grass, 4 hills, 5 mountain
export function terrainFromHeight(height: number): Terrain {
  if (height <= 0) return 'water';
  if (height === 1) return 'sand';
  if (height <= 3) return 'grass';
  if (height === 4) return 'hills';
  return 'mountain';
}

export function isLand(tile: Tile): boolean {
  return tile.terrain !== 'water';
}

// Farms need flat land, pastures (horses) and forests (bows) need grass, mines need high ground,
// fisheries go on water.
export function improvementFits(tile: Tile, imp: Improvement): boolean {
  if (tile.city) return false;
  if (imp === 'fishery') return tile.terrain === 'water';
  if (imp === 'farm') return tile.terrain === 'grass' || tile.terrain === 'sand';
  if (imp === 'pasture' || imp === 'forest') return tile.terrain === 'grass';
  return tile.terrain === 'hills' || tile.terrain === 'mountain';
}

export const IMPROVEMENT_NAME: Record<Improvement, string> = { farm: 'farm', mine: 'mine', pasture: 'pasture', forest: 'forest', fishery: 'fishery' };

// Drop anything that no longer fits after the terrain changed.
export function fixAfterTerrainChange(tile: Tile): void {
  if (tile.improvement && !improvementFits(tile, tile.improvement)) tile.improvement = null;
  if (tile.terrain === 'water') {
    // Water can be owned, so the land keeps its owner when it floods
    tile.road = false;
    tile.palisade = 0;
    tile.city = false;
    tile.capital = false;
    tile.hp = 0;
    tile.walls = 0;
    tile.shield = 0;
    tile.level = 0;
    tile.growth = 0;
    tile.wallTurns = 0;
    tile.pop = 0;
    tile.culture = 0;
    tile.borders = 0;
    tile.buildings = [];
    tile.project = null;
    tile.projectTurns = 0;
    tile.plots = [];
    tile.placed = [];
    tile.projectPlot = null;
    tile.gridLevel = 0;
    tile.deco = [];
  }
}

// Gold per turn for owning a tile
export const YIELD: Record<Terrain, number> = {
  water: 0,
  sand: 1,
  grass: 1,
  hills: 2,
  mountain: 0,
};

// Gold to claim an unowned tile (water is cheap: no gold, but builders can put fisheries on it)
export const CLAIM_COST: Record<Terrain, number> = {
  water: 2,
  sand: 3,
  grass: 4,
  hills: 6,
  mountain: 9,
};

export function makeTile(col: number, row: number, height: number): Tile {
  return {
    col,
    row,
    height,
    terrain: terrainFromHeight(height),
    owner: null,
    city: false,
    capital: false,
    improvement: null,
    road: false,
    home: null,
    hp: 0,
    walls: 0,
    shield: 0,
    level: 0,
    growth: 0,
    wallTurns: 0,
    pop: 0,
    culture: 0,
    borders: 0,
    buildings: [],
    project: null,
    projectTurns: 0,
    plots: [],
    placed: [],
    projectPlot: null,
    gridLevel: 0,
    deco: [],
  };
}
