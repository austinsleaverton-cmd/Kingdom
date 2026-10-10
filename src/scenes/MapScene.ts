// Rendering and input only. All rules live in src/world.
import Phaser from 'phaser';
import { GameState } from '../world/game';
import type { Action } from '../world/game';
import { YIELD } from '../world/tile';
import type { Terrain, Tile } from '../world/tile';
import { Hud } from './Hud';

const SIZE = 28; // hex radius in px
const SQRT3 = Math.sqrt(3);
const DRAG_THRESHOLD = 6;

const HEIGHT_COLOR = [0x1f5f9e, 0xd9c38a, 0x6bb352, 0x4f9443, 0x8c7a4c, 0x9a9a9a];
const TERRAIN_NAME: Record<Terrain, string> = {
  water: 'Water',
  sand: 'Sand',
  grass: 'Grass',
  hills: 'Hills',
  mountain: 'Mountain',
};
// Hex edge i (between corner i and i+1) faces this neighbor direction.
const EDGE_TO_DIR = [0, 5, 4, 3, 2, 1];

export class MapScene extends Phaser.Scene {
  private state!: GameState;
  private hud!: Hud;
  private action: Action = 'claim';
  private hovered: Tile | null = null;
  private lastPointer = { x: 0, y: 0 };

  private terrainGfx!: Phaser.GameObjects.Graphics;
  private ownerGfx!: Phaser.GameObjects.Graphics;
  private hoverGfx!: Phaser.GameObjects.Graphics;

  private pressed = false;
  private dragging = false;
  private downX = 0;
  private downY = 0;

  constructor() {
    super('map');
  }

  create(): void {
    this.terrainGfx = this.add.graphics();
    this.ownerGfx = this.add.graphics();
    this.hoverGfx = this.add.graphics();

    this.hud = new Hud({
      onAction: (a) => this.selectAction(a),
      onEndTurn: () => this.endTurn(),
      onNewGame: () => this.newGame(),
    });

    this.setupInput();
    this.newGame();
  }

  // ---------- flow ----------

  private newGame(): void {
    this.state = new GameState();
    this.hovered = null;
    this.redraw();
    const cap = this.state.map.tiles.find((t) => t.capital && t.owner === 0);
    if (cap) {
      const { x, y } = tileCenter(cap);
      this.cameras.main.setZoom(1.2).centerOn(x, y);
    }
  }

  private selectAction(a: Action): void {
    this.action = a;
    this.refreshHover();
    this.hud.update(this.state, this.action);
  }

  private endTurn(): void {
    if (this.state.winner !== null) return;
    this.state.endTurn();
    this.redraw();
  }

  private clickTile(tile: Tile): void {
    const res = this.state.perform(this.action, tile);
    if (!res.ok) {
      this.cameras.main.shake(80, 0.002);
      return;
    }
    this.redraw();
  }

  // ---------- input ----------

  private setupInput(): void {
    this.input.mouse?.disableContextMenu();

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.pressed = true;
      this.dragging = false;
      this.downX = p.x;
      this.downY = p.y;
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.pressed && p.isDown) {
        if (!this.dragging && Math.hypot(p.x - this.downX, p.y - this.downY) > DRAG_THRESHOLD) {
          this.dragging = true;
        }
        if (this.dragging) {
          const cam = this.cameras.main;
          cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
          cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
          this.hud.hideTip();
          return;
        }
      }
      this.setHover(this.tileAtScreen(p.x, p.y), p.x, p.y);
    });

    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      const wasClick = this.pressed && !this.dragging;
      this.pressed = false;
      this.dragging = false;
      if (!wasClick || !p.leftButtonReleased()) return;
      const tile = this.tileAtScreen(p.x, p.y);
      if (tile) this.clickTile(tile);
      this.setHover(this.tileAtScreen(p.x, p.y), p.x, p.y);
    });

    this.input.on('gameout', () => this.setHover(null, 0, 0));

    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main;
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), 0.4, 3));
    });

    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      switch (e.key) {
        case '1': this.selectAction('claim'); break;
        case '2': this.selectAction('raise'); break;
        case '3': this.selectAction('lower'); break;
        case '4': this.selectAction('city'); break;
        case ' ':
        case 'Enter': this.endTurn(); break;
        case 'n':
        case 'N': this.newGame(); break;
      }
    });
  }

  private tileAtScreen(sx: number, sy: number): Tile | null {
    const w = this.cameras.main.getWorldPoint(sx, sy);
    const q = ((SQRT3 / 3) * w.x - (1 / 3) * w.y) / SIZE;
    const r = ((2 / 3) * w.y) / SIZE;
    // cube rounding
    const x = q;
    const z = r;
    const y = -x - z;
    let rx = Math.round(x);
    const ry = Math.round(y);
    let rz = Math.round(z);
    const dx = Math.abs(rx - x);
    const dy = Math.abs(ry - y);
    const dz = Math.abs(rz - z);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (!(dy > dz)) rz = -rx - ry;
    const row = rz;
    const col = rx + (row - (row & 1)) / 2;
    return this.state.map.get(col, row);
  }

  private setHover(tile: Tile | null, sx: number, sy: number): void {
    this.hovered = tile;
    this.lastPointer = { x: sx, y: sy };
    this.refreshHover();
  }

  private refreshHover(): void {
    this.hoverGfx.clear();
    const tile = this.hovered;
    if (!tile || this.state.winner !== null) {
      this.hud.hideTip();
      return;
    }
    const check = this.state.check(this.action, tile, 0);
    const { x, y } = tileCenter(tile);
    this.hoverGfx.lineStyle(3, check.ok ? 0xffffff : 0xff5555, 0.95);
    this.hoverGfx.strokePoints(hexCorners(x, y, SIZE - 1.5), true);

    const owner = tile.owner === null ? 'Unclaimed' : this.state.players[tile.owner].name;
    const lines = [
      `${TERRAIN_NAME[tile.terrain]} (height ${tile.height})`,
      `${owner}${tile.capital ? ' · Capital' : tile.city ? ' · City' : ''}`,
      `Yield ${YIELD[tile.terrain]}g/turn`,
    ];
    const label = this.action[0].toUpperCase() + this.action.slice(1);
    const status = check.ok ? `${label}: ${check.cost}g` : `${label}: ${check.reason}`;
    this.hud.showTip(lines, status, check.ok, this.lastPointer.x, this.lastPointer.y);
  }

  // ---------- drawing ----------

  private redraw(): void {
    this.drawTerrain();
    this.drawOwners();
    this.refreshHover();
    this.hud.update(this.state, this.action);
  }

  private drawTerrain(): void {
    const g = this.terrainGfx;
    g.clear();
    for (const t of this.state.map.tiles) {
      const { x, y } = tileCenter(t);
      const pts = hexCorners(x, y, SIZE);
      g.fillStyle(HEIGHT_COLOR[t.height], 1);
      g.fillPoints(pts, true);
      g.lineStyle(1, 0x000000, 0.25);
      g.strokePoints(pts, true);
      if (t.terrain === 'mountain') {
        g.fillStyle(0x6b6b6b, 1);
        g.fillTriangle(x - 12, y + 8, x, y - 11, x + 12, y + 8);
        g.fillStyle(0xf2f2f2, 1);
        g.fillTriangle(x - 4, y - 5, x, y - 11, x + 4, y - 5);
      } else if (t.terrain === 'hills') {
        g.fillStyle(0x6f6038, 1);
        g.fillEllipse(x - 6, y + 4, 14, 8);
        g.fillEllipse(x + 6, y + 6, 12, 7);
      }
    }
  }

  private drawOwners(): void {
    const g = this.ownerGfx;
    g.clear();
    const map = this.state.map;
    for (const t of map.tiles) {
      if (t.owner === null) continue;
      const color = this.state.players[t.owner].color;
      const { x, y } = tileCenter(t);
      const pts = hexCorners(x, y, SIZE);
      g.fillStyle(color, 0.28);
      g.fillPoints(pts, true);

      g.lineStyle(3, color, 1);
      for (let i = 0; i < 6; i++) {
        const n = map.neighborAt(t, EDGE_TO_DIR[i]);
        if (n && n.owner === t.owner) continue;
        const a = pts[i];
        const b = pts[(i + 1) % 6];
        g.lineBetween(a.x, a.y, b.x, b.y);
      }

      if (t.city) this.drawCity(g, x, y, color, t.capital);
    }
  }

  private drawCity(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number, capital: boolean): void {
    const s = capital ? 1.25 : 1;
    g.fillStyle(0x1b1b1b, 1);
    g.fillRect(x - 9 * s, y - 4 * s, 18 * s, 12 * s);
    g.fillStyle(color, 1);
    g.fillRect(x - 7 * s, y - 2 * s, 14 * s, 8 * s);
    g.fillTriangle(x - 10 * s, y - 3 * s, x, y - 12 * s, x + 10 * s, y - 3 * s);
    g.lineStyle(1.5, 0xffffff, 0.9);
    g.strokeRect(x - 7 * s, y - 2 * s, 14 * s, 8 * s);
    if (capital) {
      g.fillStyle(0xfacc15, 1);
      g.fillTriangle(x - 6, y - 17, x - 3, y - 22, x, y - 17);
      g.fillTriangle(x - 2, y - 17, x + 1, y - 24, x + 4, y - 17);
      g.fillTriangle(x + 2, y - 17, x + 5, y - 22, x + 8, y - 17);
    }
  }
}

function tileCenter(t: Tile): { x: number; y: number } {
  return {
    x: SIZE * SQRT3 * (t.col + 0.5 * (t.row & 1)),
    y: SIZE * 1.5 * t.row,
  };
}

function hexCorners(cx: number, cy: number, r: number): Phaser.Math.Vector2[] {
  const pts: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < 6; i++) {
    const a = Phaser.Math.DegToRad(60 * i - 30);
    pts.push(new Phaser.Math.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a)));
  }
  return pts;
}
