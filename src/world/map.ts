// Hex map: pointy-top hexes, "odd-r" offset layout (odd rows shifted right).
import { MAX_HEIGHT, makeTile, terrainFromHeight } from './tile';
import type { Tile } from './tile';

export const MAP_WIDTH = 30;
export const MAP_HEIGHT = 20;

const EVEN_ROW_DIRS = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
const ODD_ROW_DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];

export class WorldMap {
  readonly width: number;
  readonly height: number;
  readonly tiles: Tile[];

  constructor(width: number, height: number, tiles: Tile[]) {
    this.width = width;
    this.height = height;
    this.tiles = tiles;
  }

  get(col: number, row: number): Tile | null {
    if (col < 0 || row < 0 || col >= this.width || row >= this.height) return null;
    return this.tiles[row * this.width + col];
  }

  // dir: 0 E, 1 NE, 2 NW, 3 W, 4 SW, 5 SE
  neighborAt(tile: Tile, dir: number): Tile | null {
    const [dc, dr] = (tile.row & 1 ? ODD_ROW_DIRS : EVEN_ROW_DIRS)[dir];
    return this.get(tile.col + dc, tile.row + dr);
  }

  neighbors(tile: Tile): Tile[] {
    const dirs = tile.row & 1 ? ODD_ROW_DIRS : EVEN_ROW_DIRS;
    const out: Tile[] = [];
    for (const [dc, dr] of dirs) {
      const n = this.get(tile.col + dc, tile.row + dr);
      if (n) out.push(n);
    }
    return out;
  }

  // Returns true if the height changed.
  raiseHeight(tile: Tile): boolean {
    if (tile.height >= MAX_HEIGHT) return false;
    tile.height += 1;
    tile.terrain = terrainFromHeight(tile.height);
    return true;
  }

  // Returns true if the height changed. Flooded tiles lose their owner.
  lowerHeight(tile: Tile): boolean {
    if (tile.height <= 0) return false;
    tile.height -= 1;
    tile.terrain = terrainFromHeight(tile.height);
    if (tile.terrain === 'water') {
      tile.owner = null;
      tile.city = false;
      tile.capital = false;
    }
    return true;
  }
}

export function hexDistance(a: Tile, b: Tile): number {
  const aq = a.col - (a.row - (a.row & 1)) / 2;
  const bq = b.col - (b.row - (b.row & 1)) / 2;
  const dq = aq - bq;
  const dr = a.row - b.row;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

// Small seeded RNG so a seed always gives the same map.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function valueNoise(rand: () => number, w: number, h: number, cell: number): number[] {
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const lattice: number[] = [];
  for (let i = 0; i < gw * gh; i++) lattice.push(rand());
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const out: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = x / cell;
      const gy = y / cell;
      const ix = Math.floor(gx);
      const iy = Math.floor(gy);
      const fx = smooth(gx - ix);
      const fy = smooth(gy - iy);
      const v00 = lattice[iy * gw + ix];
      const v10 = lattice[iy * gw + ix + 1];
      const v01 = lattice[(iy + 1) * gw + ix];
      const v11 = lattice[(iy + 1) * gw + ix + 1];
      const top = v00 + (v10 - v00) * fx;
      const bottom = v01 + (v11 - v01) * fx;
      out.push(top + (bottom - top) * fy);
    }
  }
  return out;
}

export function generateMap(seed: number, width = MAP_WIDTH, height = MAP_HEIGHT): WorldMap {
  const rand = mulberry32(seed);
  const big = valueNoise(rand, width, height, Math.max(5, Math.round(Math.min(width, height) / 3)));
  const small = valueNoise(rand, width, height, 3);
  const tiles: Tile[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col;
      let n = big[i] * 0.7 + small[i] * 0.3;
      // Fade the edges into ocean
      const dx = Math.abs((col / (width - 1)) * 2 - 1);
      const dy = Math.abs((row / (height - 1)) * 2 - 1);
      const edge = Math.max(dx, dy);
      n += 0.12 - Math.max(0, edge - 0.55) * 0.9;
      let h: number;
      if (n < 0.4) h = 0;
      else if (n < 0.46) h = 1;
      else if (n < 0.58) h = 2;
      else if (n < 0.68) h = 3;
      else if (n < 0.76) h = 4;
      else h = 5;
      tiles.push(makeTile(col, row, h));
    }
  }
  return new WorldMap(width, height, tiles);
}
