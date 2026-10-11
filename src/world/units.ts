// Unit types, movement costs and pathing. No Phaser imports in src/world.
import type { WorldMap } from './map';
import type { PlayerId, Terrain, Tile } from './tile';

export type UnitType = 'builder' | 'settler' | 'swordsman' | 'archer' | 'knight';

export interface UnitStats {
  name: string;
  letter: string; // shown on the map token
  cost: number; // gold to recruit (settlers use the scaling city cost instead)
  food: number; // food upkeep per turn
  moves: number;
  train: number; // turns in the city before it appears (0 = right away)
  hp: number;
  atk: number; // 0 = can't attack
  range: number; // 1 = melee, 2 = shoots over a tile
  military: boolean;
  strongVs?: UnitType; // deals bonus damage to this type
  canCapture?: boolean; // can walk into a destroyed enemy city
}

export const UNIT_STATS: Record<UnitType, UnitStats> = {
  builder: { name: 'Builder', letter: 'B', cost: 15, food: 1, moves: 2, train: 0, hp: 10, atk: 0, range: 0, military: false },
  settler: { name: 'Settler', letter: 'S', cost: 0, food: 2, moves: 2, train: 3, hp: 10, atk: 0, range: 0, military: false },
  swordsman: {
    name: 'Swordsman', letter: 'Sw', cost: 25, food: 1, moves: 2, train: 2,
    hp: 30, atk: 8, range: 1, military: true, strongVs: 'archer', canCapture: true,
  },
  archer: {
    name: 'Archer', letter: 'Ar', cost: 30, food: 1, moves: 2, train: 2,
    hp: 20, atk: 7, range: 2, military: true, strongVs: 'knight',
  },
  knight: {
    name: 'Knight', letter: 'Kn', cost: 45, food: 2, moves: 4, train: 3,
    hp: 35, atk: 10, range: 1, military: true, strongVs: 'swordsman', canCapture: true,
  },
};

export const TROOPS: UnitType[] = ['swordsman', 'archer', 'knight'];

export interface Unit {
  id: number;
  type: UnitType;
  owner: PlayerId;
  col: number;
  row: number;
  moves: number; // moves left this turn
  acted: boolean; // used its action this turn (job or attack)
  hp: number;
  hold?: boolean; // player told it to stay put: skipped by the end-of-turn check
  uses?: number; // builders on Normal/Hard: jobs left before they retire (undefined = unlimited)
  goal?: { col: number; row: number }; // multi-turn route target: moves itself at the start of each turn
  waited?: number; // turns in a row it was stuck behind one of your units
}

// A unit being trained in a city.
export interface Training {
  type: UnitType;
  owner: PlayerId;
  col: number; // city tile
  row: number;
  turnsLeft: number;
}

export type Job = 'farm' | 'mine' | 'road' | 'walls' | 'raise' | 'lower';

export const JOBS: { id: Job; label: string; key: string }[] = [
  { id: 'farm', label: 'Farm', key: 'F' },
  { id: 'mine', label: 'Mine', key: 'M' },
  { id: 'road', label: 'Road', key: 'R' },
  { id: 'raise', label: 'Raise land', key: 'U' },
  { id: 'lower', label: 'Lower land', key: 'D' },
];

export const JOB_COST: Record<Job, number> = { farm: 5, mine: 8, road: 2, walls: 5, raise: 3, lower: 3 };

const TERRAIN_MOVE: Record<Terrain, number> = {
  water: Infinity,
  sand: 1,
  grass: 1,
  hills: 2,
  mountain: 3,
};

const hasRoad = (t: Tile) => t.road || t.city;

export function moveCost(from: Tile, to: Tile): number {
  if (to.terrain === 'water') return Infinity;
  if (hasRoad(from) && hasRoad(to)) return 0.5;
  return TERRAIN_MOVE[to.terrain];
}

// Tiles the unit can reach this turn, mapped to moves left on arrival.
// A unit with full moves can always step onto one adjacent land tile.
export function reachable(map: WorldMap, unit: Unit, blocked: (t: Tile) => boolean): Map<Tile, number> {
  const out = new Map<Tile, number>();
  const start = map.get(unit.col, unit.row);
  if (!start || unit.moves <= 0) return out;
  const full = UNIT_STATS[unit.type].moves;
  const best = new Map<Tile, number>([[start, unit.moves]]);
  const queue: Tile[] = [start];
  while (queue.length) {
    // pick the tile with the most moves left (small maps, simple scan is fine)
    let bi = 0;
    for (let i = 1; i < queue.length; i++) if (best.get(queue[i])! > best.get(queue[bi])!) bi = i;
    const cur = queue.splice(bi, 1)[0];
    const left = best.get(cur)!;
    for (const n of map.neighbors(cur)) {
      if (blocked(n)) continue;
      const cost = moveCost(cur, n);
      if (cost === Infinity) continue;
      let after = left - cost;
      if (after < 0) {
        if (cur === start && left === full) after = 0;
        else continue;
      }
      if ((best.get(n) ?? -1) >= after) continue;
      best.set(n, after);
      out.set(n, after);
      queue.push(n);
    }
  }
  return out;
}

// ---------- multi-turn routes ----------

// Cheapest path (by move cost) from the unit to the nearest goal tile. Excludes the start tile.
// blocked tiles can't be entered. Returns null if no goal can be reached.
export function findPath(map: WorldMap, from: Tile, goals: Set<Tile>, blocked: (t: Tile) => boolean): Tile[] | null {
  if (goals.has(from)) return [];
  const dist = new Map<Tile, number>([[from, 0]]);
  const prev = new Map<Tile, Tile>();
  // tiny binary heap of [cost, tile]
  const heap: [number, Tile][] = [[0, from]];
  const push = (item: [number, Tile]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): [number, Tile] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, cur] = pop();
    if (d > dist.get(cur)!) continue;
    if (goals.has(cur)) {
      const path: Tile[] = [];
      for (let t: Tile | undefined = cur; t && t !== from; t = prev.get(t)) path.unshift(t);
      return path;
    }
    for (const n of map.neighbors(cur)) {
      if (blocked(n)) continue;
      const c = moveCost(cur, n);
      if (c === Infinity) continue;
      const nd = d + c;
      if (nd >= (dist.get(n) ?? Infinity)) continue;
      dist.set(n, nd);
      prev.set(n, cur);
      push([nd, n]);
    }
  }
  return null;
}

// Which turn the unit reaches each step (0 = this turn), using the same rules as reachable():
// a unit with full moves can always take one step, even onto costly terrain.
export function routeTurns(unit: Unit, path: Tile[], from: Tile): number[] {
  const full = UNIT_STATS[unit.type].moves;
  let left = unit.moves;
  let turn = 0;
  let cur = from;
  const out: number[] = [];
  for (const t of path) {
    const c = moveCost(cur, t);
    if (c <= left) left -= c;
    else if (left === full) left = 0;
    else {
      turn += 1;
      left = full;
      if (c <= left) left -= c;
      else left = 0;
    }
    out.push(turn);
    cur = t;
  }
  return out;
}
