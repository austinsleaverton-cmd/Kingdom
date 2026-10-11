// Unit types, movement costs and pathing. No Phaser imports in src/world.
import type { WorldMap } from './map';
import type { PlayerId, Terrain, Tile } from './tile';

export type UnitType = 'builder' | 'settler' | 'swordsman' | 'archer' | 'knight';

export interface UnitStats {
  name: string;
  letter: string; // short label (map tokens use drawn icons)
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
}

// A unit being trained in a city.
export interface Training {
  type: UnitType;
  owner: PlayerId;
  col: number; // city tile
  row: number;
  turnsLeft: number;
}

// 'walls' is still a valid builder job for the AI, but players build walls from the city panel.
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
