// City screen: the inside of one of your cities as its own Phaser scene (docs/CITY_BUILDER.md).
// A grassy town with the castle (the Keep) in the middle and the 6 plots as one tile each (no built-in roads:
// you paint your own paths in decorate mode), and the map hex each plot faces as a small marker just
// past the edge. Drag to pan, pinch or wheel to zoom.
// Coastal towns: the sea comes in from the sides whose plots face water on the map (world/grid.ts waterTiles),
// with a grass shore where it meets land. The Keep and the land plots always stay dry.
// Decorate mode (task 5): tap an open tile to place the picked decoration, drag a decoration to move it, and with
// a path, grass (or the eraser) picked a one-finger drag paints (two fingers still pan and zoom, right-drag pans on
// desktop). Grass tiles just show the plain ground: they keep the wild trees and flowers off that tile.
// Art: Kenney tilesheets (cityArt.ts), one city tile = 3x3 art tiles, styled after Kenney's Tiny Town sample:
// full houses on the grass, a towered castle, tree clumps along the edge. If a sheet or a tile is missing, that
// piece falls back to the old drawn look (colored shapes and emoji), so the screen always works.
// Rendering and input only: the DOM side panel (CityView.ts) owns the selection and does all the building and
// decorating, so a drag or a pinch can never build anything by accident.
import Phaser from 'phaser';
import type { GameState } from '../world/game';
import { facingTile, openPlots, plotBonus, plotTerrain } from '../world/city';
import type { Outside } from '../world/city';
import { DECOS, DECO_ORDER, decoAt, decoList, fenceLinks, isGrassKind, isPathKind, moveReason, pathLinks, placeCheck } from '../world/deco';
import { PLOT_TILES, gridRadius, plotAtTile, plotLevel, reservedTile, tileKey, waterTiles } from '../world/grid';
import { BUILDINGS, LEVEL_NAMES, PLOT_COUNT } from '../world/tile';
import type { Building, PlotTerrain, Terrain, Tile } from '../world/tile';
import { BUILDER_PEOPLE, PLOT_PEOPLE, keepPeople, makeCitySprites } from './citySprites';
import type { PxActor } from './citySprites';
import {
  ART, BUILDING_ART, BUILT_GROUND, CASTLE_ART, DECOR_ART, FENCE, FOUNTAIN_POOL, GRASS, PATH_DIRT, PATH_STONES, PLOT_GROUND, RPG,
  SCENERY, TINY, WATER_LIFT, canDraw, crispCityArt, hasFrame, loadCityArt,
} from './cityArt';
import type { Cell, Sheet } from './cityArt';

export const CITY_SCENE = 'city';
export type CityPick = number | 'keep';

// Decorate mode as the panel sees it (null = not decorating)
export interface DecoUI {
  tool: number | 'erase' | null; // DECO_ORDER index, the eraser, or nothing (tap to pick, drag to move)
  picked: [number, number] | null; // the placed decoration that's selected
}

// What the scene needs from the side panel
export interface CityLink {
  state: GameState;
  city: Tile;
  me: number;
  sel(): CityPick; // what's selected (plot index or the Keep)
  view(): { x: number; y: number; w: number; h: number }; // screen area not covered by the DOM header/panel
  pick(p: CityPick): void; // tapped a plot, a facing marker or the Keep
  close(): void; // O
  escape(): void; // Esc: drop the tool, leave decorate mode, then back to the map
  deco(): DecoUI | null;
  decoTap(dx: number, dy: number): void; // tapped a tile in decorate mode
  decoPaint(dx: number, dy: number, first: boolean): void; // a paint/erase stroke went over a tile
  decoPaintEnd(): void;
  decoMove(fx: number, fy: number, tx: number, ty: number): void; // dropped a dragged decoration
  undo(): void;
}

const T = ART * 3; // tile size in world px: 3x3 Kenney tiles
const MARKER_OUT = 0.85; // facing markers sit this many tiles past the edge
const MARKER_R = T * 0.3; // facing marker size
const DRAG_PX = 8; // movement before a press counts as a pan, not a tap
const LABEL_MIN = 30; // tile size on screen (px) below which names hide (icons stay)
const PERSON_SCALE = 1.5;
const NAME_Y = T / 2 + 1; // names sit on the bottom edge of their plot
// The castle: its box in world px around the city center (tapping anywhere on it picks the Keep)
const CASTLE_LEFT = -(CASTLE_ART.w * ART) / 2;
const CASTLE_TOP = -40;
const CASTLE_BOTTOM = CASTLE_TOP + CASTLE_ART.h * ART;

// The sea: the RPG pack's pond tiles as a 9-slice (grass shore on the outer edges and corners, open water in the middle)
const SEA = { tl: 2, t: 3, tr: 4, l: 59, mid: 60, r: 61, bl: 116, b: 117, br: 118 };

const GRASS_COLOR = 0x62a948;
const GRASS_LIGHT = 0x6db552;
const GRASS_DARK = 0x58993f;
const PLOT_COLOR: Record<PlotTerrain, number> = { water: 0x1f5f9e, sand: 0xd9c38a, grass: 0x7cc463, hills: 0x8c7a4c };
const PLOT_NAME: Record<PlotTerrain, string> = { water: 'Water', sand: 'Sand', grass: 'Grass', hills: 'Hills' };
const OUT_COLOR: Record<Terrain, number> = { water: 0x1f5f9e, sand: 0xd9c38a, grass: 0x6bb352, hills: 0x8c7a4c, mountain: 0x9a9a9a };
const OUT_ICON: Record<Outside, string> = { farm: '\u{1F33E}', pasture: '\u{1F40E}', mine: '\u26CF\uFE0F', forest: '\u{1F332}', fishery: '\u{1F41F}', road: '\u{1F6E4}\uFE0F' };

type Layer = 'ground' | 'obj';
type XY = [number, number];

// Facing marker i in tile units: past the edge in plot i's world direction (0 E, 1 NE, 2 NW, 3 W, 4 SW, 5 SE)
function markerAt(i: number, r: number): [number, number] {
  const o = r + MARKER_OUT;
  const h = r * 0.5;
  const at: [number, number][] = [[o, 0], [h, -o], [-h, -o], [-o, 0], [-h, o], [h, o]];
  return at[i];
}

function hexPts(cx: number, cy: number, rad: number): Phaser.Math.Vector2[] {
  const pts: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < 6; i++) {
    const a = Phaser.Math.DegToRad(60 * i - 30);
    pts.push(new Phaser.Math.Vector2(cx + rad * Math.cos(a), cy + rad * Math.sin(a)));
  }
  return pts;
}

// Same pattern every time you open the same city: a 0..1 number per tile and salt
function hash01(dx: number, dy: number, seed: number, salt: number): number {
  let h = Math.imul(dx + 101, 73856093) ^ Math.imul(dy + 211, 19349663) ^ Math.imul(salt + 7, 83492791) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// The tiles on a straight line from a to b (so a fast drag doesn't skip any)
function lineTiles(a: XY, b: XY): XY[] {
  const out: XY[] = [];
  const steps = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
  for (let i = 1; i <= steps; i++) {
    out.push([Math.round(a[0] + ((b[0] - a[0]) * i) / steps), Math.round(a[1] + ((b[1] - a[1]) * i) / steps)]);
  }
  return out;
}

// A tool that paints by dragging: a path, grass or the eraser
function paints(ui: DecoUI | null): boolean {
  return !!ui && (ui.tool === 'erase' || (typeof ui.tool === 'number' && isPathKind(ui.tool)));
}

export class CityScene extends Phaser.Scene {
  static link: CityLink | null = null;
  private static instance: CityScene | null = null;

  private ground!: Phaser.GameObjects.Graphics;
  private scenery!: Phaser.GameObjects.Graphics;
  private marks!: Phaser.GameObjects.Graphics;
  private gridG!: Phaser.GameObjects.Graphics;
  private hoverG!: Phaser.GameObjects.Graphics;
  private selG!: Phaser.GameObjects.Graphics;
  // Kenney tiles, one blitter per sheet and layer (missing sheet = null, the drawn fallback is used)
  private blit: Record<Layer, Record<Sheet, Phaser.GameObjects.Blitter | null>> = {
    ground: { t: null, r: null },
    obj: { t: null, r: null },
  };
  private texts: Phaser.GameObjects.Text[] = [];
  private nText = 0;
  private labels: Phaser.GameObjects.Text[] = []; // name labels, hidden when zoomed far out
  private people: Phaser.GameObjects.Sprite[] = [];
  private nPeople = 0;
  private bigLabels = true;
  private minZoom = 0.3;
  private maxZoom = 3;
  private ready = false;
  private reduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  private pressed = false;
  private dragging = false;
  private downX = 0;
  private downY = 0;
  private pinchDist = 0;
  private pinchMid: { x: number; y: number } | null = null;
  private pinching = false;
  private panOnly = false; // right or middle mouse button: always pans
  private downTile: XY | null = null;
  private stroke = false; // painting or erasing paths
  private lastPaint: XY | null = null;
  private moving: { from: XY; to: XY } | null = null; // dragging a decoration

  constructor() {
    super(CITY_SCENE);
    CityScene.instance = this;
  }

  // The panel changed (selection, something built): redraw if the screen is up
  static refresh(): void {
    const s = CityScene.instance;
    if (s?.ready && s.sys.isActive()) s.redraw();
  }

  // Opened again while already running: fit the new city to the screen
  static refit(): void {
    const s = CityScene.instance;
    if (s?.ready && s.sys.isActive()) s.show();
  }

  // The map loads the sheets first; this only matters if the city screen ever starts on its own
  preload(): void {
    loadCityArt(this);
  }

  create(): void {
    makeCitySprites(this);
    crispCityArt(this);
    this.cameras.main.setBackgroundColor('#141a26');
    this.ground = this.add.graphics().setDepth(0);
    this.gridG = this.add.graphics().setDepth(0.5);
    this.scenery = this.add.graphics().setDepth(1.5);
    this.marks = this.add.graphics().setDepth(1);
    this.selG = this.add.graphics().setDepth(4);
    this.hoverG = this.add.graphics().setDepth(4.1);
    const sheets: [Sheet, string][] = [['t', TINY], ['r', RPG]];
    for (const [s, key] of sheets) {
      if (!this.textures.exists(key)) continue;
      this.blit.ground[s] = this.add.blitter(0, 0, key).setDepth(s === 't' ? 0.4 : 0.45);
      this.blit.obj[s] = this.add.blitter(0, 0, key).setDepth(s === 't' ? 1.6 : 1.65);
    }
    this.ready = true;
    this.setupInput();
    const onResize = () => {
      if (this.sys.isActive()) this.show();
    };
    this.scale.on('resize', onResize);
    this.events.once('shutdown', () => this.scale.off('resize', onResize));
    this.events.on('wake', () => this.show());
    this.events.on('sleep', () => {
      this.resetPointer();
      this.input.setDefaultCursor('default');
    });
    this.show();
  }

  update(): void {
    const big = this.cameras.main.zoom * T >= LABEL_MIN;
    if (big === this.bigLabels) return;
    this.bigLabels = big;
    for (const l of this.labels) l.setVisible(big);
  }

  private show(): void {
    if (!CityScene.link) return;
    this.resetPointer();
    this.fit();
    this.redraw();
  }

  private view(): { x: number; y: number; w: number; h: number } {
    const v = CityScene.link?.view();
    const cam = this.cameras.main;
    if (!v || v.w < 80 || v.h < 80) return { x: 0, y: 0, w: cam.width, h: cam.height };
    return v;
  }

  // Whole town plus the facing markers fits the free part of the screen, Keep in the middle of it
  private fit(): void {
    const link = CityScene.link;
    if (!link) return;
    const cam = this.cameras.main;
    const v = this.view();
    const extent = (gridRadius(link.city) + MARKER_OUT + 0.6) * 2 * T;
    const z = Phaser.Math.Clamp(Math.min(v.w / extent, v.h / extent), 0.25, 4);
    this.minZoom = z * 0.75;
    this.maxZoom = Math.max(z * 4, 3);
    cam.setZoom(z);
    this.lookAt(0, 0);
    this.bigLabels = z * T >= LABEL_MIN;
  }

  // Put world point (wx, wy) in the middle of the free screen area.
  // Phaser cameras zoom around their center: screen = (world - scroll - size/2) * zoom + size/2
  private lookAt(wx: number, wy: number): void {
    const cam = this.cameras.main;
    const v = this.view();
    const ax = v.x + v.w / 2;
    const ay = v.y + v.h / 2;
    cam.scrollX = wx - cam.width / 2 - (ax - cam.width / 2) / cam.zoom;
    cam.scrollY = wy - cam.height / 2 - (ay - cam.height / 2) / cam.zoom;
  }

  // The world point in the middle of the free screen area
  private lookingAt(): { x: number; y: number } {
    const cam = this.cameras.main;
    const v = this.view();
    return {
      x: cam.scrollX + cam.width / 2 + (v.x + v.w / 2 - cam.width / 2) / cam.zoom,
      y: cam.scrollY + cam.height / 2 + (v.y + v.h / 2 - cam.height / 2) / cam.zoom,
    };
  }

  // Never lose the town: the middle of the view stays over it
  private clampCam(): void {
    const link = CityScene.link;
    if (!link) return;
    const lim = (gridRadius(link.city) + 0.5) * T;
    const c = this.lookingAt();
    const x = Phaser.Math.Clamp(c.x, -lim, lim);
    const y = Phaser.Math.Clamp(c.y, -lim, lim);
    if (x !== c.x || y !== c.y) this.lookAt(x, y);
  }

  private zoomAt(factor: number, sx: number, sy: number): void {
    const cam = this.cameras.main;
    const before = cam.getWorldPoint(sx, sy);
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * factor, this.minZoom, this.maxZoom));
    cam.preRender(); // refresh the camera matrix so the next lookup uses the new zoom
    const after = cam.getWorldPoint(sx, sy);
    cam.scrollX += before.x - after.x;
    cam.scrollY += before.y - after.y;
    this.clampCam();
  }

  // ---------- input ----------

  private resetPointer(): void {
    this.endStroke();
    this.pressed = false;
    this.dragging = false;
    this.pinching = false;
    this.pinchDist = 0;
    this.pinchMid = null;
    this.panOnly = false;
    this.downTile = null;
    if (this.moving) {
      this.moving = null;
      if (this.ready) this.redraw();
    }
    this.hoverG?.clear();
  }

  // Two fingers: zoom by how far apart they are, pan by how the middle between them moves
  private handlePinch(): boolean {
    const a = this.input.pointer1;
    const b = this.input.pointer2;
    if (!a?.isDown || !b?.isDown) {
      this.pinchDist = 0;
      this.pinchMid = null;
      return false;
    }
    this.pinching = true;
    this.dragging = true;
    const dist = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (this.pinchMid) {
      const cam = this.cameras.main;
      cam.scrollX -= (mid.x - this.pinchMid.x) / cam.zoom;
      cam.scrollY -= (mid.y - this.pinchMid.y) / cam.zoom;
    }
    if (this.pinchDist > 0 && dist > 0) this.zoomAt(dist / this.pinchDist, mid.x, mid.y);
    else this.clampCam();
    this.pinchDist = dist;
    this.pinchMid = mid;
    return true;
  }

  private decoUI(): DecoUI | null {
    return CityScene.link?.deco() ?? null;
  }

  // The town tile under a screen point, or null off the grid
  private tileAt(sx: number, sy: number): XY | null {
    const link = CityScene.link;
    if (!link) return null;
    const w = this.cameras.main.getWorldPoint(sx, sy);
    const dx = Math.round(w.x / T);
    const dy = Math.round(w.y / T);
    const r = gridRadius(link.city);
    return Math.abs(dx) > r || Math.abs(dy) > r ? null : [dx, dy];
  }

  // A placed decoration (not a path) that can be dragged around
  private movable(t: XY | null): boolean {
    const link = CityScene.link;
    if (!link || !t) return false;
    const k = decoAt(link.city, t[0], t[1]);
    return k !== null && !isPathKind(k);
  }

  private paintTo(t: XY, first: boolean): void {
    const link = CityScene.link;
    if (!link) return;
    if (first || !this.lastPaint) {
      link.decoPaint(t[0], t[1], true);
      this.lastPaint = t;
      return;
    }
    if (t[0] === this.lastPaint[0] && t[1] === this.lastPaint[1]) return;
    for (const s of lineTiles(this.lastPaint, t)) link.decoPaint(s[0], s[1], false);
    this.lastPaint = t;
  }

  private endStroke(): void {
    if (!this.stroke) return;
    this.stroke = false;
    this.lastPaint = null;
    CityScene.link?.decoPaintEnd();
  }

  private setupInput(): void {
    this.input.mouse?.disableContextMenu();
    if (this.input.manager.pointersTotal < 2) this.input.addPointer(1); // second finger for pinch zoom

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.input.pointer1?.isDown && this.input.pointer2?.isDown) {
        // A second finger: this is a pinch, so stop painting or dragging (what's painted stays)
        this.pinching = true;
        this.endStroke();
        if (this.moving) {
          this.moving = null;
          this.redraw();
        }
      }
      this.pressed = true;
      this.dragging = false;
      this.downX = p.x;
      this.downY = p.y;
      this.panOnly = p.rightButtonDown() || p.middleButtonDown();
      this.downTile = this.tileAt(p.x, p.y);
      this.lastPaint = null;
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.handlePinch()) return;
      if (this.pinching) return; // one finger lifted mid-pinch: wait until both are up
      const ui = this.decoUI();
      if (this.pressed && p.isDown) {
        if (!this.dragging && Math.hypot(p.x - this.downX, p.y - this.downY) > DRAG_PX) {
          this.dragging = true;
          if (ui && !this.panOnly && this.downTile) {
            if (paints(ui)) {
              this.stroke = true;
              this.hoverG.clear();
              this.paintTo(this.downTile, true);
            } else if (this.movable(this.downTile)) {
              this.moving = { from: this.downTile, to: this.downTile };
              this.hoverG.clear();
            }
          }
        }
        if (this.dragging) {
          if (this.stroke) {
            const t = this.tileAt(p.x, p.y);
            if (t) this.paintTo(t, false);
            return;
          }
          if (this.moving) {
            const t = this.tileAt(p.x, p.y) ?? this.moving.from;
            if (t[0] !== this.moving.to[0] || t[1] !== this.moving.to[1]) {
              this.moving.to = t;
              this.redraw();
            }
            return;
          }
          const cam = this.cameras.main;
          cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
          cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
          this.clampCam();
          return;
        }
      }
      if (ui) {
        this.hover(ui, p.wasTouch ? null : this.tileAt(p.x, p.y));
        return;
      }
      // Desktop: pointer cursor over anything you can tap
      this.input.setDefaultCursor(this.pickAt(p.x, p.y) !== null ? 'pointer' : 'default');
    });

    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.pinching) {
        // Finish the pinch once every finger is up; never count it as a tap
        if (!this.input.pointer1?.isDown && !this.input.pointer2?.isDown) this.resetPointer();
        return;
      }
      const tap = this.pressed && !this.dragging;
      this.pressed = false;
      this.dragging = false;
      if (this.stroke) {
        this.endStroke();
        return;
      }
      if (this.moving) {
        const m = this.moving;
        this.moving = null;
        if (m.to[0] !== m.from[0] || m.to[1] !== m.from[1]) CityScene.link?.decoMove(m.from[0], m.from[1], m.to[0], m.to[1]);
        else this.redraw();
        return;
      }
      if (!tap || p.rightButtonReleased()) return;
      if (this.decoUI()) {
        const t = this.tileAt(p.x, p.y);
        if (t) CityScene.link?.decoTap(t[0], t[1]);
        return;
      }
      const hit = this.pickAt(p.x, p.y);
      if (hit !== null) CityScene.link?.pick(hit);
    });

    // Same feel as the map: scale by how far the wheel/trackpad moved (ctrl+wheel = macOS trackpad pinch)
    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      const ev = p.event as WheelEvent;
      const delta = Phaser.Math.Clamp(dy, -60, 60);
      this.zoomAt(Math.exp(-delta * (ev.ctrlKey ? 0.01 : 0.0015)), p.x, p.y);
    });

    // Esc: drop the tool / leave decorate mode / back to the map. O: back to the map. Ctrl/Cmd+Z: undo.
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        CityScene.link?.undo();
        return;
      }
      if (e.key === 'Escape') CityScene.link?.escape();
      else if (e.key.toUpperCase() === 'O') CityScene.link?.close();
    });
  }

  // Desktop, decorate mode: outline the tile under the mouse, green where the picked tool can go
  private hover(ui: DecoUI, t: XY | null): void {
    const g = this.hoverG;
    g.clear();
    const link = CityScene.link;
    if (!link || !t) {
      this.input.setDefaultCursor('default');
      return;
    }
    const [dx, dy] = t;
    const here = decoAt(link.city, dx, dy);
    let color = 0xffffff;
    if (typeof ui.tool === 'number') {
      const pathOver = isPathKind(ui.tool) && here !== null && isPathKind(here);
      color = pathOver || placeCheck(link.state, link.city, dx, dy, ui.tool, link.me).ok ? 0x4ade80 : 0xf87171;
    } else if (ui.tool === 'erase') {
      color = here !== null ? 0xf87171 : 0xffffff;
    } else if (here === null || isPathKind(here)) {
      this.input.setDefaultCursor('default');
      return;
    }
    this.input.setDefaultCursor(ui.tool === null ? 'grab' : 'pointer');
    g.lineStyle(2, color, 0.9);
    g.strokeRect(dx * T - T / 2 + 2, dy * T - T / 2 + 2, T - 4, T - 4);
  }

  // What's under a screen point: a facing marker (counts as its plot), the castle, or a plot tile
  private pickAt(sx: number, sy: number): number | 'keep' | null {
    const link = CityScene.link;
    if (!link) return null;
    const w = this.cameras.main.getWorldPoint(sx, sy);
    const r = gridRadius(link.city);
    for (let i = 0; i < PLOT_COUNT; i++) {
      if (!facingTile(link.city, i)) continue;
      const [mx, my] = markerAt(i, r);
      if (Math.hypot(w.x - mx * T, w.y - my * T) < T * 0.45) return i; // a bit bigger than the marker, easier to hit
    }
    if (w.x >= CASTLE_LEFT && w.x <= -CASTLE_LEFT && w.y >= CASTLE_TOP && w.y <= CASTLE_BOTTOM) return 'keep';
    const dx = Math.round(w.x / T);
    const dy = Math.round(w.y / T);
    if (Math.abs(dx) > r || Math.abs(dy) > r) return null;
    if (dx === 0 && dy === 0) return 'keep';
    return plotAtTile(dx, dy);
  }

  // ---------- Kenney tiles ----------

  // One art tile with its top-left at (x, y). False if that tile isn't available.
  private bob(layer: Layer, s: Sheet, f: number, x: number, y: number, alpha = 1): boolean {
    const b = this.blit[layer][s];
    if (!b || !hasFrame(this, s, f)) return false;
    const bob = b.create(Math.round(x), Math.round(y), f);
    if (alpha < 1) bob.setAlpha(alpha);
    return true;
  }

  // A picture with its top-left at (left, top); cells are in art tiles
  private cells(layer: Layer, cells: readonly Cell[], left: number, top: number, alpha = 1): void {
    for (const k of cells) this.bob(layer, k.s, k.f, left + k.x * ART, top + k.y * ART, alpha);
  }

  // A building filling its plot (centered at x, y), with its props alongside. False = use the emoji instead.
  private building(b: Building, x: number, y: number, t: PlotTerrain, alpha: number): boolean {
    const pic = BUILDING_ART[b];
    // Water plots are part of the sea now, so the Harbor stands in it (no little pond in front any more)
    const under = t === 'water' ? [] : BUILT_GROUND[t];
    if (!canDraw(this, [...pic.cells, ...pic.props, ...under])) return false;
    const left = x - T / 2;
    const top = y - T / 2;
    this.cells('ground', under, left, top, alpha);
    this.cells('obj', pic.cells, left, top - (t === 'water' ? WATER_LIFT : 0), alpha);
    this.cells('obj', pic.props, left, top, alpha);
    return true;
  }

  // ---------- drawing ----------

  private redraw(): void {
    const link = CityScene.link;
    if (!link || !this.ready) return;
    const { state: s, city: c } = link;
    const sel = link.sel();
    const ui = link.deco();
    const r = gridRadius(c);
    const open = openPlots(c, s.isSimple(link.me));
    const seed = c.col * 92821 + c.row * 68917;
    this.nText = 0;
    this.nPeople = 0;
    this.labels = [];
    for (const layer of Object.values(this.blit)) for (const b of Object.values(layer)) b?.clear();

    // Ground: one field of grass (the tile grid only shows in decorate mode)
    const g = this.ground;
    g.clear();
    const half = (r + 0.5) * T;
    const artGrass = hasFrame(this, 't', GRASS.plain) && hasFrame(this, 't', GRASS.tufts) && hasFrame(this, 't', GRASS.flowers);
    g.fillStyle(0x000000, 0.35);
    g.fillRoundedRect(-half + 6, -half + 10, 2 * half, 2 * half, artGrass ? 6 : 22);
    g.fillStyle(0x3d6e2c, 1);
    g.fillRoundedRect(-half - 4, -half - 4, 2 * half + 8, 2 * half + 8, artGrass ? 6 : 24);
    g.fillStyle(GRASS_COLOR, 1);
    g.fillRoundedRect(-half, -half, 2 * half, 2 * half, artGrass ? 2 : 20);
    if (artGrass) {
      const n = (2 * r + 1) * 3;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const v = hash01(i, j, seed, 20);
          const f = v < 0.02 ? GRASS.flowers : v < 0.3 ? GRASS.tufts : GRASS.plain;
          this.bob('ground', 't', f, -half + i * ART, -half + j * ART);
        }
      }
    } else {
      this.drawnGrass(g, r, seed);
    }

    // Coastal towns: the sea comes in from the sides that face water on the map
    const water = waterTiles(c);
    if (water.size) this.drawWater(g, water, r);

    // Painted paths lie on the ground, under everything else (grass tiles draw nothing: the ground is already grass)
    for (const [dx, dy, k] of decoList(c)) if (isPathKind(k)) this.path(g, c, dx, dy, k);

    // Decorations and the wild scenery, row by row so lower things overlap the ones behind them.
    // Scenery first, so the castle and buildings stand in front of any tree that leans over them.
    this.scenery.clear();
    this.drawTown(c, r, seed, water);

    // The Keep: the towered castle, or a stone yard with an emoji if the art is missing
    const keepName = `Keep${c.walls ? ` \u00b7 walls ${c.walls}` : ''}`;
    if (canDraw(this, CASTLE_ART.cells)) {
      this.cells('obj', CASTLE_ART.cells, CASTLE_LEFT, CASTLE_TOP);
      if (sel === 'keep' && !ui) this.txt(0, CASTLE_BOTTOM + 7, keepName, 9, { label: true });
    } else {
      g.fillStyle(0x6b7280, 1);
      g.fillCircle(0, 0, T * 0.62);
      g.fillStyle(0x2a2f3a, 1);
      g.fillRoundedRect(-T / 2 + 2, -T / 2 + 2, T - 4, T - 4, 8);
      g.lineStyle(2 + c.walls * 1.5, 0x9ca3af, 1);
      g.strokeRoundedRect(-T / 2 + 3, -T / 2 + 3, T - 6, T - 6, 8);
      this.txt(0, -5, '\u{1F3F0}', 24);
      this.txt(0, 15, keepName, 9, { label: true });
    }
    this.crowd(keepPeople(c.walls), 0, 0, 3);

    // The 6 plots. Building names only show on the selected plot (the panel has the rest), like Kenney's sample.
    for (let i = 0; i < PLOT_COUNT; i++) {
      const [tx, ty] = PLOT_TILES[i];
      const x = tx * T;
      const y = ty * T;
      const t = plotTerrain(c, i);
      const locked = i >= open;
      const b = c.placed[i];
      const proj = c.projectPlot === i ? c.project : null;
      const picked = sel === i && !ui;
      if (locked && !b) {
        // Locked: a faint outline of the plot to come, small lock and level name
        this.plotGround(g, x, y, t, 0.25);
        this.txt(x, y - 4, '\u{1F512}', 12, { alpha: 0.6 });
        this.txt(x, y + 12, LEVEL_NAMES[plotLevel(i)], 8, { alpha: 0.7, small: true });
        continue;
      }
      if (b) {
        if (this.building(b, x, y, t, 1)) {
          if (picked) this.txt(x, y + NAME_Y, BUILDINGS[b].name, 10, { label: true });
        } else {
          this.plotGround(g, x, y, t, 1);
          this.txt(x, y - 6, BUILDINGS[b].icon, 22);
          this.txt(x, y + 13, BUILDINGS[b].name, 10, { label: true });
        }
        this.crowd(PLOT_PEOPLE[b], x, y, i);
      } else if (proj) {
        // Under construction: a see-through version of what's going up, with the turns left
        if (this.building(proj, x, y, t, 0.45)) this.txt(x, y + NAME_Y, `${c.projectTurns}t left`, 10, { label: true });
        else {
          this.plotGround(g, x, y, t, 1);
          this.txt(x, y - 6, BUILDINGS[proj].icon, 22, { alpha: 0.45 });
          this.txt(x, y + 13, `${c.projectTurns}t left`, 10, { label: true });
        }
        this.crowd(BUILDER_PEOPLE, x, y, i);
      } else {
        // Open plot: its ground (dirt lot, sand or hills; water plots are open sea) with a + to build
        this.plotGround(g, x, y, t, 1);
        this.txt(x, y - 5, '+', 26, { alpha: ui ? 0.4 : 0.85 });
        this.txt(x, y + 14, PLOT_NAME[t], 9, { label: true });
      }
    }

    // What each plot faces on the map: a small hex past the edge. Faint unless it's paying a bonus (green)
    // or its plot is selected (white outline).
    const m = this.marks;
    m.clear();
    for (let i = 0; i < PLOT_COUNT; i++) {
      const t = facingTile(c, i);
      if (!t) continue;
      const [mx, my] = markerAt(i, r);
      const x = mx * T;
      const y = my * T;
      const b = c.placed[i];
      const paying = !!b && plotBonus(c, i, b).notes.some((n) => n.includes('facing'));
      const picked = sel === i && !ui;
      if (paying) {
        const [px, py] = PLOT_TILES[i];
        this.dots(m, px * T, py * T, x, y, 0x4ade80, 0.6);
      }
      const pts = hexPts(x, y, MARKER_R);
      m.fillStyle(OUT_COLOR[t.terrain], paying ? 0.9 : picked ? 0.6 : 0.25);
      m.fillPoints(pts, true);
      if (paying || picked) {
        m.lineStyle(paying ? 2.5 : 1.5, paying ? 0x4ade80 : 0xffffff, paying ? 1 : 0.7);
        m.strokePoints(pts, true);
      }
      const work = t.improvement ?? (t.road ? 'road' : null);
      if (work) this.txt(x, y, OUT_ICON[work], 10, { alpha: paying ? 1 : picked ? 0.8 : 0.35 });
    }

    // Decorate mode: a faint tile grid (stronger while a path, grass or the eraser is picked)
    const gg = this.gridG;
    gg.clear();
    if (ui) {
      gg.lineStyle(1, 0xffffff, paints(ui) ? 0.22 : 0.1);
      for (let k = -r; k <= r + 1; k++) {
        gg.lineBetween((k - 0.5) * T, -half, (k - 0.5) * T, half);
        gg.lineBetween(-half, (k - 0.5) * T, half, (k - 0.5) * T);
      }
    }

    // Selection: the picked decoration in decorate mode, otherwise the castle for the Keep or the plot
    this.selG.clear();
    let box: { x: number; y: number; w: number; h: number } | null = null;
    if (ui) {
      const at = this.moving ? this.moving.to : ui.picked;
      if (at) box = { x: at[0] * T - T / 2 + 1, y: at[1] * T - T / 2 + 1, w: T - 2, h: T - 2 };
    } else if (sel === 'keep' && canDraw(this, CASTLE_ART.cells)) {
      box = { x: CASTLE_LEFT - 2, y: CASTLE_TOP - 2, w: -2 * CASTLE_LEFT + 4, h: CASTLE_BOTTOM - CASTLE_TOP + 4 };
    } else {
      const [sx, sy] = sel === 'keep' ? [0, 0] : PLOT_TILES[sel];
      box = { x: sx * T - T / 2 + 1, y: sy * T - T / 2 + 1, w: T - 2, h: T - 2 };
    }
    if (box) {
      const bad = !!this.moving && !this.dropOk(this.moving);
      this.selG.lineStyle(6, 0x000000, 0.4);
      this.selG.strokeRoundedRect(box.x, box.y, box.w, box.h, 6);
      this.selG.lineStyle(3, bad ? 0xf87171 : 0xfacc15, 1);
      this.selG.strokeRoundedRect(box.x, box.y, box.w, box.h, 6);
    }

    for (let k = this.nText; k < this.texts.length; k++) this.texts[k].setVisible(false);
    for (let k = this.nPeople; k < this.people.length; k++) this.people[k].setVisible(false).stop();
  }

  // The sea: open water in the middle of each water tile, a grass shore on any side that touches land.
  // Past the edge of the town counts as the edge tile, so the water runs out of the picture instead of
  // stopping at a bank.
  private drawWater(g: Phaser.GameObjects.Graphics, water: Set<string>, r: number): void {
    const edge = (v: number) => Math.max(-r, Math.min(r, v));
    const wet = (dx: number, dy: number) => water.has(tileKey(edge(dx), edge(dy)));
    const W = SEA;
    const art = canDraw(this, Object.values(W).map((f): Cell => ({ s: 'r', f, x: 0, y: 0 })));
    for (const key of water) {
      const [dx, dy] = key.split(',').map(Number);
      const left = dx * T - T / 2;
      const top = dy * T - T / 2;
      if (!art) {
        g.fillStyle(PLOT_COLOR.water, 1);
        g.fillRect(left, top, T, T);
        continue;
      }
      // true = land on that side
      const n = !wet(dx, dy - 1);
      const s = !wet(dx, dy + 1);
      const w = !wet(dx - 1, dy);
      const e = !wet(dx + 1, dy);
      const grid = [
        [n && w ? W.tl : n ? W.t : w ? W.l : W.mid, n ? W.t : W.mid, n && e ? W.tr : n ? W.t : e ? W.r : W.mid],
        [w ? W.l : W.mid, W.mid, e ? W.r : W.mid],
        [s && w ? W.bl : s ? W.b : w ? W.l : W.mid, s ? W.b : W.mid, s && e ? W.br : s ? W.b : e ? W.r : W.mid],
      ];
      grid.forEach((row, j) => row.forEach((f, i) => this.bob('ground', 'r', f, left + i * ART, top + j * ART)));
    }
  }

  // Can the dragged decoration land where it is now? (red outline when not; it snaps back on drop)
  private dropOk(m: { from: XY; to: XY }): boolean {
    const link = CityScene.link;
    return !!link && moveReason(link.city, m.from[0], m.from[1], m.to[0], m.to[1]) === '';
  }

  // Your decorations, then the wild trees and flowers on any tile you haven't used, top row first.
  // No wild scenery grows on the water.
  private drawTown(c: Tile, r: number, seed: number, water: Set<string>): void {
    const g = this.scenery;
    const art = canDraw(this, [
      { s: 't', f: SCENERY.tallTop, x: 0, y: 0 }, { s: 't', f: SCENERY.tallBottom, x: 0, y: 0 },
      { s: 't', f: SCENERY.small, x: 0, y: 0 }, { s: 't', f: SCENERY.bush, x: 0, y: 0 },
    ]);
    const mv = this.moving;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const k = decoAt(c, dx, dy);
        if (k !== null) {
          const lifted = !!mv && mv.from[0] === dx && mv.from[1] === dy;
          if (!isPathKind(k)) this.deco(c, k, dx, dy, lifted ? 0.3 : 1);
          continue; // anything you put here (a path or grass too) replaces the wild scenery
        }
        if (mv && mv.to[0] === dx && mv.to[1] === dy) continue; // room for the one being dragged here
        if (water.has(tileKey(dx, dy))) continue;
        if (reservedTile(dx, dy) || (Math.abs(dx) <= 1 && Math.abs(dy) <= 1)) continue;
        if (PLOT_TILES.some(([px, py]) => Math.abs(px - dx) + Math.abs(py - dy) === 1)) continue; // leave room around plots
        const roll = hash01(dx, dy, seed, 10);
        if (art) {
          this.artScenery(dx, dy, seed, roll, Math.max(Math.abs(dx), Math.abs(dy)) === r);
          continue;
        }
        if (roll > 0.42) continue;
        const x = dx * T + (hash01(dx, dy, seed, 11) - 0.5) * T * 0.35;
        const y = dy * T + (hash01(dx, dy, seed, 12) - 0.5) * T * 0.35;
        if (roll < 0.2) this.tree(g, x, y, 0.85 + hash01(dx, dy, seed, 13) * 0.35);
        else if (roll < 0.33) this.bush(g, x, y);
        else this.rock(g, x, y);
        if (roll < 0.1) this.tree(g, x + T * 0.28, y + T * 0.18, 0.7);
      }
    }
    // The decoration being dragged, on top of everything at the tile under your finger
    if (mv && (mv.to[0] !== mv.from[0] || mv.to[1] !== mv.from[1])) {
      const k = decoAt(c, mv.from[0], mv.from[1]);
      if (k !== null) this.deco(c, k, mv.to[0], mv.to[1], 0.85);
    }
  }

  // One decoration on tile (dx, dy)
  private deco(c: Tile, k: number, dx: number, dy: number, alpha: number): void {
    const id = DECO_ORDER[k];
    const left = dx * T - T / 2;
    const top = dy * T - T / 2;
    if (id === 'fence') {
      if (this.fence(c, dx, dy, left, top, alpha)) return;
    } else if (id === 'banner') {
      this.banner(dx * T, dy * T, c.owner !== null ? CityScene.link?.state.players[c.owner]?.color ?? 0x3b82f6 : 0x9ca3af, alpha);
      return;
    } else if (id === 'fountain') {
      const cells = DECOR_ART.fountain;
      if (canDraw(this, cells)) {
        this.cells('ground', cells.slice(0, FOUNTAIN_POOL), left, top, alpha);
        this.cells('obj', cells.slice(FOUNTAIN_POOL), left, top, alpha);
        return;
      }
    } else if (canDraw(this, DECOR_ART[id])) {
      this.cells('obj', DECOR_ART[id], left, top, alpha);
      return;
    }
    this.txt(dx * T, dy * T, DECOS[id].icon, 22, { alpha });
  }

  // A fence line through the middle of the tile, joined to the fences next to it
  private fence(c: Tile, dx: number, dy: number, left: number, top: number, alpha: number): boolean {
    const l = fenceLinks(c, dx, dy);
    const mid: number[] = [];
    const hz = l.e || l.w;
    const vt = l.n || l.s;
    if (!hz && !vt) mid.push(FENCE.post);
    else if (!vt) mid.push(l.e && l.w ? FENCE.ew : l.e ? FENCE.e : FENCE.w);
    else if (!hz) mid.push(l.n && l.s ? FENCE.ns : l.n ? FENCE.n : FENCE.post);
    else {
      if (l.s && l.e) mid.push(FENCE.se);
      if (l.s && l.w) mid.push(FENCE.sw);
      if (l.n && l.e) mid.push(FENCE.ne);
      if (l.n && l.w) mid.push(FENCE.nw);
      if (l.n && l.s) mid.push(FENCE.ns);
      if (l.e && l.w) mid.push(FENCE.ew);
    }
    const cells: Cell[] = mid.map((f) => ({ s: 't', f, x: 1, y: 1 }));
    if (l.w) cells.push({ s: 't', f: FENCE.rail, x: 0, y: 1 });
    if (l.e) cells.push({ s: 't', f: FENCE.rail, x: 2, y: 1 });
    if (l.n) cells.push({ s: 't', f: FENCE.ns, x: 1, y: 0 });
    if (l.s) cells.push({ s: 't', f: FENCE.ns, x: 1, y: 2 });
    if (!canDraw(this, cells)) return false;
    // Top row first so the posts overlap the rails above them
    cells.sort((a, b) => a.y - b.y);
    this.cells('obj', cells, left, top, alpha);
    return true;
  }

  // A painted path tile. Dirt joins its neighbors (and the castle and plots) so corners draw themselves.
  // Grass draws nothing: the grass ground is already under it.
  private path(g: Phaser.GameObjects.Graphics, c: Tile, dx: number, dy: number, k: number): void {
    if (isGrassKind(k)) return;
    const left = dx * T - T / 2;
    const top = dy * T - T / 2;
    if (DECO_ORDER[k] === 'stones') {
      if (hasFrame(this, 't', PATH_STONES)) {
        for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) this.bob('ground', 't', PATH_STONES, left + i * ART, top + j * ART);
        return;
      }
    } else {
      const P = PATH_DIRT;
      const l = pathLinks(c, dx, dy);
      const corner = (a: boolean, b: boolean, diag: boolean, out: number, edgeA: number, edgeB: number, inner: number) =>
        !a && !b ? out : a && !b ? edgeA : !a && b ? edgeB : diag ? P.mid : inner;
      // (a = the vertical neighbor, b = the horizontal one)
      const grid = [
        [corner(l.n, l.w, l.nw, P.tl, P.l, P.t, P.inTL), l.n ? P.mid : P.t, corner(l.n, l.e, l.ne, P.tr, P.r, P.t, P.inTR)],
        [l.w ? P.mid : P.l, P.mid, l.e ? P.mid : P.r],
        [corner(l.s, l.w, l.sw, P.bl, P.l, P.b, P.inBL), l.s ? P.mid : P.b, corner(l.s, l.e, l.se, P.br, P.r, P.b, P.inBR)],
      ];
      const cells: Cell[] = [];
      grid.forEach((row, y) => row.forEach((f, x) => cells.push({ s: 't', f, x, y })));
      if (canDraw(this, cells)) {
        this.cells('ground', cells, left, top);
        return;
      }
    }
    // Drawn fallback: a sandy square
    g.fillStyle(DECO_ORDER[k] === 'stones' ? 0xb8b8b0 : 0xc9a46a, 1);
    g.fillRect(left + 2, top + 2, T - 4, T - 4);
  }

  // A banner on a pole in the owner's color
  private banner(x: number, y: number, color: number, alpha: number): void {
    const g = this.scenery;
    g.fillStyle(0x000000, 0.18 * alpha);
    g.fillEllipse(x + 1, y + 16, 14, 4);
    g.fillStyle(0x5b3a1e, alpha);
    g.fillRect(x - 6, y - 20, 3, 37);
    g.fillStyle(0xfacc15, alpha);
    g.fillCircle(x - 4.5, y - 21, 2.5);
    g.fillStyle(color, alpha);
    g.fillRect(x - 3, y - 17, 13, 16);
    g.fillTriangle(x - 3, y - 1, x + 10, y - 1, x + 3.5, y + 5);
    g.fillStyle(0xffffff, 0.35 * alpha);
    g.fillRect(x - 3, y - 17, 13, 2);
    g.fillStyle(0x000000, 0.25 * alpha);
    g.fillRect(x + 8, y - 17, 2, 16);
  }

  // Fallback grass (no Kenney sheet): soft light and dark patches plus little tufts
  private drawnGrass(g: Phaser.GameObjects.Graphics, r: number, seed: number): void {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const a = hash01(dx, dy, seed, 1);
        if (a > 0.55) continue;
        const ox = (hash01(dx, dy, seed, 2) - 0.5) * T * 0.6;
        const oy = (hash01(dx, dy, seed, 3) - 0.5) * T * 0.6;
        g.fillStyle(a < 0.28 ? GRASS_LIGHT : GRASS_DARK, 0.35);
        g.fillEllipse(dx * T + ox, dy * T + oy, T * (0.7 + a), T * (0.45 + a * 0.6));
      }
    }
    g.fillStyle(0x4f8a39, 0.7);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (reservedTile(dx, dy) || hash01(dx, dy, seed, 4) > 0.5) continue;
        const x = dx * T + (hash01(dx, dy, seed, 5) - 0.5) * T * 0.7;
        const y = dy * T + (hash01(dx, dy, seed, 6) - 0.5) * T * 0.7;
        g.fillTriangle(x - 3, y + 2, x - 1, y - 4, x + 1, y + 2);
        g.fillTriangle(x, y + 2, x + 2, y - 5, x + 4, y + 2);
      }
    }
  }

  // One tile of Kenney scenery. Along the edge: thick clumps of round trees, like the woods in Kenney's sample.
  // Inside: tall trees (a few in autumn colors), bushes, sprouts, mushrooms, bare patches and flowers.
  private artScenery(dx: number, dy: number, seed: number, roll: number, edge: boolean): void {
    const cx = dx * T;
    const cy = dy * T;
    if (edge && roll < 0.45) {
      const autumn = hash01(dx, dy, seed, 17) < 0.15;
      for (let j = 0; j < 4; j++) {
        const across = j % 2 === 0 ? 3 : 2;
        for (let i = 0; i < across; i++) {
          const jx = (hash01(dx * 7 + i, dy * 7 + j, seed, 30) - 0.5) * 4;
          const jy = (hash01(dx * 7 + i, dy * 7 + j, seed, 31) - 0.5) * 3;
          this.bob('obj', 't', autumn ? SCENERY.smallAutumn : SCENERY.small, cx - 23 + i * 15 + (j % 2) * 7 + jx, cy - 30 + j * 11 + jy);
        }
      }
      return;
    }
    if (roll > 0.5) return;
    const x = cx + (hash01(dx, dy, seed, 11) - 0.5) * ART;
    const y = cy + (hash01(dx, dy, seed, 12) - 0.5) * ART;
    const flower = (salt: number) => SCENERY.flowers[Math.floor(hash01(dx, dy, seed, salt) * SCENERY.flowers.length)];
    const tall = (px: number, py: number, autumn: boolean) => {
      this.bob('obj', 't', autumn ? SCENERY.autumnTop : SCENERY.tallTop, px - 8, py - 24);
      this.bob('obj', 't', autumn ? SCENERY.autumnBottom : SCENERY.tallBottom, px - 8, py - 8);
    };
    if (roll < 0.22) {
      tall(x, y, hash01(dx, dy, seed, 17) < 0.15);
      if (roll < 0.12) tall(x + 11, y + 8, false);
    } else if (roll < 0.3) {
      this.bob('obj', 't', SCENERY.bush, x - 8, y - 8);
      const f = flower(15);
      this.bob('obj', f.s, f.f, x + 6, y);
    } else if (roll < 0.35) {
      this.bob('obj', 't', SCENERY.sprout, x - 8, y - 8);
    } else if (roll < 0.38) {
      this.bob('obj', 't', SCENERY.mushrooms, x - 8, y - 8);
    } else if (roll < 0.43) {
      this.cells('ground', SCENERY.dirt, x - 16, y - 16);
    } else {
      const a = flower(15);
      const b = flower(16);
      this.bob('obj', a.s, a.f, x - 8, y - 8);
      this.bob('obj', b.s, b.f, x + 2, y + 2);
    }
  }

  private tree(g: Phaser.GameObjects.Graphics, x: number, y: number, s: number): void {
    g.fillStyle(0x000000, 0.18);
    g.fillEllipse(x + 2, y + 12 * s, 22 * s, 7 * s);
    g.fillStyle(0x5b3a1e, 1);
    g.fillRect(x - 2 * s, y + 2 * s, 4 * s, 10 * s);
    g.fillStyle(0x2f6b2a, 1);
    g.fillCircle(x, y - 3 * s, 11 * s);
    g.fillStyle(0x3d8434, 1);
    g.fillCircle(x - 3 * s, y - 6 * s, 7 * s);
    g.fillStyle(0x4f9a43, 0.8);
    g.fillCircle(x - 5 * s, y - 8 * s, 3 * s);
  }

  private bush(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
    g.fillStyle(0x000000, 0.15);
    g.fillEllipse(x + 1, y + 5, 20, 6);
    g.fillStyle(0x356f2c, 1);
    g.fillCircle(x - 5, y, 6);
    g.fillCircle(x + 5, y, 6);
    g.fillCircle(x, y - 3, 7);
    g.fillStyle(0xe25c7a, 0.9);
    g.fillCircle(x - 3, y - 4, 1.5);
    g.fillCircle(x + 4, y - 1, 1.5);
  }

  private rock(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
    g.fillStyle(0x000000, 0.15);
    g.fillEllipse(x + 1, y + 4, 16, 5);
    g.fillStyle(0x8b8f96, 1);
    g.fillEllipse(x, y, 14, 9);
    g.fillStyle(0xb3b7bd, 1);
    g.fillEllipse(x - 2, y - 2, 6, 3);
  }

  // An open plot's ground (its map terrain): Kenney tiles if available, otherwise a colored square with a rim.
  // Water plots draw nothing: they're part of the sea (drawWater) already.
  private plotGround(g: Phaser.GameObjects.Graphics, x: number, y: number, t: PlotTerrain, alpha: number): void {
    if (t === 'water') return;
    const cells = PLOT_GROUND[t];
    if (canDraw(this, cells)) {
      this.cells('ground', cells, x - T / 2, y - T / 2, alpha);
      if (t === 'hills') this.bob('ground', 'r', 614, x + 6, y + 6, alpha);
      return;
    }
    const l = x - T / 2 + 3;
    const top = y - T / 2 + 3;
    const s = T - 6;
    g.fillStyle(PLOT_COLOR[t], alpha);
    g.fillRoundedRect(l, top, s, s, 7);
    if (t === 'hills') {
      g.fillStyle(0x6f6038, alpha);
      g.fillEllipse(x - 10, y + 10, 14, 7);
      g.fillEllipse(x + 11, y + 12, 12, 6);
    } else if (t === 'sand') {
      g.fillStyle(0xb9a46e, alpha);
      g.fillCircle(x - 13, y - 12, 1.5);
      g.fillCircle(x + 12, y - 9, 1.5);
      g.fillCircle(x + 9, y + 10, 1.5);
    }
    g.lineStyle(2, 0x3b2a17, 0.55 * alpha);
    g.strokeRoundedRect(l, top, s, s, 7);
  }

  private dots(g: Phaser.GameObjects.Graphics, x1: number, y1: number, x2: number, y2: number, color: number, alpha: number): void {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const start = T * 0.55; // from the plot's edge
    const end = len - MARKER_R; // to the marker's edge
    g.fillStyle(color, alpha);
    for (let d = start; d < end; d += 8) {
      const f = d / len;
      g.fillCircle(x1 + (x2 - x1) * f, y1 + (y2 - y1) * f, 1.5);
    }
  }

  // label: bold with an outline, hides when zoomed far out. small: plain small text that always shows.
  private txt(x: number, y: number, s: string, size: number, o: { label?: boolean; small?: boolean; alpha?: number } = {}): Phaser.GameObjects.Text {
    let t = this.texts[this.nText];
    if (!t) {
      t = this.add.text(0, 0, '', { fontFamily: 'system-ui, sans-serif', color: '#ffffff' }).setOrigin(0.5).setResolution(3);
      this.texts.push(t);
    }
    this.nText++;
    t.setText(s)
      .setFontSize(size)
      .setFontStyle(o.label ? 'bold' : '')
      .setStroke('#000000', o.label ? 3 : o.small ? 2 : 0)
      .setAlpha(o.alpha ?? 1)
      .setPosition(x, y)
      .setDepth(o.label ? 3.5 : 2)
      .setVisible(o.label ? this.bigLabels : true);
    if (o.label) this.labels.push(t);
    return t;
  }

  // The people on a tile: one by its left edge, one by its right (a lone guard stands on the right)
  private crowd(list: PxActor[], x: number, y: number, seed: number): void {
    list.forEach((a, k) => {
      const side = list.length === 1 || k === 1 ? 1 : -1;
      this.person(a, x + side * 20, y + T / 2 - 2, seed + k);
    });
  }

  private person(a: PxActor, x: number, y: number, seed: number): void {
    let s = this.people[this.nPeople];
    if (!s) {
      s = this.add.sprite(0, 0, a.key, '0').setOrigin(0.5, 1).setScale(PERSON_SCALE).setDepth(3);
      this.people.push(s);
    }
    this.nPeople++;
    s.setTexture(a.key, '0').setPosition(Math.round(x), Math.round(y)).setFlipX(!!a.flip).setVisible(true);
    if (this.reduced || !this.anims.exists(a.key)) s.stop();
    else s.play({ key: a.key, frameRate: a.fps, startFrame: seed % 2 });
  }
}
