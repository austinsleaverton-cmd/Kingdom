// Save/load the game in the browser's localStorage. No Phaser imports.
import { placeExisting, setupPlots } from './city';
import { DIFFICULTY, GameState, MAP_SIZES, seatsFor } from './game';
import type { Difficulty, GameOptions } from './game';
import { BUILDING_ORDER, LEVEL_POP, PLOT_COUNT, cityMaxHp, levelFromPop, shieldMax, terrainFromHeight } from './tile';
import type { Building, PlayerId, PlotTerrain } from './tile';
import { UNIT_STATS } from './units';
import type { Training, Unit } from './units';

const KEY = 'kingdom-save-v3';
const CITY = 1;
const CAPITAL = 2;
const ROAD = 4;
const FARM = 8;
const MINE = 16;
const PASTURE = 32;
const FOREST = 64;
const FISHERY = 128;

// City View plots: one letter per plot
const PLOT_CODE: Record<PlotTerrain, string> = { water: 'w', sand: 's', grass: 'g', hills: 'h' };
const PLOT_FROM: Record<string, PlotTerrain> = { w: 'water', s: 'sand', g: 'grass', h: 'hills' };

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
  names?: Record<number, string>; // city tile index -> name
  wars?: Record<string, number>; // pair of kingdoms -> turn the war started
  truces?: Record<string, number>; // pair -> turn peace was made
  peaceAsked?: Record<string, number>; // pair -> turn an AI refused peace
  explored?: string[]; // fog of war, per player: one '0'/'1' per tile
  palisades?: Record<number, number>; // tile index -> palisade HP
  // City View, city tile index -> [plot terrain letters, amenity on each plot (BUILDING_ORDER index, -1 none), reserved plot (-1 none)]
  plots?: Record<number, [string, number[], number]>;
  // per tile: [height, owner, flags, hp, walls, shield, level, growth, wallTurns, pop, culture, borders, buildings (bits), project (-1 none), projectTurns]
  // (everything after flags only for cities)
  tiles: [number, PlayerId | null, number, ...number[]][];
}

export interface SaveSummary {
  turn: number;
  sizeLabel: string;
  opponents: number;
  difficulty: Difficulty;
  finished: boolean;
  people: string[]; // names of the human players
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
    names: state.cityNames,
    wars: state.wars,
    truces: state.truces,
    peaceAsked: state.peaceAsked,
    explored: state.explored.map((a) => Array.from(a).join('')),
    palisades: Object.fromEntries(state.map.tiles.flatMap((t, i) => (t.palisade ? [[i, t.palisade]] : []))),
    plots: Object.fromEntries(
      state.map.tiles.flatMap((t, i) =>
        t.city && t.plots.length === PLOT_COUNT
          ? [[i, [t.plots.map((p) => PLOT_CODE[p]).join(''), t.placed.map((b) => (b ? BUILDING_ORDER.indexOf(b) : -1)), t.projectPlot ?? -1]]]
          : [],
      ),
    ),
    tiles: state.map.tiles.map((t) => {
      const flags =
        (t.city ? CITY : 0) |
        (t.capital ? CAPITAL : 0) |
        (t.road ? ROAD : 0) |
        (t.improvement === 'farm' ? FARM : 0) |
        (t.improvement === 'mine' ? MINE : 0) |
        (t.improvement === 'pasture' ? PASTURE : 0) |
        (t.improvement === 'forest' ? FOREST : 0) |
        (t.improvement === 'fishery' ? FISHERY : 0);
      if (!t.city) return [t.height, t.owner, flags];
      const bits = t.buildings.reduce((m, b) => m | (1 << BUILDING_ORDER.indexOf(b)), 0);
      const project = t.project ? BUILDING_ORDER.indexOf(t.project) : -1;
      return [t.height, t.owner, flags, t.hp, t.walls, t.shield, t.level, t.growth, t.wallTurns, t.pop, t.culture, t.borders, bits, project, t.projectTurns];
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
    people: seatsFor(data.options).filter((s) => s.human).map((s) => s.name),
  };
}

export function loadGame(): GameState | null {
  const data = readSave();
  if (!data) return null;
  try {
    const state = new GameState(data.options);
    if (data.tiles.length !== state.map.tiles.length) return null;
    state.map.tiles.forEach((t, i) => {
      const [height, owner, flags, hp, walls, shield, level, growth, wallTurns, pop, culture, borders, bits, project, projectTurns] = data.tiles[i];
      t.height = height;
      t.terrain = terrainFromHeight(height);
      t.owner = owner;
      t.city = (flags & CITY) !== 0;
      t.capital = (flags & CAPITAL) !== 0;
      t.road = (flags & ROAD) !== 0;
      t.improvement = flags & FARM ? 'farm' : flags & MINE ? 'mine' : flags & PASTURE ? 'pasture' : flags & FOREST ? 'forest' : flags & FISHERY ? 'fishery' : null;
      t.walls = t.city ? (walls ?? 0) : 0;
      t.level = t.city ? (level ?? 1) : 0; // old saves: every city starts as a Village
      t.growth = t.city ? (growth ?? 0) : 0;
      t.wallTurns = t.city ? (wallTurns ?? 0) : 0;
      // Older saves had levels, not people: start each city with the people its level needs
      t.pop = t.city ? (pop ?? LEVEL_POP[Math.max(0, Math.min(LEVEL_POP.length, t.level) - 1)]) : 0;
      if (t.city) t.level = levelFromPop(t.pop);
      t.culture = t.city ? (culture ?? 0) : 0;
      t.borders = t.city ? (borders ?? 0) : 0;
      t.buildings = t.city ? BUILDING_ORDER.filter((_, k) => ((bits ?? 0) & (1 << k)) !== 0) : [];
      t.project = t.city && project !== undefined && project >= 0 ? BUILDING_ORDER[project] : null;
      t.projectTurns = t.city ? (projectTurns ?? 0) : 0;
      t.hp = t.city ? (hp ?? cityMaxHp(t)) : 0;
      t.shield = t.city ? (shield ?? shieldMax(t)) : 0;
      t.home = data.homes && data.homes.length === data.tiles.length ? data.homes[i] : null;
      t.palisade = data.palisades?.[i] ?? 0;
      t.plots = [];
      t.placed = [];
      t.projectPlot = null;
    });
    // City View plots (second pass: the land around each city has to be loaded first)
    state.map.tiles.forEach((t, i) => {
      if (!t.city) return;
      const saved = data.plots?.[i];
      if (saved && saved[0].length === PLOT_COUNT && saved[1].length === PLOT_COUNT) {
        t.plots = saved[0].split('').map((c) => PLOT_FROM[c] ?? 'grass');
        t.placed = saved[1].map((k): Building | null => (k >= 0 && k < BUILDING_ORDER.length ? BUILDING_ORDER[k] : null));
        t.projectPlot = t.project && saved[2] >= 0 && saved[2] < PLOT_COUNT ? saved[2] : null;
      } else {
        // Older saves: plots from the land around the city, built amenities placed for you
        setupPlots(state.map, t);
      }
      placeExisting(t); // anything built but not on a plot yet gets one
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
    // Older saves have no wars: everyone starts at peace
    state.wars = { ...(data.wars ?? {}) };
    state.truces = { ...(data.truces ?? {}) };
    state.peaceAsked = { ...(data.peaceAsked ?? {}) };
    state.alerts = [];
    state.invalidate();
    state.assignMissingHomes();
    state.cityNames = { ...(data.names ?? {}) };
    state.nameMissingCities();
    // A half-built amenity from an older save: reserve the plot it will go on
    for (const c of state.cities()) {
      if (c.project && c.projectPlot === null && c.owner !== null) c.projectPlot = state.autoPlot(c, c.project, c.owner);
    }
    // Fog of war: what each kingdom has seen (older saves start with what's in sight now)
    const n = state.map.tiles.length;
    state.explored = state.players.map((_, i) => {
      const a = new Uint8Array(n);
      const s = data.explored?.[i];
      if (s && s.length === n) for (let k = 0; k < n; k++) a[k] = s.charCodeAt(k) === 49 ? 1 : 0;
      return a;
    });
    for (const p of state.players) state.explore(p.id);
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
