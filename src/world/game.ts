// Game rules and turn flow. No Phaser imports in src/world.
import { generateMap, hexDistance } from './map';
import type { WorldMap } from './map';
import { BUILDINGS, CITY_REGEN, CLAIM_COST, LEVEL_HP, LEVEL_NAMES, LEVEL_POP, MAX_HEIGHT, MAX_LEVEL, MAX_WALLS, WALL_STONE, WALL_TURNS, YIELD, cityLevel, cityMaxHp, improvementFits, isLand, shieldMax } from './tile';
import { IMPROVEMENT_NAME, levelFromPop, popNeed } from './tile';
import type { Building, Improvement, PlayerId, Tile } from './tile';
import { JOB_COST, PALISADE_COVER, PALISADE_HP, PALISADE_RANGE, PALISADE_REGEN, PALISADE_STONE, UNIT_STATS, canEnter, findPath, moveMode, reachable, routeTurns } from './units';
import type { Job, Training, Unit, UnitType } from './units';
import { aiPeaceVerdict, runAI } from './ai';

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
  attackTurn: number; // won't declare war on anyone before this turn
  attackArmy: number; // troops needed before it goes to war
  garrison: number; // troops kept home while at war
  builders: number;
  maxWalls: number;
  smart: boolean; // counters your troops, focuses wounded units and weak cities, retreats to heal
  aggression: number; // chance it takes an attack it can make (smart AIs always do)
  focusHuman: boolean; // only marches on you
  landWin: boolean; // rivals can win by holding most of the land
  builderUses: number; // jobs a builder can do before it retires (0 = unlimited)
  pillage: boolean; // AI troops wreck farms and roads on enemy land
}

export const DIFFICULTY: Record<Difficulty, DifficultyConfig> = {
  easy: {
    label: 'Easy', note: 'Rivals grow slowly, keep small armies and rarely attack.',
    income: 0.7, troopsPerCity: 0.5, maxArmy: 3, attackTurn: 45, attackArmy: 3, garrison: 2,
    builders: 1, maxWalls: 1, smart: false, aggression: 0.5, focusHuman: false, landWin: false, builderUses: 0, pillage: false,
  },
  normal: {
    label: 'Normal', note: 'Rivals build up, defend, and attack once they have an army.',
    income: 1, troopsPerCity: 1, maxArmy: 8, attackTurn: 22, attackArmy: 4, garrison: 1,
    builders: 2, maxWalls: 2, smart: false, aggression: 0.85, focusHuman: false, landWin: true, builderUses: 5, pillage: true,
  },
  hard: {
    label: 'Hard', note: 'Rivals earn more, counter your troops, and come for you early.',
    income: 1.25, troopsPerCity: 1.5, maxArmy: 14, attackTurn: 14, attackArmy: 4, garrison: 1,
    builders: 3, maxWalls: 3, smart: true, aggression: 1, focusHuman: true, landWin: true, builderUses: 2, pillage: true,
  },
};

export interface GameOptions {
  seed: number;
  size: MapSize;
  opponents: number; // 0 = sandbox, no rivals and no win conditions
  freeBuild: boolean; // human players' actions cost no gold
  simple?: boolean; // easy rules for people: no city size, food, horse/bow or unhappiness limits (AI plays normally)
  difficulty: Difficulty;
  seats?: Seat[]; // who plays each kingdom (first is always a person). Missing = you vs AI rivals
}

// One kingdom at the start screen: a person (hot-seat, passing the device) or the computer.
export interface Seat {
  name: string;
  human: boolean;
}

export const MAX_NAME = 16;

// The seats for a game: from the menu, or (older saves) you plus AI rivals.
export function seatsFor(o: GameOptions): Seat[] {
  const n = Math.max(1, Math.min(MAX_OPPONENTS + 1, o.seats?.length ? o.seats.length : o.opponents + 1));
  const out: Seat[] = [];
  for (let i = 0; i < n; i++) {
    const s = o.seats?.[i];
    const human = i === 0 ? true : s ? s.human : false;
    const name = (s?.name ?? '').trim().slice(0, MAX_NAME) || (i === 0 && !o.seats ? 'You' : PLAYER_INFO[i].name);
    out.push({ name, human });
  }
  return out;
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

export const PLAYER_INFO = [
  { name: 'You', color: 0x3b82f6 },
  { name: 'Red', color: 0xef4444 },
  { name: 'Gold', color: 0xeab308 },
  { name: 'Violet', color: 0xa855f7 },
];

export const CITY_INCOME = 3;
export const FARM_FOOD = 2;
export const KNIGHTS_PER_PASTURE = 2; // each pasture raises horses for this many knights
export const ARCHERS_PER_FOREST = 2; // each forest gives bows for this many archers
export const CITY_FOOD = 2;
export const CAPITAL_FOOD = 3;
export const MINE_STONE = 2;
export const FISHERY_FOOD = 2; // a worked fishery feeds this many
export const HARBOR_FISH = 1; // extra food per worked fishery when its city has a Harbor
export const CAPITAL_INCOME = 5;
export const WIN_SHARE = 0.6;
export const CLAIM_RADIUS = 3; // can only buy land this many hexes (or fewer) from one of your cities
export const CLAIM_SCALE = 0.04; // +4% claim price per tile already bought
export const CLAIM_DIST_SCALE = 0.35; // +35% claim price per hex beyond the first from the buying city
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
export const PILLAGE_GOLD = 3; // loot for wrecking an enemy farm, pasture, forest or mine (roads give 1)
export const GROWTH_SHARE_CAP = 3; // most spare food a single city can use for growth per turn
export const MAX_POP = 20;
export const HAPPY_BASE = 3; // every city starts this happy
export const EASY_HAPPY = 2; // extra happiness for people's cities on Easy
export const HAPPY_AT = 3; // happiness at or above this: happy (faster growth, +1 gold)
export const UNHAPPY_AT = -1; // at or below: unhappy (no growth)
export const ANGRY_AT = -3; // at or below: angry (people leave)

// War and peace: everyone starts at peace; attacking needs a declared war
export const MIN_WAR_TURNS = 5; // a war lasts at least this long before peace can be made
export const TRUCE_TURNS = 10; // after peace, neither side can declare war again for this long
export const PEACE_RETRY = 3; // an AI said no: wait this long before asking again

// Fog of war: how far things see (hexes)
export const UNIT_SIGHT: Record<UnitType, number> = {
  builder: 2, settler: 2, scout: 4, swordsman: 3, archer: 3, knight: 4, catapult: 2, trireme: 3, galleass: 3, transport: 3,
};
export const CITY_SIGHT = 2; // +1 once a city reaches level 3
export const START_SIGHT = 4; // everyone starts knowing the land this close to their capital

// Wars, treaties and refusals are stored per pair of kingdoms
export function pairKey(a: PlayerId, b: PlayerId): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

// Workers: each person in a city works one of its farms, fisheries, mines, pastures or forests (taking turns
// between the kinds in this order). Improvements without a worker sit idle and make nothing.
export const WORK_ORDER: Improvement[] = ['farm', 'fishery', 'mine', 'pasture', 'forest'];

// Troops cost gold every turn (same as the food they eat): 2 for swordsmen and archers, 3 for knights
export function troopUpkeep(type: UnitType): number {
  return UNIT_STATS[type].military ? UNIT_STATS[type].food : 0;
}

export type Mood = 'happy' | 'content' | 'unhappy' | 'angry';
export const MOOD_FACE: Record<Mood, string> = { happy: '\u{1F600}', content: '\u{1F610}', unhappy: '\u{1F641}', angry: '\u{1F620}' };

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
  kind: 'unit' | 'city' | 'palisade' | 'none';
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
  wars: Record<string, number> = {}; // pairKey -> turn the war started
  truces: Record<string, number> = {}; // pairKey -> turn peace was made
  peaceAsked: Record<string, number> = {}; // pairKey -> turn an AI last refused peace
  explored: Uint8Array[] = []; // fog of war, per player: 1 = that tile has been seen
  alerts: { p: PlayerId; msg: string }[] = []; // big news for a person (war declared on them), shown as a popup

  constructor(options: GameOptions) {
    const seats = seatsFor(options);
    this.options = {
      ...options,
      seats,
      opponents: seats.length - 1,
      difficulty: DIFFICULTY[options.difficulty] ? options.difficulty : 'normal',
    };
    const { width, height } = MAP_SIZES[this.options.size];
    this.map = generateMap(this.options.seed, width, height);
    this.players = [];
    for (let i = 0; i < seats.length; i++) {
      this.players.push({
        id: i,
        name: seats[i].name,
        color: PLAYER_INFO[i].color,
        gold: START_GOLD,
        stone: 0,
        claims: 0,
        isAI: !seats[i].human,
        alive: true,
      });
    }
    this.explored = this.players.map(() => new Uint8Array(this.map.tiles.length));
    this.placeCapitals();
    this.startTurn(0);
    for (const pl of this.players) {
      const cap = this.map.tiles.find((t) => t.capital && t.owner === pl.id);
      if (cap) this.markExplored(pl.id, cap, START_SIGHT);
      this.explore(pl.id);
    }
  }

  get seed(): number {
    return this.options.seed;
  }

  get sandbox(): boolean {
    return this.options.opponents === 0;
  }

  // Fog of war is on whenever there are rivals
  get fog(): boolean {
    return !this.sandbox;
  }

  // Two or more people sharing the device: messages use names instead of "you"
  get hotseat(): boolean {
    return this.players.filter((p) => !p.isAI).length > 1;
  }

  // People still in the game
  humansAlive(): Player[] {
    return this.players.filter((p) => !p.isAI && p.alive);
  }

  isFree(p: PlayerId): boolean {
    return this.options.freeBuild && !this.players[p].isAI;
  }

  // Easy rules (great with kids): people skip city-size, food, horse/bow and unhappiness limits
  isSimple(p: PlayerId | null): boolean {
    return p !== null && !!this.options.simple && !this.players[p].isAI;
  }

  // ---------- queries ----------

  ownedTiles(p: PlayerId): Tile[] {
    return this.map.tiles.filter((t) => t.owner === p);
  }

  // Owned land only (no water): what the land-share win and the scoreboard count
  ownedLand(p: PlayerId): number {
    return this.map.tiles.filter((t) => t.owner === p && isLand(t)).length;
  }

  cityCount(p: PlayerId): number {
    return this.map.tiles.filter((t) => t.owner === p && t.city).length;
  }

  landCount(): number {
    return this.map.tiles.filter(isLand).length;
  }

  // Gold made before paying troops. Terrain only pays when an improvement has a worker;
  // city, building and happiness income stays independent of tile workers.
  grossIncome(p: PlayerId): number {
    const worked = this.workedTiles(p);
    let gold = 0;
    for (const t of this.ownedTiles(p)) {
      if (worked.has(t)) gold += YIELD[t.terrain];
      if (t.capital) gold += CAPITAL_INCOME;
      else if (t.city) gold += CITY_INCOME;
      if (t.city) {
        gold += cityLevel(t) - 1; // bigger cities pay more
        for (const b of t.buildings) gold += BUILDINGS[b].gold;
        if (this.mood(t) === 'happy') gold += 1;
      }
    }
    return gold;
  }

  // Gold paid to troops each turn
  upkeep(p: PlayerId): number {
    if (this.isFree(p)) return 0;
    return this.armyOf(p).reduce((sum, u) => sum + troopUpkeep(u.type), 0);
  }

  // Gold per turn after paying troops (what a person sees as "next turn")
  income(p: PlayerId): number {
    return this.grossIncome(p) - this.upkeep(p);
  }

  // ---------- workers ----------

  // Improved tiles (farm, mine, pasture, forest) that have a worker this turn
  workedTiles(p: PlayerId): Set<Tile> {
    const out = new Set<Tile>();
    const byCity = new Map<number, Tile[]>();
    for (const t of this.map.tiles) {
      if (t.owner !== p || !t.improvement || t.home === null) continue;
      let list = byCity.get(t.home);
      if (!list) byCity.set(t.home, (list = []));
      list.push(t);
    }
    for (const [home, list] of byCity) {
      const city = this.map.tiles[home];
      if (!city || !city.city || city.owner !== p) continue;
      const groups = WORK_ORDER.map((k) => list.filter((t) => t.improvement === k));
      let left = city.pop;
      for (let round = 0; left > 0; round++) {
        let any = false;
        for (const g of groups) {
          if (left > 0 && round < g.length) {
            out.add(g[round]);
            left--;
            any = true;
          }
        }
        if (!any) break;
      }
    }
    return out;
  }

  // Farms, mines, pastures and forests on a city's land
  improvedCount(city: Tile): number {
    return this.cityLand(city).filter((t) => t.improvement).length;
  }

  // How many of a city's improvements are worked right now
  cityWork(city: Tile): { worked: number; total: number } {
    if (city.owner === null) return { worked: 0, total: 0 };
    const worked = this.workedTiles(city.owner);
    const land = this.cityLand(city).filter((t) => t.improvement);
    return { worked: land.filter((t) => worked.has(t)).length, total: land.length };
  }

  isWorked(tile: Tile): boolean {
    return tile.owner !== null && !!tile.improvement && this.workedTiles(tile.owner).has(tile);
  }

  // Food is supply: farms and cities produce it, units use it up.
  foodMade(p: PlayerId): number {
    const worked = this.workedTiles(p);
    let food = 0;
    for (const t of this.ownedTiles(p)) {
      if (t.capital) food += CAPITAL_FOOD;
      else if (t.city) food += CITY_FOOD;
      if (t.city) food += cityLevel(t) - 1;
      if (t.city) for (const b of t.buildings) food += BUILDINGS[b].food;
      if (t.improvement === 'farm' && worked.has(t)) food += FARM_FOOD;
      if (t.improvement === 'fishery' && worked.has(t)) food += this.fisheryFood(t);
    }
    return food;
  }

  // A worked fishery: 2 food, +1 with a Harbor in its city, nothing while enemy ships blockade that city
  fisheryFood(t: Tile): number {
    const home = this.homeCity(t);
    if (home && this.blockaded(home)) return 0;
    return FISHERY_FOOD + (home && home.buildings.includes('harbor') ? HARBOR_FISH : 0);
  }

  // Next to water: can build a Harbor and boats
  isCoastal(city: Tile): boolean {
    return this.map.neighbors(city).some((n) => n.terrain === 'water');
  }

  // Enemy warships right next to a city shut down its fisheries
  blockaded(city: Tile): boolean {
    const owner = city.owner;
    if (owner === null) return false;
    return this.units.some((u) => {
      const s = UNIT_STATS[u.type];
      return !!s.naval && s.military && this.isEnemy(u.owner, owner) && hexDistance(this.tileOf(u), city) <= 1;
    });
  }

  // Units in training already reserve their food.
  foodUsed(p: PlayerId): number {
    const units = this.armyOf(p).reduce((sum, u) => sum + UNIT_STATS[u.type].food, 0);
    const queued = this.training.filter((t) => t.owner === p).reduce((sum, t) => sum + UNIT_STATS[t.type].food, 0);
    return units + queued + this.popFood(p);
  }

  // Every 2 people in a city eat 1 food
  popFood(p: PlayerId): number {
    let n = 0;
    for (const c of this.cities()) if (c.owner === p) n += Math.floor(c.pop / 2);
    return n;
  }

  population(p: PlayerId): number {
    let n = 0;
    for (const c of this.cities()) if (c.owner === p) n += c.pop;
    return n;
  }

  // ---------- happiness ----------

  // Your troops standing on enemy land: war makes people at home unhappy
  troopsAway(p: PlayerId): number {
    return this.unitsOf(p).filter((u) => UNIT_STATS[u.type].military && this.isEnemy(this.tileOf(u).owner, p)).length;
  }

  happinessParts(city: Tile): [string, number][] {
    const p = city.owner;
    if (p === null) return [];
    const parts: [string, number][] = [['Base', HAPPY_BASE]];
    if (city.capital) parts.push(['Capital', 1]);
    if (!this.players[p].isAI && this.options.difficulty === 'easy') parts.push(['Easy mode', EASY_HAPPY]);
    for (const b of city.buildings) if (BUILDINGS[b].happy) parts.push([BUILDINGS[b].name, BUILDINGS[b].happy]);
    const crowd = Math.floor(city.pop / 2);
    if (crowd) parts.push(['Crowding', -crowd]);
    const war = Math.min(3, Math.floor(this.troopsAway(p) / 2));
    if (war) parts.push(['Troops at war', -war]);
    if (this.besieged(city)) parts.push(['Under siege', -2]);
    return parts;
  }

  happiness(city: Tile): number {
    return this.happinessParts(city).reduce((s, [, n]) => s + n, 0);
  }

  mood(city: Tile): Mood {
    const h = this.happiness(city);
    if (h >= HAPPY_AT) return 'happy';
    if (this.isSimple(city.owner)) return 'content'; // easy rules: never unhappy or angry
    if (h <= ANGRY_AT) return 'angry';
    if (h <= UNHAPPY_AT) return 'unhappy';
    return 'content';
  }

  trainingAt(city: Tile): Training | undefined {
    return this.training.find((t) => t.col === city.col && t.row === city.row);
  }

  // A city does one thing at a time: train a unit, build walls or build an amenity. Empty = free.
  busyWith(city: Tile): string {
    const t = this.trainingAt(city);
    if (t) return `training a ${UNIT_STATS[t.type].name}`;
    if (city.wallTurns > 0) return 'building walls';
    if (city.project) return `building a ${BUILDINGS[city.project].name}`;
    return '';
  }

  unitCost(type: UnitType, p: PlayerId): number {
    return type === 'settler' ? this.cityCost(p) : UNIT_STATS[type].cost;
  }

  // Horses and bows work like food: a cap from your worked pastures/forests, used by living (and training) troops
  private countImp(p: PlayerId, imp: 'pasture' | 'forest'): number {
    const worked = this.workedTiles(p);
    return this.ownedTiles(p).filter((t) => t.improvement === imp && worked.has(t)).length;
  }

  private countTroop(p: PlayerId, type: UnitType): number {
    return this.armyOf(p).filter((u) => u.type === type).length + this.training.filter((t) => t.owner === p && t.type === type).length;
  }

  horsesMade(p: PlayerId): number {
    return this.countImp(p, 'pasture') * KNIGHTS_PER_PASTURE;
  }

  horsesUsed(p: PlayerId): number {
    return this.countTroop(p, 'knight');
  }

  bowsMade(p: PlayerId): number {
    return this.countImp(p, 'forest') * ARCHERS_PER_FOREST;
  }

  bowsUsed(p: PlayerId): number {
    return this.countTroop(p, 'archer');
  }

  stoneIncome(p: PlayerId): number {
    const worked = this.workedTiles(p);
    return this.ownedTiles(p).filter((t) => t.improvement === 'mine' && worked.has(t)).length * MINE_STONE;
  }

  unitsOf(p: PlayerId): Unit[] {
    return this.units.filter((u) => u.owner === p);
  }

  // Every unit p has, including land units riding in transports (they still eat and get paid)
  armyOf(p: PlayerId): Unit[] {
    const out: Unit[] = [];
    for (const u of this.unitsOf(p)) {
      out.push(u);
      if (u.cargo) out.push(...u.cargo);
    }
    return out;
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
    const out = reachable(this.map, unit, (t) => {
      if (this.unitAt(t)) return true;
      if (this.isClosed(t, unit.owner, unit.type)) return true; // closed border at peace
      if (this.walledOff(t, unit.owner)) return true; // someone else's palisade
      // Other kingdoms' cities block movement. A destroyed city of someone you're at war with
      // can be walked into (that captures it), but only by capture-capable troops.
      if (t.city && t.owner !== null && t.owner !== unit.owner) return t.hp > 0 || !canCapture || !this.isEnemy(t.owner, unit.owner);
      return false;
    });
    // Land units can board one of your transports right next to them (uses up their moves)
    if (!UNIT_STATS[unit.type].naval && unit.moves > 0) {
      for (const n of this.map.neighbors(this.tileOf(unit))) {
        if (this.hasRoom(n, unit.owner)) out.set(n, 0);
      }
    }
    return out;
  }

  // Another kingdom's palisade: nobody else walks through it (break it first)
  walledOff(t: Tile, p: PlayerId): boolean {
    return !!t.palisade && t.owner !== null && t.owner !== p;
  }

  // Closed borders: at peace, another kingdom's land (and water) is off limits to everyone but Scouts.
  isClosed(t: Tile, p: PlayerId, type: UnitType): boolean {
    return t.owner !== null && t.owner !== p && this.players[t.owner].alive && !this.atWar(t.owner, p) && !UNIT_STATS[type].scout;
  }

  // Units standing behind a closed border (peace was just made, or the border grew under them)
  // get bumped to the closest free hex that's unowned or their own.
  private expel(p: PlayerId): void {
    let moved = 0;
    for (const u of this.unitsOf(p)) {
      const here = this.tileOf(u);
      if (!this.isClosed(here, p, u.type)) continue;
      const mode = moveMode(u.type);
      let best: Tile | null = null;
      let bd = Infinity;
      for (const t of this.map.tiles) {
        if (this.unitAt(t) || !canEnter(t, p, mode) || this.isClosed(t, p, u.type) || this.walledOff(t, p) || (t.city && t.owner !== p)) continue;
        const d = hexDistance(here, t);
        if (d < bd) {
          bd = d;
          best = t;
        }
      }
      if (!best) continue;
      u.col = best.col;
      u.row = best.row;
      u.hold = false;
      this.clearRoute(u);
      if (this.fog && !this.players[p].isAI) this.markExplored(p, best, UNIT_SIGHT[u.type]);
      moved++;
    }
    if (moved) this.tell(p, `${moved} unit${moved === 1 ? '' : 's'} stepped back over the border (closed at peace)`);
  }

  // One of p's transports with a free spot sits on this tile
  hasRoom(t: Tile, p: PlayerId): Unit | null {
    const u = this.unitAt(t);
    if (!u || u.owner !== p) return null;
    const carry = UNIT_STATS[u.type].carry ?? 0;
    return carry > (u.cargo?.length ?? 0) ? u : null;
  }

  // Land hexes next to a transport where the next unit on board can get off
  unloadCheck(boat: Unit, tile: Tile): Check {
    if (this.winner !== null) return fail('Game over');
    if (boat.owner !== this.current) return fail('Not your turn');
    if (!boat.cargo?.length) return fail('Nobody on board');
    if (!this.map.neighbors(this.tileOf(boat)).includes(tile)) return fail('Pick a hex next to the transport');
    if (!isLand(tile)) return fail('Unload onto land');
    if (this.unitAt(tile)) return fail('Something is already there');
    if (tile.city && tile.owner !== boat.owner) return fail("Can't unload into someone else's city");
    if (this.isClosed(tile, boat.owner, boat.cargo[0].type)) return fail(`${this.players[tile.owner!].name}'s border is closed at peace`);
    return { ok: true, cost: 0, reason: '' };
  }

  unloadTiles(boat: Unit): Set<Tile> {
    const out = new Set<Tile>();
    if (!boat.cargo?.length || boat.owner !== this.current) return out;
    for (const n of this.map.neighbors(this.tileOf(boat))) if (this.unloadCheck(boat, n).ok) out.add(n);
    return out;
  }

  // The first unit on board steps off. It's done for this turn.
  unload(boat: Unit, tile: Tile): Unit | null {
    if (!this.unloadCheck(boat, tile).ok) return null;
    const u = boat.cargo!.shift()!;
    if (!boat.cargo!.length) boat.cargo = undefined;
    u.col = tile.col;
    u.row = tile.row;
    u.moves = 0;
    u.acted = true;
    u.hold = false;
    this.clearRoute(u);
    this.units.push(u);
    if (this.fog && !this.players[u.owner].isAI) this.markExplored(u.owner, tile, UNIT_SIGHT[u.type]);
    return u;
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

  // Someone you're at war with who is still in the game. At peace there are no attacks, sieges or pillage.
  isEnemy(owner: PlayerId | null, p: PlayerId): boolean {
    return owner !== null && owner !== p && this.players[owner].alive && this.atWar(owner, p);
  }

  // Price to buy a tile: terrain base, more the farther it is from the buying city (the nearest
  // claiming city when none is given), plus a small bump per tile already bought.
  claimCost(tile: Tile, p: PlayerId, city?: Tile | null): number {
    const from = city ?? this.claimingCity(tile, p);
    const raw = from ? hexDistance(tile, from) : this.cityDistance(tile, p);
    const d = Number.isFinite(raw) ? raw : 1;
    const dist = 1 + Math.max(0, d - 1) * CLAIM_DIST_SCALE;
    return Math.round(CLAIM_COST[tile.terrain] * dist * (1 + this.players[p].claims * CLAIM_SCALE));
  }

  // ---------- war and peace ----------

  atWar(a: PlayerId, b: PlayerId): boolean {
    return a !== b && this.wars[pairKey(a, b)] !== undefined;
  }

  // Turns since the war started (0 = declared this turn)
  warTurns(a: PlayerId, b: PlayerId): number {
    const start = this.wars[pairKey(a, b)];
    return start === undefined ? 0 : this.turn - start;
  }

  // Turns left on a peace treaty (0 = none)
  truceLeft(a: PlayerId, b: PlayerId): number {
    const t = this.truces[pairKey(a, b)];
    return t === undefined ? 0 : Math.max(0, t + TRUCE_TURNS - this.turn);
  }

  warCheck(p: PlayerId, q: PlayerId): Check {
    if (this.winner !== null) return fail('Game over');
    if (this.sandbox) return fail('No rivals in a sandbox');
    if (p === q) return fail("That's you");
    if (!this.players[q] || !this.players[q].alive) return fail('Already defeated');
    if (this.atWar(p, q)) return fail('Already at war');
    const left = this.truceLeft(p, q);
    if (left > 0) return fail(`Peace treaty: no war for ${left} more turn${left === 1 ? '' : 's'}`);
    return { ok: true, cost: 0, reason: '' };
  }

  declareWar(p: PlayerId, q: PlayerId): Check {
    const c = this.warCheck(p, q);
    if (!c.ok) return c;
    const key = pairKey(p, q);
    this.wars[key] = this.turn;
    delete this.truces[key];
    delete this.peaceAsked[key];
    this.addLog(`${this.youCap(p)} declared war on ${this.you(q)}`);
    if (!this.players[q].isAI) {
      const who = this.hotseat ? this.players[q].name : 'you';
      this.alerts.push({ p: q, msg: `${this.players[p].name} declared war on ${who}! Their troops can now attack your units and cities.` });
    }
    return c;
  }

  peaceCheck(p: PlayerId, q: PlayerId): Check {
    if (this.winner !== null) return fail('Game over');
    if (!this.atWar(p, q)) return fail('Not at war');
    const t = this.warTurns(p, q);
    if (t < MIN_WAR_TURNS) {
      const n = MIN_WAR_TURNS - t;
      return fail(`Wars last at least ${MIN_WAR_TURNS} turns: peace is possible in ${n} turn${n === 1 ? '' : 's'}`);
    }
    const asked = this.peaceAsked[pairKey(p, q)];
    if (asked !== undefined && this.turn - asked < PEACE_RETRY) {
      const n = PEACE_RETRY - (this.turn - asked);
      return fail(`${this.players[q].name} said no. Ask again in ${n} turn${n === 1 ? '' : 's'}`);
    }
    return { ok: true, cost: 0, reason: '' };
  }

  // p asks q for peace. AI kingdoms decide by how the war is going (see aiPeaceVerdict);
  // people sharing the device agree right away.
  offerPeace(p: PlayerId, q: PlayerId): Check {
    const c = this.peaceCheck(p, q);
    if (!c.ok) return c;
    if (this.players[q].isAI) {
      const v = aiPeaceVerdict(this, q, p);
      if (!v.accept) {
        this.peaceAsked[pairKey(p, q)] = this.turn;
        this.tell(p, `${this.players[q].name} refused peace`);
        return fail(v.reason);
      }
      this.makePeace(p, q);
      return { ok: true, cost: 0, reason: v.reason };
    }
    this.makePeace(p, q);
    return { ok: true, cost: 0, reason: '' };
  }

  makePeace(p: PlayerId, q: PlayerId): void {
    const key = pairKey(p, q);
    if (this.wars[key] === undefined) return;
    delete this.wars[key];
    delete this.peaceAsked[key];
    this.truces[key] = this.turn;
    this.addLog(`${this.youCap(p)} made peace with ${this.you(q)}`);
    this.expel(p);
    this.expel(q);
  }

  // Popups waiting for a person (cleared once read)
  takeAlerts(p: PlayerId): string[] {
    const mine = this.alerts.filter((a) => a.p === p).map((a) => a.msg);
    this.alerts = this.alerts.filter((a) => a.p !== p);
    return mine;
  }

  private peaceNote(q: PlayerId): string {
    return `At peace with ${this.players[q].name}: tap their capital to declare war`;
  }

  // ---------- fog of war ----------

  // Tiles p can see right now: its land and the tiles next to it, plus everything near its cities and units
  visibleTiles(p: PlayerId): Set<Tile> {
    const out = new Set<Tile>();
    for (const t of this.map.tiles) {
      if (t.owner !== p) continue;
      out.add(t);
      for (const n of this.map.neighbors(t)) out.add(n);
      if (t.city) this.addAround(t, CITY_SIGHT + (cityLevel(t) >= 3 ? 1 : 0), out);
    }
    for (const u of this.unitsOf(p)) this.addAround(this.tileOf(u), UNIT_SIGHT[u.type], out);
    return out;
  }

  private addAround(from: Tile, r: number, out: Set<Tile>): void {
    const seen = new Set<Tile>([from]);
    let ring = [from];
    for (let i = 0; i < r; i++) {
      const next: Tile[] = [];
      for (const t of ring) {
        for (const n of this.map.neighbors(t)) {
          if (seen.has(n)) continue;
          seen.add(n);
          next.push(n);
        }
      }
      ring = next;
    }
    for (const t of seen) out.add(t);
  }

  // Marks everything p sees right now as explored and returns the visible tiles
  explore(p: PlayerId): Set<Tile> {
    const vis = this.visibleTiles(p);
    const ex = this.explored[p];
    if (ex) for (const t of vis) ex[this.tileIndex(t)] = 1;
    return vis;
  }

  // Remember everything within r hexes of a tile as explored for p
  markExplored(p: PlayerId, at: Tile, r: number): void {
    const ex = this.explored[p];
    if (!ex) return;
    const around = new Set<Tile>();
    this.addAround(at, r, around);
    for (const t of around) ex[this.tileIndex(t)] = 1;
  }

  isExplored(p: PlayerId, t: Tile): boolean {
    return this.explored[p]?.[this.tileIndex(t)] === 1;
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

  // Growth a city gains next turn: 1 plus its share of your spare food (capped).
  // Happy cities grow faster, unhappy ones stop, angry ones (or a starving kingdom) shrink.
  growthRate(city: Tile): number {
    if (city.owner === null) return 0;
    const spareAll = this.foodMade(city.owner) - this.foodUsed(city.owner);
    if (spareAll < 0 && !this.isSimple(city.owner)) return -1; // starving
    const mood = this.mood(city);
    if (mood === 'angry') return -2;
    if (mood === 'unhappy') return 0;
    const mine = this.cities().filter((c) => c.owner === city.owner).length;
    const rate = 1 + Math.min(GROWTH_SHARE_CAP, mine > 0 ? Math.max(0, spareAll) / mine : 0);
    return Math.round(rate * (mood === 'happy' ? 1.5 : 1) * 10) / 10;
  }

  growthNeed(city: Tile): number {
    return city.pop >= MAX_POP ? 0 : popNeed(city.pop);
  }

  // Why a city isn't growing (empty when it is)
  growthNote(city: Tile): string {
    if (city.owner === null) return '';
    if (this.besieged(city)) return 'Not growing: enemy troops nearby';
    if (this.foodMade(city.owner) < this.foodUsed(city.owner) && !this.isSimple(city.owner)) return 'Starving: build farms or the city shrinks';
    const mood = this.mood(city);
    if (mood === 'angry') return 'Angry: people are leaving';
    if (mood === 'unhappy') return 'Unhappy: not growing';
    return '';
  }

  private growCities(p: PlayerId): void {
    for (const c of this.cities()) {
      if (c.owner !== p || this.besieged(c)) continue;
      const need = this.growthNeed(c);
      const rate = this.growthRate(c);
      if (need === 0 && rate > 0) continue; // full
      c.growth = Math.round((c.growth + rate) * 10) / 10;
      if (c.growth < 0) {
        c.growth = 0;
        if (c.pop > 1) {
          c.pop -= 1;
          this.setPopLevel(c);
          this.tell(p, `${this.cityName(c)} lost a person (${this.growthNote(c).split(':')[0].toLowerCase() || 'unrest'})`);
        }
        continue;
      }
      if (need === 0 || c.growth < need) continue;
      c.growth = Math.round((c.growth - need) * 10) / 10;
      c.pop += 1;
      const before = cityLevel(c);
      this.setPopLevel(c);
      if (cityLevel(c) > before) {
        c.hp = Math.min(cityMaxHp(c), c.hp + LEVEL_HP);
        this.tell(p, `${this.cityName(c)} grew into a ${LEVEL_NAMES[c.level - 1]}`);
      }
    }
  }

  private setPopLevel(c: Tile): void {
    c.level = levelFromPop(c.pop);
    c.hp = Math.min(c.hp, cityMaxHp(c));
  }

  // ---------- culture: cities grab nearby land by themselves ----------

  cultureRate(city: Tile): number {
    let n = 1 + Math.floor(city.pop / 3);
    for (const b of city.buildings) n += BUILDINGS[b].culture;
    return n;
  }

  cultureNeed(city: Tile): number {
    return 5 + 3 * city.borders;
  }

  // The tile a city would grab next: the best unowned tile touching its land
  borderPick(city: Tile): Tile | null {
    if (city.owner === null) return null;
    const value: Record<string, number> = { grass: 3, hills: 3, sand: 2, mountain: 1, water: 1 };
    let best: Tile | null = null;
    let bestScore = -Infinity;
    for (const t of this.map.tiles) {
      if (t.owner !== null || !this.inCityRange(t, city) || !this.claimingCity(t, city.owner, city)) continue;
      const s = value[t.terrain] - hexDistance(t, city) * 0.6;
      if (s > bestScore) {
        bestScore = s;
        best = t;
      }
    }
    return best;
  }

  private growBorders(p: PlayerId): void {
    for (const c of this.cities()) {
      if (c.owner !== p || this.besieged(c)) continue;
      const need = this.cultureNeed(c);
      c.culture = Math.min(need, c.culture + this.cultureRate(c));
      if (c.culture < need) continue;
      const t = this.borderPick(c);
      if (!t) continue; // nothing left to grab: stays full until land opens up
      t.owner = p;
      t.home = this.tileIndex(c);
      c.culture = 0;
      c.borders += 1;
      this.invalidate();
      this.tell(p, `${this.cityName(c)} grew its borders`);
    }
    this.checkWin();
  }

  // ---------- amenities ----------

  buildCheck(city: Tile, b: Building, p: PlayerId = this.current): Check {
    if (this.winner !== null) return fail('Game over');
    if (p !== this.current) return fail('Not your turn');
    if (!city.city || city.owner !== p) return fail('Build in your own city');
    const info = BUILDINGS[b];
    if (city.buildings.includes(b)) return fail('Already built');
    const busy = this.busyWith(city);
    if (busy) return fail(`Busy ${busy}`);
    if (city.pop < info.minPop && !this.isSimple(p)) return fail(`Needs ${info.minPop} people`);
    if (info.coastal && !this.isCoastal(city)) return fail('Needs to be next to water');
    if (this.isFree(p)) return { ok: true, cost: 0, reason: '' };
    return this.players[p].gold >= info.cost ? { ok: true, cost: info.cost, reason: '' } : fail(`Need ${info.cost} gold`, info.cost);
  }

  startBuilding(city: Tile, b: Building, p: PlayerId = this.current): Check {
    const c = this.buildCheck(city, b, p);
    if (!c.ok) return c;
    this.players[p].gold -= c.cost;
    city.project = b;
    city.projectTurns = BUILDINGS[b].turns;
    return c;
  }

  private advanceProjects(p: PlayerId): void {
    for (const c of this.cities()) {
      if (c.owner !== p || !c.project) continue;
      c.projectTurns -= 1;
      if (c.projectTurns > 0) continue;
      const b = c.project;
      c.project = null;
      c.projectTurns = 0;
      if (!c.buildings.includes(b)) c.buildings.push(b);
      this.tell(p, `${this.cityName(c)} finished its ${BUILDINGS[b].name}`);
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
      if (t.owner !== null || !this.inCityRange(t, city)) continue;
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
    const free = this.isFree(p);
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
        if (city) {
          const d = hexDistance(tile, city);
          const max = this.claimRadius(city);
          if (d > max) return fail(`Too far: ${d} hexes from this city (max ${max}). Send a settler`);
          if (!this.claimingCity(tile, p, city)) return fail("Must touch this city's land");
          return withGold(this.claimCost(tile, p, city));
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
    if (tile.terrain !== 'grass') return fail('Cities need grass');
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
    tile.pop = 1;
    tile.culture = 0;
    tile.borders = 0;
    tile.buildings = [];
    tile.project = null;
    tile.projectTurns = 0;
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
    // Builders show up right away, so they don't count as the city's one job
    const busy = stats.train > 0 ? this.busyWith(city) : '';
    if (busy) return fail(`Busy ${busy}`);
    if (stats.needs && !city.buildings.includes(stats.needs)) {
      return fail(this.isCoastal(city) ? `Needs a ${BUILDINGS[stats.needs].name}` : 'Only coastal cities build boats');
    }
    const simple = this.isSimple(p);
    if (stats.minLevel && cityLevel(city) < stats.minLevel && !simple) {
      return fail(`Needs a ${LEVEL_NAMES[stats.minLevel - 1]} (${LEVEL_POP[stats.minLevel - 1]} people)`);
    }
    if (!simple && this.foodUsed(p) + stats.food > this.foodMade(p)) return fail('Not enough food: build farms or fisheries');
    if (!simple && type === 'knight' && this.horsesUsed(p) >= this.horsesMade(p)) return fail('Need horses: a worked pasture');
    if (!simple && type === 'archer' && this.bowsUsed(p) >= this.bowsMade(p)) return fail('Need bows: a worked forest');
    if (stats.stone && !this.isFree(p) && this.players[p].stone < stats.stone) return fail(`Need ${stats.stone} stone (build mines)`);
    if (stats.train === 0 && !this.spawnTile(city, type)) return fail('No room around the city');
    if (this.isFree(p)) return { ok: true, cost: 0, reason: '' };
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
    if (stats.stone && !this.isFree(p)) this.players[p].stone -= stats.stone;
    if (stats.train > 0) {
      // Metropolis (level 5) trains a turn faster
      const turns = Math.max(1, stats.train - (cityLevel(city) >= MAX_LEVEL ? 1 : 0));
      this.training.push({ type, owner: p, col: city.col, row: city.row, turnsLeft: turns });
      return 'queued';
    }
    const at = this.spawnTile(city, type)!;
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
      const at = t.turnsLeft <= 0 ? this.spawnTile(city, t.type) : null;
      if (!at) {
        keep.push(t); // still training, or waiting for room
        continue;
      }
      const stats = UNIT_STATS[t.type];
      this.units.push({ id: this.nextUnitId++, type: t.type, owner: p, col: at.col, row: at.row, moves: stats.moves, acted: false, hp: stats.hp });
      this.tell(p, `${stats.name} ready`);
    }
    this.training = keep;
  }

  // Boats launch into the water next to the city, everyone else onto the city's land
  private spawnTile(city: Tile, type: UnitType): Tile | null {
    if (!this.unitAt(city)) return city;
    if (UNIT_STATS[type].naval) return this.map.neighbors(city).find((n) => n.terrain === 'water' && !this.unitAt(n)) ?? null;
    return this.map.neighbors(city).find((n) => isLand(n) && n.owner === city.owner && !this.unitAt(n)) ?? null;
  }

  // keepRoute: a step of a planned route (a manual move cancels the route)
  moveUnit(unit: Unit, dest: Tile, keepRoute = false): boolean {
    if (this.winner !== null) return false;
    const left = this.reachableFor(unit).get(dest);
    if (left === undefined) return false;
    if (!keepRoute) this.clearRoute(unit);
    // Boarding one of your transports: the unit rides along until it's unloaded
    const boat = UNIT_STATS[unit.type].naval ? null : this.hasRoom(dest, unit.owner);
    if (boat) {
      this.clearRoute(unit);
      this.units = this.units.filter((u) => u !== unit);
      unit.col = dest.col;
      unit.row = dest.row;
      unit.moves = 0;
      unit.acted = true;
      unit.hold = false;
      boat.cargo = [...(boat.cargo ?? []), unit];
      this.tell(unit.owner, `${UNIT_STATS[unit.type].name} boarded the Transport`);
      return true;
    }
    // Everything the unit passes on the way stays explored, not just where it stops
    if (this.fog && !this.players[unit.owner].isAI) {
      const trail = findPath(this.map, this.tileOf(unit), new Set([dest]), () => false, unit.owner, moveMode(unit.type)) ?? [];
      for (const t of trail) this.markExplored(unit.owner, t, UNIT_SIGHT[u.type]);
    }
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
      if (this.isClosed(t, unit.owner, unit.type)) return true;
      if (this.walledOff(t, unit.owner)) return true;
      if (t.city && t.owner !== null && t.owner !== unit.owner) return t.hp > 0 || !canCapture || !this.isEnemy(t.owner, unit.owner);
      return false;
    };
  }

  planRoute(unit: Unit, dest: Tile, ownBlock = false): RoutePlan {
    const fail = (reason: string, arrived = false): RoutePlan => ({ ok: false, reason, path: [], turnAt: [], turns: 0, nextTo: false, arrived });
    const from = this.tileOf(unit);
    if (dest === from) return fail('Already here', true);
    const mode = moveMode(unit.type);
    const blocked = this.routeBlocker(unit, ownBlock);
    const taken = (t: Tile) => {
      const u = this.unitAt(t);
      return !!u && u !== unit;
    };
    if (!taken(dest) && !dest.city && this.isClosed(dest, unit.owner, unit.type)) {
      return fail(`${this.players[dest.owner!].name}'s border is closed at peace: only Scouts can cross`);
    }
    // Heading for a unit or an enemy city: stop on the best tile next to it (never attacks by itself)
    const nextTo = taken(dest) || blocked(dest);
    if (!nextTo && !canEnter(dest, unit.owner, mode)) {
      if (mode === 'sea') return fail('Boats stay on water (they can dock in your cities)');
      if (mode === 'wade') return fail('Builders only wade into your own water');
      return fail("Can't cross water: board a Transport");
    }
    const goals = nextTo
      ? new Set(this.map.neighbors(dest).filter((n) => n === from || (canEnter(n, unit.owner, mode) && !blocked(n) && !taken(n))))
      : new Set([dest]);
    const path = findPath(this.map, from, goals, blocked, unit.owner, mode);
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
      if (msg) this.tell(unit.owner, msg);
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
        this.tell(p, `${UNIT_STATS[u.type].name} stopped its route: stuck behind your units`);
      }
    }
  }

  // ---------- combat ----------

  private defenseMult(tile: Tile, defender: PlayerId): number {
    let m = 1;
    if (tile.terrain === 'hills' || tile.improvement === 'forest') m *= 0.8;
    if (tile.terrain === 'mountain') m *= 0.7;
    if (tile.city && tile.owner === defender) m *= 0.75;
    if (tile.palisade && tile.owner === defender) m *= PALISADE_COVER;
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
    if (stats.setup && unit.moves < stats.moves) return no(`${stats.name}s can't fire after moving this turn`);
    const from = this.tileOf(unit);
    const dist = hexDistance(from, target);
    if (dist < 1 || dist > stats.range) return no(`Out of range (${stats.range})`);
    const melee = dist === 1 && stats.range === 1;
    const defender = this.unitAt(target);
    if (stats.boatsOnly && !(defender && UNIT_STATS[defender.type].naval)) {
      return no(defender || target.city ? `${stats.name}s only fight boats` : 'Nothing to attack');
    }
    if (defender) {
      if (defender.owner === unit.owner) return no('Your own unit');
      if (!this.isEnemy(defender.owner, unit.owner)) return no(this.players[defender.owner].alive ? this.peaceNote(defender.owner) : 'Nothing to attack');
      const d = UNIT_STATS[defender.type];
      // Swordsmen and knights can't reach anything out on the water (archers and ships can)
      if (melee && !stats.naval && target.terrain === 'water') return no("Can't reach the water: use archers or ships");
      // Builders and settlers are caught at once; transports are boats and take normal hits
      if (!d.military && !d.naval) return { ok: true, reason: '', dmg: defender.hp, counter: 0, kind: 'unit' };
      const dmg = Math.max(1, Math.round(stats.atk * this.typeMult(unit.type, defender.type) * this.defenseMult(target, defender.owner)));
      const counter = melee && dmg < defender.hp
        ? Math.round(d.atk * COUNTER_SHARE * this.typeMult(defender.type, unit.type) * this.defenseMult(from, unit.owner))
        : 0;
      return { ok: true, reason: '', dmg, counter, kind: 'unit' };
    }
    if (target.city && target.owner !== null && target.owner !== unit.owner && this.players[target.owner].alive && !this.isEnemy(target.owner, unit.owner)) {
      return no(this.peaceNote(target.owner));
    }
    if (target.city && this.isEnemy(target.owner, unit.owner)) {
      if (target.hp <= 0 && target.shield <= 0) return no(stats.canCapture ? 'Destroyed: move in to capture' : 'Destroyed: send a swordsman or knight');
      const wallMult = unit.type === 'knight' && target.shield > 0 ? KNIGHT_VS_WALLS : 1;
      const dmg = Math.max(1, Math.round(stats.atk * SIEGE_MULT * wallMult * (stats.vsCity ?? 1)));
      const counter = dist === 1 ? CITY_COUNTER + 2 * target.walls : 0;
      return { ok: true, reason: '', dmg, counter, kind: 'city' };
    }
    if (target.palisade && target.owner !== null && target.owner !== unit.owner) {
      if (!this.isEnemy(target.owner, unit.owner)) return no(this.peaceNote(target.owner));
      const mult = (stats.vsPalisade ?? 1) * (unit.type === 'knight' ? KNIGHT_VS_WALLS : 1);
      return { ok: true, reason: '', dmg: Math.max(1, Math.round(stats.atk * mult)), counter: 0, kind: 'palisade' };
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
      const dName = `${this.whose(defender.owner)} ${UNIT_STATS[defender.type].name}`;
      defender.hp -= pv.dmg;
      if (defender.hp <= 0) {
        this.units = this.units.filter((u) => u !== defender);
        const aboard = defender.cargo?.length ?? 0;
        this.addLog(`${a.name} destroyed ${dName}${aboard ? ` and the ${aboard} unit${aboard === 1 ? '' : 's'} aboard` : ''}`);
      }
    } else if (pv.kind === 'palisade') {
      target.palisade = Math.max(0, (target.palisade ?? 0) - pv.dmg);
      if (!target.palisade) this.addLog(`${a.name} broke ${this.whose(target.owner!)} palisade`);
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
    city.pop = Math.max(1, Math.floor(city.pop * 0.6)); // war shrinks a city
    city.level = levelFromPop(city.pop);
    city.growth = 0;
    city.culture = 0;
    city.project = null; // half-built amenities are lost
    city.projectTurns = 0;
    city.hp = Math.round(cityMaxHp(city) * CAPTURE_HP);
    city.shield = 0;
    city.wallTurns = 0; // half-built walls are lost
    this.invalidate();
    if (wasCapital) this.eliminate(prev, captor);
    else this.addLog(`${this.players[captor].name} captured ${this.cityName(city)} from ${this.you(prev)}`);
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
    if ((job === 'farm' || job === 'pasture' || job === 'forest' || job === 'mine') && target.city) return fail('Move off the city first');
    switch (job) {
      case 'fishery':
        if (target.improvement === 'fishery') return fail('Already a fishery');
        if (!improvementFits(target, 'fishery')) return fail('Fisheries go on water: wade into your own water');
        break;
      case 'farm':
        if (target.improvement === 'farm') return fail('Already a farm');
        if (!improvementFits(target, 'farm')) return fail('Farms need grass or sand');
        break;
      case 'pasture':
        if (target.improvement === 'pasture') return fail('Already a pasture');
        if (!improvementFits(target, 'pasture')) return fail('Pastures need grass');
        break;
      case 'forest':
        if (target.improvement === 'forest') return fail('Already a forest');
        if (!improvementFits(target, 'forest')) return fail('Forests need grass');
        break;
      case 'mine':
        if (target.improvement === 'mine') return fail('Already a mine');
        if (!improvementFits(target, 'mine')) return fail('Mines need hills or mountains');
        break;
      case 'palisade':
        if (target.city) return fail('Cities have walls instead (city panel)');
        if (!isLand(target)) return fail("Palisades go on land");
        if (target.palisade) return fail('Already a palisade');
        if (!this.cities().some((c) => c.owner === p && hexDistance(c, target) <= PALISADE_RANGE)) return fail(`Only within ${PALISADE_RANGE} hexes of your cities`);
        if (!this.isFree(p) && this.players[p].stone < PALISADE_STONE) return fail(`Need ${PALISADE_STONE} stone (build mines)`);
        break;
      case 'road':
        if (target.city) return fail('Cities already count as roads');
        if (!isLand(target)) return fail("Can't build a road on water");
        if (target.road) return fail('Already a road');
        break;
      case 'walls':
        return fail('Build walls from the city panel');
      case 'raise':
        if (target.height >= MAX_HEIGHT) return fail('Already a mountain');
        if (target.city && target.height + 1 >= MAX_HEIGHT) return fail("Cities can't sit on mountains");
        if (target.height === 0 && this.unitAt(target) && UNIT_STATS[this.unitAt(target)!.type].naval) return fail('A boat is in the way');
        break;
      case 'lower':
        if (target.height <= 0) return fail('Already water');
        if (target.city && target.height <= 1) return fail('That would flood the city');
        if (target.height === 1 && this.unitAt(target)) return fail('A unit would drown');
        break;
    }
    const cost = JOB_COST[job];
    if (this.isFree(p)) return { ok: true, cost: 0, reason: '' };
    return this.players[p].gold >= cost ? { ok: true, cost, reason: '' } : fail(`Need ${cost} gold`, cost);
  }

  // Walls are a city action: pay stone (from mines) plus a little gold, one level at a time.
  wallCheck(city: Tile, p: PlayerId = this.current): Check {
    if (this.winner !== null) return fail('Game over');
    if (p !== this.current) return fail('Not your turn');
    if (!city.city || city.owner !== p) return fail('Build walls in your own city');
    if (city.walls >= MAX_WALLS) return fail('Walls are maxed');
    if (city.wallTurns > 0) return fail(`Walls going up: ${city.wallTurns} turn${city.wallTurns === 1 ? '' : 's'} left`);
    const busy = this.busyWith(city);
    if (busy) return fail(`Busy ${busy}`);
    const stone = this.wallStoneCost(city);
    if (this.isFree(p)) return { ok: true, cost: 0, reason: '' };
    if (this.players[p].stone < stone) return fail(`Need ${stone} stone (build mines)`);
    const cost = JOB_COST.walls;
    return this.players[p].gold >= cost ? { ok: true, cost, reason: '' } : fail(`Need ${cost} gold`, cost);
  }

  buildWalls(city: Tile, p: PlayerId = this.current): Check {
    const c = this.wallCheck(city, p);
    if (!c.ok) return c;
    const player = this.players[p];
    player.gold -= c.cost;
    if (!this.isFree(p)) player.stone -= this.wallStoneCost(city);
    // Paid now, built over a few turns (bigger walls take longer), like training troops
    city.wallTurns = this.wallTurnsFor(city);
    return c;
  }

  wallTurnsFor(city: Tile): number {
    return WALL_TURNS[Math.min(city.walls, MAX_WALLS - 1)];
  }

  // Start of the owner's turn: walls under construction get a turn closer
  private advanceWalls(p: PlayerId): void {
    for (const c of this.cities()) {
      if (c.owner !== p || c.wallTurns <= 0) continue;
      c.wallTurns -= 1;
      if (c.wallTurns > 0) continue;
      c.walls = Math.min(MAX_WALLS, c.walls + 1);
      c.shield = shieldMax(c); // new walls go up at full strength
      this.tell(p, `${this.cityName(c)} finished walls level ${c.walls}`);
    }
  }

  // ---------- pillage ----------

  // A troop standing on enemy land wrecks the farm/pasture/forest/mine there (or the road). Uses its attack.
  pillageCheck(unit: Unit): Check {
    if (this.winner !== null) return fail('Game over');
    if (!UNIT_STATS[unit.type].military) return fail('Only troops can pillage');
    if (unit.owner !== this.current) return fail('Not your turn');
    if (unit.acted) return fail('Already acted this turn');
    const here = this.tileOf(unit);
    if (here.city) return fail("Can't pillage a city: attack it");
    if (here.owner !== null && here.owner !== unit.owner && !this.isEnemy(here.owner, unit.owner)) return fail('Only during a war');
    if (!this.isEnemy(here.owner, unit.owner)) return fail('Stand on enemy land to pillage');
    if (!here.improvement && !here.road) return fail('Nothing here to pillage');
    return { ok: true, cost: 0, reason: '' };
  }

  // What pillaging here would wreck, and the loot
  pillageTarget(tile: Tile): { name: string; gold: number } | null {
    if (tile.improvement) return { name: IMPROVEMENT_NAME[tile.improvement], gold: PILLAGE_GOLD };
    if (tile.road) return { name: 'road', gold: 1 };
    return null;
  }

  pillage(unit: Unit): Check {
    const c = this.pillageCheck(unit);
    if (!c.ok) return c;
    const here = this.tileOf(unit);
    const what = this.pillageTarget(here)!;
    const victim = here.owner!;
    if (here.improvement) here.improvement = null;
    else here.road = false;
    this.players[unit.owner].gold += what.gold;
    unit.acted = true;
    unit.moves = 0;
    unit.hold = false;
    this.clearRoute(unit);
    this.invalidate();
    this.addLog(`${this.players[unit.owner].name} pillaged ${this.whose(victim)} ${what.name}`);
    return { ok: true, cost: 0, reason: `+${what.gold} gold` };
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
      case 'pasture':
      case 'forest':
      case 'mine':
      case 'fishery':
        target.improvement = job; // replaces whatever was there (e.g. turn a farm into a pasture)
        break;
      case 'road':
        target.road = true;
        break;
      case 'palisade':
        target.palisade = PALISADE_HP;
        if (!this.isFree(unit.owner)) this.players[unit.owner].stone -= PALISADE_STONE;
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
        this.tell(unit.owner, 'A builder finished its last job and retired');
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
    const pl = this.players[p];
    const mult = pl.isAI ? DIFFICULTY[this.options.difficulty].income : 1;
    pl.gold += Math.round(this.grossIncome(p) * mult) - this.upkeep(p);
    if (pl.gold < 0) {
      pl.gold = 0;
      this.tell(p, 'Not enough gold to pay all your troops');
    }
    pl.stone += this.stoneIncome(p);
    this.growCities(p);
    this.growBorders(p);
    this.advanceWalls(p);
    this.advanceProjects(p);
    // Cities heal and walls rebuild a little every turn, unless enemy troops are close (siege).
    for (const t of this.cities()) {
      if (t.owner !== p || this.besieged(t)) continue;
      t.hp = Math.min(cityMaxHp(t), t.hp + CITY_REGEN);
      t.shield = Math.min(shieldMax(t), t.shield + CITY_REGEN);
    }
    // Damaged palisades get patched up when no enemy troops are close
    for (const t of this.map.tiles) {
      if (t.owner !== p || !t.palisade || t.palisade >= PALISADE_HP) continue;
      const near = this.units.some((u) => UNIT_STATS[u.type].military && this.isEnemy(u.owner, p) && hexDistance(this.tileOf(u), t) <= 2);
      if (!near) t.palisade = Math.min(PALISADE_HP, t.palisade + PALISADE_REGEN);
    }
    for (const u of this.unitsOf(p)) {
      const stats = UNIT_STATS[u.type];
      u.moves = stats.moves;
      u.acted = false;
      // Units heal on their own land (25% of max HP per turn), not in the field
      if (this.tileOf(u).owner === p) u.hp = Math.min(stats.hp, u.hp + Math.ceil(stats.hp * HOME_HEAL));
    }
    this.expel(p);
    this.runRoutes(p);
    this.wakeHolders(p);
    this.advanceTraining(p);
  }

  // Units on Hold wake up when enemy troops come within 2 hexes, so they don't get picked off unnoticed
  private wakeHolders(p: PlayerId): void {
    for (const u of this.unitsOf(p)) {
      if (!u.hold || !this.enemiesNear(u).length) continue;
      u.hold = false;
      this.tell(p, `${UNIT_STATS[u.type].name} stopped holding: enemy troops nearby`);
    }
  }

  // "your" only when one person plays against the computer; with several people, names
  private whose(p: PlayerId): string {
    return !this.hotseat && !this.players[p].isAI ? 'your' : `${this.players[p].name}'s`;
  }

  private you(p: PlayerId): string {
    return !this.hotseat && !this.players[p].isAI ? 'you' : this.players[p].name;
  }

  // Same as you(), for the start of a sentence
  private youCap(p: PlayerId): string {
    const s = this.you(p);
    return s === 'you' ? 'You' : s;
  }

  // News only people care about (the AI doesn't read the log)
  private tell(p: PlayerId, msg: string): void {
    if (this.players[p].isAI) return;
    this.addLog(this.hotseat ? `${this.players[p].name}: ${msg}` : msg);
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
    // Their wars and treaties end with them
    for (const pl of this.players) {
      const key = pairKey(loser, pl.id);
      delete this.wars[key];
      delete this.truces[key];
      delete this.peaceAsked[key];
    }
    this.addLog(`${c.name} captured ${this.whose(loser)} capital!`);
  }

  private checkWin(): void {
    if (this.winner !== null || this.sandbox) return;
    const alive = this.players.filter((p) => p.alive);
    if (this.humansAlive().length === 0) {
      const top = alive.sort((a, b) => this.ownedLand(b.id) - this.ownedLand(a.id))[0];
      this.winner = top ? top.id : 1;
      this.winReason = this.hotseat ? 'Every player kingdom fell' : 'Your capital fell';
      return;
    }
    if (alive.length === 1) {
      this.winner = alive[0].id;
      this.winReason = this.hotseat ? `${alive[0].name} took every rival capital` : 'Every rival capital is yours';
      return;
    }
    const land = this.landCount();
    for (const pl of this.players) {
      if (!pl.alive || (pl.isAI && !DIFFICULTY[this.options.difficulty].landWin)) continue;
      const share = this.ownedLand(pl.id) / land;
      if (share >= WIN_SHARE) {
        this.winner = pl.id;
        const who = this.you(pl.id);
        this.winReason = `${who === 'you' ? 'You control' : `${who} controls`} ${Math.round(share * 100)}% of the land`;
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
      best.pop = 1;
      best.hp = cityMaxHp(best);
      // Water next to the capital stays water, so a capital can be coastal (Harbor, boats, fisheries)
      for (const n of this.map.neighbors(best)) {
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
