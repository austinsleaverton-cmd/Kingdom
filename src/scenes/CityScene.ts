// City screen: the inside of one of your cities as its own Phaser scene (docs/CITY_BUILDER.md).
// A grassy town square with the Keep dead center and the 6 plots as one tile each (no built-in roads: you paint
// your own paths in decorate mode, task 5), and the map hex each plot faces as a small marker just past the edge.
// Drag to pan, pinch or wheel to zoom.
// Art: Kenney tilesheets (cityArt.ts), one city tile = 3x3 art tiles. If a sheet or a tile is missing, that
// piece falls back to the old drawn look (colored shapes and emoji), so the screen always works.
// Rendering and input only: the DOM side panel (CityView.ts) owns the selection and does all the building,
// so a drag or a pinch can never build anything by accident.
import Phaser from 'phaser';
import type { GameState } from '../world/game';
import { facingTile, openPlots, plotBonus, plotTerrain } from '../world/city';
import type { Outside } from '../world/city';
import { PLOT_TILES, gridRadius, plotAtTile, plotLevel, reservedTile } from '../world/grid';
import { BUILDINGS, LEVEL_NAMES, PLOT_COUNT } from '../world/tile';
import type { Building, PlotTerrain, Terrain, Tile } from '../world/tile';
import { BUILDER_PEOPLE, PLOT_PEOPLE, keepPeople, makeCitySprites } from './citySprites';
import type { PxActor } from './citySprites';
import {
  ART, BUILDING_ART, GRASS, HILL_ROCK, KEEP_ART, PLOT_GROUND, RPG, SCENERY, TINY,
  canDraw, crispCityArt, hasFrame, loadCityArt,
} from './cityArt';
import type { Cell, Pic, Sheet } from './cityArt';

export const CITY_SCENE = 'city';
export type CityPick = number | 'keep';

// What the scene needs from the side panel
export interface CityLink {
  state: GameState;
  city: Tile;
  me: number;
  sel(): CityPick; // what's selected (plot index or the Keep)
  view(): { x: number; y: number; w: number; h: number }; // screen area not covered by the DOM header/panel
  pick(p: CityPick): void; // tapped a plot, a facing marker or the Keep
  close(): void; // Esc / O
}

const T = ART * 3; // tile size in world px: 3x3 Kenney tiles
const MARKER_OUT = 0.85; // facing markers sit this many tiles past the edge
const MARKER_R = T * 0.3; // facing marker size
const DRAG_PX = 8; // movement before a press counts as a pan, not a tap
const LABEL_MIN = 30; // tile size on screen (px) below which names hide (icons stay)
const PERSON_SCALE = 1.5;
const NAME_Y = T / 2 + 1; // building names sit on the bottom edge of their plot

const GRASS_COLOR = 0x62a948;
const GRASS_LIGHT = 0x6db552;
const GRASS_DARK = 0x58993f;
const PLOT_COLOR: Record<PlotTerrain, number> = { water: 0x1f5f9e, sand: 0xd9c38a, grass: 0x7cc463, hills: 0x8c7a4c };
const PLOT_NAME: Record<PlotTerrain, string> = { water: 'Water', sand: 'Sand', grass: 'Grass', hills: 'Hills' };
const OUT_COLOR: Record<Terrain, number> = { water: 0x1f5f9e, sand: 0xd9c38a, grass: 0x6bb352, hills: 0x8c7a4c, mountain: 0x9a9a9a };
const OUT_ICON: Record<Outside, string> = { farm: '\u{1F33E}', pasture: '\u{1F40E}', mine: '\u26CF\uFE0F', forest: '\u{1F332}', fishery: '\u{1F41F}', road: '\u{1F6E4}\uFE0F' };

type Layer = 'ground' | 'obj';

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

export class CityScene extends Phaser.Scene {
  static link: CityLink | null = null;
  private static instance: CityScene | null = null;

  private ground!: Phaser.GameObjects.Graphics;
  private scenery!: Phaser.GameObjects.Graphics;
  private marks!: Phaser.GameObjects.Graphics;
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
  private pinching = false;

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

  // Runs once, the first time a city opens. A sheet that fails to download is simply left out.
  preload(): void {
    loadCityArt(this);
  }

  create(): void {
    makeCitySprites(this);
    crispCityArt(this);
    this.cameras.main.setBackgroundColor('#141a26');
    this.ground = this.add.graphics().setDepth(0);
    this.scenery = this.add.graphics().setDepth(1.5);
    this.marks = this.add.graphics().setDepth(1);
    this.selG = this.add.graphics().setDepth(4);
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
    this.pressed = false;
    this.dragging = false;
    this.pinching = false;
    this.pinchDist = 0;
  }

  private handlePinch(): boolean {
    const a = this.input.pointer1;
    const b = this.input.pointer2;
    if (!a?.isDown || !b?.isDown) {
      this.pinchDist = 0;
      return false;
    }
    this.pinching = true;
    this.dragging = true;
    const dist = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
    if (this.pinchDist > 0 && dist > 0) this.zoomAt(dist / this.pinchDist, (a.x + b.x) / 2, (a.y + b.y) / 2);
    this.pinchDist = dist;
    return true;
  }

  private setupInput(): void {
    this.input.mouse?.disableContextMenu();
    if (this.input.manager.pointersTotal < 2) this.input.addPointer(1); // second finger for pinch zoom

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.input.pointer1?.isDown && this.input.pointer2?.isDown) this.pinching = true;
      this.pressed = true;
      this.dragging = false;
      this.downX = p.x;
      this.downY = p.y;
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.handlePinch()) return;
      if (this.pinching) return; // one finger lifted mid-pinch: wait until both are up
      if (this.pressed && p.isDown) {
        if (!this.dragging && Math.hypot(p.x - this.downX, p.y - this.downY) > DRAG_PX) this.dragging = true;
        if (this.dragging) {
          const cam = this.cameras.main;
          cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
          cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
          this.clampCam();
          return;
        }
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
      if (!tap || p.rightButtonReleased()) return;
      const hit = this.pickAt(p.x, p.y);
      if (hit !== null) CityScene.link?.pick(hit);
    });

    // Same feel as the map: scale by how far the wheel/trackpad moved (ctrl+wheel = macOS trackpad pinch)
    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      const ev = p.event as WheelEvent;
      const delta = Phaser.Math.Clamp(dy, -60, 60);
      this.zoomAt(Math.exp(-delta * (ev.ctrlKey ? 0.01 : 0.0015)), p.x, p.y);
    });

    // Esc or O again: back to the map
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key.toUpperCase() === 'O') CityScene.link?.close();
    });
  }

  // What's under a screen point: a facing marker (counts as its plot), a plot tile or the Keep
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

  // A building centered on its plot (shifted left to make room for its prop). False = use the emoji instead.
  private building(b: Building, x: number, y: number, alpha: number): boolean {
    const pic: Pic = BUILDING_ART[b];
    const all = pic.prop ? [...pic.cells, pic.prop] : pic.cells;
    if (!canDraw(this, all)) return false;
    const left = x - (pic.w * ART) / 2 - (pic.prop ? 7 : 0);
    const top = y - (pic.h * ART) / 2 - 4;
    this.cells('obj', pic.cells, left, top, alpha);
    if (pic.prop) this.bob('obj', pic.prop.s, pic.prop.f, x + 9, y - 3, alpha);
    return true;
  }

  // ---------- drawing ----------

  private redraw(): void {
    const link = CityScene.link;
    if (!link || !this.ready) return;
    const { state: s, city: c } = link;
    const sel = link.sel();
    const r = gridRadius(c);
    const open = openPlots(c, s.isSimple(link.me));
    const seed = c.col * 92821 + c.row * 68917;
    this.nText = 0;
    this.nPeople = 0;
    this.labels = [];
    for (const layer of Object.values(this.blit)) for (const b of Object.values(layer)) b?.clear();

    // Ground: one field of grass (no tile lines; the grid only shows when placing things, task 5)
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

    // Keep: a stone yard with the castle gate (walls level in the label)
    g.fillStyle(0x6b7280, 1);
    g.fillCircle(0, 0, T * 0.62);
    if (canDraw(this, KEEP_ART.cells)) {
      this.cells('obj', KEEP_ART.cells, -(KEEP_ART.w * ART) / 2, -(KEEP_ART.h * ART) / 2 - 2);
      this.txt(0, NAME_Y, `Keep${c.walls ? ` \u00b7 walls ${c.walls}` : ''}`, 9, { label: true });
    } else {
      g.fillStyle(0x2a2f3a, 1);
      g.fillRoundedRect(-T / 2 + 2, -T / 2 + 2, T - 4, T - 4, 8);
      g.lineStyle(2 + c.walls * 1.5, 0x9ca3af, 1);
      g.strokeRoundedRect(-T / 2 + 3, -T / 2 + 3, T - 6, T - 6, 8);
      this.txt(0, -5, '\u{1F3F0}', 24);
      this.txt(0, 15, `Keep${c.walls ? ` \u00b7 walls ${c.walls}` : ''}`, 9, { label: true });
    }
    this.crowd(keepPeople(c.walls), 0, 0, 3);

    // The 6 plots
    for (let i = 0; i < PLOT_COUNT; i++) {
      const [tx, ty] = PLOT_TILES[i];
      const x = tx * T;
      const y = ty * T;
      const t = plotTerrain(c, i);
      const locked = i >= open;
      const b = c.placed[i];
      const proj = c.projectPlot === i ? c.project : null;
      if (locked && !b) {
        // Locked: a faint outline of the plot to come, small lock and level name
        this.plotGround(g, x, y, t, 0.25);
        this.txt(x, y - 4, '\u{1F512}', 12, { alpha: 0.6 });
        this.txt(x, y + 12, LEVEL_NAMES[plotLevel(i)], 8, { alpha: 0.7, small: true });
        continue;
      }
      this.plotGround(g, x, y, t, 1);
      if (b) {
        if (this.building(b, x, y, 1)) this.txt(x, y + NAME_Y, BUILDINGS[b].name, 10, { label: true });
        else {
          this.txt(x, y - 6, BUILDINGS[b].icon, 22);
          this.txt(x, y + 13, BUILDINGS[b].name, 10, { label: true });
        }
        this.crowd(PLOT_PEOPLE[b], x, y, i);
      } else if (proj) {
        // Under construction: a see-through version of what's going up
        if (this.building(proj, x, y, 0.45)) this.txt(x, y + NAME_Y, `${c.projectTurns}t left`, 10, { label: true });
        else {
          this.txt(x, y - 6, BUILDINGS[proj].icon, 22, { alpha: 0.45 });
          this.txt(x, y + 13, `${c.projectTurns}t left`, 10, { label: true });
        }
        this.crowd(BUILDER_PEOPLE, x, y, i);
      } else {
        this.txt(x, y - 5, '+', 26, { alpha: 0.85 });
        this.txt(x, y + 14, PLOT_NAME[t], 9, { label: true });
      }
    }

    // Scenery: trees, bushes, rocks and flowers on open ground, just for looks (cleared once you can decorate, task 5)
    this.drawScenery(r, seed);

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
      const picked = sel === i;
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

    // Selection
    this.selG.clear();
    const [sx, sy] = sel === 'keep' ? [0, 0] : PLOT_TILES[sel];
    this.selG.lineStyle(6, 0x000000, 0.4);
    this.selG.strokeRoundedRect(sx * T - T / 2 + 1, sy * T - T / 2 + 1, T - 2, T - 2, 6);
    this.selG.lineStyle(3, 0xfacc15, 1);
    this.selG.strokeRoundedRect(sx * T - T / 2 + 1, sy * T - T / 2 + 1, T - 2, T - 2, 6);

    for (let k = this.nText; k < this.texts.length; k++) this.texts[k].setVisible(false);
    for (let k = this.nPeople; k < this.people.length; k++) this.people[k].setVisible(false).stop();
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

  // Seeded, so the same city always looks the same. Skips the Keep yard, plots and the tiles hugging them.
  private drawScenery(r: number, seed: number): void {
    const g = this.scenery;
    g.clear();
    const art = canDraw(this, [
      { s: 't', f: SCENERY.tallTop, x: 0, y: 0 }, { s: 't', f: SCENERY.tallBottom, x: 0, y: 0 },
      { s: 't', f: SCENERY.small, x: 0, y: 0 }, { s: 't', f: SCENERY.bush, x: 0, y: 0 },
    ]);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (reservedTile(dx, dy) || (Math.abs(dx) <= 1 && Math.abs(dy) <= 1)) continue;
        if (PLOT_TILES.some(([px, py]) => Math.abs(px - dx) + Math.abs(py - dy) === 1)) continue; // leave room around plots
        const roll = hash01(dx, dy, seed, 10);
        if (art) {
          if (roll > 0.5) continue;
          this.artScenery(dx, dy, seed, roll);
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
  }

  // One tile of Kenney scenery: tree groves (a few in autumn colors), a bush with a flower, pebbles or flowers
  private artScenery(dx: number, dy: number, seed: number, roll: number): void {
    const x = dx * T + (hash01(dx, dy, seed, 11) - 0.5) * ART;
    const y = dy * T + (hash01(dx, dy, seed, 12) - 0.5) * ART;
    const flower = (salt: number) => SCENERY.flowers[Math.floor(hash01(dx, dy, seed, salt) * SCENERY.flowers.length)];
    const tall = (px: number, py: number, autumn: boolean) => {
      this.bob('obj', 't', autumn ? SCENERY.autumnTop : SCENERY.tallTop, px - 8, py - 24);
      this.bob('obj', 't', autumn ? SCENERY.autumnBottom : SCENERY.tallBottom, px - 8, py - 8);
    };
    if (roll < 0.22) {
      const autumn = hash01(dx, dy, seed, 17) < 0.15;
      if (hash01(dx, dy, seed, 13) < 0.6) tall(x, y, autumn);
      else this.bob('obj', 't', autumn ? SCENERY.smallAutumn : SCENERY.small, x - 8, y - 12);
      if (roll < 0.12) tall(x + 11, y + 8, false);
      if (roll < 0.06) this.bob('obj', 't', SCENERY.small, x - 17, y + 4);
    } else if (roll < 0.32) {
      this.bob('obj', 't', SCENERY.bush, x - 8, y - 8);
      const f = flower(15);
      this.bob('obj', f.s, f.f, x + 6, y);
    } else if (roll < 0.4) {
      this.bob('obj', SCENERY.rock.s, SCENERY.rock.f, x - 8, y - 8);
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

  // A plot's own ground (its map terrain): Kenney tiles if available, otherwise a colored square with a rim
  private plotGround(g: Phaser.GameObjects.Graphics, x: number, y: number, t: PlotTerrain, alpha: number): void {
    const cells = PLOT_GROUND[t];
    if (canDraw(this, cells)) {
      this.cells('ground', cells, x - T / 2, y - T / 2, alpha);
      if (t === 'hills') this.bob('ground', HILL_ROCK.s, HILL_ROCK.f, x + 6, y + 6, alpha);
      return;
    }
    const l = x - T / 2 + 3;
    const top = y - T / 2 + 3;
    const s = T - 6;
    g.fillStyle(PLOT_COLOR[t], alpha);
    g.fillRoundedRect(l, top, s, s, 7);
    if (t === 'water') {
      g.lineStyle(1.5, 0x7dd3fc, 0.5 * alpha);
      g.lineBetween(x - 14, y - 10, x - 5, y - 10);
      g.lineBetween(x + 3, y - 3, x + 13, y - 3);
      g.lineBetween(x - 10, y + 5, x - 2, y + 5);
    } else if (t === 'hills') {
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
