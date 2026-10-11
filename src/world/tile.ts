// Tile data and terrain rules. No Phaser imports in src/world.

export type Terrain = 'water' | 'sand' | 'grass' | 'hills' | 'mountain';
export type PlayerId = number; // 0 is always the human player
export type Improvement = 'farm' | 'mine' | 'pasture' | 'forest';

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
}

export const MAX_HEIGHT = 5;
export const CITY_HP = 100;
export const CAPITAL_HP = 150;
export const WALL_SHIELD = 40; // shield per wall level
export const MAX_WALLS = 3;
export const WALL_STONE = [10, 20, 30]; // stone for wall level 1, 2, 3
export const CITY_REGEN = 10; // hp and shield regained per turn

// City growth: spare food fills a bar, a full bar is a new level
export const MAX_LEVEL = 5;
export const GROWTH_NEED = [10, 25, 45, 70]; // growth needed to go from level 1->2, 2->3, 3->4, 4->5
export const LEVEL_NAMES = ['Village', 'Town', 'City', 'Large City', 'Metropolis'];
export const LEVEL_HP = 10; // extra max hp per level above 1

export function cityLevel(tile: Tile): number {
  return Math.max(1, tile.level);
}

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

// Farms need flat land, pastures (horses) and forests (bows) need grass, mines need high ground.
export function improvementFits(tile: Tile, imp: Improvement): boolean {
  if (tile.city) return false;
  if (imp === 'farm') return tile.terrain === 'grass' || tile.terrain === 'sand';
  if (imp === 'pasture' || imp === 'forest') return tile.terrain === 'grass';
  return tile.terrain === 'hills' || tile.terrain === 'mountain';
}

export const IMPROVEMENT_NAME: Record<Improvement, string> = { farm: 'farm', mine: 'mine', pasture: 'pasture', forest: 'forest' };

// Drop anything that no longer fits after the terrain changed.
export function fixAfterTerrainChange(tile: Tile): void {
  if (tile.improvement && !improvementFits(tile, tile.improvement)) tile.improvement = null;
  if (tile.terrain === 'water') {
    // Water can be owned, so the land keeps its owner when it floods
    tile.road = false;
    tile.city = false;
    tile.capital = false;
    tile.hp = 0;
    tile.walls = 0;
    tile.shield = 0;
    tile.level = 0;
    tile.growth = 0;
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

// Gold to claim an unowned tile (water is cheap: no gold yet, fish coming)
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
  };
}
