// Kenney Hexagon Pack art for the world map (task 10). CC0, from public/assets/hexagon-pack.
// Smooth vector style on purpose: the map reads like a board game, the city screen keeps Tiny Town pixel art,
// and the zoom transition (task 6) covers the switch between the two.
// Every lookup can fail (a sheet didn't load, a frame is missing). Then the caller gets NO_ART / null back and
// draws the old flat colors instead, so the game always runs.
import Phaser from 'phaser';
import type { Improvement, Terrain, Tile } from '../world/tile';

export const HEX_TILES = 'kenney-hex-tiles'; // full hex tiles: terrain plus a few medieval building tiles
export const HEX_OBJECTS = 'kenney-hex-objects'; // loose props: castles, trees, rocks, fences
const DIR = 'assets/hexagon-pack/Spritesheets/';

// Pack tiles are pointy-top hexes, 120 wide and 140 tall (same orientation as the map)
const TILE_W = 120;
const TILE_H = 140;
const OVERLAP = 1.015; // tiles a hair bigger than the hex so no seams show between them
const KEEP_SIZE = 0.8; // castles a bit smaller than 1:1 so the name tag and units still fit
const KEEP_BASE = 12; // world px below the hex center where a castle's base sits

// Queue both sheets (called from the map's preload). A failed download just leaves the sheet out.
export function loadMapArt(scene: Phaser.Scene): void {
  if (!scene.textures.exists(HEX_TILES)) scene.load.atlasXML(HEX_TILES, `${DIR}hexagonAll_sheet.png`, `${DIR}hexagonAll_sheet.xml`);
  if (!scene.textures.exists(HEX_OBJECTS)) scene.load.atlasXML(HEX_OBJECTS, `${DIR}hexagonObjects_sheet.png`, `${DIR}hexagonObjects_sheet.xml`);
}

// What drawTile managed to draw: the ground (terrain tile) and/or the improvement on it
export interface ArtDrawn {
  ground: boolean;
  improvement: boolean;
}
export const NO_ART: ArtDrawn = { ground: false, improvement: false };

type Ground = 'grass' | 'dirt' | 'sand' | 'stone';
const GROUNDS: Ground[] = ['grass', 'dirt', 'sand', 'stone'];
// Water has no tile in the pack: it stays drawn. Hills sit on dirt, mountains on stone.
const GROUND_OF: Record<Terrain, Ground | null> = { water: null, sand: 'sand', grass: 'grass', hills: 'dirt', mountain: 'stone' };

// A prop: [frame, x, y] in the pack's own pixels from the hex center, (x, y) = the prop's bottom middle.
// The hex is about 69 px from the center to a corner at that size.
type Prop = [string, number, number];

const TERRAIN_PROPS: Partial<Record<Terrain, Prop[]>> = {
  hills: [['rockBrown_small.png', 10, -14], ['rockGrey_medium3.png', -16, 22], ['rockGrey_small5.png', 26, 30]],
  mountain: [['rockGrey_large.png', 0, 34], ['rockGrey_small1.png', -36, 38], ['rockGrey_small6.png', 36, 36]],
};

// Improvements that replace the whole tile
const IMPROVEMENT_TILE: Partial<Record<Improvement, string>> = { farm: 'medieval_farm.png' };

// Improvements drawn as props on the terrain tile. Fisheries stay drawn (they're on water).
const IMPROVEMENT_PROPS: Partial<Record<Improvement, Prop[]>> = {
  forest: [['treePine_large.png', 0, -4], ['treePine_large.png', -26, 18], ['treePine_large.png', 24, 20], ['treePine_small.png', -2, 38]],
  mine: [['mine.png', -4, 26], ['rockGrey_small1.png', 30, 34]],
  pasture: [['fence.png', -38, 6], ['fence.png', -18, 10], ['hay.png', 30, 6], ['horseTrough.png', 2, 32]],
};

const hash = (col: number, row: number): number => ((col * 73856093) ^ (row * 19349663)) >>> 0;

// The pack has 19 versions of each ground, many with trees, buildings or water baked in. Pick the plain ones
// automatically: the full hexes whose middle has the least color variation. Close runners-up are kept too,
// so the land doesn't look stamped.
function pickGround(tex: Phaser.Textures.Texture): Partial<Record<Ground, string[]>> {
  const out: Partial<Record<Ground, string[]>> = {};
  const canvas = document.createElement('canvas');
  canvas.width = TILE_W;
  canvas.height = TILE_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = tex.getSourceImage() as CanvasImageSource;
  for (const ground of GROUNDS) {
    const scored: [string, number][] = [];
    for (let i = 1; i <= 19; i++) {
      const name = `${ground}_${String(i).padStart(2, '0')}.png`;
      if (!tex.has(name)) continue;
      const f = tex.get(name);
      if (f.width !== TILE_W || f.height !== TILE_H) continue; // the pack's few small hexes
      let score = i; // can't read pixels: just go in file order
      if (ctx) {
        try {
          score = variation(ctx, img, f.cutX, f.cutY);
        } catch {
          score = i;
        }
      }
      if (Number.isFinite(score)) scored.push([name, score]);
    }
    scored.sort((a, b) => a[1] - b[1]);
    if (!scored.length) continue;
    const best = scored[0][1];
    out[ground] = scored.filter(([, s], k) => k < 3 && s <= best * 1.5 + 20).map(([n]) => n);
  }
  return out;
}

// Color variation in the middle of a tile (Infinity when it isn't a solid hex)
function variation(ctx: CanvasRenderingContext2D, img: CanvasImageSource, sx: number, sy: number): number {
  ctx.clearRect(0, 0, TILE_W, TILE_H);
  ctx.drawImage(img, sx, sy, TILE_W, TILE_H, 0, 0, TILE_W, TILE_H);
  const d = ctx.getImageData(0, 0, TILE_W, TILE_H).data;
  const cx = TILE_W / 2;
  const cy = TILE_H / 2;
  const r = 44;
  let n = 0;
  const sum = [0, 0, 0];
  const sq = [0, 0, 0];
  for (let py = cy - r; py <= cy + r; py += 2) {
    for (let px = cx - r; px <= cx + r; px += 2) {
      if ((px - cx) ** 2 + (py - cy) ** 2 > r * r) continue;
      const i = (py * TILE_W + px) * 4;
      if (d[i + 3] < 250) return Infinity;
      for (let c = 0; c < 3; c++) {
        sum[c] += d[i + c];
        sq[c] += d[i + c] * d[i + c];
      }
      n++;
    }
  }
  if (!n) return Infinity;
  let v = 0;
  for (let c = 0; c < 3; c++) v += sq[c] / n - (sum[c] / n) ** 2;
  return v;
}

// Draws the map's terrain tiles, props and castles. Three blitters (cheap even on huge maps):
// tiles at the bottom, props over the roads, castles over the kingdom colors.
export class HexArt {
  private scene: Phaser.Scene;
  private tiles: Phaser.GameObjects.Blitter | null = null;
  private props: Phaser.GameObjects.Blitter | null = null;
  private keeps: Phaser.GameObjects.Blitter | null = null;
  private base: Partial<Record<Ground, string[]>> = {};
  private tileScale: number;
  private propScale: number;
  private keepScale: number;

  constructor(scene: Phaser.Scene, hexRadius: number, depth: { tiles: number; props: number; keeps: number }) {
    this.scene = scene;
    const s = (hexRadius * Math.sqrt(3)) / TILE_W;
    this.tileScale = s * OVERLAP;
    this.propScale = s;
    this.keepScale = s * KEEP_SIZE;
    if (scene.textures.exists(HEX_TILES)) {
      const tex = scene.textures.get(HEX_TILES);
      tex.setFilter(Phaser.Textures.FilterMode.LINEAR);
      this.base = pickGround(tex);
      if (Object.keys(this.base).length) this.tiles = scene.add.blitter(0, 0, HEX_TILES).setDepth(depth.tiles).setScale(this.tileScale);
    }
    if (scene.textures.exists(HEX_OBJECTS)) {
      scene.textures.get(HEX_OBJECTS).setFilter(Phaser.Textures.FilterMode.LINEAR);
      this.props = scene.add.blitter(0, 0, HEX_OBJECTS).setDepth(depth.props).setScale(this.propScale);
      this.keeps = scene.add.blitter(0, 0, HEX_OBJECTS).setDepth(depth.keeps).setScale(this.keepScale);
    }
  }

  clearGround(): void {
    this.tiles?.clear();
    this.props?.clear();
  }

  clearCastles(): void {
    this.keeps?.clear();
  }

  // The terrain tile for one explored hex at world (x, y), plus its rocks / trees / improvement
  drawTile(t: Tile, x: number, y: number): ArtDrawn {
    const ground = GROUND_OF[t.terrain];
    const choices = ground ? this.base[ground] : undefined;
    if (!this.tiles || !choices || !choices.length) return NO_ART;
    const special = t.improvement ? IMPROVEMENT_TILE[t.improvement] : undefined;
    const tex = this.scene.textures.get(HEX_TILES);
    const whole = special !== undefined && tex.has(special);
    const frame = whole && special ? special : choices[hash(t.col, t.row) % choices.length];
    this.tiles.create(x / this.tileScale - TILE_W / 2, y / this.tileScale - TILE_H / 2, frame);
    if (t.city) return { ground: true, improvement: whole }; // the castle stands here
    const imp = t.improvement ? IMPROVEMENT_PROPS[t.improvement] : undefined;
    if (imp) return { ground: true, improvement: this.place(imp, x, y) };
    if (!whole) this.place(TERRAIN_PROPS[t.terrain] ?? [], x, y);
    return { ground: true, improvement: whole };
  }

  // A city's castle (the large one on capitals). Returns the world y of its top, or null if the art is missing.
  castle(x: number, y: number, capital: boolean): number | null {
    const b = this.keeps;
    const f = capital ? 'castle_large.png' : 'castle_small.png';
    if (!b) return null;
    const tex = this.scene.textures.get(HEX_OBJECTS);
    if (!tex.has(f)) return null;
    const fr = tex.get(f);
    const bottom = y + KEEP_BASE;
    b.create(x / this.keepScale - fr.width / 2, bottom / this.keepScale - fr.height, f);
    return bottom - fr.height * this.keepScale;
  }

  // All or nothing: if any prop is missing, draw none and let the caller use the drawn version
  private place(list: readonly Prop[], x: number, y: number): boolean {
    const b = this.props;
    if (!b || !list.length) return false;
    const tex = this.scene.textures.get(HEX_OBJECTS);
    if (!list.every(([f]) => tex.has(f))) return false;
    for (const [f, px, py] of [...list].sort((p, q) => p[2] - q[2])) {
      const fr = tex.get(f);
      b.create(x / this.propScale + px - fr.width / 2, y / this.propScale + py - fr.height, f);
    }
    return true;
  }
}
