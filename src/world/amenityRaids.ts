import type { Check, GameState } from './game';
import { BUILDINGS } from './tile';
import type { Building, Tile } from './tile';
import type { Unit } from './units';
import { damaged, raidLog, raidState } from './raidState';
export const AMENITY_LOOT = 5, MARKET_LOOT = 8, REPAIR_TURNS = 2;
export function amenityTarget(g: GameState, tile: Tile): { city: Tile; building: Building } | null {
  const city = g.homeCity(tile);
  if (!city || tile.owner === null || city.owner !== tile.owner) return null;
  const index = g.tileIndex(tile);
  const building = city.buildings.find((b) => city.sites[b] === index && !damaged(g, city, b));
  return building ? { city, building } : null;
}
export function pillageAmenity(g: GameState, unit: Unit): Check | null {
  const target = amenityTarget(g, g.tileOf(unit));
  if (!target) return null;
  const check = g.pillageCheck(unit);
  if (!check.ok) return check;
  const { city, building } = target, data = raidState(g), index = g.tileIndex(city);
  (data.damaged[index] ?? (data.damaged[index] = [])).push(building);
  const victim = g.players[city.owner!];
  const loot = building === 'market' ? Math.min(MARKET_LOOT, Math.max(0, victim.gold)) : AMENITY_LOOT;
  if (building === 'market') victim.gold -= loot;
  g.players[unit.owner].gold += loot;
  unit.acted = true; unit.moves = 0; unit.hold = false;
  g.clearRoute(unit); g.invalidate();
  raidLog(g, `${g.players[unit.owner].name} pillaged ${g.cityName(city)}'s ${BUILDINGS[building].name} (+${loot} gold). Repair it to restore its effects.`);
  return { ok: true, cost: 0, reason: `+${loot} gold` };
}
export const repairCost = (g: GameState, city: Tile, b: Building): number =>
  city.owner !== null && g.isFree(city.owner) ? 0 : Math.max(5, Math.ceil(BUILDINGS[b].cost / 4));
const no = (reason: string, cost = 0): Check => ({ ok: false, cost, reason });
export function repairCheck(g: GameState, city: Tile, b: Building, p = g.current): Check {
  if (g.winner !== null) return no('Game over');
  if (p !== g.current) return no('Not your turn');
  if (!city.city || city.owner !== p) return no('Repair your own city');
  if (!city.buildings.includes(b) || !damaged(g, city, b)) return no('Not pillaged');
  const busy = g.busyWith(city);
  if (busy) return no(`Busy ${busy}`);
  const site = city.sites[b], tile = site !== undefined && site >= 0 ? g.map.tiles[site] : null;
  const enemy = tile ? g.unitAt(tile) : null;
  if (enemy && g.isEnemy(enemy.owner, p)) return no('Clear the enemy from this amenity first');
  const cost = repairCost(g, city, b);
  return g.players[p].gold >= cost ? { ok: true, cost, reason: '' } : no(`Need ${cost} gold`, cost);
}
export function startRepair(g: GameState, city: Tile, b: Building, p = g.current): Check {
  const check = repairCheck(g, city, b, p);
  if (!check.ok) return check;
  g.players[p].gold -= check.cost;
  raidState(g).repairs[g.tileIndex(city)] = { building: b, owner: p, turns: REPAIR_TURNS };
  return check;
}
export function advanceRepairs(g: GameState, p: number): void {
  const data = raidState(g);
  for (const [key, repair] of Object.entries(data.repairs)) {
    const index = Number(key), city = g.map.tiles[index];
    if (!city?.city || city.owner !== repair.owner || !city.buildings.includes(repair.building)) {
      delete data.repairs[index]; continue;
    }
    if (repair.owner !== p) continue;
    const site = city.sites[repair.building], at = site !== undefined && site >= 0 ? g.map.tiles[site] : null;
    const enemy = at ? g.unitAt(at) : null;
    if (enemy && g.isEnemy(enemy.owner, p)) continue;
    if (--repair.turns > 0) continue;
    data.damaged[index] = (data.damaged[index] ?? []).filter((b) => b !== repair.building);
    delete data.repairs[index]; g.invalidate();
    raidLog(g, `${g.cityName(city)} repaired its ${BUILDINGS[repair.building].name}`);
  }
}
