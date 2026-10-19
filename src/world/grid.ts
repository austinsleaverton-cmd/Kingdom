// City View ground (docs/CITY_BUILDER.md): the city's own territory, drawn as detailed ground. Pure logic, no Phaser.
// Every map hex the city owns (its land and water, see GameState.cityLand) becomes a patch of small square ground
// cells. Cells are (x, y) offsets from the Keep. The hex at axial offset (q, r) from the city is centred on cell
// (HEX_W * q + HEX_W / 2 * r, HEX_H * r), and every cell belongs to the hex whose centre is nearest, so the patches
// tile without gaps, every hex gets exactly HEX_CELLS cells and the town keeps the shape it has on the map.
// Cells keep the size the old square town used, so anything saved relative to the Keep keeps its meaning.
import type { GameState } from './game';
import { plotTerrainOf } from './tile';
import type { PlotTerrain, Tile } from './tile';

export const HEX_W = 8; // cells between the centres of two hexes side by side
export const HEX_H = 7; // cells between the centres of two rows of hexes
export const HEX_CELLS = HEX_W * HEX_H; // ground cells per hex

export type XY = [number, number];

// Map direction i (0 E, 1 NE, 2 NW, 3 W, 4 SW, 5 SE) as an axial step, same order as WorldMap.neighborAt
export const AXIAL_DIRS: readonly XY[] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

// Axial hex coordinates of a map tile (the map is pointy-top "odd-r")
export function axial(t: Tile): XY {
  return [t.col - (t.row - (t.row & 1)) / 2, t.row];
}

export function hexSteps(q: number, r: number): number {
  return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
}

// The ground cell in the middle of the hex (q, r) from the Keep
export function hexCenter(q: number, r: number): XY {
  return [HEX_W * q + (HEX_W / 2) * r, HEX_H * r];
}

// Which hex (q, r) a ground cell belongs to: the nearest hex centre, ties to the upper, then the left one.
// The tie rule only compares hexes with each other, so every hex gets the same pattern of cells.
export function cellHex(x: number, y: number): XY {
  const r0 = Math.round(y / HEX_H);
  let best: XY = [0, 0];
  let bd = Infinity;
  for (let r = r0 - 1; r <= r0 + 1; r++) {
    const q0 = Math.round((x - (HEX_W / 2) * r) / HEX_W);
    for (let q = q0 - 1; q <= q0 + 1; q++) {
      const [cx, cy] = hexCenter(q, r);
      const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d < bd || (d === bd && (r < best[1] || (r === best[1] && q < best[0])))) {
        bd = d;
        best = [q, r];
      }
    }
  }
  return best;
}

// The cells of hex (0, 0) as offsets from its centre; every other hex is the same pattern moved over
const HEX_OFFSETS: readonly XY[] = (() => {
  const out: XY[] = [];
  for (let y = -HEX_H; y <= HEX_H; y++) {
    for (let x = -HEX_W; x <= HEX_W; x++) {
      const [q, r] = cellHex(x, y);
      if (q === 0 && r === 0) out.push([x, y]);
    }
  }
  return out;
})();

export function hexCells(q: number, r: number): XY[] {
  const [cx, cy] = hexCenter(q, r);
  return HEX_OFFSETS.map(([x, y]): XY => [cx + x, cy + y]);
}

// One hex of the city's territory
export interface CityHex {
  tile: Tile;
  index: number; // map tile index
  q: number; // axial offset from the city
  r: number;
  terrain: PlotTerrain; // what it counts as for building (mountains count as hills)
  center: XY; // its middle ground cell
  keep: boolean; // the city's own hex (the Keep stands here, no amenity)
  dist: number; // hexes from the Keep
}

// A hex just past the border: neighbouring land of another city, a rival kingdom, open land, the sea, or the map edge
export interface OutsideHex {
  tile: Tile | null; // null = off the map
  q: number;
  r: number;
  center: XY;
}

export interface Layout {
  city: Tile;
  hexes: CityHex[]; // the Keep's hex first, then nearest first
  byIndex: Map<number, CityHex>;
  cells: Map<string, CityHex>; // every ground cell the city owns
  outside: OutsideHex[];
  outsideCells: Map<string, OutsideHex>;
  bounds: { minX: number; maxX: number; minY: number; maxY: number }; // in cells, the outside ring included
}

// Map tile at axial offset (q, r) from the city, or null off the map
export function tileAt(state: GameState, city: Tile, q: number, r: number): Tile | null {
  const [cq, cr] = axial(city);
  const row = cr + r;
  const col = cq + q + (row - (row & 1)) / 2;
  return state.map.get(col, row);
}

// Layouts are cached per game and cleared by GameState.invalidate(), which runs whenever land, cities or terrain change
const CACHE = new WeakMap<GameState, Map<number, Layout>>();

export function clearLayouts(state: GameState): void {
  CACHE.delete(state);
}

export function cityLayout(state: GameState, city: Tile): Layout {
  let m = CACHE.get(state);
  if (!m) {
    m = new Map();
    CACHE.set(state, m);
  }
  const i = state.tileIndex(city);
  const hit = m.get(i);
  if (hit && hit.city === city) return hit;
  const lay = buildLayout(state, city);
  m.set(i, lay);
  return lay;
}

function buildLayout(state: GameState, city: Tile): Layout {
  const [cq, cr] = axial(city);
  const land = city.owner === null ? [] : state.cityLand(city);
  if (!land.includes(city)) land.unshift(city);
  const hexes: CityHex[] = land.map((t) => {
    const [aq, ar] = axial(t);
    const q = aq - cq;
    const r = ar - cr;
    return { tile: t, index: state.tileIndex(t), q, r, terrain: plotTerrainOf(t.terrain), center: hexCenter(q, r), keep: t === city, dist: hexSteps(q, r) };
  });
  hexes.sort((a, b) => Number(b.keep) - Number(a.keep) || a.dist - b.dist || a.r - b.r || a.q - b.q);
  const byIndex = new Map<number, CityHex>();
  const cells = new Map<string, CityHex>();
  const owned = new Set<string>();
  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;
  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };
  for (const h of hexes) {
    byIndex.set(h.index, h);
    owned.add(`${h.q},${h.r}`);
    for (const [x, y] of hexCells(h.q, h.r)) {
      cells.set(cellKey(x, y), h);
      grow(x, y);
    }
  }
  const outside: OutsideHex[] = [];
  const outsideCells = new Map<string, OutsideHex>();
  const seen = new Set<string>();
  for (const h of hexes) {
    for (const [dq, dr] of AXIAL_DIRS) {
      const q = h.q + dq;
      const r = h.r + dr;
      const key = `${q},${r}`;
      if (owned.has(key) || seen.has(key)) continue;
      seen.add(key);
      const o: OutsideHex = { tile: tileAt(state, city, q, r), q, r, center: hexCenter(q, r) };
      outside.push(o);
      for (const [x, y] of hexCells(q, r)) {
        outsideCells.set(cellKey(x, y), o);
        grow(x, y);
      }
    }
  }
  return { city, hexes, byIndex, cells, outside, outsideCells, bounds: { minX, maxX, minY, maxY } };
}

export function hexAt(lay: Layout, x: number, y: number): CityHex | null {
  return lay.cells.get(cellKey(x, y)) ?? null;
}

export function inTerritory(lay: Layout, x: number, y: number): boolean {
  return lay.cells.has(cellKey(x, y));
}

// Ground cells of the city that are water (its sea and lakes)
export function waterCell(lay: Layout, x: number, y: number): boolean {
  return hexAt(lay, x, y)?.terrain === 'water';
}

// "northeast": which way a hex lies from the Keep, by where it sits on screen
const COMPASS = ['east', 'southeast', 'south', 'southwest', 'west', 'northwest', 'north', 'northeast'];

export function hexDirection(q: number, r: number): string {
  const [x, y] = hexCenter(q, r);
  const k = Math.round(Math.atan2(y, x) / (Math.PI / 4)); // cells are close enough to square for this
  return COMPASS[(k + 8) % 8];
}

// "the hills hex 2 northeast of the Keep"
export function hexLabel(h: Pick<CityHex, 'q' | 'r' | 'terrain' | 'keep' | 'dist'>): string {
  if (h.keep) return "the Keep's hex";
  return `the ${h.terrain} hex ${h.dist} ${hexDirection(h.q, h.r)} of the Keep`;
}
