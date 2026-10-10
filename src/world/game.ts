// Game rules and turn flow. No Phaser imports in src/world.
import { generateMap, hexDistance } from './map';
import type { WorldMap } from './map';
import { CLAIM_COST, MAX_HEIGHT, YIELD, isLand } from './tile';
import type { PlayerId, Tile } from './tile';

export type Action = 'claim' | 'raise' | 'lower' | 'city';

export interface Player {
  id: PlayerId;
  name: string;
  color: number;
  gold: number;
  isAI: boolean;
}

export interface Check {
  ok: boolean;
  cost: number;
  reason: string;
}

export const TERRAFORM_COST = 3;
export const CITY_INCOME = 3;
export const CAPITAL_INCOME = 5;
export const CAPITAL_CAPTURE_COST = 60;
export const CITY_CAPTURE_COST = 30;
export const TURN_LIMIT = 60;
export const WIN_SHARE = 0.6;
export const START_GOLD = 10;

const fail = (reason: string, cost = 0): Check => ({ ok: false, cost, reason });

export class GameState {
  map: WorldMap;
  players: Player[];
  turn = 1;
  current: PlayerId = 0;
  winner: PlayerId | null = null;
  winReason = '';
  log: string[] = [];
  readonly seed: number;

  constructor(seed = Math.floor(Math.random() * 1e9), aiForBoth = false) {
    this.seed = seed;
    this.map = generateMap(seed);
    this.players = [
      { id: 0, name: 'You', color: 0x3b82f6, gold: START_GOLD, isAI: aiForBoth },
      { id: 1, name: 'Rival', color: 0xef4444, gold: START_GOLD, isAI: true },
    ];
    this.placeCapital(0, 0, Math.floor(this.map.width / 3));
    this.placeCapital(1, Math.ceil((this.map.width * 2) / 3), this.map.width);
    this.startTurn(0);
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
    const gold = this.players[p].gold;
    const withGold = (cost: number): Check =>
      gold >= cost ? { ok: true, cost, reason: '' } : fail(`Need ${cost} gold`, cost);

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
        const tooClose = this.map.tiles.some((t) => t.city && hexDistance(t, tile) <= 2);
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
        const wasCapital = tile.capital;
        tile.owner = p;
        if (wasCapital) {
          tile.capital = false;
          this.winner = p;
          this.winReason = `${player.name} captured the enemy capital`;
          this.addLog(`${player.name} captured the capital!`);
        } else if (tile.city && prevOwner !== null) {
          this.addLog(`${player.name} took a city`);
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
    const other: PlayerId = this.current === 0 ? 1 : 0;
    this.current = other;
    if (other === 0) this.turn += 1;
    if (this.turn > TURN_LIMIT) {
      this.finishByScore();
      return;
    }
    this.startTurn(other);
    if (this.players[other].isAI) {
      this.runAI(other);
      if (this.winner === null) this.endTurn();
    }
  }

  // ---------- internals ----------

  private startTurn(p: PlayerId): void {
    this.players[p].gold += this.income(p);
  }

  private addLog(msg: string): void {
    this.log.push(`T${this.turn}: ${msg}`);
    if (this.log.length > 5) this.log.shift();
  }

  private checkWin(): void {
    if (this.winner !== null) return;
    const land = this.landCount();
    for (const pl of this.players) {
      const share = this.ownedTiles(pl.id).length / land;
      if (share >= WIN_SHARE) {
        this.winner = pl.id;
        this.winReason = `${pl.name} controls ${Math.round(share * 100)}% of the land`;
        return;
      }
    }
  }

  private finishByScore(): void {
    this.turn = TURN_LIMIT;
    const a = this.ownedTiles(0).length;
    const b = this.ownedTiles(1).length;
    this.winner = a >= b ? 0 : 1;
    this.winReason = `Turn limit reached: ${a} vs ${b} tiles`;
  }

  private placeCapital(p: PlayerId, colMin: number, colMax: number): void {
    let best: Tile | null = null;
    let bestScore = -1;
    for (const t of this.map.tiles) {
      if (t.col < colMin || t.col >= colMax) continue;
      if (t.terrain !== 'grass' || t.owner !== null) continue;
      const score = this.map.neighbors(t).filter((n) => isLand(n) && n.terrain !== 'mountain').length;
      const centered = -Math.abs(t.row - this.map.height / 2) * 0.1;
      if (score + centered > bestScore) {
        bestScore = score + centered;
        best = t;
      }
    }
    if (!best) {
      // No grass in range: force a small island
      best = this.map.get(Math.floor((colMin + colMax) / 2), Math.floor(this.map.height / 2))!;
      best.height = 2;
      best.terrain = 'grass';
    }
    best.owner = p;
    best.city = true;
    best.capital = true;
    for (const n of this.map.neighbors(best)) {
      if (n.terrain === 'water') {
        n.height = 1;
        n.terrain = 'sand';
      }
      if (n.owner === null) n.owner = p;
    }
  }

  private runAI(p: PlayerId): void {
    for (let i = 0; i < 80 && this.winner === null; i++) {
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
    const wantCity = owned >= cities * 7;
    if (wantCity) {
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
