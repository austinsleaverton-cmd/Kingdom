import type { GameState } from './game';
import { BUILDING_ORDER } from './tile';
import type { Building } from './tile';
import { campFor, raidState } from './raidState';
import type { RaidState } from './raidState';
// Additive save section. Unknown/malformed entries are ignored without deleting valid kingdom data.
export function saveRaids(g: GameState): RaidState {
  return JSON.parse(JSON.stringify(raidState(g))) as RaidState;
}
export function loadRaids(g: GameState, raw: unknown): void {
  const fresh = raidState(g);
  if (!raw || typeof raw !== 'object' || (raw as Partial<RaidState>).version !== 1) {
    fresh.initialized = false;
    return;
  }
  const data = raw as Partial<RaidState>, faction = fresh.faction;
  const integer = (n: unknown, fallback: number) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : fallback;
  fresh.enabled = g.options.barbarians !== false;
  fresh.initialized = data.initialized === true;
  fresh.lastRound = Math.min(g.turn, integer(data.lastRound, g.turn));
  fresh.nextCamp = integer(data.nextCamp, g.turn + 12);
  fresh.camps = [];
  const seen = new Set<number>();
  if (Array.isArray(data.camps)) for (const c of data.camps) {
    if (!c || !Number.isSafeInteger(c.unitId) || seen.has(c.unitId)) continue;
    const u = g.unitById(c.unitId);
    if (!u || u.owner !== faction || u.type !== 'catapult' || g.tileOf(u).city || g.tileOf(u).terrain === 'water') continue;
    seen.add(u.id);
    fresh.camps.push({ unitId: u.id, nextRaid: integer(c.nextRaid, g.turn + 1) });
    u.moves = 0; u.acted = true;
  }
  fresh.damaged = {};
  fresh.repairs = {};
  for (const city of g.cities()) {
    const index = g.tileIndex(city), list = data.damaged?.[index];
    if (Array.isArray(list)) fresh.damaged[index] = BUILDING_ORDER.filter((b) => city.buildings.includes(b) && list.includes(b));
    const job = data.repairs?.[index];
    if (!job || job.owner !== city.owner || !fresh.damaged[index]?.includes(job.building as Building)) continue;
    if (city.project || city.wallTurns > 0 || g.trainingAt(city)) continue;
    if (typeof job.turns !== 'number' || !Number.isSafeInteger(job.turns) || job.turns < 1 || job.turns > 2) continue;
    fresh.repairs[index] = { building: job.building, owner: job.owner, turns: job.turns };
  }
  // Invalid structure references must not turn stationary camp proxies into roaming catapults.
  g.units = g.units.filter((u) => u.owner !== faction || u.type === 'swordsman' || !!campFor(g, u.id));
}
