// Game rules and turn flow. No Phaser imports in src/world.
import { generateMap, hexDistance } from './map';
import type { WorldMap } from './map';
import { CITY_REGEN, CLAIM_COST, GROWTH_NEED, LEVEL_HP, LEVEL_NAMES, MAX_HEIGHT, MAX_LEVEL, MAX_WALLS, WALL_STONE, YIELD, cityLevel, cityMaxHp, improvementFits, isLand, shieldMax } from './tile';
import type { PlayerId, Tile } from './tile';
import { JOB_COST, UNIT_STATS, findPath, reachable, routeTurns } from './units';
import type { Job, Training, Unit, UnitType } from './units';
import { runAI } from './ai';

export type Action = 'claim';

export type MapSize = 'small' | 'medium' | 'large' | 'huge';

export const MAP_SIZES: Record<MapSize, { label: string; width: number; height: number }> = {
  small: { label: 'Small', width: 20, height: 14 },
  medium: { label: 'Medium', width: 30, height: 20 },
  large: { label: 'Large', width: 44, height: 30 },
  huge: { label: 'Huge', width: 60, height: 40 },
};

export const MAX_OPPONENTS = 3;

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface DifficultyConfig {
  label: string;
  note: string;
  income: number; // AI gold multiplier
  troopsPerCity: number; // standing army size per city
  maxArmy: number;
  attackTurn: number; // won't march on anyone before this turn
  attackArmy: number; // troops needed before it goes to war
  garrison: number; // troops kept home while at war
  builders: number;
  maxWalls: number;
  smart: boolean; // counters your troops, focuses wounded units and weak cities, retreats to heal
  aggression: number; // chance it takes an attack it can make (smart AIs always do)
  focusHuman: boolean; // only marches on you
  landWin: boolean; // rivals can win by holding most of the land
  builderUses: number; // jobs a builder can do before it retires (0 = unlimited)
}

export const DIFFICULTY: Record<Difficulty, DifficultyConfig> = {
  easy: {
    label: 'Easy', note: 'Rivals grow slowly, keep small armies and rarely attack.',
    income: 0.7, troopsPerCity: 0.5, maxArmy: 3, attackTurn: 45, attackArmy: 3, garrison: 2,
    builders: 1, maxWalls: 1, smart: false, aggression: 0.5, focusHuman: false, landWin: false, builderUses: 0,
  },
  normal: {
    label: 'Normal', note: 'Rivals build up, defend, and attack once they have an army.',
    income: 1, troopsPerCity: 1, maxArmy: 8, attackTurn: 22, attackArmy: 4, garrison: 1,
    builders: 2, maxWalls: 2, smart: false, aggression: 0.85, focusHuman: false, landWin: true, builderUses: 3,
  },
  hard: {
    label: 'Hard', note: 'Rivals earn more, counter your troops, and come for you early.',
    income: 1.25, troopsPerCity: 1.5, maxArmy: 14, attackTurn: 14, attackArmy: 4, garrison: 1,
    builders: 3, maxWalls: 3, smart: true, aggression: 1, focusHuman: true, landWin: true, builderUses: 3,
  },
};

export interface GameOptions {
  seed: number;
  size: MapSize;
  opponents: number; // 0 = sandbox, no rivals and no win conditions
  freeBuild: boolean; // your actions cost no gold
  difficulty: Difficulty;
}

export interface Player {
  id: PlayerId;
  name: string;
  color: number;
  gold: number;
  stone: number;
  claims: number; // tiles bought with gold; each one makes the next pricier
  isAI: boolean;
  alive: boolean;
}

export interface Check {
  ok: boolean;
  cost: number;
  reason: string;
}

const PLAYER_INFO = [
  { name: 'You', color: 0x3b82f6 },
  { name: 'Red', color: 0xef4444 },
  { name: 'Gold', color: 0xeab308 },
  { name: 'Violet', color: 0xa855f7 },
];

export const CITY_INCOME = 3;
export const FARM_FOOD = 3;
export const CITY_FOOD = 2;
export const CAPITAL_FOOD = 3;
export const MINE_STONE = 2;
export const CAPITAL_INCOME = 5;
export const WIN_SHARE = 0.6;
export const CLAIM_RADIUS = 3; // can only buy land this many hexes (or fewer) from one of your cities
export const CLAIM_SCALE = 0.08; // +8% claim price per tile already bought
export const START_GOLD = 10;
export const CITY_SPACING = 3; // cities must be at least this many hexes apart
export const STRONG_BONUS = 1.5; // damage multiplier vs the type a unit is strong against
export const COUNTER_SHARE = 0.5; // melee defenders hit back for this share of their attack
export const CITY_COUNTER = 4; // cities hit melee attackers back for this (+2 per wall level)
export const KNIGHT_VS_WALLS = 0.5; // knights are bad at breaking walls
export const SIEGE_MULT = 1.5; // troops hit cities harder than units
export const CAPTURE_HP = 0.5; // captured cities start at this share of max hp
export const HOME_HEAL = 0.25; // units on their own land heal this share of max HP per turn
export const BIG_CLAIM_RADIUS = 4; // claim range once a city reaches level 3
export const GROWTH_SHARE_CAP = 3; // most spare food a single city can use for growth per turn

const CITY_NAMES = [
  'Oakvale', 'Stonebridge', 'Riverford', 'Highmoor', 'Ashford', 'Brightwater', 'Eldermere', 'Foxhollow',
  'Greywatch', 'Hollowmere', 'Ironwood', 'Kingsreach', 'Larkspur', 'Mistvale', 'Northwind', 'Oldcastle',
  'Pinecrest', 'Queensport', 'Redcliff', 'Silverbrook', 'Thornbury', 'Umberfield', 'Westmarch', 'Willowdale',
  'Amberlee', 'Bramblegate', 'Copperhill', 'Dunmore', 'Emberfall', 'Frostford', 'Goldenrod', 'Hawksmoor',
  'Ivyreach', 'Juniper', 'Kestrel Rock', 'Lindenholm', 'Marshgate', 'Nettlefield', 'Oxbow', 'Ravenhold',
];

// A planned multi-turn move. turnAt[i] = which turn (0 = this one) the unit reaches path[i].
export interface RoutePlan {
  ok: boolean;
  reason: string;
  path: Tile[];
  turnAt: number[];
  turns: number; // how many turns of walking
  nextTo: boolean; // ends next to the target (a unit or an enemy city) instead of on it
  arrived: boolean; // already there
}

export interface AttackPreview {
  ok: boolean;
  reason: string;
  dmg: number; // damage dealt
  counter: number; // damage taken back
  kind: 'unit' | 'city' | 'none';
}

const fail = (reason: string, cost = 0): Check => ({ ok: false, cost, reason });

export function defaultOptions(): GameOptions {
  return { seed: randomSeed(), size: 'medium', opponents: 1, freeBuild: false, difficulty: 'easy' };
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 1e9);
}

export class GameState {
  readonly options: GameOptions;
  map: WorldMap;
  players: Player[];
  turn = 1;
  current: PlayerId = 0;
  winner: PlayerId | null = null;
  winReason = '';
  log: string[] = [];
  units: Unit[] = [];
  nextUnitId = 1;
  training: Training[] = [];
  cityNames: Record<number, string> = {}; // tile index -> city name

  constructor(options: GameOptions) {
    this.options = {
      ...options,
      opponents: Math.max(0, Math.min(MAX_OPPONENTS, options.opponents)),
      difficulty: DIFFICULTY[options.difficulty] ? options.difficulty : 'normal',
    };
    const { width, height } = MAP_SIZES[this.options.size];
    this.map = generateMap(this.options.seed, width, height);
    this.players = [];
    for (let i = 0; i <= this.options.opponents; i++) {
      this.players.push({
        id: i,
        name: PLAYER_INFO[i].name,
        color: PLAYER_INFO[i].color,
        gold: START_GOLD,
        stone: 0,
        claims: 0,
        isAI: i !== 0,
        alive: true,
      });
    }
    this.placeCapitals();
    this.startTurn(0);
  }

  get seed(): number {
    return this.options.seed;
  }

  get sandbox(): boolean {
    return this.options.opponents === 0;
  }

  // ---------- queries ----------

  ownedTiles(p: PlayerId): Tile[] {
    return this.map.tiles.filter((t) => t.owner === p);
  }

  cityCount(p: PlayerId): number {
    return this.map.tiles.filter((t) => t.owner === p && t.city).length;
  }

  landCount(): number {
    return this.map.tiles.filter(isLand).length;
  }

  income(p: PlayerId): number {
    let gold = 0;
    for (const t of this.ownedTiles(p)) {
      gold += YIELD[t.terrain];
      if (t.capital) gold += CAPITAL_INCOME;
      else if (t.city) gold += CITY_INCOME;
      if (t.city) gold += cityLevel(t) - 1; // bigger cities pay more
    }
    return gold;
  }

  // Food is supply: farms and cities produce it, units use it up.
  foodMade(p: PlayerId): number {
    let food = 0;
    for (const t of this.ownedTiles(p)) {
      if (t.capital) food += CAPITAL_FOOD;
      else if (t.city) food += CITY_FOOD;
      if (t.city) food += cityLevel(t) - 1;
      if (t.improvement === 'farm') food += FARM_FOOD;
    }
    return food;
  }

  // Units in training already reserve their food.
  foodUsed(p: PlayerId): number {
    const units = this.unitsOf(p).reduce((sum, u) => sum + UNIT_STATS[u.type].food, 0);
    const queued = this.training.filter((t) => t.owner === p).reduce((sum, t) => sum + UNIT_STATS[t.type].food, 0);
    return units + queued;
  }

  trainingAt(city: Tile): Training | undefined {
    return this.training.find((t) => t.col === city.col && t.row === city.row);
  }

  unitCost(type: UnitType, p: PlayerId): number {
    return type === 'settler' ? this.cityCost(p) : UNIT_STATS[type].cost;
  }

  stoneIncome(p: PlayerId): number {
    return this.ownedTiles(p).filter((t) => t.improvement === 'mine').length * MINE_STONE;
  }

  unitsOf(p: PlayerId): Unit[] {
    return this.units.filter((u) => u.owner === p);
  }

  unitAt(tile: Tile): Unit | undefined {
    return this.units.find((u) => u.col === tile.col && u.row === tile.row);
  }

  unitById(id: number): Unit | undefined {
    return this.units.find((u) => u.id === id);
  }

  tileOf(unit: Unit): Tile {
    return this.map.get(unit.col, unit.row)!;
  }

  reachableFor(unit: Unit): Map<Tile, number> {
    if (unit.owner !== this.current) return new Map();
    const canCapture = UNIT_STATS[unit.type].canCapture === true;
    return reachable(this.map, unit, (t) => {
      if (this.unitAt(t)) return true;
      // Enemy cities block movement until destroyed; then only capture-capable troops can walk in.
      if (t.city && t.owner !== null && t.owner !== unit.owner) return t.hp > 0 || !canCapture;
      return false;
    });
  }

  // Your units that haven't done anything yet this turn and weren't told to hold.
  idleUnits(p: PlayerId): Unit[] {
    if (p !== this.current) return [];
    return this.unitsOf(p).filter(
      (u) => !u.hold && !u.goal && !u.acted && u.moves === UNIT_STATS[u.type].moves && this.reachableFor(u).size > 0,
    );
  }

  setHold(unit: Unit, hold: boolean): void {
    unit.hold = hold;
    if (hold) this.clearRoute(unit);
  }

  besieged(city: Tile): boolean {
    return this.units.some(
      (u) => UNIT_STATS[u.type].military && city.owner !== null && this.isEnemy(u.owner, city.owner) && hexDistance(this.tileOf(u), city) <= 2,
    );
  }

  isEnemy(owner: PlayerId | null, p: PlayerId): boolean {
    return owner !== null && owner !== p && this.players[owner].alive;
  }

  claimCost(tile: Tile, p: PlayerId): number {
    return Math.round(CLAIM_COST[tile.terrain] * (1 + this.players[p].claims * CLAIM_SCALE));
  }

  // ---------- city names ----------

  cityName(city: Tile): string {
    return this.cityNames[this.tileIndex(city)] ?? (city.capital ? 'Capital' : 'City');
  }

  renameCity(city: Tile, name: string): void {
    const clean = name.trim().slice(0, 24);
    if (!city.city || !clean) return;
    this.cityNames[this.tileIndex(city)] = clean;
  }

  private nameNewCity(city: Tile): void {
    const used = new Set(Object.values(this.cityNames));
    const free = CITY_NAMES.filter((n) => !used.has(n));
    const name = free.length ? free[Math.floor(Math.random() * free.length)] : `New Town ${Object.keys(this.cityNames).length + 1}`;
    this.cityNames[this.tileIndex(city)] = name;
  }

  // Old saves: give every city a name.
  nameMissingCities(): void {
    for (const c of this.cities()) if (!this.cityNames[this.tileIndex(c)]) this.nameNewCity(c);
  }

  // ---------- city land ----------

  tileIndex(t: Tile): number {
    return t.row * this.map.width + t.col;
  }

  // The city a piece of owned land belongs to.
  homeCity(t: Tile): Tile | null {
    if (t.home === null) return null;
    const c = this.map.tiles[t.home];
    return c && c.city ? c : null;
  }

  belongsTo(t: Tile, city: Tile): boolean {
    return t.home === this.tileIndex(city);
  }

  cityLand(city: Tile): Tile[] {
    const i = this.tileIndex(city);
    return this.map.tiles.filter((t) => t.home === i && t.owner === city.owner);
  }

  // How far out a city can own land: 3 hexes, 4 once it reaches level 3
  claimRadius(city: Tile): number {
    return cityLevel(city) >= 3 ? BIG_CLAIM_RADIUS : CLAIM_RADIUS;
  }

  inCityRange(tile: Tile, city: Tile): boolean {
    return hexDistance(tile, city) <= this.claimRadius(city);
  }

  // ---------- city growth ----------

  // Growth a city gains next turn: 1 plus its share of your spare food (capped)
  growthRate(city: Tile): number {
    if (city.owner === null) return 0;
    const mine = this.cities().filter((c) => c.owner === city.owner).length;
    const spare = Math.max(0, this.foodMade(city.owner) - this.foodUsed(city.owner));
    return 1 + Math.min(GROWTH_SHARE_CAP, mine > 0 ? spare / mine : 0);
  }

  growthNeed(city: Tile): number {
    const lvl = cityLevel(city);
    return lvl >= MAX_LEVEL ? 0 : GROWTH_NEED[lvl - 1];
  }

  private growCities(p: PlayerId): void {
    for (const c of this.cities()) {
      if (c.owner !== p || cityLevel(c) >= MAX_LEVEL || this.besieged(c)) continue;
      c.level = cityLevel(c);
      c.growth = Math.round((c.growth + this.growthRate(c)) * 10) / 10;
      const need = this.growthNeed(c);
      if (c.growth < need) continue;
      c.growth = Math.round((c.growth - need) * 10) / 10;
      c.level += 1;
      c.hp = Math.min(cityMaxHp(c), c.hp + LEVEL_HP);
      if (p === 0) this.addLog(`${this.cityName(c)} grew into a ${LEVEL_NAMES[c.level - 1]}`);
    }
  }

  // Which of p's cities would get this tile: the given city if it qualifies, else the nearest one
  // in range whose land the tile touches.
  claimingCity(tile: Tile, p: PlayerId, city?: Tile | null): Tile | null {
    const ok = (c: Tile) =>
      c.city && c.owner === p && this.inCityRange(tile, c) && this.map.neighbors(tile).some((n) => n.owner === p && this.belongsTo(n, c));
    if (city) return ok(city) ? city : null;
    let best: Tile | null = null;
    for (const c of this.cities()) {
      if (!ok(c)) continue;
      if (!best || hexDistance(tile, c) < hexDistance(tile, best)) best = c;
    }
    return best;
  }

  // Old saves: give every owned tile without a home to its owner's nearest city.
  assignMissingHomes(): void {
    for (const t of this.map.tiles) {
      if (t.owner === null || this.homeCity(t)?.owner === t.owner) continue;
      if (t.city) {
        t.home = this.tileIndex(t);
        continue;
      }
      let best: Tile | null = null;
      for (const c of this.cities()) {
        if (c.owner !== t.owner) continue;
        if (!best || hexDistance(t, c) < hexDistance(t, best)) best = c;
      }
      t.home = best ? this.tileIndex(best) : null;
    }
  }

  // Unowned land a city could still buy (ignores gold).
  openClaims(city: Tile): number {
    if (city.owner === null) return 0;
    let n = 0;
    for (const t of this.map.tiles) {
      if (t.owner !== null || !isLand(t) || !this.inCityRange(t, city)) continue;
      if (this.claimingCity(t, city.owner, city)) n++;
    }
    return n;
  }

  // Hexes from this tile to the closest city you own.
  cityDistance(tile: Tile, p: PlayerId): number {
    let best = Infinity;
    for (const c of this.cities()) if (c.owner === p) best = Math.min(best, hexDistance(c, tile));
    return best;
  }

  inClaimRange(tile: Tile, p: PlayerId): boolean {
    return this.cities().some((c) => c.owner === p && hexDistance(c, tile) <= this.claimRadius(c));
  }

  // Cached list of city tiles; cleared whenever something that can change cities happens.
  private cityList: Tile[] | null = null;

  cities(): Tile[] {
    if (!this.cityList) this.cityList = this.map.tiles.filter((t) => t.city);
    return this.cityList;
  }

  invalidate(): void {
    this.cityList = null;
  }

  cityCost(p: PlayerId): number {
    return 10 + 10 * this.cityCount(p);
  }

  touches(tile: Tile, p: PlayerId): boolean {
    return this.map.neighbors(tile).some((n) => n.owner === p);
  }

  // For claims, pass the city doing the buying; without one (AI) the best nearby city is used.
  check(action: Action, tile: Tile, p: PlayerId = this.current, city?: Tile | null): Check {
    if (this.winner !== null) return fail('Game over');
    const free = p === 0 && this.options.freeBuild;
    const gold = this.players[p].gold;
    const withGold = (cost: number): Check => {
      if (free) return { ok: true, cost: 0, reason: '' };
      return gold >= cost ? { ok: true, cost, reason: '' } : fail(`Need ${cost} gold`, cost);
    };

    switch (action) {
      case 'claim': {
        if (tile.owner === p) return fail('Already yours');
        // Owned land belongs to that player's cities: the only way to take it is to conquer the city.
        if (tile.owner !== null) return fail(`${this.players[tile.owner].name}'s land: conquer their city to take it`);
        if (!isLand(tile)) return fail("Can't claim water");
        if (city) {
          const d = hexDistance(tile, city);
          const max = this.claimRadius(city);
          if (d > max) return fail(`Too far: ${d} hexes from this city (max ${max}). Send a settler`);
          if (!this.claimingCity(tile, p, city)) return fail("Must touch this city's land");
          return withGold(this.claimCost(tile, p));
        }
        if (!this.touches(tile, p)) return fail('Must border your land');
        if (!this.inClaimRange(tile, p)) {
          return fail(`Too far: ${this.cityDistance(tile, p)} hexes from your nearest city (max ${CLAIM_RADIUS}). Send a settler`);
        }
        if (!this.claimingCity(tile, p)) return fail('Must touch the land of a city within range');
        return withGold(this.claimCost(tile, p));
      }
    }
  }

  // ---------- actions ----------

  // Claim only ever targets unowned land (see check): the tile joins the buying city's land.
  perform(action: Action, tile: Tile, p: PlayerId = this.current, city?: Tile | null): Check {
    const result = this.check(action, tile, p, city);
    if (!result.ok) return result;
    const player = this.players[p];
    player.gold -= result.cost;
    this.invalidate();

    switch (action) {
      case 'claim':
        tile.owner = p;
        tile.home = this.tileIndex(this.claimingCity(tile, p, city)!);
        player.claims += 1;
        break;
    }
    this.checkWin();
    return result;
  }

  // ---------- settlers ----------

  foundCheck(unit: Unit): Check {
    if (this.winner !== null) return fail('Game over');
    if (unit.type !== 'settler') return fail('Only settlers found cities');
    if (unit.owner !== this.current) return fail('Not your turn');
    const tile = this.tileOf(unit);
    if (tile.owner !== null && tile.owner !== unit.owner) return fail("Can't settle on someone else's land");
    if (tile.terrain === 'water' || tile.terrain === 'mountain') return fail("Can't settle here");
    if (tile.city) return fail('Already a city');
    if (this.cities().some((c) => hexDistance(c, tile) < CITY_SPACING)) {
      return fail(`Too close to a city (need ${CITY_SPACING}+ hexes)`);
    }
    return { ok: true, cost: 0, reason: '' };
  }

  foundCity(unit: Unit): Check {
    const c = this.foundCheck(unit);
    if (!c.ok) return c;
    const tile = this.tileOf(unit);
    const p = unit.owner;
    this.units = this.units.filter((u) => u !== unit);
    tile.owner = p;
    tile.home = this.tileIndex(tile);
    tile.city = true;
    tile.improvement = null;
    tile.level = 1;
    tile.growth = 0;
    tile.hp = cityMaxHp(tile);
    tile.walls = 0;
    tile.shield = 0;
    for (const n of this.map.neighbors(tile)) {
      if (n.owner === null && isLand(n)) {
        n.owner = p;
        n.home = tile.home;
      }
    }
    this.invalidate();
    this.nameNewCity(tile);
    this.addLog(`${this.players[p].name} founded ${this.cityName(tile)}`);
    this.checkWin();
    return c;
  }

  // ---------- units ----------

  recruitCheck(type: UnitType, city: Tile, p: PlayerId = this.current): Check {
    if (this.winner !== null) return fail('Game over');
    if (!city.city || city.owner !== p) return fail('Recruit from your own city');
    const stats = UNIT_STATS[type];
    if (stats.train > 0 && this.trainingAt(city)) return fail('City is already training');
    if (this.foodUsed(p) + stats.food > this.foodMade(p)) return fail('Not enough food: build farms');
    if (stats.train === 0 && !this.spawnTile(city)) return fail('No room around the city');
    if (p === 0 && this.options.freeBuild) return { ok: true, cost: 0, reason: '' };
    const cost = this.unitCost(type, p);
    const gold = this.players[p].gold;
    return gold >= cost ? { ok: true, cost, reason: '' } : fail(`Need ${cost} gold`, cost);
  }

  // Returns the new unit, 'queued' if it needs training time, or null if not allowed.
  recruit(type: UnitType, city: Tile, p: PlayerId = this.current): Unit | 'queued' | null {
    const c = this.recruitCheck(type, city, p);
    if (!c.ok) return null;
    this.players[p].gold -= c.cost;
    const stats = UNIT_STATS[type];
    if (stats.train > 0) {
      // Metropolis (level 5) trains a turn faster
      const turns = Math.max(1, stats.train - (cityLevel(city) >= MAX_LEVEL ? 1 : 0));
      this.training.push({ type, owner: p, col: city.col, row: city.row, turnsLeft: turns });
      return 'queued';
    }
    const at = this.spawnTile(city)!;
    const unit: Unit = { id: this.nextUnitId++, type, owner: p, col: at.col, row: at.row, moves: 0, acted: true, hp: stats.hp };
    const uses = DIFFICULTY[this.options.difficulty].builderUses;
    if (type === 'builder' && uses > 0) unit.uses = uses;
    this.units.push(unit);
    return unit;
  }

  // Count down training at the start of the owner's turn; finished units appear ready to act.
  private advanceTraining(p: PlayerId): void {
    const keep: Training[] = [];
    for (const t of this.training) {
      if (t.owner !== p) {
        keep.push(t);
        continue;
      }
      const city = this.map.get(t.col, t.row);
      if (!city || !city.city || city.owner !== p) continue; // city lost: training cancelled
      t.turnsLeft -= 1;
      const at = t.turnsLeft <= 0 ? this.spawnTile(city) : null;
      if (!at) {
        keep.push(t); // still training, or waiting for room
        continue;
      }
      const stats = UNIT_STATS[t.type];
      this.units.push({ id: this.nextUnitId++, type: t.type, owner: p, col: at.col, row: at.row, moves: stats.moves, acted: false, hp: stats.hp });
      if (p === 0) this.addLog(`${stats.name} ready`);
    }
    this.training = keep;
  }

  private spawnTile(city: Tile): Tile | null {
    if (!this.unitAt(city)) return city;
    return this.map.neighbors(city).find((n) => isLand(n) && n.owner === city.owner && !this.unitAt(n)) ?? null;
  }

  // keepRoute: a step of a planned route (a manual move cancels the route)
  moveUnit(unit: Unit, dest: Tile, keepRoute = false): boolean {
    if (this.winner !== null) return false;
    const left = this.reachableFor(unit).get(dest);
    if (left === undefined) return false;
    if (!keepRoute) this.clearRoute(unit);
    unit.col = dest.col;
    unit.row = dest.row;
    unit.moves = left;
    unit.hold = false;
    // Walking into a destroyed enemy city takes it.
    if (dest.city && this.isEnemy(dest.owner, unit.owner) && dest.hp <= 0) this.captureCity(dest, unit.owner);
    return true;
  }

  // ---------- multi-turn routes ----------
  // A unit with a goal walks there by itself at the start of each of your turns.
  // The path is re-planned every turn, so it reacts to whatever moved in the way.

  // Enemy units and standing enemy cities block planning. Your own units are ignored
  // (they usually move on) unless ownBlock is set, which is used after waiting too long.
  private routeBlocker(unit: Unit, ownBlock: boolean): (t: Tile) => boolean {
    const canCapture = UNIT_STATS[unit.type].canCapture === true;
    return (t) => {
      const u = this.unitAt(t);
      if (u && u !== unit && (ownBlock || u.owner !== unit.owner)) return true;
      if (t.city && t.owner !== null && t.owner !== unit.owner) return t.hp > 0 || !canCapture;
      return false;
    };
  }

  planRoute(unit: Unit, dest: Tile, ownBlock = false): RoutePlan {
    const fail = (reason: string, arrived = false): RoutePlan => ({ ok: false, reason, path: [], turnAt: [], turns: 0, nextTo: false, arrived });
    const from = this.tileOf(unit);
    if (dest === from) return fail('Already here', true);
    if (!isLand(dest)) return fail("Can't cross water");
    const blocked = this.routeBlocker(unit, ownBlock);
    const taken = (t: Tile) => {
      const u = this.unitAt(t);
      return !!u && u !== unit;
    };
    // Heading for a unit or an enemy city: stop on the best tile next to it (never attacks by itself)
    const nextTo = taken(dest) || blocked(dest);
    const goals = nextTo
      ? new Set(this.map.neighbors(dest).filter((n) => n === from || (isLand(n) && !blocked(n) && !taken(n))))
      : new Set([dest]);
    const path = findPath(this.map, from, goals, blocked);
    if (!path) return fail('No way to get there');
    if (!path.length) return fail('Already next to it', true);
    const turnAt = routeTurns(unit, path, from);
    return { ok: true, reason: '', path, turnAt, turns: new Set(turnAt).size, nextTo, arrived: false };
  }

  // Give the unit a goal and walk the first part right away.
  setRoute(unit: Unit, dest: Tile): RoutePlan {
    const plan = this.planRoute(unit, dest);
    if (!plan.ok || unit.owner !== this.current || this.winner !== null) return plan;
    unit.goal = { col: dest.col, row: dest.row };
    unit.waited = 0;
    unit.hold = false;
    this.followRoute(unit, true);
    return plan;
  }

  clearRoute(unit: Unit): void {
    unit.goal = undefined;
    unit.waited = undefined;
  }

  // The rest of the unit's current route (null = none or no way through right now)
  routeLeft(unit: Unit): RoutePlan | null {
    if (!unit.goal) return null;
    const dest = this.map.get(unit.goal.col, unit.goal.row);
    if (!dest) return null;
    const plan = this.planRoute(unit, dest, (unit.waited ?? 0) >= 2);
    return plan.ok ? plan : null;
  }

  private enemiesNear(unit: Unit): Unit[] {
    const here = this.tileOf(unit);
    return this.units.filter(
      (e) => UNIT_STATS[e.type].military && this.isEnemy(e.owner, unit.owner) && hexDistance(this.tileOf(e), here) <= 2,
    );
  }

  // manual: just set by the player, so enemies already in sight don't stop it (only new ones)
  private followRoute(unit: Unit, manual: boolean): 'moved' | 'blocked' | 'done' {
    const g = unit.goal;
    if (!g) return 'done';
    const name = UNIT_STATS[unit.type].name;
    const stop = (msg?: string): 'done' => {
      this.clearRoute(unit);
      if (msg && unit.owner === 0) this.addLog(msg);
      return 'done';
    };
    const dest = this.map.get(g.col, g.row);
    if (!dest) return stop();
    const seen = new Set(this.enemiesNear(unit));
    if (!manual && seen.size) return stop(`${name} stopped its route: enemy troops nearby`);
    const plan = this.planRoute(unit, dest, (unit.waited ?? 0) >= 2);
    if (!plan.ok) return plan.arrived ? stop(`${name} reached the end of its route`) : stop(`${name} stopped its route: no way through`);
    let moved = false;
    let blockedByUnit = false;
    for (const step of plan.path) {
      if (this.unitAt(step)) {
        blockedByUnit = true; // one of your units is in the way: wait for it
        break;
      }
      if (!this.reachableFor(unit).has(step)) break; // out of moves for this turn
      this.moveUnit(unit, step, true);
      moved = true;
      if (this.enemiesNear(unit).some((e) => !seen.has(e))) return stop(`${name} stopped its route: enemy troops spotted`);
    }
    if (moved) unit.waited = 0;
    const last = plan.path[plan.path.length - 1];
    if (unit.col === last.col && unit.row === last.row) return stop(`${name} reached the end of its route`);
    if (!moved && blockedByUnit) return 'blocked';
    return 'moved';
  }

  // Start of turn: move every unit on a route. Units stuck behind another one get a second try
  // once the others have moved, then count a wait (after 2 waits they route around your units).
  private runRoutes(p: PlayerId): void {
    let stuck = this.unitsOf(p).filter((u) => u.goal && this.followRoute(u, false) === 'blocked');
    stuck = stuck.filter((u) => u.goal && this.followRoute(u, false) === 'blocked');
    for (const u of stuck) {
      u.waited = (u.waited ?? 0) + 1;
      if (u.waited > 3) {
        this.clearRoute(u);
        if (p === 0) this.addLog(`${UNIT_STATS[u.type].name} stopped its route: stuck behind your units`);
      }
    }
  }

  // ---------- combat ----------

  private defenseMult(tile: Tile, defender: PlayerId): number {
    let m = 1;
    if (tile.terrain === 'hills') m *= 0.8;
    if (tile.terrain === 'mountain') m *= 0.7;
    if (tile.city && tile.owner === defender) m *= 0.75;
    return m;
  }

  private typeMult(attacker: UnitType, defender: UnitType): number {
    return UNIT_STATS[attacker].strongVs === defender ? STRONG_BONUS : 1;
  }

  attackPreview(unit: Unit, target: Tile): AttackPreview {
    const no = (reason: string): AttackPreview => ({ ok: false, reason, dmg: 0, counter: 0, kind: 'none' });
    if (this.winner !== null) return no('Game over');
    const stats = UNIT_STATS[unit.type];
    if (!stats.military) return no("This unit can't fight");
    if (unit.owner !== this.current) return no('Not your turn');
    if (unit.acted) return no('Already attacked this turn');
    const from = this.tileOf(unit);
    const dist = hexDistance(from, target);
    if (dist < 1 || dist > stats.range) return no(`Out of range (${stats.range})`);
    const melee = dist === 1 && stats.range === 1;
    const defender = this.unitAt(target);
    if (defender) {
      if (defender.owner === unit.owner) return no('Your own unit');
      if (!this.isEnemy(defender.owner, unit.owner)) return no('Nothing to attack');
      const d = UNIT_STATS[defender.type];
      if (!d.military) return { ok: true, reason: '', dmg: defender.hp, counter: 0, kind: 'unit' };
      const dmg = Math.max(1, Math.round(stats.atk * this.typeMult(unit.type, defender.type) * this.defenseMult(target, defender.owner)));
      const counter = melee && dmg < defender.hp
        ? Math.round(d.atk * COUNTER_SHARE * this.typeMult(defender.type, unit.type) * this.defenseMult(from, unit.owner))
        : 0;
      return { ok: true, reason: '', dmg, counter, kind: 'unit' };
    }
    if (target.city && this.isEnemy(target.owner, unit.owner)) {
      if (target.hp <= 0 && target.shield <= 0) return no(stats.canCapture ? 'Destroyed: move in to capture' : 'Destroyed: send a swordsman or knight');
      const wallMult = unit.type === 'knight' && target.shield > 0 ? KNIGHT_VS_WALLS : 1;
      const dmg = Math.max(1, Math.round(stats.atk * SIEGE_MULT * wallMult));
      const counter = dist === 1 ? CITY_COUNTER + 2 * target.walls : 0;
      return { ok: true, reason: '', dmg, counter, kind: 'city' };
    }
    return no('Nothing to attack');
  }

  attack(unit: Unit, target: Tile): AttackPreview {
    const pv = this.attackPreview(unit, target);
    if (!pv.ok) return pv;
    const a = this.players[unit.owner];
    unit.acted = true;
    unit.moves = 0;
    unit.hold = false;
    this.clearRoute(unit);
    if (pv.kind === 'unit') {
      const defender = this.unitAt(target)!;
      const dName = `${defender.owner === 0 ? 'your' : `a ${this.players[defender.owner].name}`} ${UNIT_STATS[defender.type].name}`;
      defender.hp -= pv.dmg;
      if (defender.hp <= 0) {
        this.units = this.units.filter((u) => u !== defender);
        this.addLog(`${a.name} destroyed ${dName}`);
      }
    } else {
      const absorbed = Math.min(target.shield, pv.dmg);
      target.shield -= absorbed;
      target.hp = Math.max(0, target.hp - (pv.dmg - absorbed));
      if (target.hp === 0) this.addLog(`${a.name} broke ${this.whose(target.owner!)} ${target.capital ? 'capital' : 'city'} ${this.cityName(target)}`);
    }
    unit.hp -= pv.counter;
    if (unit.hp <= 0) {
      this.units = this.units.filter((u) => u !== unit);
      this.addLog(`${a.name} lost a ${UNIT_STATS[unit.type].name}`);
      return pv;
    }
    // A melee capture-capable unit that destroys a city walks right in.
    if (pv.kind === 'city' && target.hp === 0 && hexDistance(this.tileOf(unit), target) === 1 && UNIT_STATS[unit.type].canCapture && !this.unitAt(target)) {
      unit.col = target.col;
      unit.row = target.row;
      this.captureCity(target, unit.owner);
    }
    return pv;
  }

  // The captor gets the city plus all the land that belongs to it.
  // Taking a capital knocks the owner out entirely.
  private captureCity(city: Tile, captor: PlayerId): void {
    const prev = city.owner;
    if (prev === null) return;
    for (const t of this.cityLand(city)) t.owner = captor;
    const wasCapital = city.capital;
    city.owner = captor;
    city.capital = false;
    city.level = Math.max(1, cityLevel(city) - 1); // war shrinks a city
    city.growth = 0;
    city.hp = Math.round(cityMaxHp(city) * CAPTURE_HP);
    city.shield = 0;
    this.invalidate();
    if (wasCapital) this.eliminate(prev, captor);
    else this.addLog(`${this.players[captor].name} captured ${this.cityName(city)} from ${prev === 0 ? 'you' : this.players[prev].name}`);
    this.checkWin();
  }

  jobCheck(unit: Unit, job: Job, target: Tile): Check {
    if (this.winner !== null) return fail('Game over');
    const p = unit.owner;
    if (p !== this.current) return fail('Not your turn');
    if (unit.type !== 'builder') return fail('Only builders can do that');
    if (unit.acted) return fail('Already worked this turn');
    const here = this.tileOf(unit);
    const terraform = job === 'raise' || job === 'lower';
    if (terraform) {
      if (target !== here && !this.map.neighbors(here).includes(target)) return fail('Pick the builder tile or one next to it');
      if (target.owner !== null && target.owner !== p) return fail("Can't change enemy land");
    } else {
      if (target !== here) return fail('Builders work the tile they stand on');
      if (target.owner !== p) return fail('Build on your own land');
    }
    switch (job) {
      case 'farm':
        if (target.improvement === 'farm') return fail('Already a farm');
        if (!improvementFits(target, 'farm')) return fail('Farms need grass or sand');
        break;
      case 'mine':
        if (target.improvement === 'mine') return fail('Already a mine');
        if (!improvementFits(target, 'mine')) return fail('Mines need hills or mountains');
        break;
      case 'road':
        if (target.city) return fail('Cities already count as roads');
        if (target.road) return fail('Already a road');
        break;
      case 'walls': {
        if (!target.city) return fail('Walls go on a city: stand the builder on it');
        if (target.walls >= MAX_WALLS) return fail('Walls are maxed');
        const stone = this.wallStoneCost(target);
        const free = p === 0 && this.options.freeBuild;
        if (!free && this.players[p].stone < stone) return fail(`Need ${stone} stone (build mines)`);
        break;
      }
      case 'raise':
        if (target.height >= MAX_HEIGHT) return fail('Already a mountain');
        if (target.city && target.height + 1 >= MAX_HEIGHT) return fail("Cities can't sit on mountains");
        break;
      case 'lower':
        if (target.height <= 0) return fail('Already water');
        if (target.city && target.height <= 1) return fail('That would flood the city');
        if (target.height === 1 && this.unitAt(target)) return fail('A unit would drown');
        break;
    }
    const cost = JOB_COST[job];
    if (p === 0 && this.options.freeBuild) return { ok: true, cost: 0, reason: '' };
    return this.players[p].gold >= cost ? { ok: true, cost, reason: '' } : fail(`Need ${cost} gold`, cost);
  }

  // Walls are a city action: pay stone (from mines) plus a little gold, one level at a time.
  wallCheck(city: Tile, p: PlayerId = this.current): Check {
    if (this.winner !== null) return fail('Game over');
    if (p !== this.current) return fail('Not your turn');
    if (!city.city || city.owner !== p) return fail('Build walls in your own city');
    if (city.walls >= MAX_WALLS) return fail('Walls are maxed');
    const stone = this.wallStoneCost(city);
    if (p === 0 && this.options.freeBuild) return { ok: true, cost: 0, reason: '' };
    if (this.players[p].stone < stone) return fail(`Need ${stone} stone (build mines)`);
    const cost = JOB_COST.walls;
    return this.players[p].gold >= cost ? { ok: true, cost, reason: '' } : fail(`Need ${cost} gold`, cost);
  }

  buildWalls(city: Tile, p: PlayerId = this.current): Check {
    const c = this.wallCheck(city, p);
    if (!c.ok) return c;
    const player = this.players[p];
    player.gold -= c.cost;
    if (!(p === 0 && this.options.freeBuild)) player.stone -= this.wallStoneCost(city);
    city.walls += 1;
    city.shield = shieldMax(city); // new walls go up at full strength
    return c;
  }

  wallStoneCost(city: Tile): number {
    return WALL_STONE[Math.min(city.walls, MAX_WALLS - 1)];
  }

  doJob(unit: Unit, job: Job, target: Tile): Check {
    const c = this.jobCheck(unit, job, target);
    if (!c.ok) return c;
    this.players[unit.owner].gold -= c.cost;
    this.invalidate();
    unit.hold = false;
    this.clearRoute(unit);
    switch (job) {
      case 'farm':
      case 'mine':
        target.improvement = job;
        break;
      case 'road':
        target.road = true;
        break;
      case 'walls':
        if (!(unit.owner === 0 && this.options.freeBuild)) this.players[unit.owner].stone -= this.wallStoneCost(target);
        target.walls += 1;
        target.shield = shieldMax(target); // new walls go up at full strength
        break;
      case 'raise':
        this.map.raiseHeight(target);
        break;
      case 'lower':
        this.map.lowerHeight(target);
        break;
    }
    unit.acted = true;
    unit.moves = 0;
    if (unit.uses !== undefined) {
      unit.uses -= 1;
      if (unit.uses <= 0) {
        this.units = this.units.filter((u) => u !== unit);
        if (unit.owner === 0) this.addLog('A builder finished its last job and retired');
      }
    }
    return c;
  }

  endTurn(): void {
    if (this.winner !== null) return;
    const n = this.players.length;
    // Advance through AI players until it's the human's turn again.
    for (let guard = 0; guard < n * 2; guard++) {
      const next = (this.current + 1) % n;
      if (next === 0) this.turn += 1;
      this.current = next;
      const pl = this.players[next];
      if (!pl.alive) continue;
      this.startTurn(next);
      if (!pl.isAI) return;
      this.runAI(next);
      if (this.winner !== null) return;
    }
  }

  // ---------- internals ----------

  private startTurn(p: PlayerId): void {
    const mult = this.players[p].isAI ? DIFFICULTY[this.options.difficulty].income : 1;
    this.players[p].gold += Math.round(this.income(p) * mult);
    this.players[p].stone += this.stoneIncome(p);
    this.growCities(p);
    // Cities heal and walls rebuild a little every turn, unless enemy troops are close (siege).
    for (const t of this.cities()) {
      if (t.owner !== p || this.besieged(t)) continue;
      t.hp = Math.min(cityMaxHp(t), t.hp + CITY_REGEN);
      t.shield = Math.min(shieldMax(t), t.shield + CITY_REGEN);
    }
    for (const u of this.unitsOf(p)) {
      const stats = UNIT_STATS[u.type];
      u.moves = stats.moves;
      u.acted = false;
      // Units heal on their own land (25% of max HP per turn), not in the field
      if (this.tileOf(u).owner === p) u.hp = Math.min(stats.hp, u.hp + Math.ceil(stats.hp * HOME_HEAL));
    }
    this.runRoutes(p);
    this.advanceTraining(p);
  }

  private whose(p: PlayerId): string {
    return p === 0 ? 'your' : `${this.players[p].name}'s`;
  }

  private addLog(msg: string): void {
    this.log.push(`T${this.turn}: ${msg}`);
    if (this.log.length > 6) this.log.shift();
  }

  // Taking a capital knocks that player out; their land goes to the captor.
  private eliminate(loser: PlayerId, captor: PlayerId): void {
    const l = this.players[loser];
    const c = this.players[captor];
    l.alive = false;
    this.units = this.units.filter((u) => u.owner !== loser);
    this.training = this.training.filter((t) => t.owner !== loser);
    for (const t of this.map.tiles) {
      if (t.owner === loser) t.owner = captor;
    }
    this.addLog(`${c.name} captured ${this.whose(loser)} capital!`);
  }

  private checkWin(): void {
    if (this.winner !== null || this.sandbox) return;
    if (!this.players[0].alive) {
      const top = this.players.filter((p) => p.alive).sort((a, b) => this.ownedTiles(b.id).length - this.ownedTiles(a.id).length)[0];
      this.winner = top ? top.id : 1;
      this.winReason = 'Your capital fell';
      return;
    }
    const rivalsLeft = this.players.some((p) => p.id !== 0 && p.alive);
    if (!rivalsLeft) {
      this.winner = 0;
      this.winReason = 'Every rival capital is yours';
      return;
    }
    const land = this.landCount();
    for (const pl of this.players) {
      if (!pl.alive || (pl.isAI && !DIFFICULTY[this.options.difficulty].landWin)) continue;
      const share = this.ownedTiles(pl.id).length / land;
      if (share >= WIN_SHARE) {
        this.winner = pl.id;
        this.winReason = `${pl.name === 'You' ? 'You control' : `${pl.name} controls`} ${Math.round(share * 100)}% of the land`;
        return;
      }
    }
  }

  private placeCapitals(): void {
    const capitals: Tile[] = [];
    const { width, height } = this.map;
    for (const pl of this.players) {
      let best: Tile | null = null;
      let bestScore = -Infinity;
      for (const t of this.map.tiles) {
        if (t.terrain !== 'grass' || t.owner !== null) continue;
        const room = this.map.neighbors(t).filter((n) => isLand(n) && n.terrain !== 'mountain').length;
        let score: number;
        if (capitals.length === 0) {
          // Human: decent spot left of center
          const dx = t.col - width * 0.3;
          const dy = t.row - height * 0.5;
          score = room - Math.hypot(dx, dy) * 0.15;
        } else {
          const minDist = Math.min(...capitals.map((c) => hexDistance(c, t)));
          score = room * 0.5 + minDist;
        }
        if (score > bestScore) {
          bestScore = score;
          best = t;
        }
      }
      if (!best) {
        // No grass left: force a small island somewhere
        best = this.map.get(Math.floor(Math.random() * width), Math.floor(Math.random() * height))!;
        best.height = 2;
        best.terrain = 'grass';
      }
      best.owner = pl.id;
      best.home = this.tileIndex(best);
      best.city = true;
      best.capital = true;
      best.level = 1;
      best.hp = cityMaxHp(best);
      for (const n of this.map.neighbors(best)) {
        if (n.terrain === 'water') {
          n.height = 1;
          n.terrain = 'sand';
        }
        if (n.owner === null) {
          n.owner = pl.id;
          n.home = best.home;
        }
      }
      this.nameNewCity(best);
      capitals.push(best);
    }
  }

  private runAI(p: PlayerId): void {
    runAI(this, p);
  }
}
