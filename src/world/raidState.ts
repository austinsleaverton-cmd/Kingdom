import type { GameState } from './game';
import type { Building, Tile } from './tile';
export interface Camp { unitId: number; nextRaid: number }
export interface Repair { building: Building; owner: number; turns: number }
export interface RaidState {
  version: 1; enabled: boolean; faction: number; initialized: boolean;
  lastRound: number; nextCamp: number; camps: Camp[];
  damaged: Record<number, Building[]>; repairs: Record<number, Repair>;
}
declare module './game' {
  interface GameOptions { barbarians?: boolean }
  interface GameState { raids?: RaidState }
}
// Non-playing faction: no capital, regular turns, income, diplomacy or victory claim.
export function raidState(g: GameState): RaidState {
  if (g.raids) return g.raids;
  const faction = g.players.length;
  g.raids = { version: 1, enabled: g.options.barbarians !== false, faction, initialized: false,
    lastRound: g.turn, nextCamp: g.turn + 12, camps: [], damaged: {}, repairs: {} };
  g.players.push({ id: faction, name: 'Barbarians', color: 0x9a5b35, gold: 0, stone: 0, claims: 0, isAI: true, alive: false });
  g.explored.push(new Uint8Array(g.map.tiles.length));
  return g.raids;
}
export const isBarbarian = (g: GameState, p: number | null): boolean =>
  p !== null && g.raids !== undefined && p === g.raids.faction;
export const campFor = (g: GameState, id: number): Camp | undefined => g.raids?.camps.find((c) => c.unitId === id);
export const damaged = (g: GameState, c: Tile, b: Building): boolean => g.raids?.damaged[g.tileIndex(c)]?.includes(b) ?? false;
export const activeAmenity = (g: GameState, c: Tile, b: Building): boolean => c.buildings.includes(b) && !damaged(g, c, b);
export function raidLog(g: GameState, message: string): void {
  g.log.push(`T${g.turn}: ${message}`);
  if (g.log.length > 6) g.log.splice(0, g.log.length - 6);
}
