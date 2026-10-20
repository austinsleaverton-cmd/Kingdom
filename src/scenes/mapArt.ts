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

// A set of props and how big to draw them (1 = the pack's own size next to its tiles).
// Kept small on purpose so units, borders and labels stay easy to read on top.
interface PropSet {
  props: Prop[];
  scale: number;
}

const TERRAIN_PROPS: Partial<Record<Terrain, PropSet>> = {
  // Rolling ground: two small rocks
  hills: { props: [['rockGrey_medium3.png', -14, 18], ['rockBrown_large.png', 18, 26]], scale: 0.6 },
  // A peak: one crag with a pebble beside it
  mountain: { props: [['rockGrey_large.png', 0, 30], ['rockGrey_small6.png', 34, 34]], scale: 0.65 },
};

// Improvements that replace the whole tile (none right now: the full farmhouse tile was too busy)
const IMPROVEMENT_TILE: Partial<Record<Improvement, string>> = {};

// Improvements drawn as props on the terrain tile. Fisheries stay drawn (they're on water).
const IMPROVEMENT_PROPS: Partial<Record<Improvement, PropSet>> = {
  forest: { props: [['treePine_large.png', 0, -4], ['treePine_large.png', -26, 18], ['treePine_large.png', 24, 20], ['treePine_small.png', -2, 38]], scale: 1 },
  farm: { props: [['farmland.png', -4, 30]], scale: 0.75 },
  mine: { props: [['mine.png', -4, 26], ['rockGrey_small1.png', 30, 34]], scale: 0.8 },
  pasture: { props: [['fence.png', -38, 6], ['fence.png', -18, 10], ['hay.png', 30, 6], ['horseTrough.png', 2, 32]], scale: 0.8 },
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

// Reusable scaled images from one sheet at one depth. Every redraw hands them out again in the same order,
// so things drawn later stay in front. (Blitters can't be used here: they ignore scale when rendering.)
class Pool {
  private scene: Phaser.Scene;
  private key: string;
  private depth: number;
  private items: Phaser.GameObjects.Image[] = [];
  private used = 0;

  constructor(scene: Phaser.Scene, key: string, depth: number) {
    this.scene = scene;
    this.key = key;
    this.depth = depth;
  }

  reset(): void {
    for (let i = 0; i < this.used; i++) this.items[i].setVisible(false);
    this.used = 0;
  }

  // An image of frame f with its origin (ox, oy) at world (x, y)
  put(f: string, x: number, y: number, scale: number, ox: number, oy: number): void {
    let img = this.items[this.used];
    if (!img) {
      img = this.scene.add.image(0, 0, this.key, f).setDepth(this.depth);
      this.items.push(img);
    } else img.setFrame(f);
    img.setOrigin(ox, oy).setScale(scale).setPosition(x, y).setVisible(true);
    this.used++;
  }
}

// Draws the map's terrain tiles, props and castles: tiles at the bottom, props over the roads, castles over the
// kingdom colors.
export class HexArt {
  private scene: Phaser.Scene;
  private tiles: Pool | null = null;
  private props: Pool | null = null;
  private keeps: Pool | null = null;
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
      if (Object.keys(this.base).length) this.tiles = new Pool(scene, HEX_TILES, depth.tiles);
    }
    if (scene.textures.exists(HEX_OBJECTS)) {
      scene.textures.get(HEX_OBJECTS).setFilter(Phaser.Textures.FilterMode.LINEAR);
      this.props = new Pool(scene, HEX_OBJECTS, depth.props);
      this.keeps = new Pool(scene, HEX_OBJECTS, depth.keeps);
    }
  }

  clearGround(): void {
    this.tiles?.reset();
    this.props?.reset();
  }

  clearCastles(): void {
    this.keeps?.reset();
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
    this.tiles.put(frame, x, y, this.tileScale, 0.5, 0.5);
    if (t.city) return { ground: true, improvement: whole }; // the castle stands here
    const imp = t.improvement ? IMPROVEMENT_PROPS[t.improvement] : undefined;
    if (imp) return { ground: true, improvement: this.place(imp, x, y) };
    const deco = TERRAIN_PROPS[t.terrain];
    if (!whole && deco) this.place(deco, x, y);
    return { ground: true, improvement: whole };
  }

  // A city's castle (the large one on capitals). Returns the world y of its top, or null if the art is missing.
  castle(x: number, y: number, capital: boolean): number | null {
    const pool = this.keeps;
    const f = capital ? 'castle_large.png' : 'castle_small.png';
    if (!pool) return null;
    const tex = this.scene.textures.get(HEX_OBJECTS);
    if (!tex.has(f)) return null;
    const bottom = y + KEEP_BASE;
    pool.put(f, x, bottom, this.keepScale, 0.5, 1);
    return bottom - tex.get(f).height * this.keepScale;
  }

  // All or nothing: if any prop is missing, draw none and let the caller use the drawn version.
  // Positions shrink with the set's scale too, so small props stay bunched in the middle of the hex.
  private place(set: PropSet, x: number, y: number): boolean {
    const pool = this.props;
    if (!pool || !set.props.length) return false;
    const tex = this.scene.textures.get(HEX_OBJECTS);
    if (!set.props.every(([f]) => tex.has(f))) return false;
    const s = this.propScale;
    const k = s * set.scale;
    for (const [f, px, py] of [...set.props].sort((p, q) => p[2] - q[2])) pool.put(f, x + px * k, y + py * k, k, 0.5, 1);
    return true;
  }
}
