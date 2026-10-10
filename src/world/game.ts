// Game rules and turn flow. No Phaser imports in src/world.
import { generateMap, hexDistance } from './map';
import type { WorldMap } from './map';
import { CLAIM_COST, MAX_HEIGHT, YIELD, isLand } from './tile';
import type { PlayerId, Tile } from './tile';

export type Action = 'claim' | 'raise' | 'lower' | 'city';

export type MapSize = 'small' | 'medium' | 'large' | 'huge';

export const MAP_SIZES: Record<MapSize, { label: string; width: number; height: number }> = {
  small: { label: 'Small', width: 20, height: 14 },
  medium: { label: 'Medium', width: 30, height: 20 },
  large: { label: 'Large', width: 44, height: 30 },
  huge: { label: 'Huge', width: 60, height: 40 },
};

export const MAX_OPPONENTS = 3;

export interface GameOptions {
  seed: number;
  size: MapSize;
  opponents: number; // 0 = sandbox, no rivals and no win conditions
  freeBuild: boolean; // your actions cost no gold
}

export interface Player {
  id: PlayerId;
  name: string;
  color: number;
  gold: number;
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

export const TERRAFORM_COST = 3;
export const CITY_INCOME = 3;
export const CAPITAL_INCOME = 5;
export const CAPITAL_CAPTURE_COST = 60;
export const CITY_CAPTURE_COST = 30;
export const WIN_SHARE = 0.6;
export const START_GOLD = 10;

const fail = (reason: string, cost = 0): Check => ({ ok: false, cost, reason });

export function defaultOptions(): GameOptions {
  return { seed: randomSeed(), size: 'medium', opponents: 1, freeBuild: false };
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

  constructor(options: GameOptions) {
    this.options = { ...options, opponents: Math.max(0, Math.min(MAX_OPPONENTS, options.opponents)) };
    const { width, height } = MAP_SIZES[this.options.size];
    this.map = generateMap(this.options.seed, width, height);
    this.players = [];
    for (let i = 0; i <= this.options.opponents; i++) {
      this.players.push({
        id: i,
        name: PLAYER_INFO[i].name,
        color: PLAYER_INFO[i].color,
        gold: START_GOLD,
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
    }
    return gold;
  }

  cityCost(p: PlayerId): number {
    return 10 + 10 * this.cityCount(p);
  }

  touches(tile: Tile, p: PlayerId): boolean {
    return this.map.neighbors(tile).some((n) => n.owner === p);
  }

  check(action: Action, tile: Tile, p: PlayerId = this.current): Check {
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
        if (!isLand(tile)) return fail("Can't claim water");
        if (!this.touches(tile, p)) return fail('Must border your land');
        if (tile.owner === null) return withGold(CLAIM_COST[tile.terrain]);
        if (tile.capital) return withGold(CAPITAL_CAPTURE_COST);
        if (tile.city) return withGold(CITY_CAPTURE_COST);
        const nearCity = this.map.neighbors(tile).some((n) => n.city && n.owner === tile.owner);
        return withGold(CLAIM_COST[tile.terrain] * 3 + (nearCity ? 6 : 0));
      }
      case 'raise': {
        if (tile.height >= MAX_HEIGHT) return fail('Already a mountain');
        if (tile.owner !== null && tile.owner !== p) return fail("Can't terraform enemy land");
        if (tile.owner === null && !this.touches(tile, p)) return fail('Must border your land');
        if (tile.city && tile.height + 1 >= MAX_HEIGHT) return fail("Cities can't sit on mountains");
        return withGold(TERRAFORM_COST);
      }
      case 'lower': {
        if (tile.height <= 0) return fail('Already water');
        if (tile.owner !== null && tile.owner !== p) return fail("Can't terraform enemy land");
        if (tile.owner === null && !this.touches(tile, p)) return fail('Must border your land');
        if (tile.city && tile.height <= 1) return fail('That would flood the city');
        return withGold(TERRAFORM_COST);
      }
      case 'city': {
        if (tile.owner !== p) return fail('Build on your own land');
        if (tile.city) return fail('Already a city');
        if (tile.terrain === 'water' || tile.terrain === 'mountain') return fail("Can't build here");
        const tooClose = this.map.neighbors(tile).some((n) => n.city || this.map.neighbors(n).some((m) => m.city));
        if (tooClose) return fail('Too close to another city');
        return withGold(this.cityCost(p));
      }
    }
  }

  // ---------- actions ----------

  perform(action: Action, tile: Tile, p: PlayerId = this.current): Check {
    const result = this.check(action, tile, p);
    if (!result.ok) return result;
    const player = this.players[p];
    player.gold -= result.cost;

    switch (action) {
      case 'claim': {
        const prevOwner = tile.owner;
        tile.owner = p;
        if (tile.capital && prevOwner !== null) {
          tile.capital = false; // captured capitals become regular cities
          this.eliminate(prevOwner, p);
        } else if (tile.city && prevOwner !== null) {
          this.addLog(`${player.name} took a city from ${this.players[prevOwner].name}`);
        }
        break;
      }
      case 'raise':
        this.map.raiseHeight(tile);
        break;
      case 'lower':
        this.map.lowerHeight(tile);
        break;
      case 'city': {
        tile.city = true;
        for (const n of this.map.neighbors(tile)) {
          if (n.owner === null && isLand(n)) n.owner = p;
        }
        this.addLog(`${player.name} founded a city`);
        break;
      }
    }
    this.checkWin();
    return result;
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
    this.players[p].gold += this.income(p);
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
    for (const t of this.map.tiles) {
      if (t.owner === loser) t.owner = captor;
    }
    this.addLog(`${c.name} captured ${l.name}'s capital!`);
  }

  private checkWin(): void {
    if (this.winner !== null || this.sandbox) return;
    if (!this.players[0].alive) {
      const top = this.players
        .filter((p) => p.alive)
        .sort((a, b) => this.ownedTiles(b.id).length - this.ownedTiles(a.id).length)[0];
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
      if (!pl.alive) continue;
      const share = this.ownedTiles(pl.id).length / land;
      if (share >= WIN_SHARE) {
        this.winner = pl.id;
        this.winReason = `${pl.id === 0 ? 'You control' : `${pl.name} controls`} ${Math.round(share * 100)}% of the land`;
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
      best.city = true;
      best.capital = true;
      for (const n of this.map.neighbors(best)) {
        if (n.terrain === 'water') {
          n.height = 1;
          n.terrain = 'sand';
        }
        if (n.owner === null) n.owner = pl.id;
      }
      capitals.push(best);
    }
  }

  private runAI(p: PlayerId): void {
    for (let i = 0; i < 80 && this.winner === null && this.players[p].alive; i++) {
      const move = this.pickAIMove(p);
      if (!move) return;
      this.perform(move.action, move.tile, p);
    }
  }

  private pickAIMove(p: PlayerId): { action: Action; tile: Tile } | null {
    const gold = this.players[p].gold;
    const owned = this.ownedTiles(p).length;
    const cities = this.cityCount(p);

    // Best city spot (on owned land, room to grow)
    let citySpot: Tile | null = null;
    let cityScore = -1;
    if (owned >= cities * 7) {
      for (const t of this.map.tiles) {
        if (t.owner !== p || t.city) continue;
        const c = this.check('city', t, p);
        if (!c.ok && c.reason !== `Need ${c.cost} gold`) continue;
        const room = this.map.neighbors(t).filter((n) => n.owner === null && isLand(n)).length;
        if (room > cityScore) {
          cityScore = room;
          citySpot = t;
        }
      }
      if (citySpot && cityScore >= 2 && gold >= this.cityCost(p)) return { action: 'city', tile: citySpot };
    }
    const reserve = citySpot && cityScore >= 2 ? Math.floor(this.cityCost(p) / 2) : 0;

    let best: Tile | null = null;
    let bestScore = 0;
    for (const t of this.map.tiles) {
      if (t.owner === p || !isLand(t)) continue;
      const c = this.check('claim', t, p);
      if (!c.ok) continue;
      let score: number;
      if (t.capital) score = 1000;
      else if (t.owner !== null && t.city) score = 50;
      else if (t.owner !== null) score = gold > 40 ? ((YIELD[t.terrain] + 1) / c.cost) * 6 : 0;
      else score = ((YIELD[t.terrain] + 0.5) / c.cost) * 10;
      if (!t.capital && gold - c.cost < reserve) continue;
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best ? { action: 'claim', tile: best } : null;
  }
}
