// Pure geometry/invalidation helpers. No Phaser or browser dependency.
import type { Tile } from '../world/tile';

export const CHUNK_SIZE = 512;
export const HEX_RADIUS = 28;
export const HEX_WIDTH = HEX_RADIUS * Math.sqrt(3);
export const GROUND_FRAME = {
  grass: 'grass_01.png',
  sand: 'sand_01.png',
} as const;

export interface Bounds { x: number; y: number; width: number; height: number }
export function center(t: Pick<Tile, 'col' | 'row'>): { x: number; y: number } {
  return { x: HEX_WIDTH * (t.col + 0.5 * (t.row & 1)), y: HEX_RADIUS * 1.5 * t.row };
}
export function intersects(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
export function chunkKeys(t: Pick<Tile, 'col' | 'row'>): string[] {
  const p = center(t);
  // Enough for the tile, tree props and half-road stubs crossing chunk boundaries.
  const pad = 64;
  const out: string[] = [];
  for (let y = Math.floor((p.y - pad) / CHUNK_SIZE); y <= Math.floor((p.y + pad) / CHUNK_SIZE); y++) {
    for (let x = Math.floor((p.x - pad) / CHUNK_SIZE); x <= Math.floor((p.x + pad) / CHUNK_SIZE); x++) out.push(`${x},${y}`);
  }
  return out;
}
export function terrainStamp(t: Tile, explored: boolean, roadNeighbors: number): string {
  // Never cache hidden terrain details, including roads across the explored frontier.
  return explored ? `${t.height}/${t.terrain}/${+t.city}/${t.improvement ?? ''}/${+t.road}/${roadNeighbors}` : '?';
}
export function viewBounds(scrollX: number, scrollY: number, width: number, height: number, zoom: number): Bounds {
  // Phaser zooms about the center of the viewport, not its upper-left corner.
  return { x: scrollX + width / 2 - width / (2 * zoom), y: scrollY + height / 2 - height / (2 * zoom), width: width / zoom, height: height / zoom };
}
