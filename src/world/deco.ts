// City Builder decorations and painted paths (docs/CITY_BUILDER.md, task 5). Pure logic, no Phaser imports.
// Each city keeps a flat list of [x, y, kind] in ground cells from the Keep (world/grid.ts). kind is an index into
// DECO_ORDER. Two layers per cell: the ground (a dirt path, stone path or grass, painted by dragging) and one
// decoration standing on it, so a bench can sit on a path and the path stays under it. Removing the decoration
// leaves the ground as it was. Grass turns a cell back to plain grass, so the wild trees and flowers that grow there
// by default go away (clear it and they come back).
// Decorations go anywhere on the city's own land: every hex it owns, so the town grows with its borders. Nothing
// goes on the water, the Keep, or an amenity; the middle of each hex (and the cell to its right) is kept for an
// amenity, paths only. Scenes only read this and call the actions below, which check the rules (your city, your
// turn, open cell, gold).
import type { Check, GameState } from './game';
import { cellKey, cityLayout, hexAt } from './grid';
import type { CityHex, Layout, XY } from './grid';
import { LEVEL_NAMES, cityLevel } from './tile';
import type { PlayerId, Tile } from './tile';

export type DecoId =
  | 'tree' | 'autumn' | 'round' | 'fruit' | 'bush' | 'flowers' | 'rock' | 'mossy' | 'mushrooms'
  | 'path' | 'stones' | 'fence'
  | 'well' | 'torch' | 'bench' | 'statue' | 'fountain' | 'banner' | 'cottage' | 'cottageStone'
  | 'sign' | 'beehive' | 'hay' | 'barrel' | 'cart' | 'campfire'
  | 'grass';

export type DecoGroup = 'path' | 'nature' | 'build';
export type DecoPrice = 'small' | 'statue' | 'fountain';

export interface DecoInfo {
  name: string;
  icon: string; // emoji, used when the art is missing
  group: DecoGroup;
  price: DecoPrice;
  beauty: number; // for the beauty bonus in task 7 (paths and grass count 0)
  minLevel?: number; // city level needed (2 Town, 3 City)
}

// New decorations only ever go on the end: saves store the index (same rule as BUILDING_ORDER)
export const DECO_ORDER: DecoId[] = [
  'tree', 'autumn', 'round', 'fruit', 'bush', 'flowers', 'rock', 'mossy', 'mushrooms',
  'path', 'stones', 'fence',
  'well', 'torch', 'bench', 'statue', 'fountain', 'banner', 'cottage', 'cottageStone',
  'sign', 'beehive', 'hay', 'barrel', 'cart', 'campfire',
  'grass',
];

const n = (name: string, icon: string): DecoInfo => ({ name, icon, group: 'nature', price: 'small', beauty: 1 });
const b = (name: string, icon: string): DecoInfo => ({ name, icon, group: 'build', price: 'small', beauty: 1 });

export const DECOS: Record<DecoId, DecoInfo> = {
  tree: n('Tall tree', '\u{1F332}'),
  autumn: n('Autumn tree', '\u{1F342}'),
  round: n('Round tree', '\u{1F333}'),
  fruit: n('Fruit tree', '\u{1F34E}'),
  bush: n('Bush', '\u{1F33F}'),
  flowers: n('Flower bed', '\u{1F337}'),
  rock: n('Rock', '\u{1FAA8}'),
  mossy: n('Mossy rock', '\u{1FAA8}'),
  mushrooms: n('Mushrooms', '\u{1F344}'),
  path: { name: 'Dirt path', icon: '\u{1F7EB}', group: 'path', price: 'small', beauty: 0 },
  stones: { name: 'Stone path', icon: '\u2B1C', group: 'path', price: 'small', beauty: 0 },
  fence: b('Fence', '\u{1F6A7}'),
  well: b('Well', '\u{1FAA3}'),
  torch: b('Torch', '\u{1F525}'),
  bench: b('Bench', '\u{1FA91}'),
  statue: { ...b('Statue', '\u{1F5FF}'), price: 'statue', beauty: 2, minLevel: 2 },
  fountain: { ...b('Fountain', '\u26F2'), price: 'fountain', beauty: 3, minLevel: 3 },
  banner: b('Banner', '\u{1F6A9}'),
  cottage: b('Cottage', '\u{1F3E0}'),
  cottageStone: b('Stone cottage', '\u{1F3E1}'),
  sign: b('Signpost', '\u{1FAA7}'),
  beehive: b('Beehive', '\u{1F41D}'),
  hay: b('Hay bale', '\u{1F33E}'),
  barrel: b('Barrel', '\u{1F6E2}\uFE0F'),
  cart: b('Cart', '\u{1F6D2}'),
  campfire: b('Campfire', '\u{1F525}'),
  grass: { name: 'Grass', icon: '\u{1F331}', group: 'path', price: 'small', beauty: 0 },
};

// Gold per decoration on Normal and Hard (Easy and Free Play are free, paths and grass are free everywhere)
export const DECO_PRICE: Record<'normal' | 'hard', Record<DecoPrice, number>> = {
  normal: { small: 2, statue: 6, fountain: 10 },
  hard: { small: 3, statue: 8, fountain: 12 },
};

// The castle's walls and towers cover these cells around the Keep (it's about 2 cells wide)
export const KEEP_TILES: readonly (readonly [number, number])[] = [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0]];

export type DecoEntry = [number, number, number];

const ok = (cost = 0): Check => ({ ok: true, cost, reason: '' });
const fail = (reason: string, cost = 0): Check => ({ ok: false, cost, reason });

export function decoInfo(kind: number): DecoInfo | null {
  const id = DECO_ORDER[kind];
  return id ? DECOS[id] : null;
}

// Painted by dragging (paths and grass): the ground layer
export function isPathKind(kind: number): boolean {
  return decoInfo(kind)?.group === 'path';
}

// Plain grass: painted like a path, but it draws nothing and paths don't join to it
export function isGrassKind(kind: number): boolean {
  return DECO_ORDER[kind] === 'grass';
}

export function decoKind(id: DecoId): number {
  return DECO_ORDER.indexOf(id);
}

export function decoList(city: Tile): DecoEntry[] {
  if (!city.deco) city.deco = [];
  return city.deco;
}

type Layer = 'ground' | 'obj';

function layerOf(kind: number): Layer {
  return isPathKind(kind) ? 'ground' : 'obj';
}

function indexAt(city: Tile, dx: number, dy: number, layer: Layer): number {
  return decoList(city).findIndex(([x, y, k]) => x === dx && y === dy && layerOf(k) === layer);
}

// The decoration standing on cell (dx, dy), or null
export function objAt(city: Tile, dx: number, dy: number): number | null {
  const i = indexAt(city, dx, dy, 'obj');
  return i < 0 ? null : decoList(city)[i][2];
}

// The painted ground of cell (dx, dy): dirt path, stone path or grass, or null
export function groundAt(city: Tile, dx: number, dy: number): number | null {
  const i = indexAt(city, dx, dy, 'ground');
  return i < 0 ? null : decoList(city)[i][2];
}

// What's on top of cell (dx, dy): its decoration, else its painted ground, else null
export function decoAt(city: Tile, dx: number, dy: number): number | null {
  return objAt(city, dx, dy) ?? groundAt(city, dx, dy);
}

// ---------- which cells are open ----------

export function keepTile(dx: number, dy: number): boolean {
  return KEEP_TILES.some(([x, y]) => x === dx && y === dy);
}

// The hex whose amenity spot is this cell (the middle of every hex but the Keep's), or null
export function lotAt(lay: Layout, dx: number, dy: number): CityHex | null {
  const h = hexAt(lay, dx, dy);
  return h && !h.keep && h.center[0] === dx && h.center[1] === dy ? h : null;
}

// The cell right of an amenity spot, where its props stand: paths only
export function yardOf(lay: Layout, dx: number, dy: number): CityHex | null {
  const h = lotAt(lay, dx - 1, dy);
  return h && hexAt(lay, dx, dy) === h ? h : null;
}

// Something is built on (or going up on) this hex
export function lotBuilt(city: Tile, h: CityHex): boolean {
  if (city.projectSite === h.index) return true;
  for (const k in city.sites) if (city.sites[k as keyof Tile['sites']] === h.index) return true;
  return false;
}

// The Keep or an amenity stands on the cell (paths join up to them)
export function builtTile(city: Tile, lay: Layout, dx: number, dy: number): boolean {
  if (keepTile(dx, dy)) return true;
  const lot = lotAt(lay, dx, dy);
  return !!lot && lotBuilt(city, lot);
}

// Why kind can't go on cell (dx, dy), ignoring whatever stands there now (empty = it can)
export function tileReason(state: GameState, city: Tile, dx: number, dy: number, kind: number): string {
  if (!Number.isInteger(dx) || !Number.isInteger(dy)) return "Outside the city's land";
  const lay = cityLayout(state, city);
  const h = hexAt(lay, dx, dy);
  if (!h) return "Outside the city's land: it gets more room as its borders grow";
  if (keepTile(dx, dy)) return 'The Keep stays clear';
  if (h.terrain === 'water') return "That's water: decorations and paths go on land";
  const lot = lotAt(lay, dx, dy);
  if (lot && lotBuilt(city, lot)) return 'An amenity stands here';
  if (!isPathKind(kind) && (lot || yardOf(lay, dx, dy))) return 'Kept clear for an amenity (paths are fine)';
  return '';
}

export function inTown(state: GameState, city: Tile, dx: number, dy: number): boolean {
  return !!hexAt(cityLayout(state, city), dx, dy);
}

// ---------- actions ----------

export function decoCost(state: GameState, p: PlayerId, kind: number): number {
  const info = decoInfo(kind);
  if (!info || info.group === 'path' || state.isFree(p)) return 0;
  const diff = state.options.difficulty;
  if (diff === 'easy') return 0;
  return DECO_PRICE[diff][info.price];
}

// Can p decorate this city right now? (empty = yes)
export function decorateReason(state: GameState, city: Tile, p: PlayerId = state.current): string {
  if (state.winner !== null) return 'Game over';
  if (p !== state.current) return 'Not your turn';
  if (!city.city || city.owner !== p) return 'Decorate your own cities';
  return '';
}

// City size a decoration needs (empty = big enough). Easy rules skip it.
export function levelReason(state: GameState, city: Tile, kind: number, p: PlayerId = state.current): string {
  const need = decoInfo(kind)?.minLevel;
  if (!need || state.isSimple(p) || cityLevel(city) >= need) return '';
  return `Needs a ${LEVEL_NAMES[need - 1]}`;
}

// Can p put kind anywhere at all (city size, gold)? Used to dim the tray.
export function trayCheck(state: GameState, city: Tile, kind: number, p: PlayerId = state.current): Check {
  const why = decorateReason(state, city, p);
  if (why) return fail(why);
  if (!decoInfo(kind)) return fail('Unknown decoration');
  const lvl = levelReason(state, city, kind, p);
  if (lvl) return fail(lvl);
  const cost = decoCost(state, p, kind);
  if (state.players[p].gold < cost) return fail(`Need ${cost} gold`, cost);
  return ok(cost);
}

// A decoration needs a cell with no other decoration on it (any ground under it is fine).
// Paths and grass can be painted under anything.
export function placeCheck(state: GameState, city: Tile, dx: number, dy: number, kind: number, p: PlayerId = state.current): Check {
  const t = trayCheck(state, city, kind, p);
  if (!t.ok) return t;
  const why = tileReason(state, city, dx, dy, kind);
  if (why) return fail(why);
  if (!isPathKind(kind) && objAt(city, dx, dy) !== null) return fail('Something is already here');
  return t;
}

// The decoration stands on whatever ground is there (grass, a dirt or stone path), which stays under it
export function placeDeco(state: GameState, city: Tile, dx: number, dy: number, kind: number, p: PlayerId = state.current): Check {
  if (isPathKind(kind)) return paintPath(state, city, dx, dy, kind, true, p);
  const c = placeCheck(state, city, dx, dy, kind, p);
  if (!c.ok) return c;
  state.players[p].gold -= c.cost;
  decoList(city).push([dx, dy, kind]);
  return c;
}

// Why the decoration on (fx, fy) can't move to (tx, ty), cell rules only (empty = it can)
export function moveReason(state: GameState, city: Tile, fx: number, fy: number, tx: number, ty: number): string {
  const kind = objAt(city, fx, fy);
  if (kind === null) return groundAt(city, fx, fy) !== null ? 'Paths are painted, not moved' : 'Nothing to move';
  if (fx === tx && fy === ty) return '';
  const where = tileReason(state, city, tx, ty, kind);
  if (where) return where;
  if (objAt(city, tx, ty) !== null) return 'Something is already here';
  return '';
}

// Moving is always free. Only the decoration moves: the ground under it, and where it lands, stays.
export function moveDeco(state: GameState, city: Tile, fx: number, fy: number, tx: number, ty: number, p: PlayerId = state.current): Check {
  const why = decorateReason(state, city, p) || moveReason(state, city, fx, fy, tx, ty);
  if (why) return fail(why);
  if (fx === tx && fy === ty) return ok();
  const i = indexAt(city, fx, fy, 'obj');
  decoList(city)[i] = [tx, ty, decoList(city)[i][2]];
  return ok();
}

// Removes the top thing: the decoration if there is one (its ground stays), else the painted ground.
// Removing never refunds gold (so decorations can't be used as a gold bank)
export function removeDeco(state: GameState, city: Tile, dx: number, dy: number, p: PlayerId = state.current): Check {
  const why = decorateReason(state, city, p);
  if (why) return fail(why);
  const o = indexAt(city, dx, dy, 'obj');
  const i = o >= 0 ? o : indexAt(city, dx, dy, 'ground');
  if (i < 0) return fail('Nothing here');
  decoList(city).splice(i, 1);
  return ok();
}

// Paint (on) or clear (off) the ground of one cell: a path or grass. Painting over another painted kind swaps
// it. A decoration standing there stays on top.
export function paintPath(state: GameState, city: Tile, dx: number, dy: number, kind: number, on: boolean, p: PlayerId = state.current): Check {
  const why = decorateReason(state, city, p);
  if (why) return fail(why);
  if (!isPathKind(kind)) return fail('Not a path');
  const i = indexAt(city, dx, dy, 'ground');
  const here = i < 0 ? null : decoList(city)[i][2];
  if (!on) {
    if (here === null) return fail('No path here');
    decoList(city).splice(i, 1);
    return ok();
  }
  if (here === kind) return ok();
  const where = tileReason(state, city, dx, dy, kind);
  if (where) return fail(where);
  if (i >= 0) decoList(city)[i] = [dx, dy, kind];
  else decoList(city).push([dx, dy, kind]);
  return ok();
}

// Clears what's placed in the town (stored items stay stored)
export function clearDeco(state: GameState, city: Tile, p: PlayerId = state.current): Check {
  const why = decorateReason(state, city, p);
  if (why) return fail(why);
  if (!decoList(city).length) return fail('Nothing to clear');
  city.deco = [];
  return ok();
}

// ---------- undo ----------

export function snapDeco(city: Tile): DecoEntry[] {
  return decoList(city).map(([x, y, k]): DecoEntry => [x, y, k]);
}

// Put a city's decorations back the way they were and give back exactly what that action cost
export function restoreDeco(state: GameState, city: Tile, saved: DecoEntry[], refund: number, p: PlayerId = state.current): Check {
  const why = decorateReason(state, city, p);
  if (why) return fail(why);
  city.deco = saved.map(([x, y, k]): DecoEntry => [x, y, k]);
  settleDeco(state, city);
  if (refund > 0) state.players[p].gold += refund;
  return ok();
}

// ---------- drawing helpers (pure) ----------

// Which neighbors a path cell joins: other paths (not grass, whatever stands on them), the castle and the
// amenities. 8 directions.
export interface Links {
  n: boolean; e: boolean; s: boolean; w: boolean;
  ne: boolean; nw: boolean; se: boolean; sw: boolean;
}

export function pathLinks(state: GameState, city: Tile, dx: number, dy: number): Links {
  const lay = cityLayout(state, city);
  const j = (x: number, y: number) => {
    if (!hexAt(lay, x, y)) return false;
    if (builtTile(city, lay, x, y)) return true;
    const k = groundAt(city, x, y);
    return k !== null && !isGrassKind(k);
  };
  return {
    n: j(dx, dy - 1), e: j(dx + 1, dy), s: j(dx, dy + 1), w: j(dx - 1, dy),
    ne: j(dx + 1, dy - 1), nw: j(dx - 1, dy - 1), se: j(dx + 1, dy + 1), sw: j(dx - 1, dy + 1),
  };
}

// Which neighbors a fence joins (other fences only), 4 directions
export function fenceLinks(city: Tile, dx: number, dy: number): { n: boolean; e: boolean; s: boolean; w: boolean } {
  const f = decoKind('fence');
  const j = (x: number, y: number) => objAt(city, x, y) === f;
  return { n: j(dx, dy - 1), e: j(dx + 1, dy), s: j(dx, dy + 1), w: j(dx - 1, dy) };
}

// ---------- keeping decorations on the city's land ----------

// The open cell nearest (x, y) where kind can stand, or null when the town is full
function nearestFree(state: GameState, city: Tile, x: number, y: number, kind: number): XY | null {
  const lay = cityLayout(state, city);
  const busy = new Set(decoList(city).filter(([, , k]) => layerOf(k) === layerOf(kind)).map(([cx, cy]) => cellKey(cx, cy)));
  let best: XY | null = null;
  let bd = Infinity;
  for (const key of lay.cells.keys()) {
    if (busy.has(key)) continue;
    const [cx, cy] = key.split(',').map(Number);
    const d = (cx - x) * (cx - x) + (cy - y) * (cy - y);
    if (d > bd || (d === bd && best && (cy > best[1] || (cy === best[1] && cx > best[0])))) continue;
    if (tileReason(state, city, cx, cy, kind)) continue;
    bd = d;
    best = [cx, cy];
  }
  return best;
}

export interface SettleResult {
  moved: number; // decorations that had to move to the nearest open cell
  stored: number; // decorations and paths put away for lack of room
  restored: number; // stored decorations that found room again
}

// Keep every decoration on open ground of the city's own land. Runs on load, at the start of the owner's turn and
// when the city opens: the land can change under it (a new city founded on one of its hexes, a hex flooded, an old
// save from the square town). A decoration that can't stay moves to the nearest open cell; with no room it is stored
// and comes back by itself later. Paths are never moved (a path only makes sense where it was painted): they are
// stored, and the player can discard them. Nothing is thrown away except entries with an unknown kind.
export function settleDeco(state: GameState, city: Tile): SettleResult {
  const res: SettleResult = { moved: 0, stored: 0, restored: 0 };
  if (!city.city) return res;
  const stash = (city.decoStash ?? []).filter((k) => decoInfo(k));
  const kept: DecoEntry[] = [];
  const homeless: DecoEntry[] = [];
  const seen = new Set<string>();
  for (const e of decoList(city)) {
    const [x, y, k] = e;
    if (!decoInfo(k)) continue;
    const key = `${x},${y},${layerOf(k)}`;
    if (!seen.has(key) && !tileReason(state, city, x, y, k)) {
      seen.add(key);
      kept.push(e);
    } else homeless.push(e);
  }
  city.deco = kept;
  for (const [x, y, k] of homeless) {
    const to = isPathKind(k) ? null : nearestFree(state, city, x, y, k);
    if (to) {
      kept.push([to[0], to[1], k]);
      res.moved++;
    } else {
      stash.push(k);
      res.stored++;
    }
  }
  if (!homeless.length) {
    for (let i = 0; i < stash.length; i++) {
      const k = stash[i];
      if (isPathKind(k)) continue;
      const to = nearestFree(state, city, 0, 2, k);
      if (!to) break;
      kept.push([to[0], to[1], k]);
      stash.splice(i--, 1);
      res.restored++;
    }
  }
  city.decoStash = stash;
  return res;
}

// What's stored for lack of room
export function stashCounts(city: Tile): { deco: number; paths: number } {
  const s = city.decoStash ?? [];
  const paths = s.filter((k) => isPathKind(k)).length;
  return { deco: s.length - paths, paths };
}

// The player chose to throw away stored path pieces (decorations stay stored until there's room)
export function discardStoredPaths(state: GameState, city: Tile, p: PlayerId = state.current): Check {
  const why = decorateReason(state, city, p);
  if (why) return fail(why);
  const before = city.decoStash ?? [];
  city.decoStash = before.filter((k) => !isPathKind(k));
  return before.length === city.decoStash.length ? fail('No stored paths') : ok();
}

// ---------- saving ----------

// Flat list for the save: x, y, kind, x, y, kind, ...
export function encodeDeco(city: Tile): number[] {
  return decoList(city).flatMap(([x, y, k]) => [x, y, k]);
}

export function decodeDeco(flat: unknown): DecoEntry[] {
  if (!Array.isArray(flat)) return [];
  const out: DecoEntry[] = [];
  for (let i = 0; i + 2 < flat.length; i += 3) {
    const [x, y, k] = [Number(flat[i]), Number(flat[i + 1]), Number(flat[i + 2])];
    if ([x, y, k].every(Number.isInteger)) out.push([x, y, k]);
  }
  return out;
}

export function decodeStash(flat: unknown): number[] {
  if (!Array.isArray(flat)) return [];
  return flat.map(Number).filter((k) => Number.isInteger(k) && decoInfo(k) !== null);
}

// How many decorations (not paths or grass) a city has, for the panel
export function decoCount(city: Tile): number {
  return decoList(city).filter(([, , k]) => !isPathKind(k)).length;
}
