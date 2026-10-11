// Tile data and terrain rules. No Phaser imports in src/world.

export type Terrain = 'water' | 'sand' | 'grass' | 'hills' | 'mountain';
export type PlayerId = number; // 0 is always the human player
export type Improvement = 'farm' | 'mine';

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
}

export const MAX_HEIGHT = 5;

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

// Farms need flat land, mines need high ground.
export function improvementFits(tile: Tile, imp: Improvement): boolean {
  if (tile.city) return false;
  if (imp === 'farm') return tile.terrain === 'grass' || tile.terrain === 'sand';
  return tile.terrain === 'hills' || tile.terrain === 'mountain';
}

// Drop anything that no longer fits after the terrain changed.
export function fixAfterTerrainChange(tile: Tile): void {
  if (tile.improvement && !improvementFits(tile, tile.improvement)) tile.improvement = null;
  if (tile.terrain === 'water') {
    tile.road = false;
    tile.owner = null;
    tile.city = false;
    tile.capital = false;
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

// Gold to claim an unowned tile
export const CLAIM_COST: Record<Terrain, number> = {
  water: 0,
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
  };
}
