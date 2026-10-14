// Unit types, movement costs and pathing. No Phaser imports in src/world.
import type { WorldMap } from './map';
import type { Building, PlayerId, Terrain, Tile } from './tile';

export type UnitType = 'builder' | 'settler' | 'scout' | 'swordsman' | 'archer' | 'knight' | 'catapult' | 'trireme' | 'galleass' | 'transport';

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
  naval?: boolean; // a boat: sails on water and docks in your own cities
  boatsOnly?: boolean; // can only attack other boats
  carry?: number; // land units it can carry across water
  minLevel?: number; // the city must be at least this level to make it
  needs?: Building; // the city must have this amenity to make it
  scout?: boolean; // crosses closed borders at peace; hills, mountains and forests cost 1 less
  stone?: number; // stone it costs to make, on top of gold
  vsPalisade?: number; // damage multiplier against palisades
  vsCity?: number; // damage multiplier against cities (walls and HP)
  setup?: boolean; // can't attack on a turn it has moved
}

export const UNIT_STATS: Record<UnitType, UnitStats> = {
  // food = upkeep: troops eat more than workers
  builder: { name: 'Builder', letter: 'B', cost: 15, food: 1, moves: 2, train: 0, hp: 10, atk: 0, range: 0, military: false },
  settler: { name: 'Settler', letter: 'S', cost: 0, food: 2, moves: 2, train: 3, hp: 10, atk: 0, range: 0, military: false, minLevel: 2 },
  scout: { name: 'Scout', letter: 'Sc', cost: 10, food: 1, moves: 3, train: 1, hp: 15, atk: 0, range: 0, military: false, scout: true },
  swordsman: {
    name: 'Swordsman', letter: 'Sw', cost: 25, food: 2, moves: 2, train: 2,
    hp: 30, atk: 8, range: 1, military: true, strongVs: 'archer', canCapture: true,
  },
  archer: {
    name: 'Archer', letter: 'Ar', cost: 30, food: 2, moves: 2, train: 2,
    hp: 20, atk: 7, range: 2, military: true, strongVs: 'knight',
  },
  knight: {
    name: 'Knight', letter: 'Kn', cost: 45, food: 3, moves: 4, train: 3,
    hp: 35, atk: 10, range: 1, military: true, strongVs: 'swordsman', canCapture: true, minLevel: 3,
  },
  // Siege: wrecks palisades and walls from 2 hexes away, weak in a straight fight, must set up before firing
  catapult: {
    name: 'Catapult', letter: 'Ca', cost: 30, food: 2, moves: 2, train: 3,
    hp: 15, atk: 6, range: 2, military: true, minLevel: 3, stone: 10, vsPalisade: 3, vsCity: 2, setup: true,
  },
  // Boats: need a Harbor
  trireme: {
    name: 'Trireme', letter: 'Tr', cost: 30, food: 2, moves: 4, train: 2,
    hp: 30, atk: 9, range: 1, military: true, naval: true, boatsOnly: true, strongVs: 'galleass', needs: 'harbor',
  },
  galleass: {
    name: 'Galleass', letter: 'Ga', cost: 50, food: 3, moves: 3, train: 3,
    hp: 30, atk: 9, range: 2, military: true, naval: true, needs: 'harbor', minLevel: 4, vsPalisade: 2,
  },
  transport: {
    name: 'Transport', letter: 'Tp', cost: 25, food: 1, moves: 4, train: 2,
    hp: 20, atk: 0, range: 0, military: false, naval: true, carry: 2, needs: 'harbor',
  },
};

// What a city's Train list offers after Builder and Settler (with rivals in the game)
export const TROOPS: UnitType[] = ['scout', 'swordsman', 'archer', 'knight', 'catapult'];
export const NAVY: UnitType[] = ['trireme', 'galleass', 'transport'];

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
  cargo?: Unit[]; // transports: land units on board (they're off the map until unloaded)
}

// A unit being trained in a city.
export interface Training {
  type: UnitType;
  owner: PlayerId;
  col: number; // city tile
  row: number;
  turnsLeft: number;
}

export type Job = 'farm' | 'pasture' | 'forest' | 'mine' | 'fishery' | 'road' | 'palisade' | 'walls' | 'raise' | 'lower';

// Palisades: a builder puts one on your land near a city; enemies must break it to get through
export const PALISADE_STONE = 4; // stone per palisade (plus its gold in JOB_COST)
export const PALISADE_HP = 20;
export const PALISADE_REGEN = 5; // HP a damaged palisade regains per turn when no enemy troops are near
export const PALISADE_RANGE = 2; // only within this many hexes of one of your cities
export const PALISADE_COVER = 0.75; // your units standing on one take this share of the damage

export const JOBS: { id: Job; label: string; key: string }[] = [
  { id: 'farm', label: 'Farm (food)', key: 'F' },
  { id: 'fishery', label: 'Fishery (food, on water)', key: 'G' },
  { id: 'pasture', label: 'Pasture (horses)', key: 'P' },
  { id: 'forest', label: 'Plant forest (bows)', key: 'T' },
  { id: 'mine', label: 'Mine', key: 'M' },
  { id: 'road', label: 'Road', key: 'R' },
  { id: 'palisade', label: `Palisade (${PALISADE_STONE} stone)`, key: 'E' },
  { id: 'raise', label: 'Raise land', key: 'U' },
  { id: 'lower', label: 'Lower land', key: 'D' },
];

export const JOB_COST: Record<Job, number> = { farm: 5, pasture: 6, forest: 4, mine: 8, fishery: 6, road: 2, palisade: 4, walls: 5, raise: 3, lower: 3 };

const TERRAIN_MOVE: Record<Terrain, number> = {
  water: Infinity,
  sand: 1,
  grass: 1,
  hills: 2,
  mountain: 3,
};

// How a unit gets around: land troops walk, boats sail, builders walk and can wade into their own water,
// scouts walk but take rough ground in stride
export type MoveMode = 'land' | 'sea' | 'wade' | 'scout';

export function moveMode(type: UnitType): MoveMode {
  if (UNIT_STATS[type].naval) return 'sea';
  if (UNIT_STATS[type].scout) return 'scout';
  return type === 'builder' ? 'wade' : 'land';
}

// Can a unit moving this way ever stand on this tile? (ignores other units)
export function canEnter(t: Tile, owner: PlayerId | undefined, mode: MoveMode): boolean {
  if (mode === 'sea') return t.terrain === 'water' || (t.city && owner !== undefined && t.owner === owner);
  if (t.terrain !== 'water') return true;
  return mode === 'wade' && owner !== undefined && t.owner === owner;
}

// Roads (and cities) only speed up their owner: enemy roads are just ground to an invader.
// owner undefined = anyone's roads count (used for display only).
const hasRoad = (t: Tile, owner?: PlayerId) => {
  if (owner !== undefined && t.owner !== null && t.owner !== owner) return false;
  return t.road || (t.city && (owner === undefined || t.owner === owner));
};

export const FOREST_MOVE = 2; // forests are slow to walk through (your own roads still cut through)

export function moveCost(from: Tile, to: Tile, owner?: PlayerId, mode: MoveMode = 'land'): number {
  if (!canEnter(to, owner, mode)) return Infinity;
  if (mode === 'sea' || to.terrain === 'water') return 1; // sailing, or a builder wading in
  if (hasRoad(from, owner) && hasRoad(to, owner)) return 0.5;
  const base = to.improvement === 'forest' && !(to.road && hasRoad(to, owner)) ? Math.max(FOREST_MOVE, TERRAIN_MOVE[to.terrain]) : TERRAIN_MOVE[to.terrain];
  return mode === 'scout' ? Math.max(1, base - 1) : base; // scouts: rough ground costs 1 less
}

// Tiles the unit can reach this turn, mapped to moves left on arrival.
// A unit with full moves can always step onto one adjacent tile it's allowed on.
export function reachable(map: WorldMap, unit: Unit, blocked: (t: Tile) => boolean): Map<Tile, number> {
  const out = new Map<Tile, number>();
  const start = map.get(unit.col, unit.row);
  if (!start || unit.moves <= 0) return out;
  const full = UNIT_STATS[unit.type].moves;
  const mode = moveMode(unit.type);
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
      const cost = moveCost(cur, n, unit.owner, mode);
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
export function findPath(
  map: WorldMap, from: Tile, goals: Set<Tile>, blocked: (t: Tile) => boolean, owner?: PlayerId, mode: MoveMode = 'land',
): Tile[] | null {
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
      const c = moveCost(cur, n, owner, mode);
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
  const mode = moveMode(unit.type);
  let left = unit.moves;
  let turn = 0;
  let cur = from;
  const out: number[] = [];
  for (const t of path) {
    const c = moveCost(cur, t, unit.owner, mode);
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
