import type { GameState } from './game';
import { hexDistance } from './map';
import type { Tile } from './tile';
import { UNIT_STATS, findPath, reachable } from './units';
import type { Unit } from './units';
import { amenityTarget } from './amenityRaids';
import { campFor, isBarbarian, raidLog, raidState } from './raidState';
export const CAMP_HP = 20, CAMP_REWARD = 15, MAX_CAMPS = 8, MAX_RAIDERS = 16, CAMP_DISTANCE = 7, CAMP_SPACING = 8;
const cadence = (g: GameState) => g.options.difficulty === 'easy' ? 10 : g.options.difficulty === 'hard' ? 5 : 7;
function hash(seed: number, index: number, round: number): number {
  let x = (seed ^ Math.imul(index + 1, 0x45d9f3b) ^ Math.imul(round + 1, 0x27d4eb2d)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}
export function campUnits(g: GameState): Unit[] {
  return (g.raids?.camps ?? []).flatMap((c) => { const u = g.unitById(c.unitId); return u ? [u] : []; });
}
export function spawnCamps(g: GameState, requested = 1): number {
  const data = raidState(g);
  if (!data.enabled || g.winner !== null) return 0;
  const limit = Math.min(MAX_CAMPS, Math.max(2, Math.floor(g.landCount() / 400)));
  const visible = g.players.filter((p) => !isBarbarian(g, p.id) && p.alive).map((p) => ({ p: p.id, tiles: g.visibleTiles(p.id) }));
  const cities = g.cities();
  const candidates = g.map.tiles.filter((t) =>
    t.owner === null && !t.city && t.terrain !== 'water' && t.terrain !== 'mountain' && !g.unitAt(t) &&
    !t.palisade && !t.improvement && !t.road &&
    cities.every((c) => hexDistance(c, t) >= CAMP_DISTANCE) &&
    cities.some((c) => hexDistance(c, t) <= 12) &&
    g.map.neighbors(t).some((n) => n.terrain !== 'water' && n.terrain !== 'mountain') &&
    visible.every((v) => !g.isExplored(v.p, t) && !v.tiles.has(t)),
  ).sort((a, b) => hash(g.seed, g.tileIndex(a), g.turn) - hash(g.seed, g.tileIndex(b), g.turn));
  let made = 0;
  for (const tile of candidates) {
    if (made >= requested || data.camps.length >= limit) break;
    if (campUnits(g).some((u) => hexDistance(g.tileOf(u), tile) < CAMP_SPACING)) continue;
    // Stationary structure proxy reuses core occupancy/combat without adding a playable kingdom or a save enum.
    // raidRules disables its attack/counter; RaidUi replaces its sprite, label and tooltip with a camp.
    const unit: Unit = { id: g.nextUnitId++, type: 'catapult', owner: data.faction, col: tile.col, row: tile.row, moves: 0, acted: true, hp: CAMP_HP };
    g.units.push(unit);
    data.camps.push({ unitId: unit.id, nextRaid: g.turn + cadence(g) });
    made++;
  }
  return made;
}
export function initializeRaids(g: GameState): void {
  const data = raidState(g);
  if (data.initialized) return;
  data.initialized = true; data.lastRound = g.turn;
  spawnCamps(g, Math.min(MAX_CAMPS, Math.max(2, Math.floor(g.landCount() / 400))));
}
function blocked(g: GameState, unit: Unit, tile: Tile): boolean {
  return tile.city || !!g.unitAt(tile) || g.walledOff(tile, unit.owner);
}
function raidGoal(g: GameState, unit: Unit): Tile | null {
  const here = g.tileOf(unit);
  let best: Tile | null = null, score = -Infinity;
  for (const tile of g.map.tiles) {
    if (tile.city || tile.owner === null || isBarbarian(g, tile.owner) || tile.terrain === 'water' || !g.players[tile.owner]?.alive) continue;
    const distance = hexDistance(here, tile);
    if (distance > 10) continue;
    const amenity = amenityTarget(g, tile);
    const value = amenity ? amenity.building === 'market' ? 16 : 12 : tile.improvement ? 8 : tile.road ? 3 : 0;
    if (!value) continue;
    const s = value - distance;
    if (s > score) { score = s; best = tile; }
  }
  return best;
}
function attackNear(g: GameState, unit: Unit): boolean {
  const choices = g.map.neighbors(g.tileOf(unit)).map((tile) => ({ tile, unit: g.unitAt(tile) }))
    .filter((t) => t.unit && !isBarbarian(g, t.unit.owner) && !t.tile.city)
    .sort((a, b) => Number(UNIT_STATS[b.unit!.type].military) - Number(UNIT_STATS[a.unit!.type].military));
  for (const target of choices) {
    const pv = g.attackPreview(unit, target.tile);
    if (pv.ok && pv.counter < unit.hp) { g.attack(unit, target.tile); return true; }
  }
  return false;
}
function moveRaider(g: GameState, unit: Unit): void {
  if (g.pillageCheck(unit).ok) { g.pillage(unit); return; }
  if (attackNear(g, unit)) return;
  const goal = raidGoal(g, unit), origin = g.tileOf(unit);
  const home = campUnits(g).sort((a, b) => hexDistance(origin, g.tileOf(a)) - hexDistance(origin, g.tileOf(b)))[0];
  const fallback = home ? g.map.neighbors(g.tileOf(home)).filter((t) => t.terrain !== 'water' && !blocked(g, unit, t)) : [];
  const goals = goal
    ? new Set(g.unitAt(goal) || g.walledOff(goal, unit.owner) ? g.map.neighbors(goal).filter((t) => !blocked(g, unit, t)) : [goal])
    : new Set(fallback);
  const path = findPath(g.map, origin, goals, (t) => blocked(g, unit, t), unit.owner, 'land');
  if (path) for (const step of path) {
    if (!g.units.includes(unit) || unit.moves <= 0) break;
    if (!reachable(g.map, unit, (t) => blocked(g, unit, t)).has(step) || !g.moveUnit(unit, step)) break;
  }
  if (!g.units.includes(unit) || unit.acted) return;
  if (g.pillageCheck(unit).ok) g.pillage(unit);
  else if (!attackNear(g, unit)) {
    const wall = g.map.neighbors(g.tileOf(unit)).find((t) => t.palisade && t.owner !== null && g.attackPreview(unit, t).ok);
    if (wall) g.attack(unit, wall);
  }
}
export function runBarbarians(g: GameState): void {
  const data = raidState(g);
  if (!data.enabled || g.winner !== null || data.lastRound >= g.turn) return;
  data.lastRound = g.turn;
  data.camps = data.camps.filter((c) => !!g.unitById(c.unitId));
  if (g.turn >= data.nextCamp) { spawnCamps(g); data.nextCamp = g.turn + 12; }
  const current = g.current;
  g.current = data.faction;
  try {
    // New raiders wait one round before moving.
    const moving = g.unitsOf(data.faction).filter((u) => !campFor(g, u.id));
    for (const unit of moving) { unit.moves = UNIT_STATS[unit.type].moves; unit.acted = false; moveRaider(g, unit); }
    for (const camp of data.camps) {
      if (g.turn < camp.nextRaid) continue;
      if (g.unitsOf(data.faction).filter((u) => !campFor(g, u.id)).length >= MAX_RAIDERS) break;
      const base = g.unitById(camp.unitId);
      if (!base) continue;
      const tile = g.tileOf(base);
      const nearby = g.unitsOf(data.faction).filter((u) => !campFor(g, u.id) && hexDistance(g.tileOf(u), tile) <= 6);
      if (nearby.length >= 2) { camp.nextRaid = g.turn + 1; continue; }
      const at = g.map.neighbors(tile).find((t) => t.terrain !== 'water' && !blocked(g, base, t));
      if (!at) { camp.nextRaid = g.turn + 1; continue; }
      g.units.push({ id: g.nextUnitId++, type: 'swordsman', owner: data.faction, col: at.col, row: at.row, hp: UNIT_STATS.swordsman.hp, moves: 0, acted: true });
      camp.nextRaid = g.turn + cadence(g);
    }
  } finally { g.current = current; }
}
export function huntBarbarians(g: GameState, p: number): void {
  if (!g.raids?.enabled || g.players.some((q) => q.alive && q.id !== p && g.atWar(p, q.id))) return;
  const visible = g.explore(p);
  const targets = g.unitsOf(g.raids.faction).filter((u) => visible.has(g.tileOf(u)));
  const troops = g.unitsOf(p).filter((u) => UNIT_STATS[u.type].military && !UNIT_STATS[u.type].naval);
  for (const unit of troops.slice(1)) {
    if (unit.acted || unit.moves <= 0) continue;
    const from = g.tileOf(unit);
    const target = targets.filter((u) => g.units.includes(u) && hexDistance(from, g.tileOf(u)) <= 8)
      .sort((a, b) => hexDistance(from, g.tileOf(a)) - hexDistance(from, g.tileOf(b)))[0];
    if (!target) continue;
    const at = g.tileOf(target);
    if (g.attackPreview(unit, at).ok) { g.attack(unit, at); continue; }
    const plan = g.planRoute(unit, at);
    if (plan.ok) for (const step of plan.path) { if (!g.reachableFor(unit).has(step) || !g.moveUnit(unit, step)) break; }
    if (g.units.includes(target) && g.attackPreview(unit, at).ok) g.attack(unit, at);
  }
}
export function clearedCamp(g: GameState, unit: Unit, id: number): void {
  const data = raidState(g);
  if (g.unitById(id)) return;
  data.camps = data.camps.filter((c) => c.unitId !== id);
  if (isBarbarian(g, unit.owner)) return;
  g.players[unit.owner].gold += CAMP_REWARD;
  raidLog(g, `${g.players[unit.owner].name} cleared a barbarian camp (+${CAMP_REWARD} gold)`);
}
