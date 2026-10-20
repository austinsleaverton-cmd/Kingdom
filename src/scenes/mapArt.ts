// Kenney Hexagon Pack art for the world map (task 10). CC0, from public/assets/hexagon-pack.
// Smooth vector style on purpose: the map reads like a board game, the city screen keeps Tiny Town pixel art,
// and the zoom transition (task 6) covers the switch between the two.
// The 2D pack has no real mountains and its farm field is a blob at map size, so peaks, hills and crop fields
// are drawn here in the same flat, lit-from-the-left style.
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
// Water has no tile in the pack: it stays drawn. Hills and mountains stand on grass, with the drawn
// mounds and peaks on top.
const GROUND_OF: Record<Terrain, Ground | null> = { water: null, sand: 'sand', grass: 'grass', hills: 'grass', mountain: 'grass' };

// A prop: [frame, x, y] in the pack's own pixels from the hex center, (x, y) = the prop's bottom middle.
// The hex is about 69 px from the center to a corner at that size.
type Prop = [string, number, number];

// A set of props and how big to draw them (1 = the pack's own size next to its tiles)
interface PropSet {
  props: Prop[];
  scale: number;
}

// Improvements drawn as props on the terrain tile. Farms are drawn (see field), fisheries too (on water).
const IMPROVEMENT_PROPS: Partial<Record<Improvement, PropSet>> = {
  forest: { props: [['treePine_large.png', 0, -4], ['treePine_large.png', -26, 18], ['treePine_large.png', 24, 20], ['treePine_small.png', -2, 38]], scale: 1 },
  mine: { props: [['mine.png', 14, 34]], scale: 0.8 },
  pasture: { props: [['fence.png', -38, 6], ['fence.png', -18, 10], ['hay.png', 30, 6], ['horseTrough.png', 2, 32]], scale: 0.8 },
};

// Drawn terrain colors: lit (left) side, shaded (right) side
const ROCK_LIT = 0xa3a7ad;
const ROCK_SHADE = 0x787d85;
const ROCK_BACK_LIT = 0x8e939a;
const ROCK_BACK_SHADE = 0x6a6f77;
const SNOW = 0xf4f6f8;
const SNOW_SHADE = 0xd3d9e0;
const HILL_LIT = 0x7cc04f;
const HILL_SHADE = 0x5c9a3a;
const HILL_BACK = 0x6aae45;
const WHEAT = 0xe2bd4f;
const WHEAT_ROW = 0xc49a2f;
const CROP = 0x8fc456;
const CROP_ROW = 0x6e9f3c;
const FIELD_EDGE = 0x8b6a35;

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

// ---------- drawn terrain (world px around the hex center; the hex is 28 px to a corner) ----------

// One peak: lit left face, shaded right face, snowcap with a shaded side
function peak(g: Phaser.GameObjects.Graphics, cx: number, base: number, w: number, h: number, lit: number, shade: number, snow: boolean): void {
  const top = base - h;
  g.fillStyle(lit, 1);
  g.fillTriangle(cx - w / 2, base, cx, top, cx + w / 2, base);
  g.fillStyle(shade, 1);
  g.fillTriangle(cx, top, cx + w / 2, base, cx + w * 0.08, base);
  if (!snow) return;
  const sy = top + h * 0.34;
  const sw = (w / 2) * 0.34;
  g.fillStyle(SNOW, 1);
  g.fillTriangle(cx - sw, sy, cx, top, cx + sw * 0.25, sy + 1.5);
  g.fillStyle(SNOW_SHADE, 1);
  g.fillTriangle(cx, top, cx + sw, sy, cx + sw * 0.25, sy + 1.5);
}

// Mountain: two smaller peaks behind a big one
function drawMountain(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  g.fillStyle(0x000000, 0.14);
  g.fillEllipse(x + 1, y + 12, 38, 7);
  peak(g, x - 9, y + 9, 20, 18, ROCK_BACK_LIT, ROCK_BACK_SHADE, true);
  peak(g, x + 10, y + 10, 19, 15, ROCK_BACK_LIT, ROCK_BACK_SHADE, false);
  peak(g, x + 1, y + 12, 28, 27, ROCK_LIT, ROCK_SHADE, true);
}

// One rounded mound: lit dome with a shaded right half
function mound(g: Phaser.GameObjects.Graphics, cx: number, base: number, r: number, lit: number, shade: number): void {
  g.fillStyle(lit, 1);
  g.beginPath();
  g.slice(cx, base, r, Math.PI, Math.PI * 2, false);
  g.closePath();
  g.fillPath();
  g.fillStyle(shade, 1);
  g.beginPath();
  g.slice(cx, base, r, Math.PI * 1.5, Math.PI * 2, false);
  g.closePath();
  g.fillPath();
}

// Hills: a back mound and two front ones, low and soft so units on top stay readable
function drawHills(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  g.fillStyle(0x000000, 0.1);
  g.fillEllipse(x, y + 10, 36, 6);
  mound(g, x + 3, y + 2, 10, HILL_BACK, HILL_SHADE);
  mound(g, x - 8, y + 10, 10, HILL_LIT, HILL_SHADE);
  mound(g, x + 10, y + 11, 8, HILL_LIT, HILL_SHADE);
}

// Farm: a wheat field and a green crop field side by side, rows running across, with a dirt edge
function drawField(g: Phaser.GameObjects.Graphics, x: number, y: number, flip: boolean): void {
  const w = 15;
  const h = 26;
  const top = y - h / 2;
  const fields: [number, number, number][] = flip
    ? [[x - w - 0.5, CROP, CROP_ROW], [x + 0.5, WHEAT, WHEAT_ROW]]
    : [[x - w - 0.5, WHEAT, WHEAT_ROW], [x + 0.5, CROP, CROP_ROW]];
  for (const [left, fill, rowColor] of fields) {
    g.fillStyle(FIELD_EDGE, 1);
    g.fillRoundedRect(left - 1, top - 1, w + 2, h + 2, 3);
    g.fillStyle(fill, 1);
    g.fillRoundedRect(left, top, w, h, 2.5);
    g.lineStyle(1.5, rowColor, 1);
    for (let ry = top + 4; ry < top + h - 1; ry += 4) g.lineBetween(left + 2, ry, left + w - 2, ry);
  }
}

// Draws the map's terrain tiles, props and castles: tiles at the bottom, drawn peaks / hills / fields and the
// props over the roads, castles over the kingdom colors.
export class HexArt {
  private scene: Phaser.Scene;
  private tiles: Pool | null = null;
  private gfx: Phaser.GameObjects.Graphics | null = null;
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
      if (Object.keys(this.base).length) {
        this.tiles = new Pool(scene, HEX_TILES, depth.tiles);
        // Between the roads and the props
        this.gfx = scene.add.graphics().setDepth((depth.tiles + depth.props) / 2 + 0.005);
      }
    }
    if (scene.textures.exists(HEX_OBJECTS)) {
      scene.textures.get(HEX_OBJECTS).setFilter(Phaser.Textures.FilterMode.LINEAR);
      this.props = new Pool(scene, HEX_OBJECTS, depth.props);
      this.keeps = new Pool(scene, HEX_OBJECTS, depth.keeps);
    }
  }

  clearGround(): void {
    this.tiles?.reset();
    this.gfx?.clear();
    this.props?.reset();
  }

  clearCastles(): void {
    this.keeps?.reset();
  }

  // The terrain tile for one explored hex at world (x, y), plus its peaks / hills / field / props
  drawTile(t: Tile, x: number, y: number): ArtDrawn {
    const ground = GROUND_OF[t.terrain];
    const choices = ground ? this.base[ground] : undefined;
    const g = this.gfx;
    if (!this.tiles || !g || !choices || !choices.length) return NO_ART;
    this.tiles.put(choices[hash(t.col, t.row) % choices.length], x, y, this.tileScale, 0.5, 0.5);
    if (t.city) return { ground: true, improvement: false }; // the castle stands here
    if (t.terrain === 'mountain') drawMountain(g, x, y);
    else if (t.terrain === 'hills') drawHills(g, x, y);
    if (t.improvement === 'farm') {
      drawField(g, x, y, (hash(t.col, t.row) & 1) === 1);
      return { ground: true, improvement: true };
    }
    const imp = t.improvement ? IMPROVEMENT_PROPS[t.improvement] : undefined;
    return { ground: true, improvement: imp ? this.place(imp, x, y) : false };
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
