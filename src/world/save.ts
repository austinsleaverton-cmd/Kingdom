// Save/load the game in the browser's localStorage. No Phaser imports.
import { DIFFICULTY, GameState, MAP_SIZES } from './game';
import type { Difficulty, GameOptions } from './game';
import { cityMaxHp, shieldMax, terrainFromHeight } from './tile';
import type { PlayerId } from './tile';
import { UNIT_STATS } from './units';
import type { Training, Unit } from './units';

const KEY = 'kingdom-save-v3';
const CITY = 1;
const CAPITAL = 2;
const ROAD = 4;
const FARM = 8;
const MINE = 16;

interface SaveData {
  version: 3;
  options: GameOptions;
  turn: number;
  current: PlayerId;
  winner: PlayerId | null;
  winReason: string;
  log: string[];
  players: { gold: number; stone: number; claims: number; alive: boolean }[];
  units: Unit[];
  nextUnitId: number;
  training?: Training[];
  homes?: (number | null)[]; // per tile: index of the city it belongs to
  // per tile: [height, owner, flags, hp, walls, shield] (last three only for cities)
  tiles: [number, PlayerId | null, number, number?, number?, number?][];
}

export interface SaveSummary {
  turn: number;
  sizeLabel: string;
  opponents: number;
  difficulty: Difficulty;
  finished: boolean;
}

export function saveGame(state: GameState): void {
  const data: SaveData = {
    version: 3,
    options: state.options,
    turn: state.turn,
    current: state.current,
    winner: state.winner,
    winReason: state.winReason,
    log: state.log,
    players: state.players.map((p) => ({ gold: p.gold, stone: p.stone, claims: p.claims, alive: p.alive })),
    units: state.units,
    nextUnitId: state.nextUnitId,
    training: state.training,
    homes: state.map.tiles.map((t) => t.home),
    tiles: state.map.tiles.map((t) => {
      const flags =
        (t.city ? CITY : 0) |
        (t.capital ? CAPITAL : 0) |
        (t.road ? ROAD : 0) |
        (t.improvement === 'farm' ? FARM : 0) |
        (t.improvement === 'mine' ? MINE : 0);
      return t.city ? [t.height, t.owner, flags, t.hp, t.walls, t.shield] : [t.height, t.owner, flags];
    }),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // storage full or blocked: keep playing without saving
  }
}

function readSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveData;
    if (data.version !== 3 || !MAP_SIZES[data.options.size]) return null;
    return data;
  } catch {
    return null;
  }
}

export function saveSummary(): SaveSummary | null {
  const data = readSave();
  if (!data) return null;
  return {
    turn: data.turn,
    sizeLabel: MAP_SIZES[data.options.size].label,
    opponents: data.options.opponents,
    difficulty: DIFFICULTY[data.options.difficulty] ? data.options.difficulty : 'normal',
    finished: data.winner !== null,
  };
}

export function loadGame(): GameState | null {
  const data = readSave();
  if (!data) return null;
  try {
    const state = new GameState(data.options);
    if (data.tiles.length !== state.map.tiles.length) return null;
    state.map.tiles.forEach((t, i) => {
      const [height, owner, flags, hp, walls, shield] = data.tiles[i];
      t.height = height;
      t.terrain = terrainFromHeight(height);
      t.owner = owner;
      t.city = (flags & CITY) !== 0;
      t.capital = (flags & CAPITAL) !== 0;
      t.road = (flags & ROAD) !== 0;
      t.improvement = flags & FARM ? 'farm' : flags & MINE ? 'mine' : null;
      t.walls = t.city ? (walls ?? 0) : 0;
      t.hp = t.city ? (hp ?? cityMaxHp(t)) : 0;
      t.shield = t.city ? (shield ?? shieldMax(t)) : 0;
      t.home = data.homes && data.homes.length === data.tiles.length ? data.homes[i] : null;
    });
    state.players.forEach((p, i) => {
      const saved = data.players[i];
      if (saved) {
        p.gold = saved.gold;
        p.stone = saved.stone ?? 0;
        p.claims = saved.claims ?? 0;
        p.alive = saved.alive;
      }
    });
    state.turn = data.turn;
    state.current = data.current;
    state.winner = data.winner;
    state.winReason = data.winReason;
    state.log = data.log;
    state.units = (data.units ?? []).map((u) => ({ ...u, hp: u.hp ?? UNIT_STATS[u.type].hp }));
    state.nextUnitId = data.nextUnitId ?? state.units.length + 1;
    state.training = (data.training ?? []).map((t) => ({ ...t }));
    state.invalidate();
    state.assignMissingHomes();
    return state;
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
