// World terrain is baked into small, dirty-tracked canvas textures, not thousands of scene images.
// Kenney props/castles remain CC0. Explicit terrain colors carry a faint, rim-free grain.
import Phaser from 'phaser';
import type { Tile, Improvement } from '../world/tile';
import { CHUNK_SIZE, HEX_RADIUS, HEX_WIDTH, GROUND_FRAME, center, chunkKeys, intersects, terrainStamp, viewBounds } from './mapCache';
import type { Bounds } from './mapCache';

export const HEX_TILES = 'kenney-hex-tiles';
export const HEX_OBJECTS = 'kenney-hex-objects';
const DIR = 'assets/hexagon-pack/Spritesheets/';
const FOG = '#0d1320';
const COLORS = ['#2f7fc4', '#d9c38a', '#6bb352', '#4f9443', '#8c7a4c', '#9a9a9a'];
let nextId = 0;
type Neighbor = (t: Tile, direction: number) => Tile | undefined | null;
type Seen = (t: Tile) => boolean;
type Prop = [string, number, number];
const PROPS: Partial<Record<Improvement, { scale: number; props: Prop[] }>> = {
  forest: { scale: 1, props: [['treePine_large.png', 0, -4], ['treePine_large.png', -26, 18], ['treePine_large.png', 24, 20], ['treePine_small.png', -2, 38]] },
  mine: { scale: 0.8, props: [['mine.png', 14, 34]] },
  pasture: { scale: 0.8, props: [['fence.png', -38, 6], ['fence.png', -18, 10], ['hay.png', 30, 6], ['horseTrough.png', 2, 32]] },
};
export function loadMapArt(scene: Phaser.Scene): void {
  if (!scene.textures.exists(HEX_TILES)) scene.load.atlasXML(HEX_TILES, `${DIR}hexagonAll_sheet.png`, `${DIR}hexagonAll_sheet.xml`);
  if (!scene.textures.exists(HEX_OBJECTS)) scene.load.atlasXML(HEX_OBJECTS, `${DIR}hexagonObjects_sheet.png`, `${DIR}hexagonObjects_sheet.xml`);
}
interface Chunk {
  bounds: Bounds;
  tiles: Tile[];
  dirty: boolean;
  texture?: Phaser.Textures.CanvasTexture;
  image?: Phaser.GameObjects.Image;
  scale: number;
  lastUsed: number;
}
function hex(ctx: CanvasRenderingContext2D, x: number, y: number, radius = HEX_RADIUS): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (60 * i - 30) * Math.PI / 180;
    const px = x + radius * Math.cos(a), py = y + radius * Math.sin(a);
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath();
}
function line(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, b: number): void {
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(a, b); ctx.stroke();
}
function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string): void {
  ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
}
function triangle(ctx: CanvasRenderingContext2D, points: number[], color: string): void {
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(points[0], points[1]); ctx.lineTo(points[2], points[3]); ctx.lineTo(points[4], points[5]); ctx.closePath(); ctx.fill();
}

// Keep the current resolution while zoom hovers around the old cutoff.
export function terrainResolution(previous: number, zoom: number): number {
  return previous === 0.5 ? (zoom > 0.72 ? 1 : 0.5) : (zoom < 0.58 ? 0.5 : 1);
}

export class HexArt {
  private chunks = new Map<string, Chunk>();
  private stamps = new Map<Tile, string>();
  private source: Tile[] | null = null;
  private seen: Seen = () => false;
  private neighbor: Neighbor = () => undefined;
  private swatches = new Map<string, HTMLCanvasElement>();
  private keeps: Phaser.GameObjects.Image[] = [];
  private keepCount = 0;
  private clock = 0;
  private id = nextId++;
  private viewStamp = '';
  private viewScale = 1;

  constructor(private scene: Phaser.Scene, private radius: number, private depth: { tiles: number; props: number; keeps: number }) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
    // Deliberately fixed frames, no heuristic ranking of center colors. Use only a central
    // swatch, expanded under a true hex clip, so no brown/cream bevel enters the ground.
    if (scene.textures.exists(HEX_TILES)) {
      const tex = scene.textures.get(HEX_TILES);
      for (const [ground, name] of Object.entries(GROUND_FRAME)) {
        if (!tex.has(name)) continue;
        const f = tex.get(name);
        const canvas = document.createElement('canvas');
        canvas.width = 120; canvas.height = 140;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        // Atlas frame names do not guarantee their center pixels have the expected hue.
        // Make the palette authoritative; source pixels contribute only faint texture.
        // Normal source-over at 12% cannot turn the green grass base gray, even when
        // the sampled source is entirely gray, white or black.
        ctx.fillStyle = ground === 'grass' ? COLORS[2] : COLORS[1];
        ctx.fillRect(0, 0, 120, 140);
        ctx.globalAlpha = 0.12;
        ctx.drawImage(tex.getSourceImage() as CanvasImageSource, f.cutX + 42, f.cutY + 52, 36, 36, 0, 0, 120, 140);
        ctx.globalAlpha = 1;
        this.swatches.set(ground, canvas);
      }
    }
    if (scene.textures.exists(HEX_OBJECTS)) scene.textures.get(HEX_OBJECTS).setFilter(Phaser.Textures.FilterMode.LINEAR);
  }

  // Cheap field comparison on actions. Painting/uploading happens ONLY for dirty, visible chunks.
  drawMap(tiles: Tile[], seen: Seen, neighbor: Neighbor): void {
    this.seen = seen;
    this.neighbor = neighbor;
    if (tiles !== this.source) {
      this.clearChunks();
      this.source = tiles;
      for (const t of tiles) for (const key of chunkKeys(t)) {
        let chunk = this.chunks.get(key);
        if (!chunk) {
          const [x, y] = key.split(',').map(Number);
          chunk = { bounds: { x: x * CHUNK_SIZE, y: y * CHUNK_SIZE, width: CHUNK_SIZE, height: CHUNK_SIZE }, tiles: [], dirty: true, scale: 0, lastUsed: 0 };
          this.chunks.set(key, chunk);
        }
        chunk.tiles.push(t);
      }
    }
    for (const t of tiles) {
      let roads = 0;
      if (seen(t) && (t.road || t.city)) for (let d = 0; d < 6; d++) {
        const n = neighbor(t, d);
        if (n && seen(n) && (n.road || n.city)) roads |= 1 << d;
      }
      const stamp = terrainStamp(t, seen(t), roads);
      if (this.stamps.get(t) === stamp) continue;
      this.stamps.set(t, stamp);
      for (const key of chunkKeys(t)) {
        const c = this.chunks.get(key);
        if (c) c.dirty = true;
      }
    }
    this.viewStamp = '';
    this.updateView(true);
  }

  updateView(visible: boolean): void {
    const cam = this.scene.cameras.main;
    const stamp = `${visible}/${cam.scrollX}/${cam.scrollY}/${cam.zoom}/${cam.width}/${cam.height}`;
    if (stamp === this.viewStamp) return;
    this.viewStamp = stamp;
    const view = viewBounds(cam.scrollX, cam.scrollY, cam.width, cam.height, cam.zoom);
    const scale = terrainResolution(this.viewScale, cam.zoom);
    this.viewScale = scale;
    const frame = ++this.clock;
    for (const [key, c] of this.chunks) {
      const show = visible && intersects(c.bounds, view);
      if (show) {
        c.lastUsed = frame;
        if (!c.texture || c.dirty || c.scale !== scale) this.bake(key, c, scale);
      }
      c.image?.setVisible(show);
    }
    // Bound retained offscreen GPU memory. Visible chunks use half-resolution at distant zoom.
    let bytes = 0;
    const cold: Chunk[] = [];
    for (const c of this.chunks.values()) if (c.texture) {
      bytes += (CHUNK_SIZE * c.scale) ** 2 * 4;
      if (c.lastUsed !== frame) cold.push(c);
    }
    cold.sort((a, b) => a.lastUsed - b.lastUsed);
    for (const c of cold) {
      if (bytes <= 32 * 1024 * 1024) break;
      bytes -= (CHUNK_SIZE * c.scale) ** 2 * 4;
      this.release(c);
    }
  }

  private bake(key: string, c: Chunk, scale: number): void {
    if (c.scale !== scale) this.release(c);
    if (!c.texture) {
      const texture = this.scene.textures.createCanvas(`map-chunk-${this.id}-${key}`, CHUNK_SIZE * scale, CHUNK_SIZE * scale);
      if (!texture) throw new Error('Could not allocate terrain chunk');
      c.texture = texture;
      c.image = this.scene.add.image(c.bounds.x, c.bounds.y, texture.key).setOrigin(0).setDepth(this.depth.tiles).setScale(1 / scale);
      texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
      c.scale = scale;
    }
    const ctx = c.texture.context;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.texture.width, c.texture.height);
    ctx.setTransform(scale, 0, 0, scale, -c.bounds.x * scale, -c.bounds.y * scale);
    // Ground first, then roads, then props. Every chunk clips at its own rectangular extent.
    for (const t of c.tiles) this.ground(ctx, t);
    ctx.strokeStyle = 'rgba(122,90,50,0.95)'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    for (const t of c.tiles) {
      if (!this.seen(t) || !(t.road || t.city)) continue;
      const a = center(t);
      let linked = false;
      for (let d = 0; d < 6; d++) {
        const n = this.neighbor(t, d);
        if (!n || !this.seen(n) || !(n.road || n.city)) continue;
        linked = true;
        const b = center(n);
        // Each tile owns its half of a road. Invalidation on either side of a chunk edge
        // therefore refreshes both halves without relying on tile iteration order.
        line(ctx, a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      if (t.road && !linked) ellipse(ctx, a.x, a.y, 4, 4, '#7a5a32');
    }
    for (const t of c.tiles) if (this.seen(t) && !t.city) this.details(ctx, t);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    c.texture.refresh();
    c.dirty = false;
  }

  private ground(ctx: CanvasRenderingContext2D, t: Tile): void {
    const { x, y } = center(t);
    const seen = this.seen(t);
    hex(ctx, x, y, HEX_RADIUS + 0.25);
    ctx.fillStyle = seen ? COLORS[t.height] ?? COLORS[2] : FOG;
    ctx.fill();
    if (seen && t.terrain !== 'water') {
      const swatch = this.swatches.get(t.terrain === 'sand' ? 'sand' : 'grass');
      if (swatch) {
        ctx.save(); ctx.clip();
        ctx.drawImage(swatch, x - HEX_WIDTH / 2 - 0.5, y - HEX_RADIUS - 0.5, HEX_WIDTH + 1, HEX_RADIUS * 2 + 1);
        ctx.restore();
      }
    }
    hex(ctx, x, y);
    ctx.strokeStyle = seen ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1; ctx.stroke();
    if (seen && t.terrain === 'water') {
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1.5;
      const flip = (t.col + t.row) & 1 ? -1 : 1;
      for (const [dx, dy] of [[-7 * flip, -5], [6 * flip, 7]]) for (const offset of [-3, 3]) {
        ctx.beginPath(); ctx.arc(x + dx + offset, y + dy, 3, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      }
    }
  }

  private details(ctx: CanvasRenderingContext2D, t: Tile): void {
    const { x, y } = center(t);
    if (t.terrain === 'mountain') {
      for (const [dx, base, w, h] of [[-9, 9, 20, 18], [10, 10, 19, 15], [1, 12, 28, 27]]) {
        triangle(ctx, [x + dx - w / 2, y + base, x + dx, y + base - h, x + dx + w / 2, y + base], '#a3a7ad');
        triangle(ctx, [x + dx, y + base - h, x + dx + w / 2, y + base, x + dx + w * 0.08, y + base], '#787d85');
        triangle(ctx, [x + dx - w * 0.17, y + base - h * 0.66, x + dx, y + base - h, x + dx + w * 0.17, y + base - h * 0.66], '#f4f6f8');
      }
    } else if (t.terrain === 'hills') {
      for (const [dx, dy, r] of [[3, 2, 10], [-8, 10, 10], [10, 11, 8]]) {
        ctx.fillStyle = '#7cc04f'; ctx.beginPath(); ctx.arc(x + dx, y + dy, r, Math.PI, Math.PI * 2); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#5c9a3a'; ctx.beginPath(); ctx.moveTo(x + dx, y + dy); ctx.arc(x + dx, y + dy, r, Math.PI * 1.5, Math.PI * 2); ctx.closePath(); ctx.fill();
      }
    }
    if (t.improvement === 'farm') {
      const flip = (t.col + t.row) & 1;
      for (let i = 0; i < 2; i++) {
        const left = x - 15.5 + i * 16;
        const wheat = i === flip;
        ctx.fillStyle = '#8b6a35'; ctx.fillRect(left - 1, y - 14, 17, 28);
        ctx.fillStyle = wheat ? '#e2bd4f' : '#8fc456'; ctx.fillRect(left, y - 13, 15, 26);
        ctx.strokeStyle = wheat ? '#c49a2f' : '#6e9f3c'; ctx.lineWidth = 1.5;
        for (let ry = y - 9; ry < y + 12; ry += 4) line(ctx, left + 2, ry, left + 13, ry);
      }
      return;
    }
    const props = t.improvement ? PROPS[t.improvement] : undefined;
    if (props && this.scene.textures.exists(HEX_OBJECTS)) {
      const tex = this.scene.textures.get(HEX_OBJECTS);
      if (props.props.every(([name]) => tex.has(name))) {
        const s = HEX_WIDTH / 120 * props.scale;
        for (const [name, dx, dy] of props.props) {
          const f = tex.get(name);
          const w = f.cutWidth * s, h = f.cutHeight * s;
          ctx.drawImage(tex.getSourceImage() as CanvasImageSource, f.cutX, f.cutY, f.cutWidth, f.cutHeight, x + dx * s - w / 2, y + dy * s - h, w, h);
        }
        return;
      }
    }
    // Missing-asset fallbacks remain readable; fisheries always use the drawn fallback.
    if (t.improvement === 'forest') {
      for (const dx of [-8, 8, 0]) triangle(ctx, [x + dx - 6, y + 9, x + dx, y - 7, x + dx + 6, y + 9], '#1f5e2e');
    } else if (t.improvement === 'mine') {
      ctx.fillStyle = '#2b2b2b'; ctx.fillRect(x - 7, y + 1, 14, 9); ellipse(ctx, x, y + 5, 2.5, 2.5, '#d4a017');
    } else if (t.improvement === 'pasture') {
      ctx.strokeStyle = '#8b5a2b'; ctx.lineWidth = 2;
      line(ctx, x - 12, y + 2, x + 12, y + 2); line(ctx, x - 12, y + 8, x + 12, y + 8);
      for (const dx of [-11, -4, 4, 11]) line(ctx, x + dx, y - 1, x + dx, y + 11);
    } else if (t.improvement === 'fishery') {
      ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x - 4, y + 4, 7, 0, Math.PI * 2); ctx.stroke();
      line(ctx, x - 11, y + 4, x + 3, y + 4); line(ctx, x - 4, y - 3, x - 4, y + 11);
      for (const [dx, dy] of [[-11, 4], [3, 4], [-4, -3], [-4, 11]]) ellipse(ctx, x + dx, y + dy, 2, 2, '#f97316');
      ellipse(ctx, x + 8, y - 6, 4, 2, '#7dd3fc');
    }
  }

  clearCastles(): void {
    for (let i = 0; i < this.keepCount; i++) this.keeps[i].setVisible(false);
    this.keepCount = 0;
  }
  castle(x: number, y: number, capital: boolean): number | null {
    if (!this.scene.textures.exists(HEX_OBJECTS)) return null;
    const tex = this.scene.textures.get(HEX_OBJECTS);
    const name = capital ? 'castle_large.png' : 'castle_small.png';
    if (!tex.has(name)) return null;
    const scale = this.radius * Math.sqrt(3) / 120 * 0.8;
    let image = this.keeps[this.keepCount];
    if (!image) {
      image = this.scene.add.image(0, 0, HEX_OBJECTS, name).setOrigin(0.5, 1).setDepth(this.depth.keeps);
      this.keeps.push(image);
    }
    image.setFrame(name).setPosition(x, y + 12).setScale(scale).setVisible(true);
    this.keepCount++;
    return y + 12 - tex.get(name).height * scale;
  }
  private release(c: Chunk): void {
    c.image?.destroy(); c.image = undefined;
    if (c.texture) this.scene.textures.remove(c.texture.key);
    c.texture = undefined; c.scale = 0;
  }
  private clearChunks(): void {
    for (const c of this.chunks.values()) this.release(c);
    this.chunks.clear(); this.stamps.clear(); this.viewStamp = '';
  }
  destroy(): void {
    this.clearChunks();
    for (const keep of this.keeps) keep.destroy();
    this.keeps = []; this.swatches.clear(); this.source = null;
  }
}
