// Browser saves. Layout/map migrations remain compatible; raids are an additive section.
import { migratePlots } from './city';
import { decodeDeco, decodeStash, encodeDeco } from './deco';
import { DIFFICULTY, GameState, MAP_SIZES, seatsFor } from './game';
import type { Difficulty, GameOptions } from './game';
import { savedMapDimensions } from './mapSizes';
import type { MapDimensions } from './mapSizes';
import { BUILDING_ORDER, LEVEL_POP, cityMaxHp, levelFromPop, shieldMax, terrainFromHeight } from './tile';
import type { Building, PlayerId } from './tile';
import { UNIT_STATS } from './units';
import type { Training, Unit } from './units';
import { installRaidRules } from './raidRules';
import { saveRaids, loadRaids } from './raidSave';
import type { RaidState } from './raidState';
installRaidRules();
const KEY = import.meta.env.VITE_CHANNEL === 'dev' ? 'kingdom-save-v3-dev' : 'kingdom-save-v3';
const CITY = 1, CAPITAL = 2, ROAD = 4, FARM = 8, MINE = 16, PASTURE = 32, FOREST = 64, FISHERY = 128;
const LAYOUT = 2;
interface SaveData {
  version: 3; layout?: number; options: GameOptions; mapDimensions?: MapDimensions;
  turn: number; current: PlayerId; winner: PlayerId | null; winReason: string; log: string[];
  players: { gold: number; stone: number; claims: number; alive: boolean }[];
  units: Unit[]; nextUnitId: number; training?: Training[];
  homes?: (number | null)[]; names?: Record<number, string>;
  wars?: Record<string, number>; truces?: Record<string, number>; peaceAsked?: Record<string, number>;
  explored?: string[]; palisades?: Record<number, number>;
  sites?: Record<number, number[]>; projectSites?: Record<number, number>;
  plots?: Record<number, [string, number[], number]>;
  deco?: Record<number, number[]>; decoStash?: Record<number, number[]>;
  raids?: RaidState;
  tiles: [number, PlayerId | null, number, ...number[]][];
}
export interface SaveSummary {
  turn: number; sizeLabel: string; opponents: number; difficulty: Difficulty; finished: boolean; people: string[];
}
export function saveGame(state: GameState): void {
  const cities = state.map.tiles.flatMap((t, i) => t.city ? [[t, i] as const] : []);
  const raids = saveRaids(state);
  const data: SaveData = {
    version: 3, layout: LAYOUT, options: { ...state.options, barbarians: raids.enabled },
    mapDimensions: { width: state.map.width, height: state.map.height },
    turn: state.turn, current: state.current, winner: state.winner, winReason: state.winReason, log: state.log,
    players: state.players.map((p) => ({ gold: p.gold, stone: p.stone, claims: p.claims, alive: p.alive })),
    units: state.units, nextUnitId: state.nextUnitId, training: state.training, homes: state.map.tiles.map((t) => t.home),
    names: state.cityNames, wars: state.wars, truces: state.truces, peaceAsked: state.peaceAsked,
    explored: state.explored.map((a) => Array.from(a).join('')),
    palisades: Object.fromEntries(state.map.tiles.flatMap((t, i) => t.palisade ? [[i, t.palisade]] : [])),
    sites: Object.fromEntries(cities.map(([t, i]) => [i, BUILDING_ORDER.flatMap((b, k) => t.sites[b] !== undefined ? [k, t.sites[b]!] : [])])),
    projectSites: Object.fromEntries(cities.flatMap(([t, i]) => t.project && t.projectSite !== null ? [[i, t.projectSite]] : [])),
    deco: Object.fromEntries(cities.flatMap(([t, i]) => t.deco?.length ? [[i, encodeDeco(t)]] : [])),
    decoStash: Object.fromEntries(cities.flatMap(([t, i]) => t.decoStash?.length ? [[i, t.decoStash.slice()]] : [])),
    raids,
    tiles: state.map.tiles.map((t) => {
      const flags = (t.city ? CITY : 0) | (t.capital ? CAPITAL : 0) | (t.road ? ROAD : 0) |
        (t.improvement === 'farm' ? FARM : 0) | (t.improvement === 'mine' ? MINE : 0) |
        (t.improvement === 'pasture' ? PASTURE : 0) | (t.improvement === 'forest' ? FOREST : 0) | (t.improvement === 'fishery' ? FISHERY : 0);
      if (!t.city) return [t.height, t.owner, flags];
      const bits = t.buildings.reduce((m, b) => m | (1 << BUILDING_ORDER.indexOf(b)), 0), project = t.project ? BUILDING_ORDER.indexOf(t.project) : -1;
      return [t.height, t.owner, flags, t.hp, t.walls, t.shield, t.level, t.growth, t.wallTurns, t.pop, t.culture, t.borders, bits, project, t.projectTurns];
    }),
  };
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* Full/blocked storage must not stop a game. */ }
}
function readSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveData;
    if (data.version !== 3 || !Object.prototype.hasOwnProperty.call(MAP_SIZES, data.options.size)) return null;
    if (!Array.isArray(data.tiles) || !savedMapDimensions(data.options.size, data.tiles.length, data.mapDimensions)) return null;
    return data;
  } catch { return null; }
}
export function saveSummary(): SaveSummary | null {
  const data = readSave();
  if (!data) return null;
  const dims = savedMapDimensions(data.options.size, data.tiles.length, data.mapDimensions)!;
  return { turn: data.turn, sizeLabel: `${MAP_SIZES[data.options.size].label} (${dims.width}x${dims.height})`,
    opponents: data.options.opponents, difficulty: DIFFICULTY[data.options.difficulty] ? data.options.difficulty : 'normal',
    finished: data.winner !== null, people: seatsFor(data.options).filter((s) => s.human).map((s) => s.name) };
}
function tileIndexOr(v: unknown, tiles: number, none: number): number {
  const n = Number(v); return Number.isInteger(n) && n >= 0 && n < tiles ? n : none;
}
export function loadGame(): GameState | null {
  const data = readSave();
  if (!data) return null;
  try {
    const dims = savedMapDimensions(data.options.size, data.tiles.length, data.mapDimensions);
    if (!dims) return null;
    // Old saves gain repair support, but no surprise barbarians. New saves persist the explicit menu choice.
    const state = new GameState({ ...data.options, barbarians: data.options.barbarians ?? false }, dims);
    if (data.tiles.length !== state.map.tiles.length) return null;
    const count = state.map.tiles.length;
    state.map.tiles.forEach((t, i) => {
      const [height, owner, flags, hp, walls, shield, level, growth, wallTurns, pop, culture, borders, bits, project, projectTurns] = data.tiles[i];
      t.height = height; t.terrain = terrainFromHeight(height); t.owner = owner;
      t.city = (flags & CITY) !== 0; t.capital = (flags & CAPITAL) !== 0; t.road = (flags & ROAD) !== 0;
      t.improvement = flags & FARM ? 'farm' : flags & MINE ? 'mine' : flags & PASTURE ? 'pasture' : flags & FOREST ? 'forest' : flags & FISHERY ? 'fishery' : null;
      t.walls = t.city ? walls ?? 0 : 0; t.level = t.city ? level ?? 1 : 0;
      t.growth = t.city ? growth ?? 0 : 0; t.wallTurns = t.city ? wallTurns ?? 0 : 0;
      t.pop = t.city ? pop ?? LEVEL_POP[Math.max(0, Math.min(LEVEL_POP.length, t.level) - 1)] : 0;
      if (t.city) t.level = levelFromPop(t.pop);
      t.culture = t.city ? culture ?? 0 : 0; t.borders = t.city ? borders ?? 0 : 0;
      t.buildings = t.city ? BUILDING_ORDER.filter((_, k) => ((bits ?? 0) & (1 << k)) !== 0) : [];
      t.project = t.city && project !== undefined && project >= 0 ? BUILDING_ORDER[project] : null;
      t.projectTurns = t.city ? projectTurns ?? 0 : 0;
      t.hp = t.city ? hp ?? cityMaxHp(t) : 0; t.shield = t.city ? shield ?? shieldMax(t) : 0;
      t.home = data.homes && data.homes.length === data.tiles.length ? data.homes[i] : null;
      t.palisade = data.palisades?.[i] ?? 0;
      t.sites = {}; t.projectSite = null; t.deco = []; t.decoStash = [];
    });
    state.players.forEach((p, i) => {
      const saved = data.players[i];
      if (saved) { p.gold = saved.gold; p.stone = saved.stone ?? 0; p.claims = saved.claims ?? 0; p.alive = saved.alive; }
    });
    state.turn = data.turn; state.current = data.current; state.winner = data.winner; state.winReason = data.winReason;
    state.log = data.log;
    state.units = (data.units ?? []).map((u) => ({ ...u, hp: u.hp ?? UNIT_STATS[u.type].hp }));
    state.nextUnitId = data.nextUnitId ?? state.units.length + 1; state.training = (data.training ?? []).map((t) => ({ ...t }));
    state.wars = { ...(data.wars ?? {}) }; state.truces = { ...(data.truces ?? {}) }; state.peaceAsked = { ...(data.peaceAsked ?? {}) }; state.alerts = [];
    state.invalidate(); state.assignMissingHomes(); state.cityNames = { ...(data.names ?? {}) }; state.nameMissingCities();
    const fresh = data.layout === LAYOUT;
    for (const c of state.cities()) {
      const i = state.tileIndex(c);
      if (fresh) {
        const flat = data.sites?.[i] ?? [];
        for (let k = 0; k + 1 < flat.length; k += 2) {
          const b: Building | undefined = BUILDING_ORDER[Number(flat[k])];
          if (b && c.buildings.includes(b)) c.sites[b] = tileIndexOr(flat[k + 1], count, -1);
        }
        const ps = data.projectSites?.[i]; c.projectSite = c.project && ps !== undefined ? tileIndexOr(ps, count, -1) : null;
        if (c.projectSite === -1) c.projectSite = null;
      } else {
        const saved = data.plots?.[i];
        const placed = saved && Array.isArray(saved[1]) ? saved[1].map((k): Building | null => k >= 0 && k < BUILDING_ORDER.length ? BUILDING_ORDER[k] : null) : [];
        migratePlots(state, c, placed, saved && saved[2] >= 0 ? saved[2] : null);
      }
      c.deco = decodeDeco(data.deco?.[i]); c.decoStash = decodeStash(data.decoStash?.[i]); state.settleCity(c, true);
    }
    for (const c of state.cities()) if (c.project && c.projectSite === null && c.owner !== null) c.projectSite = state.autoSite(c, c.project, c.owner);
    loadRaids(state, data.raids);
    // The compatibility faction is never a regular player, even if a save was edited.
    if (state.raids) state.players[state.raids.faction].alive = false;
    const n = state.map.tiles.length;
    state.explored = state.players.map((_, i) => {
      const a = new Uint8Array(n), s = data.explored?.[i];
      if (s && s.length === n) for (let k = 0; k < n; k++) a[k] = s.charCodeAt(k) === 49 ? 1 : 0;
      return a;
    });
    for (const p of state.players) state.explore(p.id);
    return state;
  } catch { return null; }
}
export function clearSave(): void { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
