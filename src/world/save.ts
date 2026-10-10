// Save/load the game in the browser's localStorage. No Phaser imports.
import { GameState } from './game';
import { terrainFromHeight } from './tile';
import type { PlayerId } from './tile';

const KEY = 'kingdom-save-v1';
const CITY = 1;
const CAPITAL = 2;

interface SaveData {
  version: 1;
  seed: number;
  turn: number;
  current: PlayerId;
  winner: PlayerId | null;
  winReason: string;
  log: string[];
  gold: number[];
  // per tile: [height, owner, flags]
  tiles: [number, PlayerId | null, number][];
}

export function saveGame(state: GameState): void {
  const data: SaveData = {
    version: 1,
    seed: state.seed,
    turn: state.turn,
    current: state.current,
    winner: state.winner,
    winReason: state.winReason,
    log: state.log,
    gold: state.players.map((p) => p.gold),
    tiles: state.map.tiles.map((t) => [t.height, t.owner, (t.city ? CITY : 0) | (t.capital ? CAPITAL : 0)]),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // storage full or blocked: keep playing without saving
  }
}

export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveData;
    if (data.version !== 1) return null;

    const state = new GameState(data.seed);
    if (data.tiles.length !== state.map.tiles.length) return null;

    state.map.tiles.forEach((t, i) => {
      const [height, owner, flags] = data.tiles[i];
      t.height = height;
      t.terrain = terrainFromHeight(height);
      t.owner = owner;
      t.city = (flags & CITY) !== 0;
      t.capital = (flags & CAPITAL) !== 0;
    });
    state.players.forEach((p, i) => (p.gold = data.gold[i] ?? p.gold));
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
