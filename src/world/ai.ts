// Rival AI. Plays only through public GameState methods, same rules as the human.
// No Phaser imports in src/world.
import { CITY_SPACING, DIFFICULTY } from './game';
import type { GameState } from './game';
import { hexDistance } from './map';
import { MAX_WALLS, YIELD, improvementFits, isLand } from './tile';
import type { PlayerId, Tile } from './tile';
import { TROOPS, UNIT_STATS } from './units';
import type { Unit, UnitType } from './units';

export function runAI(g: GameState, p: PlayerId): void {
  const cfg = DIFFICULTY[g.options.difficulty];
  aiTroops(g, p);
  if (!alive(g, p)) return;
  aiSettlers(g, p);
  aiBuilders(g, p);
  aiQueue(g, p);
  // Whatever gold is left (minus savings for the army) buys land.
  const reserve = cfg.troopsPerCity > 0 && armyWanted(g, p) > troops(g, p).length ? 25 : 0;
  for (let i = 0; i < 80 && alive(g, p); i++) {
    const tile = pickClaim(g, p, reserve + settlerReserve(g, p));
    if (!tile) return;
    g.perform('claim', tile, p);
  }
}

const alive = (g: GameState, p: PlayerId) => g.winner === null && g.players[p].alive;

function troops(g: GameState, p: PlayerId): Unit[] {
  return g.unitsOf(p).filter((u) => UNIT_STATS[u.type].military);
}

function queued(g: GameState, p: PlayerId, pred: (t: UnitType) => boolean): number {
  return g.training.filter((t) => t.owner === p && pred(t.type)).length;
}

function myCities(g: GameState, p: PlayerId): Tile[] {
  return g.cities().filter((c) => c.owner === p);
}

function enemyCities(g: GameState, p: PlayerId): Tile[] {
  return g.cities().filter((c) => g.isEnemy(c.owner, p));
}

function enemyTroops(g: GameState, p: PlayerId): Unit[] {
  return g.units.filter((u) => UNIT_STATS[u.type].military && g.isEnemy(u.owner, p));
}

function armyWanted(g: GameState, p: PlayerId): number {
  const cfg = DIFFICULTY[g.options.difficulty];
  if (g.sandbox) return 0;
  const n = Math.ceil(myCities(g, p).length * cfg.troopsPerCity);
  // Grow a bigger army once it's time to go to war.
  const war = g.turn >= cfg.attackTurn ? cfg.attackArmy : 0;
  return Math.min(cfg.maxArmy, Math.max(n, war));
}

// ---------- recruiting ----------

function settlerReserve(g: GameState, p: PlayerId): number {
  return wantsSettler(g, p) ? Math.floor(g.cityCost(p) / 2) : 0;
}

function wantsSettler(g: GameState, p: PlayerId): boolean {
  const busy = g.unitsOf(p).some((u) => u.type === 'settler') || queued(g, p, (t) => t === 'settler') > 0;
  return !busy && g.cityCount(p) < 15;
}

function pickTroopType(g: GameState, p: PlayerId): UnitType {
  const cfg = DIFFICULTY[g.options.difficulty];
  const mine = troops(g, p);
  if (cfg.smart) {
    // Counter whatever enemy troops are most common
    const counts: Record<string, number> = {};
    for (const e of enemyTroops(g, p)) counts[e.type] = (counts[e.type] ?? 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= 2) {
      const counter = TROOPS.find((t) => UNIT_STATS[t].strongVs === top[0]);
      if (counter) return counter;
    }
  }
  // Default mix: mostly swordsmen (they can capture), about a third archers, some knights
  const archers = mine.filter((u) => u.type === 'archer').length + queued(g, p, (t) => t === 'archer');
  if (archers < Math.floor((mine.length + 1) / 3)) return 'archer';
  const knights = mine.filter((u) => u.type === 'knight').length + queued(g, p, (t) => t === 'knight');
  if (g.players[p].gold >= 60 && mine.length >= 2 && knights < Math.floor((mine.length + 1) / 4)) return 'knight';
  return 'swordsman';
}

function aiQueue(g: GameState, p: PlayerId): void {
  const cfg = DIFFICULTY[g.options.difficulty];
  const cities = myCities(g, p);
  const builders = g.unitsOf(p).filter((u) => u.type === 'builder').length;
  const threatened = cities.some((c) => enemyTroops(g, p).some((e) => hexDistance(g.tileOf(e), c) <= 4));
  for (const city of cities) {
    if (g.trainingAt(city)) continue;
    const army = troops(g, p).length + queued(g, p, (t) => UNIT_STATS[t].military);
    // Danger first: defend before expanding
    if ((threatened || army < armyWanted(g, p)) && army < cfg.maxArmy) {
      const type = pickTroopType(g, p);
      if (g.recruitCheck(type, city, p).ok) {
        g.recruit(type, city, p);
        continue;
      }
    }
    if (wantsSettler(g, p) && g.recruitCheck('settler', city, p).ok) {
      g.recruit('settler', city, p);
      continue;
    }
  }
  // Builders are instant
  if (builders < Math.min(cfg.builders, cities.length) && g.players[p].gold >= 15 + settlerReserve(g, p)) {
    const city = cities.find((c) => g.recruitCheck('builder', c, p).ok);
    if (city) g.recruit('builder', city, p);
  }
}

// ---------- movement helpers ----------

// Step toward a goal tile, trying to end `keep` hexes away from it (archers keep 2).
function stepToward(g: GameState, unit: Unit, goal: Tile, keep = 0): void {
  const here = g.tileOf(unit);
  const score = (t: Tile) => {
    const d = hexDistance(t, goal);
    return d < keep ? 50 + (keep - d) : d - keep;
  };
  let best: Tile | null = null;
  let bestScore = score(here);
  for (const [t] of g.reachableFor(unit)) {
    const s = score(t);
    if (s < bestScore || (s === bestScore && best && t.terrain === 'hills')) {
      bestScore = s;
      best = t;
    }
  }
  if (best) g.moveUnit(unit, best);
}

// ---------- builders ----------

function builderJob(g: GameState, p: PlayerId, t: Tile): 'farm' | 'mine' | 'walls' | null {
  if (t.owner !== p) return null;
  const cfg = DIFFICULTY[g.options.difficulty];
  if (t.city) {
    if (t.walls < Math.min(cfg.maxWalls, MAX_WALLS) && g.players[p].stone >= g.wallStoneCost(t)) return 'walls';
    return null;
  }
  if (t.improvement) return null;
  const hungry = g.foodUsed(p) + 3 > g.foodMade(p);
  const mines = g.ownedTiles(p).filter((x) => x.improvement === 'mine').length;
  if (improvementFits(t, 'mine') && mines < 1 + Math.floor(myCities(g, p).length / 2) && cfg.maxWalls > 0) return 'mine';
  if (improvementFits(t, 'farm') && (hungry || t.terrain === 'grass')) return 'farm';
  return null;
}

function aiBuilders(g: GameState, p: PlayerId): void {
  for (const unit of g.unitsOf(p).filter((u) => u.type === 'builder')) {
    const here = g.tileOf(unit);
    let job = builderJob(g, p, here);
    if (job && g.jobCheck(unit, job, here).ok) {
      g.doJob(unit, job, here);
      continue;
    }
    // Walk to the nearest tile that needs work (walls rank first, then mines, then farms)
    let target: Tile | null = null;
    let best = Infinity;
    for (const t of g.ownedTiles(p)) {
      const j = builderJob(g, p, t);
      if (!j || (g.unitAt(t) && t !== here)) continue;
      const d = hexDistance(here, t) - (j === 'walls' ? 3 : j === 'mine' ? 1 : 0);
      if (d < best) {
        best = d;
        target = t;
      }
    }
    if (!target) continue;
    stepToward(g, unit, target);
    const now = g.tileOf(unit);
    job = builderJob(g, p, now);
    if (job && g.jobCheck(unit, job, now).ok) g.doJob(unit, job, now);
  }
}

// ---------- troops ----------

function bestAttack(g: GameState, unit: Unit): Tile | null {
  const here = g.tileOf(unit);
  const cand = new Set<Tile>(g.map.neighbors(here));
  if (UNIT_STATS[unit.type].range >= 2) for (const n of [...cand]) for (const m of g.map.neighbors(n)) if (m !== here) cand.add(m);
  const smart = DIFFICULTY[g.options.difficulty].smart;
  let best: Tile | null = null;
  let bestScore = -Infinity;
  for (const t of cand) {
    const pv = g.attackPreview(unit, t);
    if (!pv.ok) continue;
    if (pv.counter >= unit.hp) continue; // suicide
    const target = g.unitAt(t);
    let s = pv.dmg - pv.counter;
    if (target && pv.dmg >= target.hp) s += 25; // kill
    if (pv.kind === 'city') s += 5 + (t.capital ? 3 : 0);
    if (smart && target) s += (1 - target.hp / UNIT_STATS[target.type].hp) * 10; // finish wounded units
    if (s > bestScore) {
      bestScore = s;
      best = t;
    }
  }
  return best;
}

function aiTroops(g: GameState, p: PlayerId): void {
  const cfg = DIFFICULTY[g.options.difficulty];
  const army = troops(g, p);
  if (army.length === 0) return;
  const cities = myCities(g, p);
  const enemies = enemyTroops(g, p);

  // A city is under threat if enemy troops are close
  const threatened = cities.filter((c) => enemies.some((e) => hexDistance(g.tileOf(e), c) <= 3));

  // Pick a war target: nearest enemy city (Hard also weighs how damaged it is)
  let warTarget: Tile | null = null;
  const atWar = g.turn >= cfg.attackTurn && army.length >= cfg.attackArmy;
  if (atWar && cities.length > 0) {
    const home = cities.find((c) => c.capital) ?? cities[0];
    let best = Infinity;
    for (const c of enemyCities(g, p)) {
      if (cfg.focusHuman && c.owner !== 0) continue;
      const d = hexDistance(home, c);
      const s = cfg.smart ? d + (c.hp + c.shield) / 25 : d;
      if (s < best) {
        best = s;
        warTarget = c;
      }
    }
  }
  const garrison = threatened.length > 0 ? 0 : Math.min(cities.length, cfg.garrison);
  let kept = 0;

  for (const unit of army) {
    if (!alive(g, p) || !g.units.includes(unit)) continue;
    const stats = UNIT_STATS[unit.type];
    const keep = stats.range >= 2 ? 2 : 0;

    // 1. Hit something if we can do it right where we are
    const first = bestAttack(g, unit);
    if (first && (cfg.smart || Math.random() < cfg.aggression)) {
      g.attack(unit, first);
      continue;
    }

    // 2. Decide where to go
    let goal: Tile | null = null;
    const hurt = unit.hp < stats.hp * 0.35;
    if (hurt && cfg.smart && cities.length) {
      goal = nearest(g.tileOf(unit), cities);
    } else if (threatened.length) {
      const c = nearest(g.tileOf(unit), threatened)!;
      goal = nearest(c, enemies.map((e) => g.tileOf(e))) ?? c;
    } else if (warTarget && kept >= garrison) {
      goal = warTarget;
    } else if (cities.length) {
      kept++;
      goal = nearest(g.tileOf(unit), cities);
      if (goal && hexDistance(g.tileOf(unit), goal) <= 1) goal = null; // already home
    }

    if (goal) {
      // Walk into a broken city to capture it
      if (goal.city && g.isEnemy(goal.owner, p) && goal.hp <= 0 && g.reachableFor(unit).has(goal)) {
        g.moveUnit(unit, goal);
        continue;
      }
      stepToward(g, unit, goal, goal.city && g.isEnemy(goal.owner, p) ? Math.max(keep, 1) : keep);
    }

    // 3. Attack after moving
    if (!g.units.includes(unit) || unit.acted) continue;
    const after = bestAttack(g, unit);
    if (after) g.attack(unit, after);
  }
}

function nearest(from: Tile, tiles: Tile[]): Tile | null {
  let best: Tile | null = null;
  let d = Infinity;
  for (const t of tiles) {
    const dt = hexDistance(from, t);
    if (dt < d) {
      d = dt;
      best = t;
    }
  }
  return best;
}

// ---------- settlers ----------

function settleScore(g: GameState, tile: Tile, p: PlayerId): number {
  if (tile.terrain === 'water' || tile.terrain === 'mountain' || tile.city) return -1;
  if (tile.owner !== null && tile.owner !== p) return -1;
  if (g.cities().some((c) => hexDistance(c, tile) < CITY_SPACING)) return -1;
  let room = 0;
  for (const n of g.map.neighbors(tile)) {
    if (n.owner === null && isLand(n) && n.terrain !== 'mountain') room += 1;
  }
  return room;
}

function aiSettlers(g: GameState, p: PlayerId): void {
  for (const unit of g.unitsOf(p).filter((u) => u.type === 'settler')) {
    const here = g.tileOf(unit);
    let target: Tile | null = null;
    let best = -Infinity;
    for (const t of g.map.tiles) {
      const sc = settleScore(g, t, p);
      if (sc < 2) continue;
      const v = sc - hexDistance(here, t) * 0.8;
      if (v > best) {
        best = v;
        target = t;
      }
    }
    if (!target) {
      if (g.foundCheck(unit).ok) g.foundCity(unit);
      continue;
    }
    if (target !== here) stepToward(g, unit, target);
    if (g.tileOf(unit) === target && g.foundCheck(unit).ok) g.foundCity(unit);
  }
}

// ---------- land ----------

function pickClaim(g: GameState, p: PlayerId, reserve: number): Tile | null {
  const gold = g.players[p].gold;
  let best: Tile | null = null;
  let bestScore = 0;
  for (const t of g.map.tiles) {
    if (t.owner !== null || !isLand(t)) continue;
    const c = g.check('claim', t, p);
    if (!c.ok || gold - c.cost < reserve) continue;
    const score = ((YIELD[t.terrain] + 0.5) / c.cost) * 10;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}
