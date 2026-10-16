// City screen: the inside of one of your cities as its own Phaser scene (docs/CITY_BUILDER.md).
// A square ground grid with the Keep dead center, the 6 plots as one tile each, a road from the Keep to every plot,
// and the map hex each plot faces as a small marker just past the grid edge. Drag to pan, pinch or wheel to zoom.
// Rendering and input only: the DOM side panel (CityView.ts) owns the selection and does all the building,
// so a drag or a pinch can never build anything by accident.
import Phaser from 'phaser';
import type { GameState } from '../world/game';
import { facingTile, openPlots, plotBonus, plotTerrain } from '../world/city';
import type { Outside } from '../world/city';
import { PLOT_TILES, ROAD_TILES, gridRadius, plotAtTile, plotLevel } from '../world/grid';
import { BUILDINGS, LEVEL_NAMES, PLOT_COUNT } from '../world/tile';
import type { PlotTerrain, Terrain, Tile } from '../world/tile';
import { BUILDER_PEOPLE, PLOT_PEOPLE, keepPeople, makeCitySprites } from './citySprites';
import type { PxActor } from './citySprites';

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

const T = 56; // tile size in world px
const MARKER_OUT = 0.95; // facing markers sit this many tiles past the grid edge
const DRAG_PX = 8; // movement before a press counts as a pan, not a tap
const LABEL_MIN = 34; // tile size on screen (px) below which names hide (icons stay)
const PERSON_SCALE = 1.5;

const GRASS = [0x5fa646, 0x66ad4c, 0x6cb452];
const ROAD = 0xa98455;
const ROAD_EDGE = 0x7f6038;
const PLOT_COLOR: Record<PlotTerrain, number> = { water: 0x1f5f9e, sand: 0xd9c38a, grass: 0x7cc463, hills: 0x8c7a4c };
const PLOT_NAME: Record<PlotTerrain, string> = { water: 'Water', sand: 'Sand', grass: 'Grass', hills: 'Hills' };
const OUT_COLOR: Record<Terrain, number> = { water: 0x1f5f9e, sand: 0xd9c38a, grass: 0x6bb352, hills: 0x8c7a4c, mountain: 0x9a9a9a };
const OUT_ICON: Record<Outside, string> = { farm: '\u{1F33E}', pasture: '\u{1F40E}', mine: '\u26CF\uFE0F', forest: '\u{1F332}', fishery: '\u{1F41F}', road: '\u{1F6E4}\uFE0F' };

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

// Same grass pattern every time you open the same city
function grassAt(dx: number, dy: number, seed: number): number {
  const h = Math.imul(dx + 101, 73856093) ^ Math.imul(dy + 211, 19349663) ^ seed;
  return GRASS[((h >>> 0) % 7) % GRASS.length];
}

export class CityScene extends Phaser.Scene {
  static link: CityLink | null = null;
  private static instance: CityScene | null = null;

  private ground!: Phaser.GameObjects.Graphics;
  private marks!: Phaser.GameObjects.Graphics;
  private selG!: Phaser.GameObjects.Graphics;
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

  create(): void {
    makeCitySprites(this);
    this.cameras.main.setBackgroundColor('#141a26');
    this.ground = this.add.graphics().setDepth(0);
    this.marks = this.add.graphics().setDepth(1);
    this.selG = this.add.graphics().setDepth(4);
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

  // Whole grid plus the facing markers fits the free part of the screen, Keep in the middle of it
  private fit(): void {
    const link = CityScene.link;
    if (!link) return;
    const cam = this.cameras.main;
    const v = this.view();
    const extent = (gridRadius(link.city) + MARKER_OUT + 0.7) * 2 * T;
    const z = Phaser.Math.Clamp(Math.min(v.w / extent, v.h / extent), 0.25, 3);
    this.minZoom = z * 0.75;
    this.maxZoom = Math.max(z * 4, 2.5);
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

  // Never lose the town: the middle of the view stays over the grid
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
      if (Math.hypot(w.x - mx * T, w.y - my * T) < T * 0.5) return i;
    }
    const dx = Math.round(w.x / T);
    const dy = Math.round(w.y / T);
    if (Math.abs(dx) > r || Math.abs(dy) > r) return null;
    if (dx === 0 && dy === 0) return 'keep';
    return plotAtTile(dx, dy);
  }

  // ---------- drawing ----------

  private redraw(): void {
    const link = CityScene.link;
    if (!link || !this.ready) return;
    const { state: s, city: c } = link;
    const sel = link.sel();
    const r = gridRadius(c);
    const open = openPlots(c, s.isSimple(link.me));
    this.nText = 0;
    this.nPeople = 0;
    this.labels = [];

    // Ground: a raised square of grass with a dark edge and a soft shadow
    const g = this.ground;
    g.clear();
    const half = (r + 0.5) * T;
    g.fillStyle(0x000000, 0.35);
    g.fillRect(-half + 6, -half + 10, 2 * half, 2 * half);
    g.fillStyle(0x2f5a24, 1);
    g.fillRect(-half - 5, -half - 5, 2 * half + 10, 2 * half + 10);
    const seed = c.col * 92821 + c.row * 68917;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        g.fillStyle(grassAt(dx, dy, seed), 1);
        g.fillRect(dx * T - T / 2, dy * T - T / 2, T, T);
      }
    }
    g.lineStyle(1, 0x000000, 0.07);
    for (let k = -r; k <= r + 1; k++) {
      g.lineBetween(k * T - T / 2, -half, k * T - T / 2, half);
      g.lineBetween(-half, k * T - T / 2, half, k * T - T / 2);
    }

    // Roads from the Keep to each plot
    for (const [dx, dy] of ROAD_TILES) {
      const x = dx * T;
      const y = dy * T;
      g.fillStyle(ROAD_EDGE, 1);
      g.fillRect(x - T / 2 + 4, y - T / 2 + 4, T - 8, T - 8);
      g.fillStyle(ROAD, 1);
      g.fillRect(x - T / 2 + 6, y - T / 2 + 6, T - 12, T - 12);
      g.fillStyle(ROAD_EDGE, 0.5);
      g.fillCircle(x - 8, y + 5, 2);
      g.fillCircle(x + 9, y - 6, 1.5);
    }

    // Keep: stone tile, walls drawn as a thicker grey rim per level
    g.fillStyle(0x2a2f3a, 1);
    g.fillRoundedRect(-T / 2 + 2, -T / 2 + 2, T - 4, T - 4, 6);
    g.lineStyle(2 + c.walls * 1.5, 0x9ca3af, 1);
    g.strokeRoundedRect(-T / 2 + 3, -T / 2 + 3, T - 6, T - 6, 6);
    this.txt(0, -5, '\u{1F3F0}', 28);
    this.txt(0, 17, `Keep${c.walls ? ` \u00b7 walls ${c.walls}` : ''}`, 9, { label: true });
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
      const dim = locked && !b ? 0.45 : 1;
      this.plotGround(g, x, y, t, dim);
      if (b) {
        this.txt(x, y - 6, BUILDINGS[b].icon, 26);
        this.txt(x, y + 15, BUILDINGS[b].name, 10, { label: true });
        this.crowd(PLOT_PEOPLE[b], x, y, i);
      } else if (proj) {
        this.txt(x, y - 6, BUILDINGS[proj].icon, 26, { alpha: 0.45 });
        this.txt(x, y + 15, `${c.projectTurns}t left`, 10, { label: true });
        this.crowd(BUILDER_PEOPLE, x, y, i);
      } else if (locked) {
        this.txt(x, y - 5, '\u{1F512}', 18, { alpha: 0.85 });
        this.txt(x, y + 15, LEVEL_NAMES[plotLevel(i)], 9, { label: true });
      } else {
        this.txt(x, y - 5, '+', 28, { alpha: 0.85 });
        this.txt(x, y + 16, PLOT_NAME[t], 9, { label: true });
      }
    }

    // What each plot faces on the map: a small hex past the edge, lit green when it's paying a bonus
    const m = this.marks;
    m.clear();
    for (let i = 0; i < PLOT_COUNT; i++) {
      const t = facingTile(c, i);
      if (!t) continue;
      const [mx, my] = markerAt(i, r);
      const x = mx * T;
      const y = my * T;
      const mine = t.owner === c.owner;
      const b = c.placed[i];
      const paying = !!b && plotBonus(c, i, b).notes.some((n) => n.includes('facing'));
      // dotted guide from the plot out to its marker
      const [px, py] = PLOT_TILES[i];
      this.dots(m, px * T, py * T, x, y, paying ? 0x4ade80 : 0xffffff, paying ? 0.55 : 0.18);
      const pts = hexPts(x, y, T * 0.42);
      m.fillStyle(OUT_COLOR[t.terrain], mine ? 0.85 : 0.4);
      m.fillPoints(pts, true);
      m.lineStyle(paying ? 3 : 1.5, paying ? 0x4ade80 : 0x000000, paying ? 1 : 0.4);
      m.strokePoints(pts, true);
      const work = t.improvement ?? (t.road ? 'road' : null);
      if (work) this.txt(x, y, OUT_ICON[work], 15, { alpha: mine ? 1 : 0.5 });
    }

    // Selection
    this.selG.clear();
    const [sx, sy] = sel === 'keep' ? [0, 0] : PLOT_TILES[sel];
    this.selG.lineStyle(7, 0x000000, 0.4);
    this.selG.strokeRoundedRect(sx * T - T / 2 + 1, sy * T - T / 2 + 1, T - 2, T - 2, 7);
    this.selG.lineStyle(3.5, 0xfacc15, 1);
    this.selG.strokeRoundedRect(sx * T - T / 2 + 1, sy * T - T / 2 + 1, T - 2, T - 2, 7);

    for (let k = this.nText; k < this.texts.length; k++) this.texts[k].setVisible(false);
    for (let k = this.nPeople; k < this.people.length; k++) this.people[k].setVisible(false).stop();
  }

  // A plot's own ground (its map terrain) with a little fence-colored rim so plots read as building spots
  private plotGround(g: Phaser.GameObjects.Graphics, x: number, y: number, t: PlotTerrain, alpha: number): void {
    const l = x - T / 2 + 3;
    const top = y - T / 2 + 3;
    const s = T - 6;
    g.fillStyle(PLOT_COLOR[t], alpha);
    g.fillRoundedRect(l, top, s, s, 6);
    if (t === 'water') {
      g.lineStyle(1.5, 0x7dd3fc, 0.5 * alpha);
      g.lineBetween(x - 16, y - 12, x - 6, y - 12);
      g.lineBetween(x + 4, y - 4, x + 15, y - 4);
      g.lineBetween(x - 12, y + 6, x - 2, y + 6);
    } else if (t === 'hills') {
      g.fillStyle(0x6f6038, alpha);
      g.fillEllipse(x - 12, y + 12, 16, 8);
      g.fillEllipse(x + 13, y + 14, 14, 7);
    } else if (t === 'sand') {
      g.fillStyle(0xb9a46e, alpha);
      g.fillCircle(x - 15, y - 14, 1.5);
      g.fillCircle(x + 14, y - 10, 1.5);
      g.fillCircle(x + 10, y + 12, 1.5);
    }
    g.lineStyle(2, 0x3b2a17, 0.55 * alpha);
    g.strokeRoundedRect(l, top, s, s, 6);
  }

  private dots(g: Phaser.GameObjects.Graphics, x1: number, y1: number, x2: number, y2: number, color: number, alpha: number): void {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const start = T * 0.55; // from the plot's edge
    const end = len - T * 0.42; // to the marker's edge
    g.fillStyle(color, alpha);
    for (let d = start; d < end; d += 9) {
      const f = d / len;
      g.fillCircle(x1 + (x2 - x1) * f, y1 + (y2 - y1) * f, 1.6);
    }
  }

  private txt(x: number, y: number, s: string, size: number, o: { label?: boolean; alpha?: number } = {}): Phaser.GameObjects.Text {
    let t = this.texts[this.nText];
    if (!t) {
      t = this.add.text(0, 0, '', { fontFamily: 'system-ui, sans-serif', color: '#ffffff' }).setOrigin(0.5).setResolution(2);
      this.texts.push(t);
    }
    this.nText++;
    t.setText(s)
      .setFontSize(size)
      .setFontStyle(o.label ? 'bold' : '')
      .setStroke('#000000', o.label ? 3 : 0)
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
      this.person(a, x + side * 19, y + T / 2 - 3, seed + k);
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
