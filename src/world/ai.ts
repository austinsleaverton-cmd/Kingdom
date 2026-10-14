// Rival AI. Plays only through public GameState methods, same rules as the human.
// No Phaser imports in src/world.
import { CITY_SPACING, DIFFICULTY, MIN_WAR_TURNS } from './game';
import type { GameState } from './game';
import { hexDistance } from './map';
import { BUILDINGS, MAX_WALLS, YIELD, cityLevel, cityMaxHp, improvementFits, isLand } from './tile';
import type { Building, PlayerId, Tile } from './tile';
import { PALISADE_STONE, TROOPS, UNIT_STATS } from './units';
import type { Job, Unit, UnitType } from './units';

export function runAI(g: GameState, p: PlayerId): void {
  const cfg = DIFFICULTY[g.options.difficulty];
  aiDiplomacy(g, p);
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

// Cities of kingdoms we're at war with
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
  // Grow a bigger army once it's time to go to war (or someone already started one).
  const fighting = g.players.some((q) => q.alive && g.atWar(p, q.id));
  const war = g.turn >= cfg.attackTurn || fighting ? cfg.attackArmy : 0;
  return Math.min(cfg.maxArmy, Math.max(n, war));
}

// ---------- war and peace ----------

// Rough military strength: troops (health and punch) plus cities
function power(g: GameState, p: PlayerId): number {
  return troops(g, p).reduce((s, u) => s + u.hp + UNIT_STATS[u.type].atk * 2, 0) + g.cityCount(p) * 15;
}

// Would AI kingdom `ai` agree to peace with `other` right now? It depends on how the war is going:
// who's stronger, whose cities are hurting, how long it has dragged on, unrest at home, and difficulty.
export function aiPeaceVerdict(g: GameState, ai: PlayerId, other: PlayerId): { accept: boolean; reason: string } {
  const cfg = DIFFICULTY[g.options.difficulty];
  const name = g.players[ai].name;
  const ratio = power(g, other) / Math.max(1, power(g, ai)); // above 1: the other side is stronger
  const cities = myCities(g, ai);
  const hurting = cities.some((c) => c.hp < cityMaxHp(c) * 0.5);
  const winning = g.cities().some((c) => c.owner === other && c.hp < cityMaxHp(c) * 0.5);
  let chance = 0.35 + Math.max(0, g.warTurns(ai, other) - MIN_WAR_TURNS) * 0.04; // war weariness
  chance += Math.max(-0.3, Math.min(0.35, (ratio - 1) * 0.4));
  if (hurting) chance += 0.25;
  if (winning) chance -= 0.3;
  chance += 0.08 * cities.filter((c) => g.mood(c) === 'unhappy' || g.mood(c) === 'angry').length;
  if (g.options.difficulty === 'easy') chance += 0.15;
  if (g.options.difficulty === 'hard') chance -= 0.15;
  if (cfg.focusHuman && !g.players[other].isAI) chance -= 0.1;
  chance = Math.max(0.05, Math.min(0.95, chance));
  if (Math.random() < chance) {
    return { accept: true, reason: hurting || ratio > 1.2 ? `${name} is glad to stop the fighting.` : `${name} agrees to peace.` };
  }
  const reason = winning
    ? `${name} smells victory and wants to keep fighting.`
    : ratio < 0.8
      ? `${name} thinks it's winning this war.`
      : `${name} isn't ready to stop yet.`;
  return { accept: false, reason };
}

// Start wars when the army is ready, and make peace with other AI kingdoms when it suits both
function aiDiplomacy(g: GameState, p: PlayerId): void {
  if (g.sandbox) return;
  const cfg = DIFFICULTY[g.options.difficulty];
  for (const q of g.players) {
    if (q.id === p || !q.alive || !q.isAI || !g.atWar(p, q.id)) continue;
    if (g.peaceCheck(p, q.id).ok && aiPeaceVerdict(g, p, q.id).accept) g.offerPeace(p, q.id);
  }
  // One war at a time, and not before the difficulty allows it
  if (g.turn < cfg.attackTurn || troops(g, p).length < cfg.attackArmy) return;
  if (g.players.some((q) => q.alive && g.atWar(p, q.id))) return;
  if (!cfg.smart && Math.random() > cfg.aggression) return; // doesn't always pounce the moment it can
  const target = pickWarTarget(g, p);
  if (target !== null) g.declareWar(p, target);
}

// Nearest kingdom we're allowed to declare war on (Hard only goes after people)
function pickWarTarget(g: GameState, p: PlayerId): PlayerId | null {
  const cfg = DIFFICULTY[g.options.difficulty];
  const cities = myCities(g, p);
  const home = cities.find((c) => c.capital) ?? cities[0];
  if (!home) return null;
  let best: PlayerId | null = null;
  let bestD = Infinity;
  for (const c of g.cities()) {
    const q = c.owner;
    if (q === null || q === p || !g.players[q].alive) continue;
    if (cfg.focusHuman && g.players[q].isAI) continue;
    if (!g.warCheck(p, q).ok) continue;
    const d = hexDistance(home, c);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best;
}

// ---------- recruiting ----------

function settlerReserve(g: GameState, p: PlayerId): number {
  return wantsSettler(g, p) ? Math.floor(g.cityCost(p) / 2) : 0;
}

function wantsSettler(g: GameState, p: PlayerId): boolean {
  const busy = g.unitsOf(p).some((u) => u.type === 'settler') || queued(g, p, (t) => t === 'settler') > 0;
  return !busy && g.cityCount(p) < 15;
}

function pickTroopType(g: GameState, p: PlayerId, city: Tile): UnitType {
  const cfg = DIFFICULTY[g.options.difficulty];
  const mine = troops(g, p).filter((u) => !UNIT_STATS[u.type].naval);
  // Knights need horses (pastures) and a big enough city, archers need bows (forests)
  const canHave = (t: UnitType) =>
    (UNIT_STATS[t].minLevel ?? 0) <= cityLevel(city) &&
    (t === 'knight' ? g.horsesUsed(p) < g.horsesMade(p) : t === 'archer' ? g.bowsUsed(p) < g.bowsMade(p) : true);
  if (cfg.smart) {
    // Counter whatever enemy troops are most common nearby
    const counts: Record<string, number> = {};
    for (const e of enemyTroops(g, p)) counts[e.type] = (counts[e.type] ?? 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= 2) {
      const counter = TROOPS.find((t) => UNIT_STATS[t].strongVs === top[0]);
      if (counter && canHave(counter)) return counter;
    }
  }
  // A couple of Catapults for a war (Normal and Hard): they crack palisades and walls
  if (g.options.difficulty !== 'easy' && g.players.some((q) => q.alive && g.atWar(p, q.id))) {
    const cats = mine.filter((u) => u.type === 'catapult').length + queued(g, p, (t) => t === 'catapult');
    const st = UNIT_STATS.catapult;
    if (cats < 2 && mine.length >= 3 && (st.minLevel ?? 0) <= cityLevel(city) && g.players[p].stone >= (st.stone ?? 0)) return 'catapult';
  }
  // Default mix: mostly swordsmen (they can capture), some archers, knights when rich
  const archers = mine.filter((u) => u.type === 'archer').length + queued(g, p, (t) => t === 'archer');
  if (archers < Math.floor((mine.length + 1) / 3) && canHave('archer')) return 'archer';
  const knights = mine.filter((u) => u.type === 'knight').length + queued(g, p, (t) => t === 'knight');
  if (g.players[p].gold >= 60 && mine.length >= 2 && knights < Math.floor((mine.length + 1) / 4) && canHave('knight')) return 'knight';
  return 'swordsman';
}

function aiQueue(g: GameState, p: PlayerId): void {
  const cfg = DIFFICULTY[g.options.difficulty];
  const cities = myCities(g, p);
  const builders = g.unitsOf(p).filter((u) => u.type === 'builder').length;
  const threatened = cities.some((c) => enemyTroops(g, p).some((e) => hexDistance(g.tileOf(e), c) <= 4));
  for (const city of cities) {
    if (g.busyWith(city)) continue;
    const army = troops(g, p).length + queued(g, p, (t) => UNIT_STATS[t].military);
    // Danger first: defend before expanding
    if ((threatened || army < armyWanted(g, p)) && army < cfg.maxArmy) {
      const type = pickTroopType(g, p, city);
      if (g.recruitCheck(type, city, p).ok && (threatened || g.players[p].gold - g.unitCost(type, p) >= 0)) {
        g.recruit(type, city, p);
        continue;
      }
    }
    if (wantsSettler(g, p) && g.recruitCheck('settler', city, p).ok) {
      g.recruit('settler', city, p);
      continue;
    }
    // A Trireme or two to guard the coast once there's a Harbor
    if (!g.sandbox && city.buildings.includes('harbor') && boats(g, p) < Math.min(2, harbors(g, p)) && g.recruitCheck('trireme', city, p).ok) {
      if (g.players[p].gold - g.unitCost('trireme', p) >= settlerReserve(g, p)) {
        g.recruit('trireme', city, p);
        continue;
      }
    }
    // Walls when there's stone for them
    if (city.walls < Math.min(cfg.maxWalls, MAX_WALLS) && g.wallCheck(city, p).ok) {
      g.buildWalls(city, p);
      continue;
    }
    // Nothing else to do: build an amenity if there's spare gold
    const b = pickBuilding(g, p, city);
    if (b && g.players[p].gold - BUILDINGS[b].cost >= settlerReserve(g, p) + 10) g.startBuilding(city, b, p);
  }
  // Builders are instant
  if (builders < Math.min(cfg.builders, cities.length) && g.players[p].gold >= 15 + settlerReserve(g, p)) {
    const city = cities.find((c) => g.recruitCheck('builder', c, p).ok);
    if (city) g.recruit('builder', city, p);
  }
}

function boats(g: GameState, p: PlayerId): number {
  return g.unitsOf(p).filter((u) => UNIT_STATS[u.type].naval).length + queued(g, p, (t) => !!UNIT_STATS[t].naval);
}

function harbors(g: GameState, p: PlayerId): number {
  return myCities(g, p).filter((c) => c.buildings.includes('harbor')).length;
}

// Unhappy cities get temples and arenas first, hungry kingdoms a granary, otherwise markets
function pickBuilding(g: GameState, p: PlayerId, city: Tile): Building | null {
  const mood = g.mood(city);
  const hungry = g.foodUsed(p) + 2 > g.foodMade(p);
  const order: Building[] =
    mood === 'unhappy' || mood === 'angry'
      ? ['temple', 'arena', 'park', 'market', 'granary', 'harbor']
      : hungry
        ? ['granary', 'harbor', 'market', 'temple', 'park', 'arena']
        : ['market', 'temple', 'harbor', 'granary', 'park', 'arena'];
  return order.find((b) => g.buildCheck(city, b, p).ok) ?? null;
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

function builderJob(g: GameState, p: PlayerId, t: Tile): Job | null {
  if (t.owner !== p) return null;
  const cfg = DIFFICULTY[g.options.difficulty];
  if (t.city) return null; // walls are a city action now (see aiQueue)
  if (wantsPalisade(g, p, t)) return 'palisade';
  if (t.improvement) return null;
  // Only build what the city has people to work (one spare is fine)
  const home = g.homeCity(t);
  if (home && g.improvedCount(home) > home.pop) return null;
  const hungry = g.foodUsed(p) + 3 > g.foodMade(p);
  const mines = g.ownedTiles(p).filter((x) => x.improvement === 'mine').length;
  if (improvementFits(t, 'mine') && mines < 1 + Math.floor(myCities(g, p).length / 2) && cfg.maxWalls > 0) return 'mine';
  if (improvementFits(t, 'farm') && hungry) return 'farm';
  if (improvementFits(t, 'fishery') && hungry) return 'fishery';
  // A few pastures and forests so it can field knights and archers
  const want = 1 + Math.floor(myCities(g, p).length / 3);
  const count = (imp: string) => g.ownedTiles(p).filter((x) => x.improvement === imp).length;
  if (improvementFits(t, 'pasture') && count('pasture') < want) return 'pasture';
  if (improvementFits(t, 'forest') && count('forest') < want) return 'forest';
  if (improvementFits(t, 'farm') && t.terrain === 'grass') return 'farm';
  if (improvementFits(t, 'fishery') && home?.buildings.includes('harbor')) return 'fishery';
  return null;
}

// Normal and Hard ring their capital with palisades once they're at war or enemies come close
function wantsPalisade(g: GameState, p: PlayerId, t: Tile): boolean {
  if (g.options.difficulty === 'easy' || t.palisade || !isLand(t) || t.city) return false;
  if (g.players[p].stone < PALISADE_STONE) return false;
  const cap = myCities(g, p).find((c) => c.capital);
  if (!cap || hexDistance(cap, t) !== 1) return false;
  const fighting = g.players.some((q) => q.alive && g.atWar(p, q.id));
  return fighting || enemyTroops(g, p).some((e) => hexDistance(g.tileOf(e), cap) <= 5);
}

function aiBuilders(g: GameState, p: PlayerId): void {
  for (const unit of g.unitsOf(p).filter((u) => u.type === 'builder')) {
    const here = g.tileOf(unit);
    let job = builderJob(g, p, here);
    if (job && g.jobCheck(unit, job, here).ok) {
      g.doJob(unit, job, here);
      continue;
    }
    // Walk to the nearest tile that needs work (mines rank a bit higher)
    let target: Tile | null = null;
    let best = Infinity;
    for (const t of g.ownedTiles(p)) {
      const j = builderJob(g, p, t);
      if (!j || (g.unitAt(t) && t !== here)) continue;
      const d = hexDistance(here, t) - (j === 'mine' ? 1 : 0);
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

// palisades: also consider breaking palisades (after moving, or for catapults that can't move first)
function bestAttack(g: GameState, unit: Unit, palisades = true): Tile | null {
  const here = g.tileOf(unit);
  const cand = new Set<Tile>(g.map.neighbors(here));
  if (UNIT_STATS[unit.type].range >= 2) for (const n of [...cand]) for (const m of g.map.neighbors(n)) if (m !== here) cand.add(m);
  const smart = DIFFICULTY[g.options.difficulty].smart;
  let best: Tile | null = null;
  let bestScore = -Infinity;
  for (const t of cand) {
    const pv = g.attackPreview(unit, t);
    if (!pv.ok) continue;
    if (pv.kind === 'palisade' && !palisades) continue;
    if (pv.counter >= unit.hp) continue; // suicide
    const target = g.unitAt(t);
    let s = pv.dmg - pv.counter;
    if (target && pv.dmg >= target.hp) s += 25; // kill
    if (pv.kind === 'city') s += 5 + (t.capital ? 3 : 0);
    if (pv.kind === 'palisade') s -= 4; // only when nothing better is in reach
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

  // Pick a war target among kingdoms we're at war with: nearest (easy/normal) or weakest-nearby (hard)
  let warTarget: Tile | null = null;
  const marching = army.length >= cfg.attackArmy;
  if (marching && cities.length > 0) {
    const home = cities.find((c) => c.capital) ?? cities[0];
    let best = Infinity;
    for (const c of enemyCities(g, p)) {
      if (cfg.focusHuman && (c.owner === null || g.players[c.owner].isAI)) continue;
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
    const first = bestAttack(g, unit, !!stats.setup);
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
      const c = nearest(g.tileOf(unit), threatened);
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

    // 3. Attack after moving, or wreck what it's standing on
    if (!g.units.includes(unit) || unit.acted) continue;
    const after = bestAttack(g, unit);
    if (after) g.attack(unit, after);
    else if (cfg.pillage && g.pillageCheck(unit).ok) g.pillage(unit);
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
  if (tile.terrain !== 'grass' || tile.city) return -1; // cities need grass
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
