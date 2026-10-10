// Save/load the game in the browser's localStorage. No Phaser imports.
import { GameState, MAP_SIZES } from './game';
import type { GameOptions } from './game';
import { terrainFromHeight } from './tile';
import type { PlayerId } from './tile';

const KEY = 'kingdom-save-v2';
const CITY = 1;
const CAPITAL = 2;

interface SaveData {
  version: 2;
  options: GameOptions;
  turn: number;
  current: PlayerId;
  winner: PlayerId | null;
  winReason: string;
  log: string[];
  players: { gold: number; alive: boolean }[];
  // per tile: [height, owner, flags]
  tiles: [number, PlayerId | null, number][];
}

export interface SaveSummary {
  turn: number;
  sizeLabel: string;
  opponents: number;
  finished: boolean;
}

export function saveGame(state: GameState): void {
  const data: SaveData = {
    version: 2,
    options: state.options,
    turn: state.turn,
    current: state.current,
    winner: state.winner,
    winReason: state.winReason,
    log: state.log,
    players: state.players.map((p) => ({ gold: p.gold, alive: p.alive })),
    tiles: state.map.tiles.map((t) => [t.height, t.owner, (t.city ? CITY : 0) | (t.capital ? CAPITAL : 0)]),
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
    if (data.version !== 2 || !MAP_SIZES[data.options.size]) return null;
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
      const [height, owner, flags] = data.tiles[i];
      t.height = height;
      t.terrain = terrainFromHeight(height);
      t.owner = owner;
      t.city = (flags & CITY) !== 0;
      t.capital = (flags & CAPITAL) !== 0;
    });
    state.players.forEach((p, i) => {
      const saved = data.players[i];
      if (saved) {
        p.gold = saved.gold;
        p.alive = saved.alive;
      }
    });
    state.turn = data.turn;
    state.current = data.current;
    state.winner = data.winner;
    state.winReason = data.winReason;
    state.log = data.log;
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
