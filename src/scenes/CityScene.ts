// City screen: the inside of one of your cities as its own Phaser scene (docs/CITY_BUILDER.md).
// It shows the city's real territory: every map hex the city owns, laid out the way it sits on the map, as a patch
// of detailed ground (world/grid.ts). The Keep stands on the city's own hex, amenities stand in the middle of the
// other hexes, and everything else is ground to decorate. The ring of hexes just past the border is drawn dimmed
// (open land, the sea, another of your cities, a rival kingdom), with the border in your color. Coastlines, sand
// and hills come straight from the map. Drag to pan, pinch or wheel to zoom.
// Decorate mode (task 5): tap an open cell to place the picked decoration, drag a decoration to move it, and with
// a path, grass (or the eraser) picked a one-finger drag paints (two fingers still pan and zoom, right-drag pans on
// desktop).
// Zoom transition (task 6): arriving from the map the town starts close and eases out to fit. Keep zooming out
// past the min zoom (wheel, or pinch and release) and it zooms out and fades back to the map (zoomPush.ts).
// Art: Kenney tilesheets (cityArt.ts), one ground cell = 3x3 art tiles. If a sheet or a tile is missing, that
// piece falls back to the old drawn look (colored shapes and emoji), so the screen always works.
// Hills match the world map (task 10): green ground with a light shade and low pixel mounds, not bare dirt.
// Rendering and input only: the DOM side panel (CityView.ts) owns the selection and does all the building and
// decorating, so a drag or a pinch can never build anything by accident.
import Phaser from 'phaser';
import type { GameState } from '../world/game';
import { bonusSources, freeSlots, hasSiteFor } from '../world/city';
import type { Outside } from '../world/city';
import { DECOS, DECO_ORDER, fenceLinks, isGrassKind, isPathKind, keepTile, lotAt, moveReason, pathLinks, placeCheck, yardOf } from '../world/deco';
import { cellKey, cityLayout, hexAt, hexCells } from '../world/grid';
import type { CityHex, Layout, XY } from '../world/grid';
import { BUILDINGS, BUILDING_ORDER } from '../world/tile';
import type { Building, PlotTerrain, Terrain, Tile } from '../world/tile';
import { BUILDER_PEOPLE, PLOT_PEOPLE, keepPeople, makeCitySprites } from './citySprites';
import type { PxActor } from './citySprites';
import {
  ART, BUILDING_ART, BUILT_GROUND, CASTLE_ART, DECOR_ART, FENCE, FOUNTAIN_POOL, GRASS, PATH_DIRT, PATH_STONES, PLOT_GROUND, RPG,
  SCENERY, TINY, WATER_LIFT, canDraw, crispCityArt, hasFrame, loadCityArt,
} from './cityArt';
import type { Cell, Sheet } from './cityArt';
import { PinchPush, TRACKPAD_PINCH, ZoomPush, pushHint } from './zoomPush';

export const CITY_SCENE = 'city';
export type CityPick = number | 'keep'; // a hex of the city (map tile index) or the Keep

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
  sel(): CityPick; // what's selected (a hex or the Keep)
  view(): { x: number; y: number; w: number; h: number }; // screen area not covered by the DOM header/panel
  pick(p: CityPick): void; // tapped a hex of the city or the Keep
  close(): void; // O, or zoomed out past the limit
  escape(): void; // Esc: drop the tool, leave decorate mode, then back to the map
  deco(): DecoUI | null;
  decoTap(dx: number, dy: number): void; // tapped a cell in decorate mode
  decoPaint(dx: number, dy: number, first: boolean): void; // a paint/erase stroke went over a cell
  decoPaintEnd(): void;
  decoMove(fx: number, fy: number, tx: number, ty: number): void; // dropped a dragged decoration
  undo(): void;
}

const T = ART * 3; // ground cell size in world px: 3x3 Kenney tiles
const DRAG_PX = 8; // movement before a press counts as a pan, not a tap
const LABEL_MIN = 30; // cell size on screen (px) below which names hide (icons stay)
const PERSON_SCALE = 1.5;
const NAME_Y = T / 2 + 1; // names sit on the bottom edge of their building
// The castle: its box in world px around the Keep (tapping anywhere on it picks the Keep)
const CASTLE_LEFT = -(CASTLE_ART.w * ART) / 2;
const CASTLE_TOP = -40;
const CASTLE_BOTTOM = CASTLE_TOP + CASTLE_ART.h * ART;
// Zoom transition: fade color (the screen's background), how close the town starts, and timings
const FADE: [number, number, number] = [20, 26, 38];
const INTRO_ZOOM = 2.2;
const INTRO_MS = 340;
const OUTRO_MS = 240;

// Water is a continuous fill, not repeated pond sprites (their baked-in borders made a dark grid).
const SEA_COLOR = 0x62bec9;
const SEA_SHALLOWS = 0x83ced4;
const SEA_FOAM = 0xc3e8df;

const GRASS_COLOR = 0x62a948;
const GRASS_LIGHT = 0x6db552;
const GRASS_DARK = 0x58993f;
// Hills: the grass with a light darker-green veil, and low mounds in Tiny Town's greens (lit left, shaded right)
const HILL_TINT = 0x1e3d12;
const HILL_TINT_ALPHA = 0.14;
const HILL_LIT = 0x82c050;
const HILL_SHADE = 0x5f9b3b;
const HILL_TOP = 0x9fd36a;
const PLOT_COLOR: Record<PlotTerrain, number> = { water: 0x1f5f9e, sand: 0xd9c38a, grass: 0x7cc463, hills: 0x6aa84f };
const PLOT_NAME: Record<PlotTerrain, string> = { water: 'Water', sand: 'Sand', grass: 'Grass', hills: 'Hills' };
const OUT_COLOR: Record<Terrain, number> = { water: 0x1f5f9e, sand: 0xd9c38a, grass: 0x6bb352, hills: 0x5e9a3a, mountain: 0x9a9a9a };
const WORK_ICON: Record<Outside, string> = { farm: '\u{1F33E}', pasture: '\u{1F40E}', mine: '\u26CF\uFE0F', forest: '\u{1F332}', fishery: '\u{1F41F}', road: '\u{1F6E4}\uFE0F' };

type Layer = 'ground' | 'obj';

// Same pattern every time you open the same city: a 0..1 number per cell and salt
function hash01(dx: number, dy: number, seed: number, salt: number): number {
  let h = Math.imul(dx + 1001, 73856093) ^ Math.imul(dy + 2011, 19349663) ^ Math.imul(salt + 7, 83492791) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// The cells on a straight line from a to b (so a fast drag doesn't skip any)
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

const parseKey = (k: string): XY => {
  const [x, y] = k.split(',').map(Number);
  return [x, y];
};

// Where everything stands this redraw, so drawing doesn't scan lists per cell
interface Town {
  lay: Layout;
  objs: Map<string, number>; // cell -> decoration kind
  ground: Map<string, number>; // cell -> painted path or grass
  built: Map<number, Building>; // hex -> finished amenity
}

export class CityScene extends Phaser.Scene {
  static link: CityLink | null = null;
  static intro = false; // set by CityView: play the zoom-in when the screen next shows
  private static instance: CityScene | null = null;

  private ground!: Phaser.GameObjects.Graphics;
  private hillG!: Phaser.GameObjects.Graphics; // the darker-green veil over hill cells, just above the ground tiles
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

  // Zoom transition (task 6)
  private push = new ZoomPush(); // wheel past the min zoom
  private pinchPush = new PinchPush(); // pinch past the min zoom
  private zoomTw: Phaser.Tweens.Tween | null = null;
  private busy = false; // zooming out to the map: ignore input

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

  // Leaving on purpose: zoom out and fade, then done() switches to the map. False = no animation (switch now).
  static zoomOut(done: () => void): boolean {
    const s = CityScene.instance;
    if (!s?.ready || !s.sys.isActive() || s.reduced || s.busy) return false;
    s.outro(done);
    return true;
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
    this.hillG = this.add.graphics().setDepth(0.47);
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

  private layout(): Layout | null {
    const link = CityScene.link;
    return link ? cityLayout(link.state, link.city) : null;
  }

  private show(): void {
    if (!CityScene.link) return;
    this.resetPointer();
    this.zoomTw?.stop();
    this.zoomTw = null;
    this.fit();
    this.redraw();
    this.push.cool(performance.now()); // leftover zoom from the map can't bounce you straight back out
    if (!CityScene.intro) return;
    CityScene.intro = false;
    if (this.reduced) return;
    // Arriving from the map: start close on the Keep and ease out to the fitted view
    const z = this.cameras.main.zoom;
    const at = this.lookingAt();
    this.zoomTween(z * INTRO_ZOOM, z, INTRO_MS, 'Sine.easeOut', at);
    this.cameras.main.fadeIn(INTRO_MS * 0.6, FADE[0], FADE[1], FADE[2]);
  }

  // Zoom from one level to another, keeping world point `at` in the middle of the free screen area
  private zoomTween(from: number, to: number, ms: number, ease: string, at: { x: number; y: number }): void {
    this.zoomTw?.stop();
    const cam = this.cameras.main;
    cam.setZoom(from);
    this.lookAt(at.x, at.y);
    this.zoomTw = this.tweens.addCounter({
      from,
      to,
      duration: ms,
      ease,
      onUpdate: (_tw: Phaser.Tweens.Tween, _t: unknown, _k: string, v: number) => {
        cam.setZoom(v);
        this.lookAt(at.x, at.y);
      },
      onComplete: () => {
        this.zoomTw = null;
      },
    });
  }

  // Leaving for the map: zoom out and fade, then switch
  private outro(done: () => void): void {
    this.resetPointer();
    this.busy = true;
    const cam = this.cameras.main;
    const z = cam.zoom;
    this.zoomTween(z, z * 0.55, OUTRO_MS, 'Sine.easeIn', this.lookingAt());
    cam.fadeOut(OUTRO_MS, FADE[0], FADE[1], FADE[2]);
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.zoomTw?.stop();
      this.zoomTw = null;
      this.busy = false;
      done();
      cam.resetFX();
    });
  }

  private view(): { x: number; y: number; w: number; h: number } {
    const v = CityScene.link?.view();
    const cam = this.cameras.main;
    if (!v || v.w < 80 || v.h < 80) return { x: 0, y: 0, w: cam.width, h: cam.height };
    return v;
  }

  // The city's land in world px (the cells it owns, not the dimmed ring around it)
  private landBox(): { x: number; y: number; w: number; h: number } {
    const lay = this.layout();
    if (!lay) return { x: -T, y: -T, w: 2 * T, h: 2 * T };
    let minX = 0;
    let maxX = 0;
    let minY = 0;
    let maxY = 0;
    for (const key of lay.cells.keys()) {
      const [x, y] = parseKey(key);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    return { x: (minX - 0.5) * T, y: (minY - 0.5) * T, w: (maxX - minX + 1) * T, h: (maxY - minY + 1) * T };
  }

  // The whole city fits the free part of the screen. Small towns open centred on the Keep, big ones on their land.
  private fit(): void {
    if (!CityScene.link) return;
    const cam = this.cameras.main;
    const v = this.view();
    const box = this.landBox();
    const pad = T * 1.2;
    const z = Phaser.Math.Clamp(Math.min(v.w / (box.w + pad * 2), v.h / (box.h + pad * 2)), 0.08, 4);
    this.minZoom = z * 0.75;
    this.maxZoom = Math.max(z * 6, 3);
    cam.setZoom(z);
    this.lookAt(box.x + box.w / 2, box.y + box.h / 2);
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

  // Never lose the town: the middle of the view stays over the city's land
  private clampCam(): void {
    if (!CityScene.link) return;
    const box = this.landBox();
    const c = this.lookingAt();
    const x = Phaser.Math.Clamp(c.x, box.x, box.x + box.w);
    const y = Phaser.Math.Clamp(c.y, box.y, box.y + box.h);
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
    this.pinchPush.reset();
    pushHint(null);
    if (this.moving) {
      this.moving = null;
      if (this.ready) this.redraw();
    }
    this.hoverG?.clear();
  }

  // Two fingers: zoom by how far apart they are, pan by how the middle between them moves.
  // Squeezing on past the min zoom stretches the view a little; let go once it says so and you're back on the map.
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
    if (this.pinchDist > 0 && dist > 0) {
      const ratio = dist / this.pinchDist;
      const cam = this.cameras.main;
      const pp = this.pinchPush;
      const atMin = cam.zoom <= this.minZoom + 0.001;
      if (pp.active || (ratio < 1 && atMin && !this.stroke && !this.moving && !this.push.cooling(performance.now()))) {
        pp.stretch(1 / ratio);
        cam.setZoom(this.minZoom / pp.give);
        this.clampCam();
        pushHint(pp.armed ? 'Release for the map' : null);
      } else this.zoomAt(ratio, mid.x, mid.y);
    } else this.clampCam();
    this.pinchDist = dist;
    this.pinchMid = mid;
    return true;
  }

  private decoUI(): DecoUI | null {
    return CityScene.link?.deco() ?? null;
  }

  // The ground cell under a screen point (anywhere near the town: the panel explains cells outside its land)
  private tileAt(sx: number, sy: number): XY | null {
    const lay = this.layout();
    if (!lay) return null;
    const w = this.cameras.main.getWorldPoint(sx, sy);
    const dx = Math.round(w.x / T);
    const dy = Math.round(w.y / T);
    const b = lay.bounds;
    return dx < b.minX || dx > b.maxX || dy < b.minY || dy > b.maxY ? null : [dx, dy];
  }

  // A placed decoration (not a path) that can be dragged around
  private movable(t: XY | null): boolean {
    const link = CityScene.link;
    if (!link || !t) return false;
    const k = this.objAt(link.city, t[0], t[1]);
    return k !== null;
  }

  private objAt(city: Tile, x: number, y: number): number | null {
    for (const [dx, dy, k] of city.deco ?? []) if (dx === x && dy === y && !isPathKind(k)) return k;
    return null;
  }

  private groundAt(city: Tile, x: number, y: number): number | null {
    for (const [dx, dy, k] of city.deco ?? []) if (dx === x && dy === y && isPathKind(k)) return k;
    return null;
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
      if (this.busy) return;
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
      if (this.busy) return;
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
      if (this.busy) return;
      if (this.pinching) {
        // Finish the pinch once every finger is up; never count it as a tap.
        // Squeezed past the min zoom far enough: back to the map. Not far enough: spring back.
        if (!this.input.pointer1?.isDown && !this.input.pointer2?.isDown) {
          const armed = this.pinchPush.armed;
          const stretched = this.pinchPush.active;
          this.resetPointer();
          if (armed) CityScene.link?.close();
          else if (stretched) this.zoomTween(this.cameras.main.zoom, this.minZoom, 160, 'Sine.easeOut', this.lookingAt());
        }
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

    // Same feel as the map: scale by how far the wheel/trackpad moved (ctrl+wheel = macOS trackpad pinch).
    // Keep zooming out once at the min zoom and it goes back to the map (not while painting or dragging).
    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (this.busy) return;
      const ev = p.event as WheelEvent;
      const delta = Phaser.Math.Clamp(dy, -60, 60);
      const now = performance.now();
      const out = delta > 0 && !this.stroke && !this.moving && !this.pinching;
      this.push.atLimit(out && this.cameras.main.zoom <= this.minZoom + 0.001, now);
      if (out && this.push.feed(delta * (ev.ctrlKey ? TRACKPAD_PINCH : 1), now)) {
        CityScene.link?.close();
        return;
      }
      this.zoomAt(Math.exp(-delta * (ev.ctrlKey ? 0.01 : 0.0015)), p.x, p.y);
    });

    // Esc: drop the tool / leave decorate mode / back to the map. O: back to the map. Ctrl/Cmd+Z: undo.
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (this.busy) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        CityScene.link?.undo();
        return;
      }
      if (e.key === 'Escape') CityScene.link?.escape();
      else if (e.key.toUpperCase() === 'O') CityScene.link?.close();
    });
  }

  // Desktop, decorate mode: outline the cell under the mouse, green where the picked tool can go
  private hover(ui: DecoUI, t: XY | null): void {
    const g = this.hoverG;
    g.clear();
    const link = CityScene.link;
    if (!link || !t) {
      this.input.setDefaultCursor('default');
      return;
    }
    const [dx, dy] = t;
    const here = this.objAt(link.city, dx, dy) ?? this.groundAt(link.city, dx, dy);
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

  // What's under a screen point: the castle (the Keep), or one of the city's hexes
  private pickAt(sx: number, sy: number): CityPick | null {
    const lay = this.layout();
    if (!lay) return null;
    const w = this.cameras.main.getWorldPoint(sx, sy);
    if (w.x >= CASTLE_LEFT && w.x <= -CASTLE_LEFT && w.y >= CASTLE_TOP && w.y <= CASTLE_BOTTOM) return 'keep';
    const h = hexAt(lay, Math.round(w.x / T), Math.round(w.y / T));
    if (!h) return null;
    return h.keep ? 'keep' : h.index;
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

  // A building filling its cell (centered at x, y), with its props alongside. False = use the emoji instead.
  private building(b: Building, x: number, y: number, t: PlotTerrain, alpha: number): boolean {
    const pic = BUILDING_ART[b];
    // Water hexes are part of the sea, so the Harbor stands in it (no little pond in front)
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

  private town(c: Tile, lay: Layout): Town {
    const objs = new Map<string, number>();
    const ground = new Map<string, number>();
    for (const [x, y, k] of c.deco ?? []) (isPathKind(k) ? ground : objs).set(cellKey(x, y), k);
    const built = new Map<number, Building>();
    for (const b of BUILDING_ORDER) {
      const at = c.sites[b];
      if (at !== undefined && at >= 0 && c.buildings.includes(b)) built.set(at, b);
    }
    return { lay, objs, ground, built };
  }

  private redraw(): void {
    const link = CityScene.link;
    if (!link || !this.ready) return;
    const { state: s, city: c } = link;
    const sel = link.sel();
    const ui = link.deco();
    const lay = cityLayout(s, c);
    const town = this.town(c, lay);
    const seed = c.col * 92821 + c.row * 68917;
    this.nText = 0;
    this.nPeople = 0;
    this.labels = [];
    for (const layer of Object.values(this.blit)) for (const b of Object.values(layer)) b?.clear();

    // The ring past the border first: dimmed land and sea, tinted for whoever owns it
    const g = this.ground;
    g.clear();
    this.hillG.clear();
    this.drawOutside(g, s, c, lay, link.me);

    // The city's own land, hex by hex: grass, sand and hills straight from the map. Water is the sea, below.
    const artGrass = hasFrame(this, 't', GRASS.plain) && hasFrame(this, 't', GRASS.tufts) && hasFrame(this, 't', GRASS.flowers);
    const water = new Set<string>();
    for (const [key, h] of lay.cells) {
      if (h.terrain === 'water') {
        water.add(key);
        continue;
      }
      const [x, y] = parseKey(key);
      this.landCell(g, x, y, h.terrain, seed, artGrass);
    }
    if (water.size) this.drawWater(g, lay, water);

    // Painted paths lie on the ground, under everything else (grass draws nothing: the ground is already grass)
    for (const [key, k] of town.ground) {
      if (!lay.cells.has(key)) continue;
      const [x, y] = parseKey(key);
      this.path(g, s, c, x, y, k);
    }

    // Decorations and the wild scenery, row by row so lower things overlap the ones behind them
    this.scenery.clear();
    this.drawTown(c, town, seed);

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

    // Every other hex: its amenity in the middle, the one going up, or an open spot with a + to build.
    // Names only show on the selected hex (the panel has the rest). A badge in the corner shows what's worked there.
    const room = freeSlots(c, s.isSimple(link.me)) > 0;
    const harbor = !c.buildings.includes('harbor') && c.project !== 'harbor' && s.isCoastal(c) && hasSiteFor(s, c, 'harbor');
    for (const h of lay.hexes) {
      if (h.keep) continue;
      const [cx, cy] = h.center;
      const x = cx * T;
      const y = cy * T;
      const b = town.built.get(h.index);
      const proj = c.projectSite === h.index ? c.project : null;
      const picked = sel === h.index && !ui;
      if (b) {
        if (this.building(b, x, y, h.terrain, 1)) {
          if (picked) this.txt(x, y + NAME_Y, BUILDINGS[b].name, 10, { label: true });
        } else {
          this.lotGround(g, x, y, h.terrain, 1);
          this.txt(x, y - 6, BUILDINGS[b].icon, 22);
          this.txt(x, y + 13, BUILDINGS[b].name, 10, { label: true });
        }
        this.crowd(PLOT_PEOPLE[b], x, y, h.index);
      } else if (proj) {
        // Under construction: a see-through version of what's going up, with the turns left
        if (this.building(proj, x, y, h.terrain, 0.45)) this.txt(x, y + NAME_Y, `${c.projectTurns}t left`, 10, { label: true });
        else {
          this.lotGround(g, x, y, h.terrain, 1);
          this.txt(x, y - 6, BUILDINGS[proj].icon, 22, { alpha: 0.45 });
          this.txt(x, y + 13, `${c.projectTurns}t left`, 10, { label: true });
        }
        this.crowd(BUILDER_PEOPLE, x, y, h.index);
      } else {
        if (!town.ground.has(cellKey(cx, cy))) this.lotGround(g, x, y, h.terrain, 1);
        const usable = h.terrain !== 'water' || harbor;
        if (usable && (room || picked)) this.txt(x, y - 5, '+', 24, { alpha: ui ? 0.3 : picked ? 0.95 : 0.6 });
        if (picked) this.txt(x, y + 14, PLOT_NAME[h.terrain], 9, { label: true });
      }
      const works: Outside[] = [];
      if (h.tile.improvement) works.push(h.tile.improvement);
      if (h.tile.road) works.push('road');
      if (works.length) this.txt((cx - 2) * T, (cy - 2) * T, works.map((w) => WORK_ICON[w]).join(''), 13, { alpha: ui ? 0.45 : 0.9 });
    }

    // The border in your color, and faint lines between the hexes (not while decorating)
    const m = this.marks;
    m.clear();
    this.drawBorders(m, lay, c.owner !== null ? s.players[c.owner].color : 0xffffff, !ui);

    // The selected amenity: dotted lines to the hexes paying its bonuses
    if (!ui && typeof sel === 'number') {
      const b = town.built.get(sel) ?? (c.projectSite === sel ? c.project : null);
      const from = lay.byIndex.get(sel);
      if (b && from) {
        for (const at of bonusSources(s, c, sel, b)) {
          const to = lay.byIndex.get(at)?.center ?? lay.outside.find((o) => o.tile && s.tileIndex(o.tile) === at)?.center;
          if (to) this.dots(m, from.center[0] * T, from.center[1] * T, to[0] * T, to[1] * T, 0x4ade80, 0.85);
        }
      }
    }

    // Decorate mode: a faint cell grid on the city's land (stronger while a path, grass or the eraser is picked)
    const gg = this.gridG;
    gg.clear();
    if (ui) {
      gg.lineStyle(1, 0xffffff, paints(ui) ? 0.22 : 0.1);
      for (const [key, h] of lay.cells) {
        if (h.terrain === 'water') continue;
        const [x, y] = parseKey(key);
        gg.strokeRect(x * T - T / 2, y * T - T / 2, T, T);
      }
    }

    // Selection: the picked decoration in decorate mode, otherwise the castle for the Keep or the whole hex
    this.selG.clear();
    let box: { x: number; y: number; w: number; h: number } | null = null;
    if (ui) {
      const at = this.moving ? this.moving.to : ui.picked;
      if (at) box = { x: at[0] * T - T / 2 + 1, y: at[1] * T - T / 2 + 1, w: T - 2, h: T - 2 };
    } else if (sel === 'keep') {
      if (canDraw(this, CASTLE_ART.cells)) box = { x: CASTLE_LEFT - 2, y: CASTLE_TOP - 2, w: -2 * CASTLE_LEFT + 4, h: CASTLE_BOTTOM - CASTLE_TOP + 4 };
      else box = { x: -T / 2 + 1, y: -T / 2 + 1, w: T - 2, h: T - 2 };
    } else {
      const h = lay.byIndex.get(sel);
      if (h) {
        this.hexOutline(this.selG, lay, h, 6, 0x000000, 0.4);
        this.hexOutline(this.selG, lay, h, 3, 0xfacc15, 1);
      }
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

  // The hexes just past the border: dimmed, tinted in their owner's color, unexplored ones dark.
  // One small label per neighbour ("Land of Riverton", "Red", "Open land: claim it to grow").
  private drawOutside(g: Phaser.GameObjects.Graphics, s: GameState, c: Tile, lay: Layout, me: number): void {
    const named = new Set<string>();
    for (const o of lay.outside) {
      const t = o.tile;
      if (!t) continue; // off the map: just the background
      const hidden = s.fog && !s.isExplored(me, t);
      const cells = hexCells(o.q, o.r);
      for (const [x, y] of cells) {
        g.fillStyle(hidden ? 0x0d1320 : OUT_COLOR[t.terrain], 1);
        g.fillRect(x * T - T / 2, y * T - T / 2, T, T);
      }
      if (hidden) continue;
      g.fillStyle(0x0b0e14, 0.5);
      for (const [x, y] of cells) g.fillRect(x * T - T / 2, y * T - T / 2, T, T);
      if (t.owner !== null) {
        g.fillStyle(s.players[t.owner].color, t.owner === c.owner ? 0.12 : 0.22);
        for (const [x, y] of cells) g.fillRect(x * T - T / 2, y * T - T / 2, T, T);
      }
      const home = s.homeCity(t);
      const label = t.owner === null
        ? t.terrain === 'water' ? '' : 'Open land: claim it to grow'
        : t.owner === c.owner ? (home ? `Land of ${s.cityName(home)}` : '') : s.players[t.owner].name;
      if (label && !named.has(label)) {
        named.add(label);
        this.txt(o.center[0] * T, o.center[1] * T, label, 9, { small: true, alpha: 0.75 });
      }
    }
  }

  // One ground cell of land: Kenney grass (a few variants scattered by a seeded hash), sand, or hills.
  // Hills are the same grass with a light darker-green veil (mounds come with the scenery), like the map.
  private landCell(g: Phaser.GameObjects.Graphics, x: number, y: number, t: PlotTerrain, seed: number, artGrass: boolean): void {
    const left = x * T - T / 2;
    const top = y * T - T / 2;
    const green = t === 'grass' || t === 'hills';
    if (green && artGrass) {
      for (let j = 0; j < 3; j++) {
        for (let i = 0; i < 3; i++) {
          const v = hash01(x * 3 + i, y * 3 + j, seed, 20);
          const f = v < 0.02 ? GRASS.flowers : v < 0.3 ? GRASS.tufts : GRASS.plain;
          this.bob('ground', 't', f, left + i * ART, top + j * ART);
        }
      }
      if (t === 'hills') this.hillShade(left, top);
      return;
    }
    if (!green && canDraw(this, PLOT_GROUND[t])) {
      this.cells('ground', PLOT_GROUND[t], left, top);
      return;
    }
    g.fillStyle(t === 'grass' ? GRASS_COLOR : PLOT_COLOR[t], 1);
    g.fillRect(left, top, T, T);
    if (t === 'hills') {
      this.hillShade(left, top);
      return;
    }
    if (t !== 'grass') return;
    const a = hash01(x, y, seed, 1);
    if (a < 0.55) {
      g.fillStyle(a < 0.28 ? GRASS_LIGHT : GRASS_DARK, 0.35);
      g.fillEllipse(x * T + (hash01(x, y, seed, 2) - 0.5) * T * 0.6, y * T + (hash01(x, y, seed, 3) - 0.5) * T * 0.6, T * (0.7 + a), T * (0.45 + a * 0.6));
    }
  }

  // The darker-green veil that marks a hill cell (so you can still spot the Workshop's hills)
  private hillShade(left: number, top: number): void {
    this.hillG.fillStyle(HILL_TINT, HILL_TINT_ALPHA);
    this.hillG.fillRect(left, top, T, T);
  }

  // The border: a line in the owner's color around the city's land. lines: faint dividers between its hexes too.
  private drawBorders(g: Phaser.GameObjects.Graphics, lay: Layout, color: number, lines: boolean): void {
    const half = T / 2;
    for (const [key, h] of lay.cells) {
      const [x, y] = parseKey(key);
      const px = x * T;
      const py = y * T;
      const sides: [number, number, number, number, number, number][] = [
        [1, 0, px + half, py - half, px + half, py + half],
        [-1, 0, px - half, py - half, px - half, py + half],
        [0, 1, px - half, py + half, px + half, py + half],
        [0, -1, px - half, py - half, px + half, py - half],
      ];
      for (const [dx, dy, x1, y1, x2, y2] of sides) {
        const n = lay.cells.get(cellKey(x + dx, y + dy));
        if (!n) {
          g.lineStyle(4, 0x000000, 0.35);
          g.lineBetween(x1, y1, x2, y2);
          g.lineStyle(2.5, color, 1);
          g.lineBetween(x1, y1, x2, y2);
        } else if (lines && n !== h && (dx > 0 || dy > 0)) {
          g.lineStyle(1, 0xffffff, 0.16);
          g.lineBetween(x1, y1, x2, y2);
        }
      }
    }
  }

  // The outline of one hex of the city (its cells' outer edges)
  private hexOutline(g: Phaser.GameObjects.Graphics, lay: Layout, h: CityHex, width: number, color: number, alpha: number): void {
    const half = T / 2;
    g.lineStyle(width, color, alpha);
    for (const [key, v] of lay.cells) {
      if (v !== h) continue;
      const [x, y] = parseKey(key);
      const px = x * T;
      const py = y * T;
      if (lay.cells.get(cellKey(x + 1, y)) !== h) g.lineBetween(px + half, py - half, px + half, py + half);
      if (lay.cells.get(cellKey(x - 1, y)) !== h) g.lineBetween(px - half, py - half, px - half, py + half);
      if (lay.cells.get(cellKey(x, y + 1)) !== h) g.lineBetween(px - half, py + half, px + half, py + half);
      if (lay.cells.get(cellKey(x, y - 1)) !== h) g.lineBetween(px - half, py - half, px + half, py - half);
    }
  }

  // Continuous water with sparse, seeded ripples. No pond sprites: even their center frame has a rim.
  // Fill complete horizontal runs first so shared cell edges cannot form a tile grid. Shallows and foam
  // are drawn only against actual land, never between water cells or along the open sea/map edge.
  private drawWater(g: Phaser.GameObjects.Graphics, lay: Layout, water: Set<string>): void {
    const wet = (x: number, y: number) => {
      const key = cellKey(x, y);
      if (water.has(key)) return true;
      if (lay.cells.has(key)) return false;
      const o = lay.outsideCells.get(key);
      return !o || !o.tile || o.tile.terrain === 'water';
    };
    const rows = new Map<number, number[]>();
    for (const key of water) {
      const [x, y] = parseKey(key);
      const row = rows.get(y);
      if (row) row.push(x);
      else rows.set(y, [x]);
    }
    g.fillStyle(SEA_COLOR, 1);
    for (const [y, xs] of rows) {
      xs.sort((a, b) => a - b);
      let start = xs[0];
      let end = start;
      const fill = () => g.fillRect(start * T - T / 2, y * T - T / 2, (end - start + 1) * T, T);
      for (let i = 1; i < xs.length; i++) {
        if (xs[i] === end + 1) end = xs[i];
        else {
          fill();
          start = end = xs[i];
        }
      }
      fill();
    }
    const c = CityScene.link?.city;
    const seed = c ? c.col * 92821 + c.row * 68917 : 0;
    for (const key of water) {
      const [dx, dy] = parseKey(key);
      const left = dx * T - T / 2;
      const top = dy * T - T / 2;
      // A few short highlights, jittered inside the cell rather than aligned along its edges.
      for (let k = 0; k < 3; k++) {
        if (hash01(dx, dy, seed, 70 + k) > 0.4) continue;
        const x = left + 8 + Math.floor(hash01(dx, dy, seed, 80 + k) * (T - 20));
        const y = top + 8 + Math.floor(hash01(dx, dy, seed, 90 + k) * (T - 16));
        const w = 2 + Math.floor(hash01(dx, dy, seed, 100 + k) * 4);
        g.fillStyle(SEA_FOAM, 0.28);
        g.fillRect(x, y, w, 1);
      }
      const n = !wet(dx, dy - 1);
      const s = !wet(dx, dy + 1);
      const w = !wet(dx - 1, dy);
      const e = !wet(dx + 1, dy);
      g.fillStyle(SEA_SHALLOWS, 1);
      if (n) g.fillRect(left, top, T, 5);
      if (s) g.fillRect(left, top + T - 5, T, 5);
      if (w) g.fillRect(left, top, 5, T);
      if (e) g.fillRect(left + T - 5, top, 5, T);
      g.fillStyle(SEA_FOAM, 0.65);
      if (n) g.fillRect(left, top, T, 1);
      if (s) g.fillRect(left, top + T - 1, T, 1);
      if (w) g.fillRect(left, top, 1, T);
      if (e) g.fillRect(left + T - 1, top, 1, T);
      // Concave shoreline corners: a diagonal land cell touches this water cell at one point.
      g.fillStyle(SEA_SHALLOWS, 1);
      if (!n && !w && !wet(dx - 1, dy - 1)) g.fillRect(left, top, 3, 3);
      if (!n && !e && !wet(dx + 1, dy - 1)) g.fillRect(left + T - 3, top, 3, 3);
      if (!s && !w && !wet(dx - 1, dy + 1)) g.fillRect(left, top + T - 3, 3, 3);
      if (!s && !e && !wet(dx + 1, dy + 1)) g.fillRect(left + T - 3, top + T - 3, 3, 3);
    }
  }

  // Can the dragged decoration land where it is now? (red outline when not; it snaps back on drop)
  private dropOk(m: { from: XY; to: XY }): boolean {
    const link = CityScene.link;
    return !!link && moveReason(link.state, link.city, m.from[0], m.from[1], m.to[0], m.to[1]) === '';
  }

  // Your decorations, then the wild trees and flowers on any cell you haven't used, top row first.
  // No wild scenery on the water, the Keep, amenity spots or right around them. Forest hexes grow thick woods,
  // farm hexes stay mostly open, sand is sparse.
  private drawTown(c: Tile, town: Town, seed: number): void {
    const g = this.scenery;
    const lay = town.lay;
    const art = canDraw(this, [
      { s: 't', f: SCENERY.tallTop, x: 0, y: 0 }, { s: 't', f: SCENERY.tallBottom, x: 0, y: 0 },
      { s: 't', f: SCENERY.small, x: 0, y: 0 }, { s: 't', f: SCENERY.bush, x: 0, y: 0 },
    ]);
    const mv = this.moving;
    const order = [...lay.cells.keys()].map(parseKey).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const nearLot = (x: number, y: number) =>
      !!lotAt(lay, x, y) || !!lotAt(lay, x + 1, y) || !!lotAt(lay, x - 1, y) || !!lotAt(lay, x, y + 1) || !!lotAt(lay, x, y - 1);
    for (const [dx, dy] of order) {
      const key = cellKey(dx, dy);
      const k = town.objs.get(key);
      if (k !== undefined) {
        const lifted = !!mv && mv.from[0] === dx && mv.from[1] === dy;
        this.deco(c, k, dx, dy, lifted ? 0.3 : 1);
        continue;
      }
      if (town.ground.has(key)) continue; // anything you painted here (a path or grass) replaces the wild scenery
      if (mv && mv.to[0] === dx && mv.to[1] === dy) continue; // room for the one being dragged here
      const h = lay.cells.get(key)!;
      if (h.terrain === 'water') continue;
      if ((Math.abs(dx) <= 1 && Math.abs(dy) <= 1) || keepTile(dx, dy) || nearLot(dx, dy) || yardOf(lay, dx, dy)) continue;
      const imp = h.tile.improvement;
      const roll = hash01(dx, dy, seed, 10);
      if (imp === 'farm' && roll > 0.06) continue; // fields stay open
      if (h.terrain === 'sand' && roll > 0.18) continue;
      const edge = !lay.cells.has(cellKey(dx + 1, dy)) || !lay.cells.has(cellKey(dx - 1, dy)) || !lay.cells.has(cellKey(dx, dy + 1)) || !lay.cells.has(cellKey(dx, dy - 1));
      if (art) {
        this.artScenery(dx, dy, seed, roll, edge, imp === 'forest', h.terrain);
        continue;
      }
      if (h.terrain === 'hills' && roll < 0.45) {
        this.mounds(dx, dy, seed);
        continue;
      }
      if (roll > (imp === 'forest' ? 0.7 : 0.42)) continue;
      const x = dx * T + (hash01(dx, dy, seed, 11) - 0.5) * T * 0.35;
      const y = dy * T + (hash01(dx, dy, seed, 12) - 0.5) * T * 0.35;
      if (roll < 0.2 || imp === 'forest') this.tree(g, x, y, 0.85 + hash01(dx, dy, seed, 13) * 0.35);
      else if (roll < 0.33) this.bush(g, x, y);
      else this.rock(g, x, y);
      if (roll < 0.1) this.tree(g, x + T * 0.28, y + T * 0.18, 0.7);
    }
    // The decoration being dragged, on top of everything at the cell under your finger
    if (mv && (mv.to[0] !== mv.from[0] || mv.to[1] !== mv.from[1])) {
      const k = town.objs.get(cellKey(mv.from[0], mv.from[1]));
      if (k !== undefined) this.deco(c, k, mv.to[0], mv.to[1], 0.85);
    }
  }

  // One decoration on cell (dx, dy)
  private deco(c: Tile, k: number, dx: number, dy: number, alpha: number): void {
    const id = DECO_ORDER[k];
    if (!id) return;
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

  // A fence line through the middle of the cell, joined to the fences next to it
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

  // A painted path cell. Dirt joins its neighbors (and the castle and amenities) so corners draw themselves.
  // Grass draws nothing: the grass ground is already under it.
  private path(g: Phaser.GameObjects.Graphics, s: GameState, c: Tile, dx: number, dy: number, k: number): void {
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
      const l = pathLinks(s, c, dx, dy);
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

  // One cell of Kenney scenery. Along the border: thick clumps of round trees, like the woods in Kenney's sample.
  // Inside: tall trees (a few in autumn colors), bushes, sprouts, mushrooms, bare patches and flowers.
  // forest: a planted forest hex, mostly trees. Hills get low mounds and the odd pebble, sand only the odd bush.
  private artScenery(dx: number, dy: number, seed: number, roll: number, edge: boolean, forest: boolean, t: PlotTerrain): void {
    const cx = dx * T;
    const cy = dy * T;
    if ((edge && roll < 0.3) || (forest && roll < 0.35)) {
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
    const x = cx + (hash01(dx, dy, seed, 11) - 0.5) * ART;
    const y = cy + (hash01(dx, dy, seed, 12) - 0.5) * ART;
    if (t === 'hills' && !forest) {
      if (roll < 0.45) {
        this.mounds(dx, dy, seed);
        return;
      }
      if (roll > 0.85) {
        this.bob('obj', 'r', 614, x - 8, y - 8);
        return;
      }
    }
    if (roll > (forest ? 0.75 : 0.5)) return;
    const flower = (salt: number) => SCENERY.flowers[Math.floor(hash01(dx, dy, seed, salt) * SCENERY.flowers.length)];
    const tall = (px: number, py: number, autumn: boolean) => {
      this.bob('obj', 't', autumn ? SCENERY.autumnTop : SCENERY.tallTop, px - 8, py - 24);
      this.bob('obj', 't', autumn ? SCENERY.autumnBottom : SCENERY.tallBottom, px - 8, py - 8);
    };
    if (t === 'sand') {
      this.bob('obj', 't', SCENERY.bush, x - 8, y - 8);
      return;
    }
    if (roll < 0.22 || forest) {
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

  // A hill cell's mounds: one big, sometimes a small one in front, nudged a little so rows don't line up
  private mounds(dx: number, dy: number, seed: number): void {
    const g = this.scenery;
    const x = dx * T + Math.round((hash01(dx, dy, seed, 40) - 0.5) * 10);
    const y = dy * T + 8;
    this.mound(g, x - 5, y, 28, 12);
    if (hash01(dx, dy, seed, 41) < 0.6) this.mound(g, x + 11, y + 6, 16, 8);
  }

  // One low mound in 2px steps (so it sits with the pixel art): lit on the left, shaded on the right, light cap
  private mound(g: Phaser.GameObjects.Graphics, cx: number, base: number, w: number, h: number): void {
    g.fillStyle(0x000000, 0.14);
    g.fillRect(cx - w / 2 + 2, base, w - 2, 2);
    for (let k = 0; k < h; k += 2) {
      const half = Math.max(2, Math.round(((w / 2) * Math.sqrt(1 - (k / h) ** 2)) / 2) * 2);
      const row = base - k - 2;
      g.fillStyle(k >= h - 4 ? HILL_TOP : HILL_LIT, 1);
      g.fillRect(cx - half, row, half * 2, 2);
      if (half > 2) {
        g.fillStyle(HILL_SHADE, 1);
        g.fillRect(cx + 2, row, half - 2, 2);
      }
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

  // An open amenity spot's ground: a dirt lot on grass and hills, a rim on sand. Water spots are part of the sea.
  private lotGround(g: Phaser.GameObjects.Graphics, x: number, y: number, t: PlotTerrain, alpha: number): void {
    if (t === 'water') return;
    const green = t === 'grass' || t === 'hills';
    if (green && canDraw(this, PLOT_GROUND.grass)) {
      this.cells('ground', PLOT_GROUND.grass, x - T / 2, y - T / 2, alpha);
      return;
    }
    const l = x - T / 2 + 3;
    const top = y - T / 2 + 3;
    const s = T - 6;
    if (green) {
      g.fillStyle(PLOT_COLOR[t], alpha);
      g.fillRoundedRect(l, top, s, s, 7);
    }
    g.lineStyle(2, 0x3b2a17, 0.45 * alpha);
    g.strokeRoundedRect(l, top, s, s, 7);
  }

  private dots(g: Phaser.GameObjects.Graphics, x1: number, y1: number, x2: number, y2: number, color: number, alpha: number): void {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 1) return;
    const start = T * 0.55; // from the building's edge
    const end = len - T * 0.4; // to just short of the other hex's middle
    g.fillStyle(color, alpha);
    for (let d = start; d < end; d += 10) {
      const f = d / len;
      g.fillCircle(x1 + (x2 - x1) * f, y1 + (y2 - y1) * f, 2);
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

  // The people on a cell: one by its left edge, one by its right (a lone guard stands on the right)
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
