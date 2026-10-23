// Idempotent compatibility adapter. The feature's data/actions/AI stay in pure world modules.
// The existing engine and its migration logic remain unchanged; all method adaptation is centralized here.
import { GameState } from './game';
import { hexDistance } from './map';
import { BUILDINGS, BARRACKS_SPEED, cityLevel, MAX_LEVEL } from './tile';
import type { Tile } from './tile';
import { UNIT_STATS } from './units';
import { advanceRepairs, amenityTarget, pillageAmenity, repairCheck, startRepair } from './amenityRaids';
import { clearedCamp, huntBarbarians, runBarbarians } from './barbarians';
import { activeAmenity, campFor, damaged, isBarbarian, raidState } from './raidState';
interface TurnHooks { startTurn(p: number): void; runAI(p: number): void }
let installed = false;
export function installRaidRules(): void {
  if (installed) return;
  installed = true;
  const proto = GameState.prototype, income = proto.grossIncome;
  proto.grossIncome = function(p) { raidState(this); return income.call(this, p); };
  const fog = Object.getOwnPropertyDescriptor(proto, 'fog')!;
  Object.defineProperty(proto, 'fog', { ...fog, get(this: GameState) { return this.raids?.enabled || fog.get!.call(this); } });
  const enemy = proto.isEnemy;
  proto.isEnemy = function(owner, p) {
    if (owner !== null && owner !== p && (isBarbarian(this, owner) || isBarbarian(this, p))) return true;
    return enemy.call(this, owner, p);
  };
  const war = proto.atWar;
  proto.atWar = function(a, b) { return a !== b && (isBarbarian(this, a) || isBarbarian(this, b)) || war.call(this, a, b); };
  const busy = proto.busyWith;
  proto.busyWith = function(city) {
    const repair = this.raids?.repairs[this.tileIndex(city)];
    return repair && repair.owner === city.owner ? `repairing the ${BUILDINGS[repair.building].name} (${repair.turns}t)` : busy.call(this, city);
  };
  const mill = proto.millFood;
  proto.millFood = function(city, worked) { return damaged(this, city, 'mill') ? 0 : mill.call(this, city, worked); };
  const fish = proto.fisheryFood;
  proto.fisheryFood = function(tile) {
    const city = this.homeCity(tile);
    return fish.call(this, tile) - (city && damaged(this, city, 'harbor') && city.buildings.includes('harbor') && !this.blockaded(city) ? 1 : 0);
  };
  const train = proto.trainTurns;
  proto.trainTurns = function(type, city) {
    if (!damaged(this, city, 'barracks')) return train.call(this, type, city);
    const stats = UNIT_STATS[type];
    if (stats.train <= 0) return 0;
    return Math.max(1, stats.train - (cityLevel(city) >= MAX_LEVEL ? 1 : 0) - (stats.military && activeAmenity(this, city, 'barracks') ? BARRACKS_SPEED : 0));
  };
  const recruit = proto.recruitCheck;
  proto.recruitCheck = function(type, city, p = this.current) {
    const need = UNIT_STATS[type].needs;
    if (need && damaged(this, city, need)) return { ok: false, cost: 0, reason: `Repair the ${BUILDINGS[need].name} first` };
    return recruit.call(this, type, city, p);
  };
  const pillageCheckBase = proto.pillageCheck;
  proto.pillageCheck = function(unit) {
    const result = pillageCheckBase.call(this, unit);
    return !result.ok && result.reason === 'Nothing here to pillage' && amenityTarget(this, this.tileOf(unit))
      ? { ok: true, cost: 0, reason: '' } : result;
  };
  const target = proto.pillageTarget;
  proto.pillageTarget = function(tile) {
    const a = amenityTarget(this, tile);
    if (!a) return target.call(this, tile);
    return { name: BUILDINGS[a.building].name, gold: a.building === 'market' ? Math.min(8, Math.max(0, this.players[a.city.owner!].gold)) : 5 };
  };
  const pillage = proto.pillage;
  proto.pillage = function(unit) { return pillageAmenity(this, unit) ?? pillage.call(this, unit); };
  const preview = proto.attackPreview;
  proto.attackPreview = function(unit, tile) {
    if (campFor(this, unit.id)) return { ok: false, reason: "Camps don't attack", dmg: 0, counter: 0, kind: 'none' };
    if (isBarbarian(this, unit.owner) && tile.city) return { ok: false, reason: 'Raiders do not attack or capture cities', dmg: 0, counter: 0, kind: 'none' };
    const result = preview.call(this, unit, tile), defender = this.unitAt(tile);
    return result.ok && defender && campFor(this, defender.id) ? { ...result, counter: 0 } : result;
  };
  const attack = proto.attack;
  proto.attack = function(unit, tile) {
    const defender = this.unitAt(tile), campId = defender && campFor(this, defender.id) ? defender.id : null;
    const result = attack.call(this, unit, tile);
    if (result.ok && campId !== null) clearedCamp(this, unit, campId);
    return result;
  };
  const reach = proto.reachableFor;
  proto.reachableFor = function(unit) {
    if (campFor(this, unit.id)) return new Map();
    const result = reach.call(this, unit);
    if (isBarbarian(this, unit.owner)) for (const tile of result.keys()) if (tile.city) result.delete(tile);
    return result;
  };
  const move = proto.moveUnit;
  proto.moveUnit = function(unit, tile, keepRoute = false) {
    if (campFor(this, unit.id) || isBarbarian(this, unit.owner) && tile.city) return false;
    return move.call(this, unit, tile, keepRoute);
  };
  const claim = proto.check;
  proto.check = function(action, tile, p = this.current, city) {
    const u = this.unitAt(tile);
    if (action === 'claim' && u && campFor(this, u.id)) return { ok: false, cost: 0, reason: 'Clear the barbarian camp first' };
    return claim.call(this, action, tile, p, city);
  };
  const border = proto.borderPick;
  proto.borderPick = function(city) {
    if (!this.raids?.camps.length) return border.call(this, city);
    if (city.owner === null) return null;
    const value: Record<string, number> = { grass: 3, hills: 3, sand: 2, mountain: 1, water: 1 };
    let best: Tile | null = null, score = -Infinity;
    for (const tile of this.map.tiles) {
      if (tile.owner !== null || !this.inCityRange(tile, city) || !this.claimingCity(tile, city.owner, city)) continue;
      const unit = this.unitAt(tile);
      if (unit && campFor(this, unit.id)) continue;
      const s = value[tile.terrain] - hexDistance(tile, city) * .6;
      if (s > score) { score = s; best = tile; }
    }
    return best;
  };
  const siege = proto.besieged;
  proto.besieged = function(city) {
    const units = this.units;
    try { this.units = units.filter((u) => !campFor(this, u.id)); return siege.call(this, city); }
    finally { this.units = units; }
  };
  const end = proto.endTurn;
  proto.endTurn = function() { const before = this.turn; end.call(this); if (this.turn !== before && this.winner === null) runBarbarians(this); };
  const hooks = proto as unknown as TurnHooks, start = hooks.startTurn;
  hooks.startTurn = function(this: GameState, p) { advanceRepairs(this, p); start.call(this, p); };
  const ai = hooks.runAI;
  hooks.runAI = function(this: GameState, p) {
    const data = raidState(this);
    for (const city of this.cities()) {
      if (city.owner !== p) continue;
      const b = (data.damaged[this.tileIndex(city)] ?? []).find((b) => repairCheck(this, city, b, p).ok);
      if (b) startRepair(this, city, b, p);
    }
    ai.call(this, p);
    if (this.winner === null && this.players[p].alive) huntBarbarians(this, p);
  };
}
export function repairStatus(g: GameState, city: Tile): string[] {
  const data = raidState(g), i = g.tileIndex(city);
  return (data.damaged[i] ?? []).map((b) => `${BUILDINGS[b].name}: ${data.repairs[i]?.building === b ? `repairing (${data.repairs[i].turns}t)` : 'pillaged, effects disabled'}`);
}
